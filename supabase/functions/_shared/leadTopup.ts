// Prepaid lead balance top-ups (Stripe Checkout, one-time payment) and the
// webhook that credits agent_lead_ledger (migration 162). No Supabase/Deno
// imports, so it runs against a mocked Stripe and an in-memory store.
//
//   createTopup        lead-balance-topup calls it for a signed-in agent. The
//                      button's dollar amount is mapped to cents HERE; any
//                      other amount is refused. Returns a hosted Checkout URL.
//   handleTopupEvent   agent-billing's webhook calls it for a
//                      checkout.session.completed tagged kind=lead_topup. The
//                      session is re-fetched from Stripe and checked (payment
//                      mode, paid, usd, amount and agent match the tags), then
//                      one 'topup' row is written with stripe_ref = session id.
//                      The ledger's unique (stripe_ref) where kind='topup'
//                      makes a retried or repeated event a no-op.
//
// Test mode only: a live key is refused in lead-balance-topup until going live
// is its own checked step. Cancellation billing is not touched here.
import type { Stripe } from './fulfillmentPayouts.ts'

// Button dollars → cents. The only amounts that can ever be charged or credited.
export const TOPUP_CENTS: Record<string, number> = { '100': 10000, '250': 25000, '500': 50000 }
const ALLOWED_CENTS = new Set(Object.values(TOPUP_CENTS))

export const TOPUP_KIND = 'lead_topup'
const TAG = { ohvara: 'lead_balance', kind: TOPUP_KIND }

export const isLiveKey = (key: string) => key.startsWith('sk_live_') || key.startsWith('rk_live_')

// Where Stripe may send the agent back to. Same list as agent-billing.
const DEFAULT_RETURN = 'https://portal.ohvara.com/agent/billing'
const ALLOWED_ORIGINS = ['https://portal.ohvara.com', 'https://ohvara-dashboard.vercel.app']

export function safeReturnUrl(raw: unknown): URL {
  try {
    const u = new URL(String(raw))
    const local = u.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(u.hostname)
    if (ALLOWED_ORIGINS.includes(u.origin) || local) return new URL(`${u.origin}${u.pathname}`)
  } catch { /* fall through */ }
  return new URL(DEFAULT_RETURN)
}

// An error whose message is safe to show the agent as is.
export class TopupError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export type TopupAgent = { id: string; email: string | null; stripe_customer_id: string | null }

export async function createTopup(stripe: Stripe, me: TopupAgent, body: Record<string, unknown>, nowMs: number) {
  const cents = TOPUP_CENTS[String(body.amount_dollars)]
  if (!cents) throw new TopupError(400, 'Pick $100, $250 or $500.')

  const back = safeReturnUrl(body.return_url)
  const metadata = { ...TAG, profile_id: me.id, amount_cents: cents }
  // Stripe fills in {CHECKOUT_SESSION_ID} itself, so it must not be URL-encoded.
  const base = `${back.origin}${back.pathname}`
  const session = await stripe('POST', 'checkout/sessions', {
    mode: 'payment',
    payment_method_types: ['card'],   // card only: paid at completion, no async settle
    line_items: [{
      quantity: 1,
      price_data: { currency: 'usd', unit_amount: cents, product_data: { name: 'Ohvara prepaid lead balance' } },
    }],
    client_reference_id: me.id,
    ...(me.stripe_customer_id ? { customer: me.stripe_customer_id } : me.email ? { customer_email: me.email } : {}),
    metadata,
    payment_intent_data: { metadata },
    success_url: `${base}?topup=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${base}?topup=canceled`,
  }, {
    // A double tap within the same minute gets the same session back.
    idempotencyKey: `lead-topup-${me.id}-${cents}-${Math.floor(nowMs / 60e3)}`,
  })
  return { url: session.url as string, session_id: session.id as string, amount_cents: cents }
}

// ── webhook ─────────────────────────────────────────────────────────────────

export type TopupStore = {
  agent(id: string): Promise<{ id: string; role: string } | null>
  // Inserts one kind='topup' row. null = this stripe_ref was already credited.
  insertTopup(row: { agent_id: string; amount_cents: number; stripe_ref: string; note: string }):
    Promise<{ id: string; balance_after_cents: number } | null>
}

// Cheap check on the (signed) payload; handleTopupEvent re-checks the session itself.
export const isTopupEvent = (event: any) =>
  event?.type === 'checkout.session.completed' && event.data?.object?.metadata?.kind === TOPUP_KIND

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// A result for the log. Anything that isn't a top-up we can trust is ignored
// (200, so Stripe stops sending it); a store or Stripe failure throws (500,
// so Stripe retries, and the unique stripe_ref stops a double credit).
export async function handleTopupEvent(store: TopupStore, stripe: Stripe, event: any): Promise<Record<string, unknown>> {
  const id = event.data?.object?.id
  if (typeof id !== 'string' || !id.startsWith('cs_')) return { ignored: 'no session id' }
  const s = await stripe('GET', `checkout/sessions/${id}`)

  if (s.metadata?.kind !== TOPUP_KIND) return { ignored: 'not a lead top-up' }
  if (s.mode !== 'payment') return { ignored: `mode ${s.mode}` }
  if (s.payment_status !== 'paid') return { ignored: `payment ${s.payment_status}` }

  const agentId = s.metadata?.profile_id
  if (typeof agentId !== 'string' || !UUID.test(agentId) || s.client_reference_id !== agentId) {
    return { ignored: 'agent mismatch', session: s.id }
  }
  const cents = s.amount_total
  if (s.currency !== 'usd' || !ALLOWED_CENTS.has(cents) || String(cents) !== String(s.metadata?.amount_cents)) {
    return { ignored: 'amount mismatch', session: s.id }
  }

  const agent = await store.agent(agentId)
  if (!agent || agent.role !== 'agent') return { ignored: 'not an agent', session: s.id }

  const row = await store.insertTopup({ agent_id: agentId, amount_cents: cents, stripe_ref: s.id, note: 'Stripe top-up' })
  if (!row) return { already_credited: s.id }
  return { credited_cents: cents, ledger_id: row.id, balance_after_cents: row.balance_after_cents, session: s.id }
}
