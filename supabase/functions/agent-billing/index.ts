import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js'

// Prompt 673 — the agent retainer (weekly, agent pays Ohvara). Prompt 692 made
// it tiered: each row of agent_billing_tiers (migration 119) is a weekly price
// plus a weekly submission cap, and gets its own recurring Price here. Stripe
// Billing: one weekly recurring Price per tier, Stripe-hosted Checkout to subscribe and
// the Customer Portal to manage, so no card data touches this app. Migration
// 113 holds the state on profiles; this function is the only thing that
// writes it (service role), apart from an admin by hand.
//
// Not the dead pre-pivot Payouts system: that used Stripe *Connect* to pay
// reps (stripe_account_id). This is Customers + Subscriptions, money the other
// way, and never touches those columns.
//
// Two entry points, one function so the subscription -> profile mapping lives
// in one place:
//
//   POST /agent-billing            { action, return_url? }   (the app)
//     status   — { configured, mode, webhook_configured, billing_status }.
//                Signed in, it also re-syncs from Stripe, so a missed or
//                late webhook heals the next time the agent opens Billing.
//                Signed out, it returns the booleans only (ops check).
//     checkout — agent only; { tier } picks the plan (default: the first
//                active tier). Returns { url } for a Stripe Checkout page.
//     portal   — agent only; returns { url } for the Customer Portal
//                (update card, switch plan, cancel, renew, invoices).
//                { flow: 'change_plan' } deep-links to the plan switcher.
//
//   POST /agent-billing/webhook    (Stripe)
//     Verified against STRIPE_WEBHOOK_SECRET. Every event is used only for
//     the subscription id; the subscription itself is re-fetched from Stripe,
//     so out-of-order delivery can't write stale state.
//
// Deployed with verify_jwt off; users are authenticated here instead.
//
// Secrets: STRIPE_SECRET_KEY (sk_test_… until go-live), STRIPE_WEBHOOK_SECRET
// (the endpoint's whsec_…). The Price, Product and Customer Portal
// configuration are created on first use, so there's no setup step in Stripe
// beyond the webhook endpoint.
//
// Stripe webhook endpoint:
//   https://jjextitmbptoaolacocs.supabase.co/functions/v1/agent-billing/webhook
// events: checkout.session.completed, customer.subscription.created,
//   customer.subscription.updated, customer.subscription.deleted,
//   invoice.paid, invoice.payment_failed

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

const STRIPE_KEY = Deno.env.get('STRIPE_SECRET_KEY')
const WEBHOOK_SECRET = Deno.env.get('STRIPE_WEBHOOK_SECRET')
// Pinned so subscription.current_period_end and invoice.subscription stay
// where this code reads them. Webhook payloads follow the endpoint's own
// version, which is why events are only mined for ids (both shapes handled).
const STRIPE_VERSION = '2024-06-20'

const TAG = { ohvara: 'agent_billing' }
const GRACE_HOURS = 48 // keep in step with src/lib/billing.js
const MAX_SKEW_SECONDS = 5 * 60

// Where Stripe may send the agent back to. Anything else falls back to prod.
const DEFAULT_RETURN = 'https://portal.ohvara.com/settings#billing'
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

// ── Stripe REST ──────────────────────────────────────────────────────────────

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
  const res = await fetch(`https://api.stripe.com/v1/${path}${qs}`, {
    method,
    headers: {
      Authorization: `Bearer ${STRIPE_KEY}`,
      'Stripe-Version': STRIPE_VERSION,
      ...(method !== 'GET' ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
    },
    body: method !== 'GET' && init.params ? formEncode(init.params) : undefined,
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data?.error?.message || `Stripe ${method} ${path} failed (${res.status})`)
  return data
}

// ── Tiers + Prices ───────────────────────────────────────────────────────────

type Tier = {
  key: string; name: string; weekly_cents: number; weekly_cap: number | null
  stripe_lookup_key: string | null; stripe_price_id: string | null; sort_order: number
}

async function loadTiers(admin: SupabaseClient): Promise<Tier[]> {
  const { data, error } = await admin.from('agent_billing_tiers').select('*').eq('is_active', true).order('sort_order')
  if (error) throw new Error(`Couldn't load billing tiers: ${error.message}`)
  return (data || []) as Tier[]
}

// One shared Product, found through any existing tier Price or created once.
async function ensureProduct(tiers: Tier[]): Promise<string> {
  for (const t of tiers) {
    if (!t.stripe_lookup_key) continue
    const found = await stripe('prices', { method: 'GET', params: { lookup_keys: [t.stripe_lookup_key], active: true, limit: 1 } })
    if (found.data?.[0]?.product) return found.data[0].product
  }
  return (await stripe('products', {
    params: { name: 'Ohvara agent portal access', description: 'Weekly retainer: portal access and that week\'s batch of cancellations.', metadata: TAG },
  })).id
}

// A tier's weekly Price, created on first use and found again by lookup key.
// If the tier's price changes, a new Price takes over the lookup key; existing
// subscriptions stay on whatever they signed up at until moved by hand.
async function ensureTierPrice(admin: SupabaseClient, tier: Tier, tiers: Tier[]): Promise<string> {
  const lookup = tier.stripe_lookup_key || `ohvara_agent_${tier.key}_weekly`
  const found = await stripe('prices', { method: 'GET', params: { lookup_keys: [lookup], active: true, limit: 1 } })
  const current = found.data?.[0]
  let id: string
  if (current && current.unit_amount === tier.weekly_cents && current.recurring?.interval === 'week') {
    id = current.id
    // Prices created before tiers existed carry no tier tag.
    if (current.metadata?.tier !== tier.key) await stripe(`prices/${id}`, { params: { metadata: { ...TAG, tier: tier.key } } })
  } else {
    const product = current?.product || await ensureProduct(tiers)
    id = (await stripe('prices', {
      params: {
        product, currency: 'usd', unit_amount: tier.weekly_cents, recurring: { interval: 'week' },
        nickname: tier.name, lookup_key: lookup, transfer_lookup_key: true, metadata: { ...TAG, tier: tier.key },
      },
    })).id
  }
  if (tier.stripe_price_id !== id || tier.stripe_lookup_key !== lookup) {
    await admin.from('agent_billing_tiers')
      .update({ stripe_price_id: id, stripe_lookup_key: lookup, updated_at: new Date().toISOString() }).eq('key', tier.key)
    tier.stripe_price_id = id
    tier.stripe_lookup_key = lookup
  }
  return id
}

// Our own Customer Portal configuration (found by metadata), so the account's
// default portal settings can't change what agents are allowed to do. Updated
// on every use so a new or repriced tier shows up in the plan switcher.
//
// Plan switching: upgrades bill the difference immediately (the cap goes up as
// soon as the webhook lands); downgrades wait for the end of the paid week so
// nobody loses capacity they've paid for.
async function ensurePortalConfig(admin: SupabaseClient): Promise<string> {
  const tiers = await loadTiers(admin)
  const prices: string[] = []
  for (const t of tiers) prices.push(await ensureTierPrice(admin, t, tiers))
  const product = await ensureProduct(tiers)

  const features = {
    invoice_history: { enabled: true },
    payment_method_update: { enabled: true },
    // Cancelling keeps the paid week; the portal offers "Renew" until it ends.
    subscription_cancel: { enabled: true, mode: 'at_period_end', proration_behavior: 'none' },
    customer_update: { enabled: false },
    subscription_update: {
      enabled: prices.length > 1,
      default_allowed_updates: ['price'],
      products: [{ product, prices }],
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
  const tagged = price.metadata?.tier
  if (tagged && tiers.some(t => t.key === tagged)) return tagged
  const hit = tiers.find(t => t.stripe_price_id === price.id || (price.lookup_key && t.stripe_lookup_key === price.lookup_key))
  return hit?.key ?? null
}

// ── Subscription -> profile ──────────────────────────────────────────────────

const LIVE = ['active', 'trialing', 'past_due']
const PROFILE_COLS = 'id, role, email, full_name, billing_status, billing_tier, stripe_customer_id, stripe_subscription_id, billing_grace_until'

async function profileFor(admin: SupabaseClient, sub: any) {
  const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id
  if (sub.metadata?.profile_id) {
    const { data } = await admin.from('profiles').select(PROFILE_COLS).eq('id', sub.metadata.profile_id).maybeSingle()
    if (data) return data
  }
  if (!customerId) return null
  const { data } = await admin.from('profiles').select(PROFILE_COLS).eq('stripe_customer_id', customerId).maybeSingle()
  return data
}

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
  if (p.billing_status === 'exempt') return { ignored: 'exempt' }
  // An old subscription's late events must not clobber the current one.
  if (p.stripe_subscription_id && p.stripe_subscription_id !== sub.id && !LIVE.includes(sub.status)) {
    return { ignored: 'not the current subscription' }
  }

  const now = new Date()
  const tier = tierOfPrice(sub.items?.data?.[0]?.price, await loadTiers(admin))
  const periodEnd = sub.current_period_end ?? sub.items?.data?.[0]?.current_period_end
  const patch: Record<string, unknown> = {
    stripe_customer_id: typeof sub.customer === 'string' ? sub.customer : sub.customer?.id,
    stripe_subscription_id: sub.id,
    billing_current_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
    billing_updated_at: now.toISOString(),
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
        : new Date(now.getTime() + GRACE_HOURS * 3600e3).toISOString()
      break
    case 'incomplete':
      break
    default:
      patch.billing_status = 'lapsed'
      patch.billing_grace_until = null
  }

  const { error } = await admin.from('profiles').update(patch).eq('id', p.id)
  if (error) throw new Error(`Profile update failed: ${error.message}`)
  return { profile_id: p.id, billing_status: patch.billing_status ?? p.billing_status }
}

// The customer's most relevant subscription: a live one if any, else the newest.
async function latestSubscription(customerId: string) {
  const list = await stripe('subscriptions', { method: 'GET', params: { customer: customerId, status: 'all', limit: 10 } })
  const subs = list.data || []
  return subs.find((s: any) => LIVE.includes(s.status)) || subs[0] || null
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
  if (!t || !v1.length || !Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > MAX_SKEW_SECONDS) return false
  const expected = await hmacHex(secret, `${t}.${rawBody}`)
  return v1.some(sig => safeEqual(expected, sig))
}

function subscriptionIdOf(event: any): string | null {
  const o = event.data?.object || {}
  switch (event.type) {
    case 'checkout.session.completed':
      return o.mode === 'subscription' ? (typeof o.subscription === 'string' ? o.subscription : o.subscription?.id) : null
    case 'invoice.paid':
    case 'invoice.payment_failed': {
      const s = o.subscription ?? o.parent?.subscription_details?.subscription
      return typeof s === 'string' ? s : s?.id ?? null
    }
    default:
      return event.type?.startsWith('customer.subscription.') ? o.id : null
  }
}

async function handleWebhook(req: Request, admin: SupabaseClient) {
  if (!STRIPE_KEY || !WEBHOOK_SECRET) return json({ error: 'Billing webhook not configured' }, 503)
  const raw = await req.text()
  if (!await verifySignature(req.headers.get('stripe-signature'), raw, WEBHOOK_SECRET)) {
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

// ── App actions ──────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  if (new URL(req.url).pathname.endsWith('/webhook')) return handleWebhook(req, admin)

  const configured = !!STRIPE_KEY
  const mode = !STRIPE_KEY ? null : STRIPE_KEY.startsWith('sk_live_') || STRIPE_KEY.startsWith('rk_live_') ? 'live' : 'test'
  const flags = { configured, mode, webhook_configured: !!WEBHOOK_SECRET }

  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer /, '')
  let body: any = {}
  try { body = await req.json() } catch { /* empty body */ }
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
      if (configured && me.role === 'agent' && me.stripe_customer_id && me.billing_status !== 'exempt') {
        const sub = await latestSubscription(me.stripe_customer_id).catch(() => null)
        if (sub) billing_status = (await syncSubscription(admin, sub, me)).billing_status ?? billing_status
      }
      return json({ ...flags, billing_status })
    }

    if (me.role !== 'agent') return json({ error: 'Only agents are billed' }, 403)
    if (me.billing_status === 'exempt') return json({ error: 'Your account isn\'t billed.' }, 409)
    if (!configured) {
      return json({ error: 'Billing isn\'t set up yet: the Stripe account hasn\'t been connected.', code: 'not_configured' }, 503)
    }

    const returnUrl = safeReturnUrl(body.return_url)

    if (action === 'checkout') {
      let customerId = me.stripe_customer_id
      if (customerId) {
        // Never start a second subscription. A live one means the webhook
        // missed something: sync it and send them to the portal instead.
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
          .update({ stripe_customer_id: customerId, billing_updated_at: new Date().toISOString() })
          .eq('id', me.id)
        if (error) throw new Error(`Couldn't save the Stripe customer: ${error.message}`)
      }

      const tiers = await loadTiers(admin)
      const tier = tiers.find(t => t.key === body.tier) || (body.tier ? null : tiers[0])
      if (!tier) return json({ error: `Unknown plan: ${body.tier}` }, 400)
      const price = await ensureTierPrice(admin, tier, tiers)
      const session = await stripe('checkout/sessions', {
        params: {
          mode: 'subscription',
          customer: customerId,
          client_reference_id: me.id,
          line_items: [{ price, quantity: 1 }],
          subscription_data: { metadata: { ...TAG, profile_id: me.id, tier: tier.key } },
          metadata: { ...TAG, profile_id: me.id, tier: tier.key },
          success_url: returnUrl,
          cancel_url: returnUrl,
        },
      })
      return json({ url: session.url })
    }

    if (action === 'portal') {
      if (!me.stripe_customer_id) return json({ error: 'No subscription yet. Subscribe first.' }, 409)
      const configuration = await ensurePortalConfig(admin)
      const params: Record<string, unknown> = { customer: me.stripe_customer_id, configuration, return_url: returnUrl }
      // Straight to the plan switcher for an agent with a live subscription.
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
    console.error(`agent-billing ${action} failed:`, (e as Error).message)
    return json({ error: (e as Error).message || 'Stripe request failed' }, 502)
  }
})
