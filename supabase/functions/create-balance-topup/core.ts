// create-balance-topup — a one-time Stripe Checkout that adds money to an
// agent's prepaid lead balance (Roadmap Goal 3). index.ts wires Deno; all the
// logic is here, free of Deno globals, so it runs against a mocked Stripe and
// an in-memory store in core.test.ts.
//
//   POST { amount_cents | amount_dollars, return_url }
//     → { url }: a hosted Checkout page (mode payment) to send the agent to.
//
// Callers: a signed-in agent, for themselves (checked here: verify_jwt alone
// lets a publishable-key caller through). The amount must match an active row
// of prepaid_topup_options (migration 176), read with the service role; the
// price is built here from that row, never from the body. return_url must be
// on this app's own origin, anything else is refused. Nothing is credited
// here: stripe-balance-webhook credits the ledger (credit_topup) once Stripe
// reports the session paid.
//
// TEST MODE ONLY: unless the key starts with sk_test_ (missing, sk_live_,
// rk_live_, anything else) every call is refused before Stripe is touched.
// Going live is its own checked step through Brayden's door.

import { type Stripe, StripeError } from '../_shared/fulfillmentPayouts.ts'

export type Profile = { id: string; role: string; email: string | null; stripe_customer_id: string | null }

export type Store = {
  userFromJwt(jwt: string): Promise<string | null>
  profile(id: string): Promise<Profile | null>
  // amount_cents of the active prepaid_topup_options rows.
  topupOptions(): Promise<number[]>
}

export type Env = {
  stripeKey?: string
  // Extra allowed return origins (e.g. PUBLIC_APP_URL), on top of the fixed list.
  appOrigins?: string[]
  now?: () => number
}

// The marker stripe-balance-webhook looks for. Keep in step with its core.ts.
export const TOPUP_KIND = 'balance_topup'
const TAG = { ohvara: 'agent_lead_balance', kind: TOPUP_KIND }

export class AppError extends Error {
  status: number; code?: string
  constructor(status: number, message: string, code?: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

// Only a test-mode secret key may create sessions.
export const isTestKey = (key: string | undefined) => !!key && key.startsWith('sk_test_')

// This app's own origins. Same list as agent-billing, plus local dev.
const ALLOWED_ORIGINS = ['https://portal.ohvara.com', 'https://ohvara-dashboard.vercel.app']

// The return page, or null when it isn't on this app's own origin.
export function ownReturnUrl(raw: unknown, extra: string[] = []): URL | null {
  if (typeof raw !== 'string' || !raw) return null
  try {
    const u = new URL(raw)
    const local = u.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(u.hostname)
    if (u.username || u.password) return null
    return ALLOWED_ORIGINS.includes(u.origin) || extra.includes(u.origin) || local ? u : null
  } catch {
    return null
  }
}

// Whole cents from amount_cents, or amount_dollars × 100. NaN when neither is a
// clean number.
export function requestedCents(body: any): number {
  if (body?.amount_cents !== undefined && body?.amount_cents !== null) {
    const c = Number(body.amount_cents)
    return Number.isInteger(c) ? c : NaN
  }
  if (body?.amount_dollars !== undefined && body?.amount_dollars !== null) {
    const d = Number(body.amount_dollars)
    const c = Math.round(d * 100)
    return Number.isFinite(d) && Math.abs(d * 100 - c) < 1e-6 ? c : NaN
  }
  return NaN
}

const dollars = (cents: number) => `$${(cents / 100).toFixed(cents % 100 ? 2 : 0)}`

async function caller(store: Store, jwt: string) {
  const id = jwt ? await store.userFromJwt(jwt) : null
  if (!id) throw new AppError(401, 'Not signed in')
  const me = await store.profile(id)
  if (!me || me.role !== 'agent') throw new AppError(403, 'Only agents can add funds.')
  return me
}

export async function createTopup(store: Store, stripe: Stripe, env: Env, jwt: string, body: any) {
  const me = await caller(store, jwt)
  if (!isTestKey(env.stripeKey)) {
    throw new AppError(503, 'Adding funds isn\'t available yet.', 'not_configured')
  }

  const options = (await store.topupOptions()).filter(c => Number.isInteger(c) && c > 0).sort((a, b) => a - b)
  if (!options.length) throw new AppError(503, 'Adding funds isn\'t available right now.', 'no_options')
  const cents = requestedCents(body)
  if (!options.includes(cents)) {
    throw new AppError(400, `Pick ${options.map(dollars).join(', ')}.`, 'bad_amount')
  }

  const back = ownReturnUrl(body?.return_url, env.appOrigins)
  if (!back) throw new AppError(400, 'Bad return page.', 'bad_return_url')
  // Stripe fills in {CHECKOUT_SESSION_ID} itself, so it must not be URL-encoded.
  const base = `${back.origin}${back.pathname}`

  const metadata = { ...TAG, agent_id: me.id, amount_cents: String(cents) }
  // A double tap within the same minute gets the same session back.
  const minute = Math.floor((env.now ? env.now() : Date.now()) / 60_000)
  const session = await stripe('POST', 'checkout/sessions', {
    mode: 'payment',
    // Cards (incl. Apple / Google Pay) only: paid when the session completes,
    // so checkout.session.completed is the one event the webhook credits on.
    payment_method_types: ['card'],
    ...(me.stripe_customer_id ? { customer: me.stripe_customer_id } : me.email ? { customer_email: me.email } : {}),
    client_reference_id: me.id,
    line_items: [{
      quantity: 1,
      price_data: {
        currency: 'usd',
        unit_amount: cents,
        product_data: { name: 'Ohvara prepaid lead balance', description: `${dollars(cents)} added to your balance` },
      },
    }],
    metadata,
    payment_intent_data: { metadata },
    success_url: `${base}?topup=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${base}?topup=cancel`,
  }, { idempotencyKey: `balance-topup-${me.id}-${cents}-${minute}` })
  if (typeof session?.url !== 'string') throw new Error('Stripe returned no checkout url')
  return { url: session.url as string }
}

export async function handle(req: Request, store: Store, stripe: Stripe, env: Env): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer /, '')
  const body = await req.json().catch(() => ({}))
  try {
    return json(await createTopup(store, stripe, env, jwt, body))
  } catch (e) {
    if (e instanceof AppError) return json({ error: e.message, ...(e.code ? { code: e.code } : {}) }, e.status)
    // Stripe's own text can name ids and internals; only its code is logged.
    console.error('create-balance-topup failed:', e instanceof StripeError ? `stripe ${e.status} ${e.code || e.type}` : (e as Error).message)
    return json({ error: 'Something went wrong. Try again in a minute.' }, 502)
  }
}
