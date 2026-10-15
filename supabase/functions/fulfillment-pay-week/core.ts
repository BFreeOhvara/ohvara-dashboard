// fulfillment-pay-week — Prompt 764, the automatic Monday pay run. Logic
// only; index.ts wires Deno (secrets, the service-role store, Stripe, Resend).
//
// Fulfillment reps are paid per verified cancel (migration 145). Every Monday
// at 8 AM Central pg_cron calls this; it pays each rep the sum of their newly
// verified cancels through Stripe Connect. Nobody approves (Brayden, Oct 14):
// the only way in is pg_cron's x-ohvara-cron secret. A request from a person
// is refused.
//
// The run, for the week that just ended (pay date = this Monday):
//   payouts_live off → nothing moves (the run is logged 'off')
//   Pause payouts on → skipped (logged 'paused')
//   every rep's amount is recomputed in the database (fulfillment_payable):
//     verified cancels not yet paid, logged before the week ended, plus the
//     weekly minimum top-up when it's on. Never taken from a request.
//   Stripe balance short of the whole run → nobody is paid, Brayden is told,
//     and the run tries again the next day (never some reps and not others)
//   a rep with no bank ready → their amount is held (nothing reserved); it is
//     paid in the first run after they connect
//   each other rep: claim (reserves their cancels) → Stripe Transfer with an
//     idempotency key per payout row + amount → paid. A refused transfer marks
//     the payout failed, frees its cancels for the next run, and tells Brayden
//     and the rep.
// A run that ends 'done' is never run again (a second call the same day is a
// no-op, and a claimed payout can't be claimed twice). Any other ending tries
// again at the next daily call, until next Monday's run takes over.

import {
  type Email, type PayoutAccount, type Stripe, StripeError, canPay, destinationLabel, problemEmail, sentEmail, weekLabel,
} from '../_shared/fulfillmentPayouts.ts'

export type Payout = {
  id: string; rep_id: string; period_start: string; period_end: string
  amount_cents: number; cancels: number; topup_cents: number; status: string; stripe_transfer_id: string | null
}
export type Rep = { id: string; full_name: string | null; email: string | null; stripe_account_id: string | null; payout_email_sent: boolean; payout_email_problem: boolean }
export type Run = { id: string; pay_date: string; status: string; attempts: number }
export type RunPatch = Partial<{
  status: string; reps: number; paid_reps: number; held_reps: number; failed_reps: number; cancels: number
  paid_cents: number; held_cents: number; failed_cents: number; needed_cents: number | null; balance_cents: number | null; note: string | null; finished_at: string
}>

export interface Store {
  cronOk(secret: string): Promise<boolean>
  settings(): Promise<{ payouts_live: boolean; payouts_paused: boolean }>
  run(payDate: string): Promise<Run | null>
  // Inserts the run (status running) or bumps attempts on an unfinished one.
  startRun(payDate: string, periodStart: string): Promise<Run>
  finishRun(id: string, patch: RunPatch): Promise<void>
  reps(): Promise<Rep[]>
  // fulfillment_payable: what this rep would be paid for the week.
  payable(repId: string, periodStart: string): Promise<{ amount_cents: number; cancels: number }>
  // A payout already sending for this rep-week (a run that crashed mid-way).
  sending(repId: string, periodStart: string): Promise<Payout | null>
  account(repId: string): Promise<PayoutAccount | null>
  // fulfillment_claim_payout; null = nothing to pay or already paid.
  claim(repId: string, periodStart: string, runId: string, hold?: boolean, reason?: string): Promise<Payout | null>
  // fulfillment_finish_payout
  finish(payoutId: string, ok: boolean, transferId: string | null, paidTo: string | null, reason: string | null): Promise<void>
  notifyAdmins(message: string, data: Record<string, unknown>): Promise<void>
  notifyRep(repId: string, message: string, data: Record<string, unknown>): Promise<void>
  sendEmail(e: Email): Promise<void>
}

export type Env = { configured: boolean; appUrl: string }

export const PAY_HOUR = 8            // Monday 8 AM Central
export const PAY_TZ = 'America/Chicago'

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-ohvara-cron',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

const money = (cents: number) => (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })

// Date / weekday / hour in Chicago.
export function chicago(now: Date) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: PAY_TZ, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short', hour: '2-digit', hourCycle: 'h23',
  }).formatToParts(now).map(p => [p.type, p.value]))
  return { date: `${parts.year}-${parts.month}-${parts.day}`, weekday: parts.weekday as string, hour: Number(parts.hour) }
}

export function addDays(iso: string, n: number) {
  const d = new Date(`${iso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
export const mondayOf = (iso: string) => addDays(iso, -((new Date(`${iso}T12:00:00Z`).getUTCDay() + 6) % 7))

// A refusal Brayden (and the rep's email) can read. Stripe's raw text is logged.
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

export function availableUsd(balance: any) {
  return (balance?.available || []).filter((b: any) => b.currency === 'usd').reduce((s: number, b: any) => s + (Number(b.amount) || 0), 0)
}

export async function runPayday(store: Store, stripe: Stripe, env: Env, now = new Date()) {
  const here = chicago(now)
  const payDate = mondayOf(here.date)
  if (here.weekday === 'Mon' && here.hour < PAY_HOUR) return { skipped: 'before_pay_time', pay_date: payDate }
  const prior = await store.run(payDate)
  if (prior?.status === 'done') return { skipped: 'already_done', pay_date: payDate }

  const periodStart = addDays(payDate, -7)
  const run = await store.startRun(payDate, periodStart)
  const end = async (status: string, patch: RunPatch = {}) => {
    await store.finishRun(run.id, { status, finished_at: new Date().toISOString(), ...patch })
    return { run: run.id, pay_date: payDate, status, ...patch }
  }

  const s = await store.settings()
  if (!s.payouts_live) return end('off', { note: 'Payouts are off. Nothing moved.' })
  if (s.payouts_paused) return end('paused', { note: 'Payouts are paused. Nothing moved.' })
  if (!env.configured) {
    await store.notifyAdmins('Monday pay didn\'t run: Stripe isn\'t connected.', { pay_date: payDate })
    return end('error', { note: 'Stripe isn\'t connected.' })
  }

  // Who gets what. A payout left sending by a crashed run keeps its amount.
  const plan: { rep: Rep; account: PayoutAccount | null; ready: boolean; amount: number }[] = []
  for (const rep of await store.reps()) {
    const sending = await store.sending(rep.id, periodStart)
    const amount = sending ? sending.amount_cents : (await store.payable(rep.id, periodStart)).amount_cents
    if (!(amount > 0)) continue
    const account = await store.account(rep.id)
    plan.push({ rep, account, ready: !!rep.stripe_account_id && canPay(account), amount })
  }
  if (!plan.length) return end('done', { note: 'Nothing to pay this week.' })

  // All or nobody: the whole run has to fit in the Stripe balance.
  const needed = plan.filter(p => p.ready).reduce((t, p) => t + p.amount, 0)
  if (needed > 0) {
    const balance = availableUsd(await stripe('GET', 'balance'))
    if (balance < needed) {
      await store.notifyAdmins(
        `Monday pay didn't go out: Stripe has ${money(balance)} available and the run needs ${money(needed)}. Nobody was paid. It tries again tomorrow at 8 AM.`,
        { pay_date: payDate, needed_cents: needed, balance_cents: balance, link: '/admin/payouts' },
      )
      return end('short_balance', { needed_cents: needed, balance_cents: balance, note: 'Not enough Stripe balance for the whole run. Nobody was paid.' })
    }
  }

  const t = { reps: plan.length, paid_reps: 0, held_reps: 0, failed_reps: 0, cancels: 0, paid_cents: 0, held_cents: 0, failed_cents: 0 }
  const failures: string[] = []
  for (const p of plan) {
    const { rep } = p
    if (!p.ready) {
      const reason = !rep.stripe_account_id || !p.account ? 'You haven\'t added where your pay should go yet.' : 'Stripe needs something from you before it can pay you.'
      const row = await store.claim(rep.id, periodStart, run.id, true, reason)
      if (!row) continue
      t.held_reps++; t.held_cents += row.amount_cents
      await emailIfOn(store, rep.payout_email_problem, rep, to => problemEmail(to, row, reason, env.appUrl))
      continue
    }
    const row = await store.claim(rep.id, periodStart, run.id)
    if (!row) continue
    const dest = destinationLabel(p.account)
    try {
      const transfer = await stripe('POST', 'transfers', {
        amount: row.amount_cents,
        currency: 'usd',
        destination: rep.stripe_account_id,
        transfer_group: `fulfillment_${rep.id}_${periodStart}`,
        description: `Ohvara pay · ${weekLabel(row.period_start, row.period_end)} · ${row.cancels} cancels`,
        metadata: { ohvara: 'fulfillment_payout', payout_id: row.id, rep_id: rep.id, period_start: periodStart, cancels: String(row.cancels), run_id: run.id },
      }, { idempotencyKey: `fulfillment-payout-${row.id}-${row.amount_cents}` })
      await store.finish(row.id, true, transfer.id, dest, null)
      t.paid_reps++; t.paid_cents += row.amount_cents; t.cancels += row.cancels
      await emailIfOn(store, rep.payout_email_sent, rep, to => sentEmail(to, row, dest, env.appUrl))
    } catch (e) {
      console.error('pay run transfer failed:', e instanceof StripeError ? `${e.status} ${e.code || e.type}: ${e.message}` : (e as Error).message)
      const reason = failureText(e)
      await store.finish(row.id, false, null, null, reason)
      t.failed_reps++; t.failed_cents += row.amount_cents
      failures.push(`${rep.full_name || 'A rep'} (${money(row.amount_cents)})`)
      await store.notifyRep(rep.id, `Your pay of ${money(row.amount_cents)} didn't go out. ${reason} It tries again next Monday.`, { payout_id: row.id, link: '/fulfillment/pay' })
      await emailIfOn(store, rep.payout_email_problem, rep, to => problemEmail(to, row, reason, env.appUrl))
    }
  }

  if (failures.length) {
    await store.notifyAdmins(`Monday pay: ${failures.length} transfer${failures.length === 1 ? '' : 's'} failed: ${failures.join(', ')}. They retry next Monday.`, { pay_date: payDate, link: '/admin/payouts' })
  }
  return end('done', { ...t, needed_cents: needed })
}

export async function handle(req: Request, store: Store, stripe: Stripe, env: Env, now?: Date): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  const secret = req.headers.get('x-ohvara-cron')
  if (!secret || !(await store.cronOk(secret))) {
    return json({ error: 'Payouts run by themselves every Monday at 8 AM Central. There is nothing to approve.', code: 'automatic' }, 403)
  }
  try {
    return json(await runPayday(store, stripe, env, now))
  } catch (e) {
    console.error('pay run failed:', (e as Error).message)
    return json({ error: 'The pay run failed. It tries again at the next run.' }, 500)
  }
}
