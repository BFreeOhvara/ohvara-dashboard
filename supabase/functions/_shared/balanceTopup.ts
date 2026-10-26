// Prepaid balance top-ups: what create-balance-topup puts on a Checkout
// Session and what the agent-billing webhook checks before crediting it.
// Kept here so both sides read the same amounts and marker.

// The only amounts an agent can buy, in cents. Keep in step with
// credit_topup() in migration 161, which refuses anything else.
export const TOPUP_CENTS = [10000, 25000, 50000] as const

// metadata.kind on every top-up session. The webhook URL is shared with the
// retainer's subscription Checkout, so this is how the two never mix.
export const TOPUP_KIND = 'prepaid_topup'

export const isTopupAmount = (cents: unknown): cents is number =>
  typeof cents === 'number' && (TOPUP_CENTS as readonly number[]).includes(cents)

export type TopupCredit = { agent_id: string; amount_cents: number; session_id: string }

// A completed Checkout Session → what to credit, or why not. Everything is
// read from the session Stripe signed, and must agree: the agent on the
// metadata and client_reference_id, and the amount we set with what was paid.
export function topupFromSession(s: any): { credit: TopupCredit } | { skip: string } {
  if (s?.metadata?.kind !== TOPUP_KIND) return { skip: 'not_topup' }
  if (s.mode !== 'payment') return { skip: 'not_payment_mode' }
  if (s.payment_status !== 'paid') return { skip: `payment_status_${s.payment_status}` }
  const agent = s.metadata.agent_id
  if (!agent || agent !== s.client_reference_id) return { skip: 'agent_mismatch' }
  const cents = Number(s.metadata.amount_cents)
  if (!isTopupAmount(cents)) return { skip: 'bad_amount' }
  if (s.amount_total !== cents || String(s.currency).toLowerCase() !== 'usd') return { skip: 'amount_mismatch' }
  return { credit: { agent_id: agent, amount_cents: cents, session_id: s.id } }
}
