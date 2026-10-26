// create-balance-topup — a one-time Stripe Checkout that adds a set amount to
// an agent's prepaid balance. index.ts wires Deno; everything here runs
// against a mocked Stripe in core.test.ts.
//
//   POST { amount_cents: 10000 | 25000 | 50000, return_url? }
//     → { url, id }: a hosted Checkout page (mode payment) to send the agent to.
//
// Callers: a signed-in agent, for themselves. The amount must be one of the
// set ones; the price is built here from it, never taken from the body. The
// session carries the agent and amount in metadata (kind 'prepaid_topup');
// nothing is credited here. The agent-billing webhook credits the ledger when
// Stripe reports the session paid (credit_topup, migration 161).

import { type Stripe, StripeError } from '../_shared/fulfillmentPayouts.ts'
import { TOPUP_CENTS, TOPUP_KIND, isTopupAmount } from '../_shared/balanceTopup.ts'

export type Profile = { id: string; role: string; email: string | null; stripe_customer_id: string | null }

export type Store = {
  userFromJwt(jwt: string): Promise<string | null>
  profile(id: string): Promise<Profile | null>
}

export type Env = { configured: boolean; now?: () => number }

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

const TAG = { ohvara: 'agent_balance' }

// Where Stripe may send the agent back to. Same list as agent-billing.
const DEFAULT_RETURN = 'https://portal.ohvara.com/agent/billing'
const ALLOWED_ORIGINS = ['https://portal.ohvara.com', 'https://ohvara-dashboard.vercel.app']

export function safeReturnUrl(raw: unknown): URL {
  try {
    const u = new URL(String(raw))
    const local = u.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(u.hostname)
    if (ALLOWED_ORIGINS.includes(u.origin) || local) return u
  } catch { /* fall through */ }
  return new URL(DEFAULT_RETURN)
}

const dollars = (cents: number) => `$${(cents / 100).toFixed(0)}`

async function caller(store: Store, jwt: string) {
  const id = jwt ? await store.userFromJwt(jwt) : null
  if (!id) throw new AppError(401, 'Not signed in')
  const me = await store.profile(id)
  if (!me || me.role !== 'agent') throw new AppError(403, 'Only agents can add funds.')
  return me
}

export async function createTopup(store: Store, stripe: Stripe, env: Env, jwt: string, body: any) {
  const me = await caller(store, jwt)
  if (!env.configured) throw new AppError(503, 'Billing isn\'t set up yet.', 'not_configured')
  const cents = body?.amount_cents
  if (!isTopupAmount(cents)) {
    throw new AppError(400, `Pick ${TOPUP_CENTS.map(dollars).join(', ')}.`, 'bad_amount')
  }

  // Stripe fills in {CHECKOUT_SESSION_ID} itself, so it must not be URL-encoded.
  const back = safeReturnUrl(body?.return_url)
  const base = `${back.origin}${back.pathname}`
  const metadata = { ...TAG, kind: TOPUP_KIND, agent_id: me.id, amount_cents: String(cents) }
  // A double-tap within the same minute gets the same session back.
  const minute = Math.floor((env.now ? env.now() : Date.now()) / 60_000)
  const session = await stripe('POST', 'checkout/sessions', {
    mode: 'payment',
    // Cards (incl. Apple / Google Pay) only: they're paid when the session
    // completes, so checkout.session.completed is the one event to credit on.
    payment_method_types: ['card'],
    ...(me.stripe_customer_id ? { customer: me.stripe_customer_id } : me.email ? { customer_email: me.email } : {}),
    client_reference_id: me.id,
    line_items: [{
      price_data: {
        currency: 'usd',
        unit_amount: cents,
        product_data: { name: 'Ohvara prepaid balance', description: `${dollars(cents)} added to your balance` },
      },
      quantity: 1,
    }],
    metadata,
    payment_intent_data: { metadata },
    success_url: `${base}?topup=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${base}?topup=cancel`,
  }, { idempotencyKey: `balance-topup-${me.id}-${cents}-${minute}` })
  return { url: session.url, id: session.id }
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
    // Stripe's own text can name ids and internals; it's logged, not shown.
    console.error('create-balance-topup failed:', e instanceof StripeError ? `${e.status} ${e.code || e.type}: ${e.message}` : (e as Error).message)
    return json({ error: 'Something went wrong with Stripe. Try again in a minute.' }, 502)
  }
}
