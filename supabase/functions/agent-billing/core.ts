import type { SupabaseClient } from 'npm:@supabase/supabase-js'

// Prompt 673: the agent retainer (weekly, agent pays Ohvara). There is one
// platform subscription now: Policy Servicing, a weekly price made from
// app_settings.agent_billing_weekly_cents. Inbounds are bought on top of it: a
// weekly amount per inbound type (Live Calls, Booked Appointments), one more
// item on the same subscription, tracked in agent_inbound_spend. Migration 113
// holds the state on profiles; this function is the only thing that writes it
// (service role), apart from an admin by hand.
//
// Prompt 734: billing is managed inside the portal: Embedded Checkout to
// subscribe, and our own actions for the card (SetupIntent + Payment Element),
// cancel / renew and invoices, instead of Stripe's hosted Customer Portal. Card
// numbers are still only typed into Stripe's own fields.
//
// Not the dead pre-pivot Payouts system: that used Stripe *Connect* to pay
// reps (stripe_account_id). This is Customers + Subscriptions, money the other
// way, and never touches those columns.
//
// index.ts wires Deno (env, the Supabase client, Deno.serve); everything else
// is here so it can be run against a mocked Stripe.
//
//   POST /agent-billing            { action, ... }   (the app)
//     status          — { configured, mode, webhook_configured, billing_status }.
//                       Signed in, it also re-syncs from Stripe, so a missed or
//                       late webhook heals the next time the agent opens Billing.
//                       Signed out, it returns the booleans only (ops check).
//     overview:       servicing, inbound, next charge, card, last 12 invoices,
//                       publishable key (Manage billing).
//     inbound_get:    what the agent buys on top, and the settings for it.
//     inbound_set:    { type, weekly_cents, paused }: change one inbound type.
//     checkout:       an Embedded Checkout session's client_secret.
//     setup_card      — a SetupIntent's client_secret for the Payment Element.
//     set_default_card— { payment_method }: makes it the card for the customer
//                       and the subscription; retries a past-due invoice.
//     cancel / resume — cancel_at_period_end on / off.
//     portal          — the old Customer Portal link. No UI points at it.
//   Every action works on the caller's own customer and subscription, read
//   from their profiles row. Ids in the request body are never used.
//
//   POST /agent-billing/webhook    (Stripe)
//     Verified against STRIPE_WEBHOOK_SECRET. Every event is used only for
//     the subscription id; the subscription itself is re-fetched from Stripe,
//     so out-of-order delivery can't write stale state.
//
// Deployed with verify_jwt off; users are authenticated here instead.
//
// Secrets: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET (the endpoint's whsec_…),
// STRIPE_PUBLISHABLE_KEY (pk_…, handed to the page for Stripe.js). Prices,
// Products and the portal configuration are created on first use.
//
// Stripe webhook endpoint:
//   https://jjextitmbptoaolacocs.supabase.co/functions/v1/agent-billing/webhook
// events: checkout.session.completed, customer.subscription.created,
//   customer.subscription.updated, customer.subscription.deleted,
//   invoice.paid, invoice.payment_failed
//   + transfer.reversed (Prompt 753, Fulfillment payouts)
// Prompt 753 also points a Connect endpoint ("events on connected accounts")
// at the same URL for account.updated and account.external_account.*; its
// signing secret is STRIPE_CONNECT_WEBHOOK_SECRET.

export type Env = {
  stripeKey?: string
  webhookSecret?: string
  publishableKey?: string
  // Prompt 753 — Fulfillment payouts ride on this same webhook URL. A Connect
  // endpoint ("events on connected accounts", for account.updated) has its own
  // signing secret; either secret is accepted. Connect events (account.*,
  // transfer.reversed) go to onConnectEvent instead of the billing sync.
  connectWebhookSecret?: string
  onConnectEvent?: (event: any) => Promise<Record<string, unknown>>
  fetch?: typeof fetch
  now?: () => number
}

let ENV: Env = {}
export function configure(env: Env) { ENV = env }
const now = () => (ENV.now ? ENV.now() : Date.now())

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

// Pinned so subscription.current_period_end, invoice.subscription and
// GET /invoices/upcoming stay where this code reads them. Webhook payloads
// follow the endpoint's own version, which is why events are only mined for
// ids (both shapes handled).
const STRIPE_VERSION = '2024-06-20'

const TAG = { ohvara: 'agent_billing' }
const GRACE_HOURS = 48 // keep in step with src/lib/billing.js
const MAX_SKEW_SECONDS = 5 * 60

// Where Stripe may send the agent back to. Anything else falls back to prod.
const DEFAULT_RETURN = 'https://portal.ohvara.com/agent/billing'
const ALLOWED_ORIGINS = ['https://portal.ohvara.com', 'https://ohvara-dashboard.vercel.app']

function safeReturnUrl(raw: unknown): string {
  try {
    const u = new URL(String(raw))
    const local = u.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(u.hostname)
    return ALLOWED_ORIGINS.includes(u.origin) || local ? u.toString() : DEFAULT_RETURN
  } catch {
    return DEFAULT_RETURN
  }
}

// An error whose message is safe to show the agent as is.
class AppError extends Error {
  status: number; code?: string
  constructor(status: number, message: string, code?: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

// ── Stripe REST ──────────────────────────────────────────────────────────────

class StripeError extends Error {
  code?: string; type?: string; status: number
  constructor(e: any, status: number, fallback: string) {
    super(e?.message || fallback)
    this.code = e?.code
    this.type = e?.type
    this.status = status
  }
}

const isMissing = (e: unknown) => e instanceof StripeError && e.code === 'resource_missing'

// Stripe takes form encoding with bracketed nesting: a[b][0][c]=…
function formEncode(obj: Record<string, unknown>, prefix = '', out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue
    const key = prefix ? `${prefix}[${k}]` : k
    if (Array.isArray(v)) {
      v.forEach((item, i) => {
        if (item !== null && typeof item === 'object') formEncode(item as Record<string, unknown>, `${key}[${i}]`, out)
        else out.append(`${key}[${i}]`, String(item))
      })
    } else if (typeof v === 'object') {
      formEncode(v as Record<string, unknown>, key, out)
    } else {
      out.append(key, String(v))
    }
  }
  return out
}

// List/retrieve calls must say method: 'GET'; params alone means a POST (create).
async function stripe(path: string, init: { method?: string; params?: Record<string, unknown>; idempotencyKey?: string } = {}) {
  const method = init.method || (init.params ? 'POST' : 'GET')
  const qs = method === 'GET' && init.params ? `?${formEncode(init.params)}` : ''
  const res = await (ENV.fetch || fetch)(`https://api.stripe.com/v1/${path}${qs}`, {
    method,
    headers: {
      Authorization: `Bearer ${ENV.stripeKey}`,
      'Stripe-Version': STRIPE_VERSION,
      ...(method !== 'GET' ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
      ...(init.idempotencyKey ? { 'Idempotency-Key': init.idempotencyKey } : {}),
    },
    body: method !== 'GET' && init.params ? formEncode(init.params) : undefined,
  })
  const data = await res.json()
  if (!res.ok) throw new StripeError(data?.error, res.status, `Stripe ${method} ${path} failed (${res.status})`)
  return data
}

const idOf = (x: any): string | null => (typeof x === 'string' ? x : x?.id ?? null)

// ── Lines + Prices ───────────────────────────────────────────────────────────

const INBOUND_TYPES = ['live_call', 'booked_appointment'] as const
type InboundType = typeof INBOUND_TYPES[number]
type Line = 'servicing' | InboundType

const LINE_LABEL: Record<Line, string> = {
  servicing: 'Policy Servicing',
  live_call: 'Live Calls',
  booked_appointment: 'Booked Appointments',
}
const isLine = (x: unknown): x is Line => typeof x === 'string' && Object.hasOwn(LINE_LABEL, x)

// Each line has one Product with a fixed id, tagged line=<line>. Stripe has no
// metadata on an inline price_data, and an invoice line's own metadata is the
// subscription's, so the Product is what still names an inbound line once its
// subscription item is gone.
const PRODUCT_PREFIX = 'ohvara_line_'

// Which line a Price belongs to, from its own tag or its Product. null = none
// of ours, which is what an old tier price looks like.
function lineOfPrice(price: any): Line | null {
  if (isLine(price?.metadata?.line)) return price.metadata.line
  const product = idOf(price?.product)
  const key = product?.startsWith(PRODUCT_PREFIX) ? product.slice(PRODUCT_PREFIX.length) : null
  return isLine(key) ? key : null
}

const lineOfItem = (item: any): Line | null => (isLine(item?.metadata?.line) ? item.metadata.line : lineOfPrice(item?.price))

// The item tagged line=servicing, else the one item with no tag of ours: an
// agent still on an old tier price keeps it, and it shows as the servicing line.
function servicingItem(sub: any) {
  const items: any[] = sub?.items?.data || []
  return items.find(i => lineOfItem(i) === 'servicing') || items.find(i => !lineOfItem(i)) || null
}

const inboundItems = (sub: any, type: InboundType): any[] => (sub?.items?.data || []).filter((i: any) => lineOfItem(i) === type)

async function ensureLineProduct(line: Line): Promise<string> {
  const id = `${PRODUCT_PREFIX}${line}`
  try {
    const p = await stripe(`products/${id}`)
    if (p.active === false) await stripe(`products/${id}`, { params: { active: true } })
    return id
  } catch (e) {
    if (!isMissing(e)) throw e
  }
  try {
    await stripe('products', { params: { id, name: LINE_LABEL[line], metadata: { ...TAG, line } } })
  } catch (e) {
    // Two first-time requests at once: the other one made it.
    if (!(e instanceof StripeError && e.code === 'resource_already_exists')) throw e
  }
  return id
}

type Settings = {
  agent_billing_weekly_cents: number
  inbound_est_cents_live_call: number
  inbound_est_cents_booked_appt: number
  inbound_min_weekly_cents: number
  inbound_spend_presets: number[]
}

async function loadSettings(admin: SupabaseClient): Promise<Settings> {
  const { data, error } = await admin.from('app_settings')
    .select('agent_billing_weekly_cents, inbound_est_cents_live_call, inbound_est_cents_booked_appt, inbound_min_weekly_cents, inbound_spend_presets')
    .eq('id', 1).single()
  if (error || !data) throw new Error(`Couldn't load billing settings: ${error?.message ?? 'no row'}`)
  return data as Settings
}

const SERVICING_LOOKUP = 'ohvara_servicing_weekly'

// The servicing Price, found again by lookup key. When the amount in settings
// changes a new Price takes over the key and the old one is retired; subscribers
// stay on whatever they signed up at until moved by hand.
async function ensureServicingPrice(admin: SupabaseClient): Promise<string> {
  const { agent_billing_weekly_cents: cents } = await loadSettings(admin)
  const found = await stripe('prices', { method: 'GET', params: { lookup_keys: [SERVICING_LOOKUP], active: true, limit: 1 } })
  const current = found.data?.[0]
  if (current && current.unit_amount === cents && current.recurring?.interval === 'week') return current.id
  const created = await stripe('prices', {
    params: {
      product: await ensureLineProduct('servicing'), currency: 'usd', unit_amount: cents, recurring: { interval: 'week' },
      nickname: LINE_LABEL.servicing, lookup_key: SERVICING_LOOKUP, transfer_lookup_key: true, metadata: { ...TAG, line: 'servicing' },
    },
  })
  if (current) await stripe(`prices/${current.id}`, { params: { active: false } })
  return created.id
}

// Our own Customer Portal configuration (found by metadata), so the account's
// default portal settings can't change what agents are allowed to do. Only the
// legacy `portal` action uses it since Prompt 734. No plan switching: there is
// one subscription, and inbound amounts change through inbound_set.
async function ensurePortalConfig(): Promise<string> {
  const features = {
    invoice_history: { enabled: true },
    payment_method_update: { enabled: true },
    subscription_cancel: { enabled: true, mode: 'at_period_end', proration_behavior: 'none' },
    customer_update: { enabled: false },
    subscription_update: { enabled: false },
  }

  const list = await stripe('billing_portal/configurations', { method: 'GET', params: { active: true, limit: 100 } })
  const mine = (list.data || []).find((c: any) => c.metadata?.ohvara === TAG.ohvara)
  if (mine) {
    await stripe(`billing_portal/configurations/${mine.id}`, { params: { features } })
    return mine.id
  }
  const created = await stripe('billing_portal/configurations', {
    params: { business_profile: { headline: 'Ohvara Policy Servicing' }, features, metadata: TAG },
  })
  return created.id
}

// ── Subscription -> profile ──────────────────────────────────────────────────

const LIVE = ['active', 'trialing', 'past_due']
const PROFILE_COLS = 'id, role, email, full_name, billing_exempt, billing_status, stripe_customer_id, stripe_subscription_id, billing_grace_until'

async function profileFor(admin: SupabaseClient, sub: any) {
  const customerId = idOf(sub.customer)
  if (sub.metadata?.profile_id) {
    const { data } = await admin.from('profiles').select(PROFILE_COLS).eq('id', sub.metadata.profile_id).maybeSingle()
    if (data) return data
  }
  if (!customerId) return null
  const { data } = await admin.from('profiles').select(PROFILE_COLS).eq('stripe_customer_id', customerId).maybeSingle()
  return data
}

const periodEndOf = (sub: any) => sub.current_period_end ?? servicingItem(sub)?.current_period_end ?? null

// Maps a Stripe subscription onto the 113 columns.
//   active / trialing      -> active (or canceled if cancel_at_period_end)
//   past_due               -> past_due, grace clock starts at the first failure
//   incomplete             -> ids only; the first payment hasn't cleared
//   canceled / unpaid /
//   incomplete_expired /
//   paused                 -> lapsed
async function syncSubscription(admin: SupabaseClient, sub: any, profile?: any) {
  const p = profile || await profileFor(admin, sub)
  if (!p) return { ignored: 'no matching profile' }
  // Comped agents and non-agents are managed by hand.
  if (p.billing_exempt || p.billing_status === 'exempt') return { ignored: 'exempt' }
  // An old subscription's late events must not clobber the current one.
  if (p.stripe_subscription_id && p.stripe_subscription_id !== sub.id && !LIVE.includes(sub.status)) {
    return { ignored: 'not the current subscription' }
  }

  const at = new Date(now())
  const periodEnd = periodEndOf(sub)
  const patch: Record<string, unknown> = {
    stripe_customer_id: idOf(sub.customer),
    stripe_subscription_id: sub.id,
    billing_current_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
    billing_updated_at: at.toISOString(),
  }

  switch (sub.status) {
    case 'active':
    case 'trialing':
      patch.billing_status = sub.cancel_at_period_end ? 'canceled' : 'active'
      patch.billing_grace_until = null
      break
    case 'past_due':
      patch.billing_status = 'past_due'
      patch.billing_grace_until = p.billing_status === 'past_due' && p.billing_grace_until
        ? p.billing_grace_until
        : new Date(at.getTime() + GRACE_HOURS * 3600e3).toISOString()
      break
    case 'incomplete':
      break
    default:
      patch.billing_status = 'lapsed'
      patch.billing_grace_until = null
  }

  const { error } = await admin.from('profiles').update(patch).eq('id', p.id)
  if (error) throw new Error(`Profile update failed: ${error.message}`)
  // Later reads in the same request see the new state.
  Object.assign(p, patch)
  return { profile_id: p.id, billing_status: patch.billing_status ?? p.billing_status }
}

// The customer's most relevant subscription: a live one if any, else the newest.
async function latestSubscription(customerId: string) {
  const list = await stripe('subscriptions', { method: 'GET', params: { customer: customerId, status: 'all', limit: 10 } })
  const subs = list.data || []
  return subs.find((s: any) => LIVE.includes(s.status)) || subs[0] || null
}

// The caller's own subscription, from their profile row only. A stored id
// that belongs to another customer (it never should) is ignored.
async function ownSubscription(me: any) {
  if (!me.stripe_customer_id) return null
  let sub: any = null
  if (me.stripe_subscription_id) {
    try {
      sub = await stripe(`subscriptions/${me.stripe_subscription_id}`)
    } catch (e) {
      if (!isMissing(e)) throw e
    }
    if (sub && idOf(sub.customer) !== me.stripe_customer_id) sub = null
  }
  if (!sub || !LIVE.includes(sub.status)) sub = (await latestSubscription(me.stripe_customer_id)) || sub
  return sub
}

async function liveSubscription(me: any) {
  const sub = await ownSubscription(me)
  if (!sub || !LIVE.includes(sub.status)) {
    throw new AppError(409, 'You don\'t have a subscription right now. Start Policy Servicing first.', 'no_subscription')
  }
  return sub
}

// ── Webhook ──────────────────────────────────────────────────────────────────

async function hmacHex(secret: string, message: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message))
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('')
}

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

// Stripe-Signature: t=<ts>,v1=<hex>[,v1=<hex>…]. Signed payload is `${t}.${body}`.
// More than one v1 shows up while a signing secret is being rolled.
async function verifySignature(header: string | null, rawBody: string, secret: string) {
  if (!header) return false
  let t = ''
  const v1: string[] = []
  for (const part of header.split(',')) {
    const [k, v] = part.split('=')
    if (k === 't') t = v
    if (k === 'v1' && v) v1.push(v)
  }
  const ts = Number(t)
  if (!t || !v1.length || !Number.isFinite(ts) || Math.abs(now() / 1000 - ts) > MAX_SKEW_SECONDS) return false
  const expected = await hmacHex(secret, `${t}.${rawBody}`)
  return v1.some(sig => safeEqual(expected, sig))
}

function subscriptionIdOf(event: any): string | null {
  const o = event.data?.object || {}
  switch (event.type) {
    case 'checkout.session.completed':
      return o.mode === 'subscription' ? idOf(o.subscription) : null
    case 'invoice.paid':
    case 'invoice.payment_failed':
      return idOf(o.subscription ?? o.parent?.subscription_details?.subscription)
    default:
      return event.type?.startsWith('customer.subscription.') ? o.id : null
  }
}

const CONNECT_TYPES = ['account.updated', 'account.external_account.created', 'account.external_account.updated', 'account.external_account.deleted', 'transfer.reversed']

async function handleWebhook(req: Request, admin: SupabaseClient) {
  if (!ENV.stripeKey || !ENV.webhookSecret) return json({ error: 'Billing webhook not configured' }, 503)
  const raw = await req.text()
  const sig = req.headers.get('stripe-signature')
  const ok = await verifySignature(sig, raw, ENV.webhookSecret)
    || (!!ENV.connectWebhookSecret && await verifySignature(sig, raw, ENV.connectWebhookSecret))
  if (!ok) return json({ error: 'Bad signature' }, 400)
  const event = JSON.parse(raw)

  // Prompt 753 — Fulfillment payouts (Connect). Non-2xx makes Stripe retry.
  if (CONNECT_TYPES.includes(event.type)) {
    if (!ENV.onConnectEvent) return json({ received: true, ignored: event.type })
    try {
      const result = await ENV.onConnectEvent(event)
      console.log(`agent-billing webhook ${event.type} (payouts)`, JSON.stringify(result))
      return json({ received: true, ...result })
    } catch (e) {
      console.error(`agent-billing webhook ${event.type} (payouts) failed:`, (e as Error).message)
      return json({ error: (e as Error).message }, 500)
    }
  }
  const subId = subscriptionIdOf(event)
  if (!subId) return json({ received: true, ignored: event.type })

  // Non-2xx makes Stripe retry, which is what we want if Stripe or the DB hiccups.
  try {
    const sub = await stripe(`subscriptions/${subId}`)
    // Checkout carries the agent on the session too; fall back to it if the
    // subscription metadata is somehow missing.
    if (!sub.metadata?.profile_id && event.type === 'checkout.session.completed') {
      sub.metadata = { ...(sub.metadata || {}), profile_id: event.data.object.client_reference_id }
    }
    const result = await syncSubscription(admin, sub)
    console.log(`agent-billing webhook ${event.type} ${subId}`, JSON.stringify(result))
    return json({ received: true, ...result })
  } catch (e) {
    console.error(`agent-billing webhook ${event.type} ${subId} failed:`, (e as Error).message)
    return json({ error: (e as Error).message }, 500)
  }
}

// ── Prompt 734 — Manage billing in the portal ───────────────────────────────

const iso = (sec: number | null | undefined) => (sec ? new Date(sec * 1000).toISOString() : null)

const CARD_BRANDS: Record<string, string> = {
  visa: 'Visa', mastercard: 'Mastercard', amex: 'American Express', discover: 'Discover',
  diners: 'Diners Club', jcb: 'JCB', unionpay: 'UnionPay', cartes_bancaires: 'Cartes Bancaires', eftpos_au: 'EFTPOS',
}
const WALLETS: Record<string, string> = {
  apple_pay: 'Apple Pay', google_pay: 'Google Pay', samsung_pay: 'Samsung Pay', link: 'Link',
  amex_express_checkout: 'Amex Express Checkout', masterpass: 'Masterpass', visa_checkout: 'Visa Checkout',
}
const cap = (t: string) => (t ? t[0].toUpperCase() + t.slice(1) : t)

// Whatever the agent pays with, as one line for the Payment method card. `card`
// keeps the P734 fields (brand, last4, exp_*) so an older page still works;
// `label` is the line to show and `kind` is card | link | bank | other.
// A Stripe Link payment method has no card of its own, only the Link email, so
// `linkCard` (brand + last4 found on the charge, P737) names the card behind
// it. The Link email is the agent's own, returned only to them (never logged):
// the page shows "Link · name@example.com", or "Link · Visa ending 4242" if a
// card is found behind it, or just "Link" when Stripe says neither.
type LinkCard = { brand: string; last4: string }

function methodOf(pm: any, linkCard: LinkCard | null = null) {
  if (!pm) return null
  const none = { brand: null, last4: null, exp_month: null, exp_year: null }
  const cardLine = (brand: string | null | undefined, last4: string | null | undefined) => {
    const name = CARD_BRANDS[brand as string] || (brand && brand !== 'unknown' ? cap(brand.replace(/_/g, ' ')) : 'Card')
    return last4 ? `${name} ending ${last4}` : name
  }
  if (pm.type === 'link' && !linkCard && pm.card?.brand && pm.card?.last4) linkCard = { brand: pm.card.brand, last4: pm.card.last4 }
  if (pm.card && pm.type !== 'link') {
    const c = pm.card
    const walletType = c.wallet?.type || null
    const wallet = walletType ? (WALLETS[walletType] || cap(String(walletType).replace(/_/g, ' '))) : null
    const ending = cardLine(c.brand, c.last4)
    return {
      brand: c.brand, last4: c.last4, exp_month: c.exp_month, exp_year: c.exp_year,
      kind: walletType === 'link' ? 'link' : 'card', wallet: walletType,
      label: !wallet ? ending : walletType === 'link' ? `Link · ${ending}` : `${ending} · ${wallet}`,
    }
  }
  if (pm.type === 'link') {
    const email: string | null = typeof pm.link?.email === 'string' && pm.link.email.trim() ? pm.link.email.trim() : null
    return {
      ...none, brand: linkCard?.brand ?? null, last4: linkCard?.last4 ?? null, kind: 'link', email,
      label: linkCard ? `Link · ${cardLine(linkCard.brand, linkCard.last4)}` : email ? `Link · ${email}` : 'Link',
    }
  }
  if (pm.type === 'us_bank_account' || pm.us_bank_account) {
    const last4 = pm.us_bank_account?.last4
    return { ...none, last4: last4 || null, kind: 'bank', label: last4 ? `Bank account ending ${last4}` : 'Bank account' }
  }
  return { ...none, kind: 'other', label: cap(String(pm.type || 'payment method').replace(/_/g, ' ')) }
}

const isLinkMethod = (pm: any) => pm?.type === 'link' || pm?.card?.wallet?.type === 'link'

// The card a charge was made with: payment_method_details.card, or a card block
// inside payment_method_details.link, whichever Stripe returns for Link.
function cardOnCharge(charge: any): LinkCard | null {
  const d = charge?.payment_method_details
  for (const c of [d?.card, d?.link?.card]) {
    if (c?.brand && c?.last4) return { brand: c.brand, last4: c.last4 }
  }
  return null
}

// A payment method only counts if it's attached to the caller's own customer.
async function ownMethod(id: string, customerId: string) {
  try {
    const pm = await stripe(`payment_methods/${id}`)
    return idOf(pm.customer) === customerId ? pm : null
  } catch (e) {
    if (isMissing(e)) return null
    throw e
  }
}

// What the next charge goes to, found in order, stopping at the first hit:
//   sub      the subscription's own default
//   customer the customer's invoice default / default source
//   invoice  what the latest paid invoice was charged with
//   attached the customer's first attached payment method
// Embedded Checkout doesn't always leave a default in the first two places,
// and a Link / wallet payment has no `card`, so the last two catch those. A
// card found there (not in the first two) is saved as the customer's default so
// the next lookup and the next charge agree. Logs which step hit, never card data.
//
// P737: for a Link method, also look for the card behind it: on the method
// itself (source=pm), else on the charge of the latest paid invoice
// (source=charge; only a charge made with this method or another Link payment),
// else none. The log line says which, so a reload shows whether Stripe exposes it.
async function defaultMethod(customerId: string, sub: any) {
  let paidInvoices: any[] | null = null
  const getPaid = async () => {
    if (!paidInvoices) {
      const r = await stripe('invoices', {
        method: 'GET',
        params: {
          customer: customerId, status: 'paid', limit: 3,
          expand: ['data.payment_intent.payment_method', 'data.payment_intent.latest_charge'],
        },
      })
      paidInvoices = r.data || []
    }
    return paidInvoices as any[]
  }

  const linkCardOf = async (pm: any): Promise<{ card: LinkCard | null; source: string }> => {
    if (pm.card?.brand && pm.card?.last4) return { card: { brand: pm.card.brand, last4: pm.card.last4 }, source: 'pm' }
    try {
      for (const inv of await getPaid()) {
        const charge = inv.payment_intent?.latest_charge
        if (!charge || typeof charge === 'string') continue
        const d = charge.payment_method_details
        const ours = idOf(charge.payment_method) === pm.id || d?.type === 'link' || d?.card?.wallet?.type === 'link'
        if (!ours) continue
        const card = cardOnCharge(charge)
        if (card) return { card, source: 'charge' }
      }
    } catch (e) {
      if (!(e instanceof StripeError)) throw e
      console.error('agent-billing overview link card lookup failed:', e.code || e.type)
    }
    return { card: null, source: 'none' }
  }

  const found = async (via: string, pm: any) => {
    let linkCard: LinkCard | null = null
    let extra = ''
    if (pm && isLinkMethod(pm)) {
      const r = await linkCardOf(pm)
      linkCard = r.card
      extra = ` link_card=${r.card ? 'yes' : 'no'} source=${r.source}`
    }
    console.log(`agent-billing overview card via=${via} type=${pm?.type ?? 'none'}${extra}`)
    return methodOf(pm, linkCard)
  }

  const subPm = idOf(sub?.default_payment_method)
  if (subPm) {
    const pm = await ownMethod(subPm, customerId)
    if (pm) return found('sub', pm)
  }

  const customer = await stripe(`customers/${customerId}`)
  if (customer.deleted) return null
  const custPm = idOf(customer.invoice_settings?.default_payment_method) || idOf(customer.default_source)
  if (custPm) {
    const pm = await ownMethod(custPm, customerId)
    if (pm) return found('customer', pm)
  }

  let pm: any = null
  let via = 'none'
  for (const inv of await getPaid()) {
    const raw = inv.payment_intent?.payment_method
    if (!raw) continue
    const cand = typeof raw === 'string' ? await ownMethod(raw, customerId) : (idOf(raw.customer) === customerId ? raw : null)
    if (cand) { pm = cand; via = 'invoice'; break }
  }
  if (!pm) {
    try {
      const list = await stripe(`customers/${customerId}/payment_methods`, { method: 'GET', params: { limit: 3 } })
      const cand = (list.data || []).find((m: any) => idOf(m.customer) === customerId)
      if (cand) { pm = cand; via = 'attached' }
    } catch (e) {
      if (!(e instanceof StripeError)) throw e
      console.error('agent-billing overview attached lookup failed:', e.code || e.type)
    }
  }
  const method = await found(via, pm)
  if (!pm) return null

  try {
    await stripe(`customers/${customerId}`, { params: { invoice_settings: { default_payment_method: pm.id } } })
  } catch (e) {
    if (!(e instanceof StripeError)) throw e
    console.error('agent-billing overview default heal failed:', e.code || e.type)
  }
  return method
}

// Paid / Open / Failed for the invoice list. "Failed" = a charge was tried
// and didn't go through (open with attempts, or written off).
function invoiceRow(inv: any) {
  const failed = inv.status === 'uncollectible' || (inv.status === 'open' && (inv.attempt_count || 0) > 0)
  const totals = new Map<Line, number>()
  for (const l of inv.lines?.data || []) {
    const line = lineOfPrice(l.price) ?? 'servicing'
    totals.set(line, (totals.get(line) || 0) + (l.amount || 0))
  }
  const lines = (Object.keys(LINE_LABEL) as Line[]).filter(k => totals.has(k)).map(k => ({ label: LINE_LABEL[k], amount_cents: totals.get(k) as number }))
  return {
    id: inv.id,
    date: iso(inv.created),
    created: iso(inv.created),
    amount_cents: inv.status === 'paid' ? inv.amount_paid : inv.amount_due,
    status: inv.status === 'paid' ? 'paid' : inv.status === 'void' ? 'void' : failed ? 'failed' : 'open',
    lines,
    description: lines.map(l => l.label).join(' + ') || inv.description || LINE_LABEL.servicing,
    receipt_url: inv.hosted_invoice_url || null,
    pdf_url: inv.invoice_pdf || null,
  }
}

function planOf(sub: any) {
  const item = servicingItem(sub)
  if (!item) return null
  return { tier: null, name: LINE_LABEL.servicing, weekly_cents: item.price?.unit_amount ?? null, weekly_cap: null }
}

type Flags = { configured: boolean; mode: 'test' | 'live' | null; webhook_configured: boolean }
type SpendRow = { inbound_type: InboundType; weekly_cents: number; paused: boolean; updated_at: string }

const isComped = (me: any) => !!me.billing_exempt || me.billing_status === 'exempt'

async function loadSpend(admin: SupabaseClient, agentId: string): Promise<SpendRow[]> {
  const { data, error } = await admin.from('agent_inbound_spend').select('inbound_type, weekly_cents, paused, updated_at').eq('agent_id', agentId)
  if (error) throw new Error(`Couldn't load inbound spend: ${error.message}`)
  return (data || []) as SpendRow[]
}

const estimatesOf = (s: Settings): Record<InboundType, number> => ({
  live_call: s.inbound_est_cents_live_call,
  booked_appointment: s.inbound_est_cents_booked_appt,
})

// Both types, always; a type with no row is 0 and not paused.
function inboundLines(rows: SpendRow[], s: Settings) {
  const est = estimatesOf(s)
  return INBOUND_TYPES.map(type => {
    const row = rows.find(r => r.inbound_type === type)
    const weekly_cents = row?.weekly_cents ?? 0
    return { type, label: LINE_LABEL[type], weekly_cents, paused: row?.paused ?? false, estimate_count: Math.floor(weekly_cents / est[type]) }
  })
}

// Read-only for a comped account and with Stripe not configured: neither calls Stripe.
async function overview(admin: SupabaseClient, me: any, flags: Flags) {
  const [settings, rows] = await Promise.all([loadSettings(admin), loadSpend(admin, me.id)])
  const inbound = inboundLines(rows, settings)
  const base = { configured: flags.configured, publishable_key: ENV.publishableKey || null, inbound }
  const quiet = { ...base, billing_status: me.billing_status, subscription: null, card: null, invoices: [], next_charge_cents: 0 }
  const servicing = (status: string, comped: boolean) => ({ price_cents: settings.agent_billing_weekly_cents, status, next_charge_at: null, comped })
  if (isComped(me)) return { ...quiet, servicing: servicing('active', true) }
  if (!flags.configured || !me.stripe_customer_id) return { ...quiet, servicing: servicing(me.billing_status, false) }

  const sub = await ownSubscription(me)
  let billing_status = me.billing_status
  if (sub) billing_status = (await syncSubscription(admin, sub, me)).billing_status ?? billing_status

  const [card, invoices] = await Promise.all([
    defaultMethod(me.stripe_customer_id, sub),
    stripe('invoices', { method: 'GET', params: { customer: me.stripe_customer_id, limit: 12 } }),
  ])

  const live = !!sub && LIVE.includes(sub.status)
  const price_cents = (live ? servicingItem(sub)?.price?.unit_amount : null) ?? settings.agent_billing_weekly_cents
  const renews = live && !sub.cancel_at_period_end
  const inboundCents = inbound.filter(l => !l.paused).reduce((sum, l) => sum + l.weekly_cents, 0)

  return {
    ...base,
    billing_status,
    servicing: { price_cents, status: billing_status, next_charge_at: renews ? iso(periodEndOf(sub)) : null, comped: false },
    next_charge_cents: renews ? price_cents + inboundCents : 0,
    subscription: sub ? {
      status: sub.status,
      cancel_at_period_end: !!sub.cancel_at_period_end,
      current_period_end: iso(periodEndOf(sub)),
      plan: planOf(sub),
      scheduled: null,
    } : null,
    card,
    invoices: (invoices.data || []).filter((i: any) => i.status !== 'draft').map(invoiceRow),
  }
}

function needPublishableKey() {
  if (!ENV.publishableKey) throw new AppError(503, 'Billing isn\'t fully set up yet.', 'no_publishable_key')
  return ENV.publishableKey
}

async function setupCard(me: any) {
  const publishable_key = needPublishableKey()
  if (!me.stripe_customer_id) throw new AppError(409, 'No subscription yet. Start Policy Servicing first.', 'no_subscription')
  const si = await stripe('setup_intents', {
    params: {
      customer: me.stripe_customer_id,
      usage: 'off_session',
      payment_method_types: ['card'],
      metadata: { ...TAG, profile_id: me.id },
    },
  })
  return { client_secret: si.client_secret, publishable_key }
}

async function setDefaultCard(admin: SupabaseClient, me: any, body: any) {
  const pmId = String(body.payment_method || '')
  if (!/^pm_[A-Za-z0-9]+$/.test(pmId)) throw new AppError(400, 'That card couldn\'t be saved. Try again.')
  if (!me.stripe_customer_id) throw new AppError(409, 'No subscription yet. Start Policy Servicing first.', 'no_subscription')

  let pm: any
  try {
    pm = await stripe(`payment_methods/${pmId}`)
  } catch (e) {
    if (isMissing(e)) throw new AppError(403, 'That card isn\'t on your account.')
    throw e
  }
  // The SetupIntent attaches the card to the caller's customer. A card on any
  // other customer (or none) is refused.
  if (idOf(pm.customer) !== me.stripe_customer_id) throw new AppError(403, 'That card isn\'t on your account.')

  await stripe(`customers/${me.stripe_customer_id}`, { params: { invoice_settings: { default_payment_method: pmId } } })
  let sub = await ownSubscription(me)
  let retry: { ok: boolean; message?: string } | null = null
  if (sub && LIVE.includes(sub.status)) {
    sub = await stripe(`subscriptions/${sub.id}`, { params: { default_payment_method: pmId } })
    // A fixed card brings a past-due agent current right away.
    if (sub.status === 'past_due' && sub.latest_invoice) {
      const inv = await stripe(`invoices/${idOf(sub.latest_invoice)}`)
      if (inv.status === 'open') {
        try {
          await stripe(`invoices/${inv.id}/pay`, { params: { payment_method: pmId } })
          retry = { ok: true }
        } catch (e) {
          if (!(e instanceof StripeError)) throw e
          console.error('agent-billing set_default_card retry failed:', e.code || e.type)
          retry = { ok: false, message: e.type === 'card_error' ? e.message : 'We couldn\'t charge that card. Try another card.' }
        }
        sub = await stripe(`subscriptions/${sub.id}`)
      }
    }
  }
  const billing_status = sub ? (await syncSubscription(admin, sub, me)).billing_status ?? me.billing_status : me.billing_status
  return { card: methodOf(pm), retry, billing_status }
}

async function releaseSchedule(sub: any) {
  const schedId = idOf(sub.schedule)
  if (!schedId) return
  const sched = await stripe(`subscription_schedules/${schedId}`)
  if (['not_started', 'active'].includes(sched.status)) await stripe(`subscription_schedules/${schedId}/release`, { params: {} })
}

async function cancelSub(admin: SupabaseClient, me: any) {
  const sub = await liveSubscription(me)
  if (sub.cancel_at_period_end) {
    return { ok: true, billing_status: (await syncSubscription(admin, sub, me)).billing_status, access_until: iso(periodEndOf(sub)) }
  }
  // A schedule owns cancellation behaviour; a waiting downgrade is moot anyway.
  await releaseSchedule(sub)
  const updated = await stripe(`subscriptions/${sub.id}`, { params: { cancel_at_period_end: true } })
  const { billing_status } = await syncSubscription(admin, updated, me)
  return { ok: true, billing_status, access_until: iso(periodEndOf(updated)) }
}

async function resumeSub(admin: SupabaseClient, me: any) {
  const sub = await liveSubscription(me)
  const updated = sub.cancel_at_period_end
    ? await stripe(`subscriptions/${sub.id}`, { params: { cancel_at_period_end: false } })
    : sub
  const { billing_status } = await syncSubscription(admin, updated, me)
  return { ok: true, billing_status, renews_on: iso(periodEndOf(updated)) }
}

// ── Inbound spend ────────────────────────────────────────────────────────────

const MAX_WEEKLY_CENTS = 99999999 // the most Stripe takes as a unit_amount

// `sub` is the live subscription when the caller already has it (null = none).
async function inboundState(admin: SupabaseClient, me: any, flags: Flags, sub?: any) {
  const comped = isComped(me)
  const [settings, rows] = await Promise.all([loadSettings(admin), loadSpend(admin, me.id)])
  let live = sub
  if (live === undefined) {
    const own = !comped && flags.configured ? await ownSubscription(me) : null
    live = own && LIVE.includes(own.status) ? own : null
  }
  return {
    configured: flags.configured,
    comped,
    billed: !comped,
    subscribed: comped || !!live,
    mode: flags.mode ?? 'test',
    min_weekly_cents: settings.inbound_min_weekly_cents,
    presets: settings.inbound_spend_presets,
    estimate_cents: estimatesOf(settings),
    types: inboundLines(rows, settings),
  }
}

// Makes the subscription carry one item for this type at `wanted` cents, or
// none at 0. proration none: nothing is charged now and the new amount bills at
// the next weekly renewal. Already right = no Stripe write, so a repeat is
// harmless. A duplicate item left by two requests at once is cleaned up here too.
async function syncInboundItem(sub: any, type: InboundType, wanted: number, version: string) {
  const [keep, ...extra] = inboundItems(sub, type)
  const right = wanted ? keep?.price?.unit_amount === wanted && (keep.quantity ?? 1) === 1 : !keep
  if (right && !extra.length) return sub

  // A waiting downgrade would otherwise be stranded: nothing can undo it now.
  await releaseSchedule(sub)

  const items: Record<string, unknown>[] = extra.map(i => ({ id: i.id, deleted: true }))
  if (wanted) {
    items.push({
      ...(keep ? { id: keep.id } : {}),
      price_data: { currency: 'usd', product: await ensureLineProduct(type), unit_amount: wanted, recurring: { interval: 'week' } },
      quantity: 1,
      metadata: { line: type },
    })
  } else if (keep) {
    items.push({ id: keep.id, deleted: true })
  }
  // A double tap collapses into one Stripe write. The row's updated_at keeps a
  // later return to the same amount from replaying this one, and the minute
  // keeps a Stripe error from being replayed to every retry for a day.
  const minute = Math.floor(now() / 60000)
  const idempotencyKey = ['inbound', sub.id, type, wanted, version, minute, ...items.map(i => i.id ?? 'new')].join(':')
  return stripe(`subscriptions/${sub.id}`, { params: { items, proration_behavior: 'none' }, idempotencyKey })
}

async function logSpendChange(admin: SupabaseClient, agentId: string, type: InboundType, prev: SpendRow | undefined, cents: number, paused: boolean) {
  const { error } = await admin.from('agent_inbound_spend_log').insert({
    agent_id: agentId, inbound_type: type,
    old_cents: prev?.weekly_cents ?? 0, new_cents: cents,
    old_paused: prev?.paused ?? false, new_paused: paused,
  })
  if (error) throw new Error(`Couldn't log the inbound change: ${error.message}`)
}

async function saveSpend(admin: SupabaseClient, agentId: string, type: InboundType, cents: number, paused: boolean) {
  const { error } = await admin.from('agent_inbound_spend').upsert(
    { agent_id: agentId, inbound_type: type, weekly_cents: cents, paused, updated_at: new Date(now()).toISOString() },
    { onConflict: 'agent_id,inbound_type' },
  )
  if (error) throw new Error(`Couldn't save the inbound change: ${error.message}`)
}

// Order matters and is the point of this function:
//   1. bad input               400, nothing else runs
//   2. comped                  409, no Stripe call
//   3. live Stripe key         403, no Stripe call
//   4. no live subscription    409
//   5. Stripe, then the log, then the row. If Stripe fails nothing was written
//      and the agent can retry. If the database fails after Stripe, the retry
//      finds Stripe already right and finishes the writes.
async function inboundSet(admin: SupabaseClient, me: any, body: any, flags: Flags) {
  const { type, weekly_cents: cents } = body
  if (!INBOUND_TYPES.includes(type)) throw new AppError(400, 'That lead type isn\'t available.')
  if (!Number.isInteger(cents) || cents < 0 || cents > MAX_WEEKLY_CENTS) throw new AppError(400, 'Enter a weekly amount in whole cents, 0 or more.')
  if (body.paused !== undefined && typeof body.paused !== 'boolean') throw new AppError(400, 'Paused must be true or false.')
  const { inbound_min_weekly_cents: min } = await loadSettings(admin)
  if (cents > 0 && cents < min) throw new AppError(400, `The weekly minimum is $${(min / 100).toFixed(2)}, or 0 for none.`)

  if (isComped(me)) throw new AppError(409, 'Your account isn\'t billed.')
  if (flags.mode === 'live') throw new AppError(403, 'Lead spend is test mode only for now.')

  const sub = flags.configured ? await ownSubscription(me) : null
  if (!sub || !LIVE.includes(sub.status)) throw new AppError(409, 'Start Policy Servicing first.')

  const prev = (await loadSpend(admin, me.id)).find(r => r.inbound_type === type)
  const paused: boolean = body.paused ?? prev?.paused ?? false
  const updated = await syncInboundItem(sub, type, paused ? 0 : cents, prev?.updated_at ?? 'new')

  if ((prev?.weekly_cents ?? 0) !== cents || (prev?.paused ?? false) !== paused) {
    await logSpendChange(admin, me.id, type, prev, cents, paused)
    await saveSpend(admin, me.id, type, cents, paused)
  }
  return inboundState(admin, me, flags, updated)
}

// Checkout starts a subscription with the servicing item only, so spend left
// from an ended subscription would read as bought while nothing bills for it.
async function clearSpend(admin: SupabaseClient, agentId: string) {
  for (const row of await loadSpend(admin, agentId)) {
    if (!row.weekly_cents && !row.paused) continue
    await logSpendChange(admin, agentId, row.inbound_type, row, 0, false)
    await saveSpend(admin, agentId, row.inbound_type, 0, false)
  }
}

// ── App actions ──────────────────────────────────────────────────────────────

// CONTRACT for the frontend. Called with invokeBilling(action, body) from
// src/lib/billing.js. Errors are JSON { error: 'plain message' } with a status.
//
// inbound_get (no body): 200 for every agent including comped:
//   { configured: bool, comped: bool, billed: bool (false when comped),
//     subscribed: bool (live servicing subscription, or comped),
//     mode: 'test'|'live' ('test' when no Stripe key is set),
//     min_weekly_cents: int, presets: int[],
//     estimate_cents: { live_call: int, booked_appointment: int },
//     types: [{ type: 'live_call'|'booked_appointment',
//               label: 'Live Calls'|'Booked Appointments',
//               weekly_cents: int, paused: bool, estimate_count: int }] }
//   estimate_count = floor(weekly_cents / estimate cents). Both types are always
//   listed; a type never set is weekly_cents 0, paused false.
//
// inbound_set body { type, weekly_cents, paused }: 200 returns the same shape as
// inbound_get after the change. A change applies at the next weekly renewal.
//   400 invalid input (unknown type, non-integer, negative, between 1 and min-1
//       cents, or above Stripe's limit of 99999999 cents).
//   409 'Start Policy Servicing first.' for a billed agent with no live servicing
//       subscription (also when Stripe is not configured).
//   409 "Your account isn't billed." for a comped agent.
//   403 'Lead spend is test mode only for now.' when the Stripe key mode is
//       live, before any Stripe call.
//
// overview (no body): 200 for every agent, comped read-only:
//   { configured,
//     servicing: { price_cents, status, next_charge_at, comped },
//     inbound: [{ type, label, weekly_cents, paused, estimate_count }],
//     next_charge_cents (servicing + active unpaused inbound),
//     invoices: [{ id, date, amount_cents, status,
//                  lines: [{ label: 'Policy Servicing'|'Live Calls'|'Booked Appointments', amount_cents }] }] }
//   plus the existing card, portal and cancel fields ManageBilling already uses,
//   unchanged: publishable_key, billing_status, card, subscription { status,
//   cancel_at_period_end, current_period_end, plan, scheduled (always null now) },
//   and created, description, receipt_url, pdf_url on each invoice.
//   servicing.status is a billing_status value ('active' when comped);
//   next_charge_at is null and next_charge_cents is 0 when nothing will renew
//   (comped, no live subscription, or set to cancel).
//   With no Stripe key: configured false, subscription and card null, invoices [].

export async function handle(req: Request, admin: SupabaseClient): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  if (new URL(req.url).pathname.endsWith('/webhook')) return handleWebhook(req, admin)

  const STRIPE_KEY = ENV.stripeKey
  const configured = !!STRIPE_KEY
  const mode: Flags['mode'] = !STRIPE_KEY ? null : STRIPE_KEY.startsWith('sk_live_') || STRIPE_KEY.startsWith('rk_live_') ? 'live' : 'test'
  const flags = { configured, mode, webhook_configured: !!ENV.webhookSecret }

  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer /, '')
  let body: any = {}
  try { body = await req.json() } catch { /* empty body */ }
  if (!body || typeof body !== 'object') body = {}
  const action = body.action || 'status'

  // Signed-out status only ever returns booleans, never values.
  const { data: { user } } = jwt ? await admin.auth.getUser(jwt) : { data: { user: null } }
  if (!user && action === 'status') return json(flags)
  if (!user) return json({ error: 'Not signed in' }, 401)

  const { data: me } = await admin.from('profiles').select(PROFILE_COLS).eq('id', user.id).single()
  if (!me) return json({ error: 'No profile' }, 403)

  try {
    if (action === 'status') {
      let billing_status = me.billing_status
      // Heal from Stripe: covers a webhook that hasn't landed (or isn't set up yet).
      if (configured && me.role === 'agent' && me.stripe_customer_id && !me.billing_exempt && me.billing_status !== 'exempt') {
        const sub = await latestSubscription(me.stripe_customer_id).catch(() => null)
        if (sub) billing_status = (await syncSubscription(admin, sub, me)).billing_status ?? billing_status
      }
      return json({ ...flags, billing_status })
    }

    if (me.role !== 'agent') return json({ error: 'Only agents are billed' }, 403)

    // These three answer a comped account and an unconfigured Stripe themselves.
    if (action === 'inbound_get') return json(await inboundState(admin, me, flags))
    if (action === 'inbound_set') return json(await inboundSet(admin, me, body, flags))
    if (action === 'overview') return json(await overview(admin, me, flags))

    if (isComped(me)) return json({ error: 'Your account isn\'t billed.' }, 409)
    if (!configured) {
      return json({ error: 'Billing isn\'t set up yet: the Stripe account hasn\'t been connected.', code: 'not_configured' }, 503)
    }

    const returnUrl = safeReturnUrl(body.return_url)

    switch (action) {
      case 'setup_card': return json(await setupCard(me))
      case 'set_default_card': return json(await setDefaultCard(admin, me, body))
      case 'cancel': return json(await cancelSub(admin, me))
      case 'resume': return json(await resumeSub(admin, me))
    }

    if (action === 'checkout') {
      const publishable_key = needPublishableKey()

      let customerId = me.stripe_customer_id
      if (customerId) {
        // Never start a second subscription. A live one means the webhook
        // missed something: sync it and send them to Manage billing instead.
        const list = await stripe('subscriptions', { method: 'GET', params: { customer: customerId, status: 'all', limit: 20 } })
        const live = (list.data || []).find((s: any) => LIVE.includes(s.status))
        if (live) {
          await syncSubscription(admin, live, me)
          return json({ error: 'You already have a subscription. Use Manage billing.', code: 'already_subscribed' }, 409)
        }
        // Dead-ends Stripe kept around (gave up retrying, or an abandoned
        // first payment) would otherwise sit next to the new one.
        for (const s of list.data || []) {
          if (['unpaid', 'incomplete'].includes(s.status)) await stripe(`subscriptions/${s.id}`, { method: 'DELETE' })
        }
      } else {
        const customer = await stripe('customers', {
          params: { email: me.email || user.email, name: me.full_name || undefined, metadata: { ...TAG, profile_id: me.id } },
        })
        customerId = customer.id
        const { error } = await admin.from('profiles')
          .update({ stripe_customer_id: customerId, billing_updated_at: new Date(now()).toISOString() })
          .eq('id', me.id)
        if (error) throw new Error(`Couldn't save the Stripe customer: ${error.message}`)
      }

      const price = await ensureServicingPrice(admin)
      await clearSpend(admin, me.id)
      // Embedded Checkout: the card box renders inside /agent/billing. Stripe
      // fills in {CHECKOUT_SESSION_ID} itself, so it must not be URL-encoded.
      const back = new URL(returnUrl)
      const session = await stripe('checkout/sessions', {
        params: {
          ui_mode: 'embedded',
          mode: 'subscription',
          customer: customerId,
          client_reference_id: me.id,
          line_items: [{ price, quantity: 1 }],
          subscription_data: { metadata: { ...TAG, profile_id: me.id } },
          metadata: { ...TAG, profile_id: me.id },
          return_url: `${back.origin}${back.pathname}?session_id={CHECKOUT_SESSION_ID}`,
        },
      })
      return json({ client_secret: session.client_secret, publishable_key })
    }

    if (action === 'portal') {
      if (!me.stripe_customer_id) return json({ error: 'No subscription yet. Subscribe first.' }, 409)
      const configuration = await ensurePortalConfig()
      const params: Record<string, unknown> = { customer: me.stripe_customer_id, configuration, return_url: returnUrl }
      const session = await stripe('billing_portal/sessions', { params })
      return json({ url: session.url })
    }

    return json({ error: `Unknown action: ${action}` }, 400)
  } catch (e) {
    if (e instanceof AppError) return json({ error: e.message, ...(e.code ? { code: e.code } : {}) }, e.status)
    // Stripe's own message is logged, not shown: it can name ids and internals.
    // A card decline is the exception; that text is meant for the cardholder.
    if (e instanceof StripeError) {
      console.error(`agent-billing ${action} failed: stripe ${e.status} ${e.code || e.type}: ${e.message}`)
      if (e.type === 'card_error') return json({ error: e.message, code: 'card_error' }, 402)
      return json({ error: 'Something went wrong with billing. Try again in a minute.' }, 502)
    }
    console.error(`agent-billing ${action} failed:`, (e as Error).message)
    return json({ error: 'Something went wrong with billing. Try again in a minute.' }, 502)
  }
}
