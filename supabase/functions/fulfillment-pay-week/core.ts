// fulfillment-pay-week — Prompt 753. An admin approves and pays one rep's
// finished pay week. Modelled on stripe-pay-commission (P55), with the
// amount never taken from the request: it's recomputed here from the rep's
// schedule (fulfillment_week_figures, migration 138) at the moment of paying.
//
//   POST { rep_id, period_start }   (period_start = that week's Monday)
//
// Prompt 761: while payouts_live is off, Approve still works but only marks the
// week approved (same checks and claim, the amount locked from the server's
// figures); Stripe is never called and no email goes out. Once payouts are
// on, an approved week is paid by approving it again (the claim takes an
// approved row older than two minutes).
//
// Order of checks: admin → payouts_live on → Stripe configured → the week is
// over and comes to more than $0 → claim the row (upcoming / failed / held →
// approved, so two clicks can't both pay) → the rep's payout account can take
// a transfer (else the week is put on hold and the rep emailed) → Stripe
// Transfer to the connected account, with an idempotency key per row + amount
// (a retry after a crash returns the same transfer, never a second one) →
// paid, "Payout sent" email. A refused transfer marks the week failed and
// sends the "Payout problem" email. Emails go only if the rep's switch is on.

import {
  type Email, type PayoutAccount, type Stripe, StripeError, canPay, destinationLabel, problemEmail, sentEmail, weekLabel,
} from '../_shared/fulfillmentPayouts.ts'

export type Figures = { period_start: string; period_end: string; hours: number; rate_cents: number; amount_cents: number; ended: boolean }
export type Payout = {
  id: string; rep_id: string; period_start: string; period_end: string; hours: number; rate_cents: number
  amount_cents: number; status: string; stripe_transfer_id: string | null
}
export type Rep = { id: string; role: string; full_name: string | null; email: string | null; stripe_account_id: string | null; payout_email_sent: boolean; payout_email_problem: boolean }

export type Store = {
  userFromJwt(jwt: string): Promise<string | null>
  role(id: string): Promise<string | null>
  payoutsLive(): Promise<boolean>
  rep(id: string): Promise<Rep | null>
  figures(repId: string, periodStart: string): Promise<Figures | null>
  // Locks the week for paying: writes the figures and moves it to approved
  // only from upcoming / failed / held (or an approved claim older than two
  // minutes, i.e. a crashed attempt). Returns the claimed row, or null.
  claim(repId: string, f: Figures, adminId: string): Promise<Payout | null>
  payout(repId: string, periodStart: string): Promise<Payout | null>
  account(repId: string): Promise<PayoutAccount | null>
  markPayout(id: string, patch: Record<string, unknown>): Promise<void>
  sendEmail(e: Email): Promise<void>
}

export type Env = { configured: boolean; appUrl: string }

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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const isMonday = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(`${s}T12:00:00Z`).getUTCDay() === 1

// A refusal the admin (and the rep's email) can read. Stripe's raw text is logged.
export function failureText(e: unknown) {
  if (e instanceof StripeError) {
    if (e.code === 'balance_insufficient') return 'Ohvara\'s Stripe balance was too low to send it.'
    if (e.code === 'account_invalid' || e.code === 'account_closed') return 'Your payout account can\'t receive money right now.'
    return 'Stripe couldn\'t send the payment.'
  }
  return 'Something went wrong sending the payment.'
}

async function emailIfOn(store: Store, on: boolean, rep: Rep, build: (to: string) => Email) {
  if (!on || !rep.email) return
  try { await store.sendEmail(build(rep.email)) } catch (e) { console.error('payout email failed:', (e as Error).message) }
}

export async function payWeek(store: Store, stripe: Stripe, env: Env, adminId: string, body: any) {
  if ((await store.role(adminId)) !== 'admin') throw new AppError(403, 'Only an admin can pay a week.')
  const repId = String(body?.rep_id || '')
  const start = String(body?.period_start || '')
  if (!UUID.test(repId) || !isMonday(start)) throw new AppError(400, 'Pick a rep and a week (its Monday).')
  const live = await store.payoutsLive()
  if (live && !env.configured) throw new AppError(503, 'Stripe isn\'t connected.', 'not_configured')

  const rep = await store.rep(repId)
  if (!rep || rep.role !== 'fulfillment') throw new AppError(404, 'That rep isn\'t on Fulfillment.')
  const f = await store.figures(repId, start)
  if (!f) throw new AppError(404, 'No pay week for that rep.')
  if (!f.ended) throw new AppError(409, 'That week isn\'t over yet. Pay it from Monday.', 'week_not_over')
  if (!(f.amount_cents > 0)) throw new AppError(400, 'Nothing to pay for that week.', 'nothing_to_pay')

  const row = await store.claim(repId, f, adminId)
  if (!row) {
    const cur = await store.payout(repId, start)
    if (cur?.status === 'paid') throw new AppError(409, 'That week is already paid.', 'already_paid')
    if (!live && cur?.status === 'approved') return { ok: true, approved_only: true, payout_id: cur.id, amount_cents: cur.amount_cents }
    throw new AppError(409, 'That week is being paid right now.', 'in_progress')
  }
  // Payouts off: the week stays approved, no money moves.
  if (!live) return { ok: true, approved_only: true, payout_id: row.id, amount_cents: row.amount_cents }

  const acct = await store.account(repId)
  if (!rep.stripe_account_id || !acct || !canPay(acct)) {
    const reason = !rep.stripe_account_id || !acct ? 'You haven\'t added where your pay should go yet.' : 'Stripe needs something from you before it can pay you.'
    await store.markPayout(row.id, { status: 'held', failure_reason: reason })
    await emailIfOn(store, rep.payout_email_problem, rep, to => problemEmail(to, row, reason, env.appUrl))
    throw new AppError(409, `On hold: ${rep.full_name || 'the rep'} hasn't finished payout setup.`, 'held')
  }

  const dest = destinationLabel(acct)
  let transfer
  try {
    transfer = await stripe('POST', 'transfers', {
      amount: row.amount_cents,
      currency: 'usd',
      destination: rep.stripe_account_id,
      transfer_group: `fulfillment_${repId}_${start}`,
      description: `Ohvara pay · ${weekLabel(row.period_start, row.period_end)}`,
      metadata: { ohvara: 'fulfillment_payout', payout_id: row.id, rep_id: repId, period_start: start, hours: String(row.hours) },
    }, { idempotencyKey: `fulfillment-payout-${row.id}-${row.amount_cents}` })
  } catch (e) {
    console.error('fulfillment-pay-week transfer failed:', e instanceof StripeError ? `${e.status} ${e.code || e.type}: ${e.message}` : (e as Error).message)
    const reason = failureText(e)
    await store.markPayout(row.id, { status: 'failed', failure_reason: reason })
    await emailIfOn(store, rep.payout_email_problem, rep, to => problemEmail(to, row, reason, env.appUrl))
    throw new AppError(502, `Not paid: ${reason}`, 'transfer_failed')
  }

  await store.markPayout(row.id, {
    status: 'paid', stripe_transfer_id: transfer.id, paid_at: new Date().toISOString(), paid_to: dest, failure_reason: null,
  })
  await emailIfOn(store, rep.payout_email_sent, rep, to => sentEmail(to, row, dest, env.appUrl))
  return { ok: true, payout_id: row.id, transfer_id: transfer.id, amount_cents: row.amount_cents, paid_to: dest }
}

export async function handle(req: Request, store: Store, stripe: Stripe, env: Env): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer /, '')
  const id = jwt ? await store.userFromJwt(jwt) : null
  if (!id) return json({ error: 'Not signed in' }, 401)
  const body = await req.json().catch(() => ({}))
  try {
    return json(await payWeek(store, stripe, env, id, body))
  } catch (e) {
    if (e instanceof AppError) return json({ error: e.message, ...(e.code ? { code: e.code } : {}) }, e.status)
    console.error('fulfillment-pay-week failed:', (e as Error).message)
    return json({ error: 'Something went wrong. Try again in a minute.' }, 500)
  }
}
