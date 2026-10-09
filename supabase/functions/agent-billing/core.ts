import type { SupabaseClient } from 'npm:@supabase/supabase-js'

// Prompt 673 — the agent retainer (weekly, agent pays Ohvara). Prompt 692 made
// it tiered: each row of agent_billing_tiers (migration 119) is a weekly price
// plus a weekly submission cap, and gets its own recurring Price here. Migration
// 113 holds the state on profiles; this function is the only thing that writes
// it (service role), apart from an admin by hand.
//
// Prompt 734 — billing is managed inside the portal: Embedded Checkout to
// subscribe, and our own actions for the card (SetupIntent + Payment Element),
// plan switch, cancel / renew and invoices, instead of Stripe's hosted
// Customer Portal. Card numbers are still only typed into Stripe's own fields.
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
//     overview        — plan, status, period end, scheduled change, card,
//                       last 12 invoices, publishable key (Manage billing).
//     checkout        — { tier }: an Embedded Checkout session's client_secret.
//     setup_card      — a SetupIntent's client_secret for the Payment Element.
//     set_default_card— { payment_method }: makes it the card for the customer
//                       and the subscription; retries a past-due invoice.
//     preview_change  — { tier }: what a plan switch costs / when it happens.
//     change_plan     — { tier }: upgrade now (bills the difference) or
//                       downgrade at the end of the paid week (a schedule).
//     cancel_change   — undo a scheduled downgrade.
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

export type Env = {
  stripeKey?: string
  webhookSecret?: string
  publishableKey?: string
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
async function stripe(path: string, init: { method?: string; params?: Record<string, unknown> } = {}) {
  const method = init.method || (init.params ? 'POST' : 'GET')
  const qs = method === 'GET' && init.params ? `?${formEncode(init.params)}` : ''
  const res = await (ENV.fetch || fetch)(`https://api.stripe.com/v1/${path}${qs}`, {
    method,
    headers: {
      Authorization: `Bearer ${ENV.stripeKey}`,
      'Stripe-Version': STRIPE_VERSION,
      ...(method !== 'GET' ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
    },
    body: method !== 'GET' && init.params ? formEncode(init.params) : undefined,
  })
  const data = await res.json()
  if (!res.ok) throw new StripeError(data?.error, res.status, `Stripe ${method} ${path} failed (${res.status})`)
  return data
}

const idOf = (x: any): string | null => (typeof x === 'string' ? x : x?.id ?? null)

// ── Tiers + Prices ───────────────────────────────────────────────────────────

type Tier = {
  key: string; name: string; weekly_cents: number; weekly_cap: number | null
  stripe_lookup_key: string | null; stripe_price_id: string | null; stripe_product_id: string | null; sort_order: number
}

async function loadTiers(admin: SupabaseClient): Promise<Tier[]> {
  const { data, error } = await admin.from('agent_billing_tiers').select('*').eq('is_active', true).order('sort_order')
  if (error) throw new Error(`Couldn't load billing tiers: ${error.message}`)
  return (data || []) as Tier[]
}

// A stored id this Stripe account can't see (it was made under another key,
// e.g. sandbox ids left behind after going live) or that was archived/deleted
// counts as not stored: the caller makes a new one. That's what broke Manage
// billing in the P673 live test ("No such product").
async function usableProduct(id: string | null): Promise<string | null> {
  if (!id) return null
  try {
    const p = await stripe(`products/${id}`)
    return p.deleted || p.active === false ? null : p.id
  } catch (e) {
    if (isMissing(e)) return null
    throw e
  }
}

// Each tier gets its OWN Stripe Product: the Customer Portal's plan switcher
// refuses two Prices with the same billing interval under one Product. The
// first tier keeps the original Product (Prompt 673's subscribers are on it);
// every later tier gets a dedicated one, remembered in stripe_product_id.
async function productFor(admin: SupabaseClient, tier: Tier, tiers: Tier[], current: any): Promise<string> {
  const stored = await usableProduct(tier.stripe_product_id)
  if (stored) return stored
  const first = tiers[0]
  if (tier.key === first.key) {
    if (current?.product) return current.product
  } else if (current?.product) {
    // A dedicated product left by an earlier run, as opposed to the first tier's.
    const firstStored = await usableProduct(first.stripe_product_id)
    const f = firstStored ? null : first.stripe_lookup_key
      ? (await stripe('prices', { method: 'GET', params: { lookup_keys: [first.stripe_lookup_key], active: true, limit: 1 } })).data?.[0]
      : null
    const firstProduct = firstStored || f?.product
    if (current.product !== firstProduct) return current.product
  }
  return (await stripe('products', {
    params: {
      name: tier.key === first.key ? 'Ohvara agent portal access' : `Ohvara agent portal access: ${tier.name}`,
      description: 'Weekly retainer: portal access and that week\'s batch of cancellations.',
      metadata: { ...TAG, tier: tier.key },
    },
  })).id
}

// A tier's weekly Price, created on first use and found again by lookup key.
// If the tier's price changes, a new Price takes over the lookup key; existing
// subscriptions stay on whatever they signed up at until moved by hand.
async function ensureTierPrice(admin: SupabaseClient, tier: Tier, tiers: Tier[]): Promise<string> {
  const lookup = tier.stripe_lookup_key || `ohvara_agent_${tier.key}_weekly`
  const found = await stripe('prices', { method: 'GET', params: { lookup_keys: [lookup], active: true, limit: 1 } })
  const current = found.data?.[0]
  const product = await productFor(admin, tier, tiers, current)
  let id: string
  if (current && current.product === product && current.unit_amount === tier.weekly_cents && current.recurring?.interval === 'week') {
    id = current.id
    // Prices created before tiers existed carry no tier tag.
    if (current.metadata?.tier !== tier.key) await stripe(`prices/${id}`, { params: { metadata: { ...TAG, tier: tier.key } } })
  } else {
    id = (await stripe('prices', {
      params: {
        product, currency: 'usd', unit_amount: tier.weekly_cents, recurring: { interval: 'week' },
        nickname: tier.name, lookup_key: lookup, transfer_lookup_key: true, metadata: { ...TAG, tier: tier.key },
      },
    })).id
    // Moved to a different product: retire the old Price (existing subscribers keep it).
    if (current && current.product !== product) await stripe(`prices/${current.id}`, { params: { active: false } })
  }
  if (tier.stripe_price_id !== id || tier.stripe_lookup_key !== lookup || tier.stripe_product_id !== product) {
    const { error } = await admin.from('agent_billing_tiers')
      .update({ stripe_price_id: id, stripe_lookup_key: lookup, stripe_product_id: product, updated_at: new Date(now()).toISOString() })
      .eq('key', tier.key)
    if (error) throw new Error(`Couldn't save the Stripe price: ${error.message}`)
    tier.stripe_price_id = id
    tier.stripe_lookup_key = lookup
    tier.stripe_product_id = product
  }
  return id
}

// Our own Customer Portal configuration (found by metadata), so the account's
// default portal settings can't change what agents are allowed to do. Only the
// legacy `portal` action uses it since Prompt 734.
async function ensurePortalConfig(admin: SupabaseClient): Promise<string> {
  const tiers = await loadTiers(admin)
  const products: { product: string; prices: string[] }[] = []
  for (const t of tiers) {
    const price = await ensureTierPrice(admin, t, tiers)
    products.push({ product: t.stripe_product_id as string, prices: [price] })
  }

  const features = {
    invoice_history: { enabled: true },
    payment_method_update: { enabled: true },
    subscription_cancel: { enabled: true, mode: 'at_period_end', proration_behavior: 'none' },
    customer_update: { enabled: false },
    subscription_update: {
      enabled: products.length > 1,
      default_allowed_updates: ['price'],
      products,
      proration_behavior: 'always_invoice',
      schedule_at_period_end: { conditions: [{ type: 'decreasing_item_amount' }] },
    },
  }

  const list = await stripe('billing_portal/configurations', { method: 'GET', params: { active: true, limit: 100 } })
  const mine = (list.data || []).find((c: any) => c.metadata?.ohvara === TAG.ohvara)
  if (mine) {
    await stripe(`billing_portal/configurations/${mine.id}`, { params: { features } })
    return mine.id
  }
  const created = await stripe('billing_portal/configurations', {
    params: { business_profile: { headline: 'Ohvara agent portal access' }, features, metadata: TAG },
  })
  return created.id
}

// Which tier a Stripe Price belongs to: its own tag first, then by id or
// lookup key. null = unrecognised (keep whatever the profile already has).
function tierOfPrice(price: any, tiers: Tier[]): string | null {
  if (!price) return null
  if (typeof price === 'string') return tiers.find(t => t.stripe_price_id === price)?.key ?? null
  const tagged = price.metadata?.tier
  if (tagged && tiers.some(t => t.key === tagged)) return tagged
  const hit = tiers.find(t => t.stripe_price_id === price.id || (price.lookup_key && t.stripe_lookup_key === price.lookup_key))
  return hit?.key ?? null
}

// ── Subscription -> profile ──────────────────────────────────────────────────

const LIVE = ['active', 'trialing', 'past_due']
const PROFILE_COLS = 'id, role, email, full_name, billing_exempt, billing_status, billing_tier, stripe_customer_id, stripe_subscription_id, billing_grace_until'

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

const periodEndOf = (sub: any) => sub.current_period_end ?? sub.items?.data?.[0]?.current_period_end ?? null

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
  const tier = tierOfPrice(sub.items?.data?.[0]?.price, await loadTiers(admin))
  const periodEnd = periodEndOf(sub)
  const patch: Record<string, unknown> = {
    stripe_customer_id: idOf(sub.customer),
    stripe_subscription_id: sub.id,
    billing_current_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
    billing_updated_at: at.toISOString(),
  }
  if (tier) patch.billing_tier = tier

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
    throw new AppError(409, 'You don\'t have a subscription right now. Pick a plan to start one.', 'no_subscription')
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

async function handleWebhook(req: Request, admin: SupabaseClient) {
  if (!ENV.stripeKey || !ENV.webhookSecret) return json({ error: 'Billing webhook not configured' }, 503)
  const raw = await req.text()
  if (!await verifySignature(req.headers.get('stripe-signature'), raw, ENV.webhookSecret)) {
    return json({ error: 'Bad signature' }, 400)
  }
  const event = JSON.parse(raw)
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
// it. The Link email is never put in the result: the page shows "Link · Visa
// ending 4242", or just "Link" when Stripe doesn't say which card it was.
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
    return {
      ...none, brand: linkCard?.brand ?? null, last4: linkCard?.last4 ?? null, kind: 'link',
      label: linkCard ? `Link · ${cardLine(linkCard.brand, linkCard.last4)}` : 'Link',
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
  const line = inv.lines?.data?.[0]
  return {
    id: inv.id,
    created: iso(inv.created),
    amount_cents: inv.status === 'paid' ? inv.amount_paid : inv.amount_due,
    status: inv.status === 'paid' ? 'paid' : inv.status === 'void' ? 'void' : failed ? 'failed' : 'open',
    description: line?.price?.nickname ? `${line.price.nickname} plan, weekly` : line?.description || inv.description || 'Weekly plan',
    receipt_url: inv.hosted_invoice_url || null,
    pdf_url: inv.invoice_pdf || null,
  }
}

const tierInfo = (t: Tier | undefined | null) => (t ? { tier: t.key, name: t.name, weekly_cents: t.weekly_cents, weekly_cap: t.weekly_cap } : null)

// A downgrade waiting for the end of the paid week: the schedule's phase
// after the current one, on a different price.
async function scheduledChange(sub: any, tiers: Tier[]) {
  const schedId = idOf(sub?.schedule)
  if (!schedId) return null
  const sched = await stripe(`subscription_schedules/${schedId}`)
  if (!['not_started', 'active'].includes(sched.status)) return null
  const curPrice = sub.items?.data?.[0]?.price?.id
  const next = (sched.phases || []).find((ph: any) => ph.start_date >= (periodEndOf(sub) ?? Infinity) - 1)
  const priceId = idOf(next?.items?.[0]?.price)
  if (!next || !priceId || priceId === curPrice) return null
  const t = tiers.find(x => x.stripe_price_id === priceId)
  return t ? { ...tierInfo(t), at: iso(next.start_date) } : null
}

function planOf(sub: any, tiers: Tier[]) {
  const price = sub?.items?.data?.[0]?.price
  if (!price) return null
  const key = tierOfPrice(price, tiers)
  const t = tiers.find(x => x.key === key)
  return { tier: key, name: t?.name ?? price.nickname ?? null, weekly_cents: price.unit_amount ?? t?.weekly_cents ?? null, weekly_cap: t?.weekly_cap ?? null }
}

async function overview(admin: SupabaseClient, me: any) {
  const tiers = await loadTiers(admin)
  const base = { publishable_key: ENV.publishableKey || null }
  if (!me.stripe_customer_id) return { ...base, billing_status: me.billing_status, subscription: null, card: null, invoices: [] }

  const sub = await ownSubscription(me)
  let billing_status = me.billing_status
  if (sub) billing_status = (await syncSubscription(admin, sub, me)).billing_status ?? billing_status

  const [card, invoices, scheduled] = await Promise.all([
    defaultMethod(me.stripe_customer_id, sub),
    stripe('invoices', { method: 'GET', params: { customer: me.stripe_customer_id, limit: 12 } }),
    sub && LIVE.includes(sub.status) ? scheduledChange(sub, tiers) : null,
  ])

  return {
    ...base,
    billing_status,
    subscription: sub ? {
      status: sub.status,
      cancel_at_period_end: !!sub.cancel_at_period_end,
      current_period_end: iso(periodEndOf(sub)),
      plan: planOf(sub, tiers),
      scheduled,
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
  if (!me.stripe_customer_id) throw new AppError(409, 'No subscription yet. Pick a plan first.', 'no_subscription')
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
  if (!me.stripe_customer_id) throw new AppError(409, 'No subscription yet. Pick a plan first.', 'no_subscription')

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

// Shared checks for a plan switch: a live, not-cancelling subscription and a
// different active tier. The price always comes from agent_billing_tiers.
async function planSwitch(admin: SupabaseClient, me: any, body: any) {
  const sub = await liveSubscription(me)
  if (sub.cancel_at_period_end) throw new AppError(409, 'Your plan is set to cancel. Renew it first, then switch.', 'canceling')
  const tiers = await loadTiers(admin)
  const target = tiers.find(t => t.key === body.tier)
  if (!target) throw new AppError(400, 'That plan isn\'t available.')
  const item = sub.items?.data?.[0]
  if (!item) throw new AppError(409, 'Your subscription has no plan on it. Contact support.')
  const price = await ensureTierPrice(admin, target, tiers)
  const currentKey = tierOfPrice(item.price, tiers)
  if (price === item.price?.id || currentKey === target.key) throw new AppError(409, 'You\'re already on that plan.', 'same_plan')
  const currentCents = item.price?.unit_amount ?? 0
  const direction = target.weekly_cents > currentCents ? 'up' : 'down'
  return { sub, tiers, target, item, price, direction }
}

// Seconds; a browser-supplied proration date is only used if it's recent, so
// the charge matches the preview the agent confirmed.
function prorationDate(raw: unknown) {
  const t = Math.floor(now() / 1000)
  const n = Number(raw)
  return Number.isFinite(n) && n <= t && t - n < 15 * 60 ? Math.floor(n) : t
}

async function previewChange(admin: SupabaseClient, me: any, body: any) {
  const { sub, target, item, price, direction } = await planSwitch(admin, me, body)
  if (direction === 'down') {
    return { direction, ...tierInfo(target), at: iso(periodEndOf(sub)) }
  }
  const proration_date = Math.floor(now() / 1000)
  const upcoming = await stripe('invoices/upcoming', {
    method: 'GET',
    params: {
      customer: me.stripe_customer_id,
      subscription: sub.id,
      subscription_items: [{ id: item.id, price }],
      subscription_proration_behavior: 'always_invoice',
      subscription_proration_date: proration_date,
    },
  })
  const amount_cents = (upcoming.lines?.data || [])
    .filter((l: any) => l.proration)
    .reduce((s: number, l: any) => s + (l.amount || 0), 0)
  return { direction, ...tierInfo(target), amount_cents: Math.max(0, amount_cents), proration_date }
}

async function releaseSchedule(sub: any) {
  const schedId = idOf(sub.schedule)
  if (!schedId) return
  const sched = await stripe(`subscription_schedules/${schedId}`)
  if (['not_started', 'active'].includes(sched.status)) await stripe(`subscription_schedules/${schedId}/release`, { params: {} })
}

async function changePlan(admin: SupabaseClient, me: any, body: any) {
  const { sub, target, item, price, direction } = await planSwitch(admin, me, body)

  if (direction === 'up') {
    // An upgrade replaces any downgrade that was waiting.
    await releaseSchedule(sub)
    // pending_if_incomplete: the plan only changes if the difference is paid.
    const updated = await stripe(`subscriptions/${sub.id}`, {
      params: {
        items: [{ id: item.id, price }],
        proration_behavior: 'always_invoice',
        proration_date: prorationDate(body.proration_date),
        payment_behavior: 'pending_if_incomplete',
      },
    })
    if (updated.pending_update) {
      throw new AppError(402, 'Your card was declined, so your plan didn\'t change. Update your card and try again.', 'payment_failed')
    }
    const { billing_status } = await syncSubscription(admin, updated, me)
    return { ok: true, direction, ...tierInfo(target), billing_status }
  }

  // Downgrade at the end of the paid week: a schedule with the current price
  // until then and the new one after; it releases the subscription afterwards.
  const schedId = idOf(sub.schedule)
  const sched = schedId
    ? await stripe(`subscription_schedules/${schedId}`)
    : await stripe('subscription_schedules', { params: { from_subscription: sub.id } })
  const t = Math.floor(now() / 1000)
  const cur = (sched.phases || []).find((ph: any) => ph.start_date <= t && t < ph.end_date) || sched.phases?.[0]
  const end = periodEndOf(sub) ?? cur?.end_date
  await stripe(`subscription_schedules/${sched.id}`, {
    params: {
      end_behavior: 'release',
      phases: [
        { items: [{ price: item.price.id, quantity: 1 }], start_date: cur.start_date, end_date: end, proration_behavior: 'none' },
        { items: [{ price, quantity: 1 }], iterations: 1, proration_behavior: 'none' },
      ],
    },
  })
  return { ok: true, direction, ...tierInfo(target), at: iso(end) }
}

async function cancelChange(me: any) {
  const sub = await liveSubscription(me)
  await releaseSchedule(sub)
  return { ok: true }
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

// ── App actions ──────────────────────────────────────────────────────────────

export async function handle(req: Request, admin: SupabaseClient): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  if (new URL(req.url).pathname.endsWith('/webhook')) return handleWebhook(req, admin)

  const STRIPE_KEY = ENV.stripeKey
  const configured = !!STRIPE_KEY
  const mode = !STRIPE_KEY ? null : STRIPE_KEY.startsWith('sk_live_') || STRIPE_KEY.startsWith('rk_live_') ? 'live' : 'test'
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
    if (me.billing_exempt || me.billing_status === 'exempt') return json({ error: 'Your account isn\'t billed.' }, 409)
    if (!configured) {
      return json({ error: 'Billing isn\'t set up yet: the Stripe account hasn\'t been connected.', code: 'not_configured' }, 503)
    }

    const returnUrl = safeReturnUrl(body.return_url)

    switch (action) {
      case 'overview': return json(await overview(admin, me))
      case 'setup_card': return json(await setupCard(me))
      case 'set_default_card': return json(await setDefaultCard(admin, me, body))
      case 'preview_change': return json(await previewChange(admin, me, body))
      case 'change_plan': return json(await changePlan(admin, me, body))
      case 'cancel_change': return json(await cancelChange(me))
      case 'cancel': return json(await cancelSub(admin, me))
      case 'resume': return json(await resumeSub(admin, me))
    }

    if (action === 'checkout') {
      const publishable_key = needPublishableKey()
      const tiers = await loadTiers(admin)
      const tier = tiers.find(t => t.key === body.tier) || (body.tier ? null : tiers[0])
      if (!tier) return json({ error: 'That plan isn\'t available.' }, 400)

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

      const price = await ensureTierPrice(admin, tier, tiers)
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
          subscription_data: { metadata: { ...TAG, profile_id: me.id, tier: tier.key } },
          metadata: { ...TAG, profile_id: me.id, tier: tier.key },
          return_url: `${back.origin}${back.pathname}?session_id={CHECKOUT_SESSION_ID}`,
        },
      })
      return json({ client_secret: session.client_secret, publishable_key })
    }

    if (action === 'portal') {
      if (!me.stripe_customer_id) return json({ error: 'No subscription yet. Subscribe first.' }, 409)
      const configuration = await ensurePortalConfig(admin)
      const params: Record<string, unknown> = { customer: me.stripe_customer_id, configuration, return_url: returnUrl }
      if (body.flow === 'change_plan' && me.stripe_subscription_id && ['active', 'past_due'].includes(me.billing_status)) {
        params.flow_data = {
          type: 'subscription_update',
          subscription_update: { subscription: me.stripe_subscription_id },
          after_completion: { type: 'redirect', redirect: { return_url: returnUrl } },
        }
      }
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
