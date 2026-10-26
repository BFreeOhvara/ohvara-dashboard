// lead-balance-topup — the request side: who may top up, and the replies.
// index.ts wires Deno (env, the service-role client); the Checkout session
// itself is built in ../_shared/leadTopup.ts. The webhook that credits the
// ledger lives on agent-billing's /webhook (one Stripe endpoint, one secret).
//
//   POST { amount_dollars: 100 | 250 | 500, return_url }   (agent JWT)
//     → { url, session_id, amount_cents }  hosted Checkout, test mode
//     → { error } 400  amount isn't one of the three
//     → { error } 401  not signed in;  403  not an agent
//     → { error } 503  Stripe isn't set up, or the key is live (test only for now)
import { StripeError, type Stripe } from '../_shared/fulfillmentPayouts.ts'
import { createTopup, isLiveKey, TopupError, type TopupAgent } from '../_shared/leadTopup.ts'

export type Deps = {
  stripeKey?: string
  stripe: Stripe
  userOf(jwt: string): Promise<{ id: string } | null>
  profile(id: string): Promise<(TopupAgent & { role: string }) | null>
  now(): number
  log(msg: string): void
}

export type Result = { status: number; body: Record<string, unknown> }
const fail = (status: number, error: string): Result => ({ status, body: { error } })

export async function handle(deps: Deps, authorization: string | null, body: Record<string, unknown>): Promise<Result> {
  const jwt = (authorization || '').replace(/^Bearer /, '')
  const user = jwt ? await deps.userOf(jwt) : null
  if (!user) return fail(401, 'Not signed in')

  const me = await deps.profile(user.id)
  if (!me || me.role !== 'agent') return fail(403, 'Only agents have a lead balance.')

  if (!deps.stripeKey) return fail(503, 'Top-ups aren\'t set up yet.')
  if (isLiveKey(deps.stripeKey)) return fail(503, 'Top-ups aren\'t open yet.')

  try {
    return { status: 200, body: await createTopup(deps.stripe, me, body, deps.now()) }
  } catch (e) {
    if (e instanceof TopupError) return fail(e.status, e.message)
    // Stripe's own text is logged, not shown: it can name ids and internals.
    if (e instanceof StripeError) deps.log(`stripe ${e.status} ${e.code || e.type}`)
    else deps.log((e as Error).message)
    return fail(502, 'Couldn\'t start the top-up. Try again in a minute.')
  }
}
