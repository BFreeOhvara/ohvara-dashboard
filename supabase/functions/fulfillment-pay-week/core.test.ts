/**
 * Node unit tests for the automatic Monday pay run (Prompt 764), with a mocked
 * Stripe client and an in-memory store that follows the database's rules
 * (fulfillment_payable / fulfillment_claim_payout / fulfillment_finish_payout,
 * migration 145). No real Stripe calls, no money moves.
 * Run: node --test supabase/functions/fulfillment-pay-week/core.test.ts
 * (The Connect tests moved to fulfillment-connect-session/core.test.ts.)
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runPayday, handle, chicago, mondayOf, type Store, type Payout, type Rep, type Run } from './core.ts'
import { StripeError, type Stripe, type PayoutAccount, type Email } from '../_shared/fulfillmentPayouts.ts'

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
// Monday Oct 19 2026, 8:05 AM Central (CDT, UTC-5).
const MON_805 = new Date('2026-10-19T13:05:00Z')
const LAST_WEEK = '2026-10-12'
const ENV = { configured: true, appUrl: 'https://portal.ohvara.com' }

const ready = (rep: string): PayoutAccount => ({
  rep_id: rep, stripe_account_id: `acct_${rep[0]}`, details_submitted: true, payouts_enabled: true, transfers_active: true,
  requirements_due: [], disabled_reason: null, external_kind: 'bank', bank_name: 'Chase', last4: '4821',
})

type C = { id: string; rep: string; status: string; amount: number; logged: string; week: string; payout: string | null; paid: boolean }

function world(over: { live?: boolean; paused?: boolean; balance?: number; accounts?: Record<string, PayoutAccount | null>; failFor?: string; minCents?: number | null; reps?: Rep[] } = {}) {
  const reps: Rep[] = over.reps ?? [
    { id: A, full_name: 'Ana', email: 'ana@x.co', stripe_account_id: 'acct_a', payout_email_sent: true, payout_email_problem: true },
    { id: B, full_name: 'Ben', email: 'ben@x.co', stripe_account_id: 'acct_b', payout_email_sent: true, payout_email_problem: true },
  ]
  const accounts: Record<string, PayoutAccount | null> = over.accounts ?? { [A]: ready(A), [B]: ready(B) }
  const cancels: C[] = []
  const payouts: (Payout & { run_id?: string; failure_reason?: string | null; paid_to?: string | null })[] = []
  const runs: (Run & Record<string, any>)[] = []
  const transfers: any[] = []
  const admin: string[] = []
  const repNotes: [string, string][] = []
  const emails: Email[] = []
  const settings = { payouts_live: over.live ?? true, payouts_paused: over.paused ?? false }
  const state = { balance: over.balance ?? 1_000_000 }
  let n = 0
  const add = (rep: string, status: string, logged = '2026-10-14T15:00:00Z', week = LAST_WEEK, amount = 1000) =>
    cancels.push({ id: `c${++n}`, rep, status, amount, logged, week, payout: null, paid: false })

  const locked = (c: C) => c.paid || payouts.some(p => p.id === c.payout && ['approved', 'paid'].includes(p.status))
  const payable = (rep: string, period: string) => {
    const cut = new Date(`${period}T05:00:00Z`).getTime() + 7 * 864e5
    const list = cancels.filter(c => c.rep === rep && ['verified', 'verified_by_admin'].includes(c.status) && !c.paid && new Date(c.logged).getTime() < cut && !locked(c))
    const sum = list.reduce((t, c) => t + c.amount, 0)
    const wk = list.filter(c => c.week === period).length
    const topup = over.minCents != null && wk > 0 && sum < over.minCents ? over.minCents - sum : 0
    return { ids: list.map(c => c.id), cancels: list.length, amount_cents: sum + topup, topup }
  }

  const store: Store = {
    async cronOk(s) { return s === 'cron-secret' },
    async settings() { return settings },
    async run(d) { return runs.find(r => r.pay_date === d) ?? null },
    async startRun(d) {
      const had = runs.find(r => r.pay_date === d)
      if (had) { had.status = 'running'; had.attempts++; return had }
      const r = { id: `run${runs.length + 1}`, pay_date: d, status: 'running', attempts: 1 }
      runs.push(r)
      return r
    },
    async finishRun(id, patch) { Object.assign(runs.find(r => r.id === id)!, patch) },
    async reps() { return reps },
    async payable(rep, period) { return payable(rep, period) },
    async sending(rep, period) { return payouts.find(p => p.rep_id === rep && p.period_start === period && p.status === 'approved') ?? null },
    async account(rep) { return accounts[rep] ?? null },
    async claim(rep, period, run, hold = false, reason) {
      let cur = payouts.find(p => p.rep_id === rep && p.period_start === period)
      if (cur?.status === 'paid') return null
      if (cur?.status === 'approved') return cur
      const f = payable(rep, period)
      if (f.amount_cents <= 0) return null
      if (!cur) {
        cur = { id: `po${payouts.length + 1}`, rep_id: rep, period_start: period, period_end: '2026-10-18', amount_cents: 0, cancels: 0, topup_cents: 0, status: 'upcoming', stripe_transfer_id: null }
        payouts.push(cur)
      }
      Object.assign(cur, { amount_cents: f.amount_cents, cancels: f.cancels, topup_cents: f.topup, status: hold ? 'held' : 'approved', run_id: run, failure_reason: hold ? reason : null })
      if (!hold) for (const c of cancels) if (f.ids.includes(c.id) && !c.payout) c.payout = cur.id
      return cur
    },
    async finish(id, ok, tr, to, reason) {
      const p = payouts.find(x => x.id === id)!
      if (ok) { Object.assign(p, { status: 'paid', stripe_transfer_id: tr, paid_to: to }); for (const c of cancels) if (c.payout === id) c.paid = true }
      else { Object.assign(p, { status: 'failed', failure_reason: reason }); for (const c of cancels) if (c.payout === id) c.payout = null }
    },
    async notifyAdmins(m) { admin.push(m) },
    async notifyRep(rep, m) { repNotes.push([rep, m]) },
    async sendEmail(e) { emails.push(e) },
  }
  const seenKeys = new Map<string, any>()
  const stripe: Stripe = async (method, path, params, opts) => {
    if (path === 'balance') return { available: [{ currency: 'usd', amount: state.balance }] }
    if (path === 'transfers') {
      const k = opts?.idempotencyKey!
      if (seenKeys.has(k)) return seenKeys.get(k)
      if (over.failFor && params?.destination === over.failFor) throw new StripeError({ code: 'account_invalid', message: 'nope' }, 400, 'x')
      const t = { id: `tr_${transfers.length + 1}`, ...params }
      transfers.push({ ...params, key: k })
      seenKeys.set(k, t)
      return t
    }
    throw new Error(`unexpected ${method} ${path}`)
  }
  return { store, stripe, cancels, payouts, runs, transfers, admin, repNotes, emails, settings, state, add, accounts }
}

test('time: Chicago date, the Monday, and no pay before 8 AM Monday', async () => {
  assert.deepEqual(chicago(MON_805), { date: '2026-10-19', weekday: 'Mon', hour: 8 })
  assert.equal(mondayOf('2026-10-21'), '2026-10-19')
  const w = world()
  w.add(A, 'verified')
  const early = await runPayday(w.store, w.stripe, ENV, new Date('2026-10-19T12:30:00Z')) as any // 7:30 AM CDT
  assert.equal(early.skipped, 'before_pay_time')
  assert.equal(w.runs.length, 0)
})

test('normal run: each rep gets the sum of their verified cancels; checking / needs a listen roll over', async () => {
  const w = world()
  w.add(A, 'verified'); w.add(A, 'verified_by_admin'); w.add(A, 'checking'); w.add(A, 'needs_listen'); w.add(A, 'not_paid'); w.add(A, 'void')
  w.add(B, 'verified')
  w.add(A, 'verified', '2026-10-19T13:00:00Z', '2026-10-19') // logged this week: waits for next Monday
  const r = await runPayday(w.store, w.stripe, ENV, MON_805) as any
  assert.equal(r.status, 'done')
  assert.deepEqual(w.transfers.map(t => [t.destination, t.amount]).sort(), [['acct_a', 2000], ['acct_b', 1000]])
  assert.equal(w.runs[0].paid_cents, 3000)
  assert.equal(w.runs[0].cancels, 3)
  assert.equal(w.cancels.filter(c => c.paid).length, 3)
  assert.equal(w.emails.filter(e => /on its way/.test(e.subject)).length, 2)
  // Each transfer's key is per payout row + amount.
  assert.ok(w.transfers.every(t => /^fulfillment-payout-po\d+-\d+$/.test(t.key)))
})

test('payouts_live off: nothing moves; paused: nothing moves; both retry the next day', async () => {
  const off = world({ live: false })
  off.add(A, 'verified')
  assert.equal((await runPayday(off.store, off.stripe, ENV, MON_805) as any).status, 'off')
  assert.equal(off.transfers.length, 0)
  assert.equal(off.payouts.length, 0)
  const paused = world({ paused: true })
  paused.add(A, 'verified')
  assert.equal((await runPayday(paused.store, paused.stripe, ENV, MON_805) as any).status, 'paused')
  assert.equal(paused.transfers.length, 0)
  // Unpaused Tuesday: the same pay date runs and pays.
  paused.settings.payouts_paused = false
  const tue = await runPayday(paused.store, paused.stripe, ENV, new Date('2026-10-20T13:05:00Z')) as any
  assert.equal(tue.status, 'done')
  assert.equal(tue.pay_date, '2026-10-19')
  assert.equal(paused.transfers.length, 1)
  assert.equal(paused.runs[0].attempts, 2)
})

test('short balance: nobody is paid, Brayden is told, it retries the next day', async () => {
  const w = world({ balance: 1500 })
  w.add(A, 'verified'); w.add(B, 'verified')
  const r = await runPayday(w.store, w.stripe, ENV, MON_805) as any
  assert.equal(r.status, 'short_balance')
  assert.equal(w.transfers.length, 0)
  assert.equal(w.payouts.length, 0)
  assert.equal(w.cancels.filter(c => c.payout).length, 0)
  assert.match(w.admin[0], /\$15\.00 available.*\$20\.00/)
  // Topped up by Tuesday: the same pay date runs and pays both.
  w.state.balance = 5000
  const tue = await runPayday(w.store, w.stripe, ENV, new Date('2026-10-20T13:05:00Z')) as any
  assert.equal(tue.status, 'done')
  assert.equal(w.transfers.length, 2)
})

test('no bank: held (nothing reserved), then paid in the first run after the rep connects', async () => {
  const w = world({ accounts: { [A]: ready(A), [B]: null } })
  w.add(A, 'verified'); w.add(B, 'verified')
  await runPayday(w.store, w.stripe, ENV, MON_805)
  assert.deepEqual(w.transfers.map(t => t.destination), ['acct_a'])
  const held = w.payouts.find(p => p.rep_id === B)!
  assert.equal(held.status, 'held')
  assert.equal(w.cancels.find(c => c.rep === B)!.payout, null)
  assert.match(w.emails.find(e => e.to === 'ben@x.co')!.subject, /problem/)
  // Ben connects; next Monday's run pays last week's cancel too.
  w.accounts[B] = ready(B)
  await runPayday(w.store, w.stripe, ENV, new Date('2026-10-26T13:05:00Z'))
  assert.deepEqual(w.transfers.map(t => [t.destination, t.amount]), [['acct_a', 1000], ['acct_b', 1000]])
  assert.ok(w.cancels.every(c => c.paid))
})

test('a failed transfer: payout failed, cancels freed, Brayden and the rep told, paid next run', async () => {
  const w = world({ failFor: 'acct_b' })
  w.add(A, 'verified'); w.add(B, 'verified')
  const r = await runPayday(w.store, w.stripe, ENV, MON_805) as any
  assert.equal(r.status, 'done')
  assert.equal(w.runs[0].failed_reps, 1)
  assert.equal(w.payouts.find(p => p.rep_id === B)!.status, 'failed')
  assert.equal(w.cancels.find(c => c.rep === B)!.payout, null)
  assert.match(w.admin[0], /1 transfer failed: Ben/)
  assert.equal(w.repNotes[0][0], B)
  assert.ok(w.emails.some(e => e.to === 'ben@x.co' && /problem/.test(e.subject)))
  // Fixed by next Monday: paid then.
  const ok = world()
  Object.assign(w.stripe, {})
  const next = await runPayday(w.store, ok.stripe, ENV, new Date('2026-10-26T13:05:00Z')) as any
  assert.equal(next.status, 'done')
  assert.ok(w.cancels.every(c => c.paid))
})

test('running twice: the second call is a no-op, nobody is paid twice', async () => {
  const w = world()
  w.add(A, 'verified')
  await runPayday(w.store, w.stripe, ENV, MON_805)
  const again = await runPayday(w.store, w.stripe, ENV, new Date('2026-10-19T14:05:00Z')) as any
  assert.equal(again.skipped, 'already_done')
  assert.equal(w.transfers.length, 1)
  // Even a run that crashed after claiming resumes with the same key (Stripe returns the same transfer).
  const c = world()
  c.add(A, 'verified')
  const row = await c.store.claim(A, LAST_WEEK, 'run0')
  assert.equal(row!.status, 'approved')
  await runPayday(c.store, c.stripe, ENV, MON_805)
  await c.stripe('POST', 'transfers', { amount: row!.amount_cents, destination: 'acct_a' }, { idempotencyKey: `fulfillment-payout-${row!.id}-${row!.amount_cents}` })
  assert.equal(c.transfers.length, 1)
})

test('weekly minimum: topped up when the rep has a verified cancel that week', async () => {
  const w = world({ minCents: 5000 })
  w.add(A, 'verified')
  w.add(B, 'checking')
  await runPayday(w.store, w.stripe, ENV, MON_805)
  assert.deepEqual(w.transfers.map(t => [t.destination, t.amount]), [['acct_a', 5000]])
  assert.equal(w.payouts[0].topup_cents, 4000)
})

test('handle: only pg_cron\'s secret runs it; a person gets "automatic"', async () => {
  const w = world()
  const asAdmin = await handle(new Request('http://x', { method: 'POST', headers: { Authorization: 'Bearer admin' }, body: '{"rep_id":"x"}' }), w.store, w.stripe, ENV, MON_805)
  assert.equal(asAdmin.status, 403)
  assert.equal((await asAdmin.json()).code, 'automatic')
  const wrong = await handle(new Request('http://x', { method: 'POST', headers: { 'x-ohvara-cron': 'guess' } }), w.store, w.stripe, ENV, MON_805)
  assert.equal(wrong.status, 403)
  const ok = await handle(new Request('http://x', { method: 'POST', headers: { 'x-ohvara-cron': 'cron-secret' } }), w.store, w.stripe, ENV, MON_805)
  assert.equal(ok.status, 200)
  assert.equal((await ok.json()).status, 'done')
})
