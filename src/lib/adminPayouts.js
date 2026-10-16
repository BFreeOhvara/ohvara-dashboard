import { addDaysStr } from './scheduling'
import { zonedDateStr } from './timezones'

// Prompt 765 — the numbers behind Admin Payouts. Pure, so the page and the QA
// harness agree. Nothing here decides what gets paid: the Monday pay run
// (fulfillment-pay-week) does that in the database; this only shows it.

export const PAY_TZ = 'America/Chicago' // the run is Monday 8 AM Central

const utc = s => new Date(`${s}T12:00:00Z`)
export const money = cents => {
  const v = (cents || 0) / 100
  return v.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: Number.isInteger(v) ? 0 : 2, maximumFractionDigits: 2 })
}
const fmt = (s, o) => utc(s).toLocaleDateString('en-US', { ...o, timeZone: 'UTC' })
export const dayLong = s => fmt(s, { month: 'short', day: 'numeric' })               // Oct 19
export const monDay = s => fmt(s, { weekday: 'short', month: 'short', day: 'numeric' }) // Mon, Oct 19
// "Oct 5 – 11", or "Sep 28 – Oct 4" across a month
export function weekSpan(mon) {
  const end = addDaysStr(mon, 6)
  const same = utc(mon).getUTCMonth() === utc(end).getUTCMonth()
  return `${dayLong(mon)} – ${same ? utc(end).getUTCDate() : dayLong(end)}`
}

// The Monday the next run pays: the first Monday after today (Central).
export function nextPayDate(now) {
  const today = zonedDateStr(now, PAY_TZ)
  const dow = (utc(today).getUTCDay() + 6) % 7 // Mon = 0
  return addDaysStr(today, 7 - dow)
}

export const canPay = a => !!a && !!a.payouts_enabled && !!a.transfers_active // same as the server's canPay
export const bankText = a => (a?.last4 ? `${a.bank_name || 'Bank'} •• ${a.last4}` : null)

export function listenReason(reason) {
  if (reason === 'no_recording') return 'No recording found'
  if (reason === 'agent_flag') return 'The agent flagged it'
  if (reason === 'over_cap') return 'Over the weekly cap'
  return 'AI couldn’t tell the carrier confirmed it'
}

export const clock = sec => {
  const s = Math.max(0, Math.round(sec || 0))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

// raw: { now, settings, unpaid, listen, accounts, runs }
export function payoutsModel({ now, settings, unpaid = [], listen = [], accounts = [], runs = [] }) {
  const live = !!settings?.payouts_live
  const paused = !!settings?.payouts_paused
  const acctBy = new Map(accounts.map(a => [a.rep_id, a]))
  const overCap = new Map()
  for (const c of listen) if (c.reason === 'over_cap') overCap.set(c.rep_id, (overCap.get(c.rep_id) || 0) + 1)

  const byRep = new Map()
  for (const c of unpaid) {
    const r = byRep.get(c.rep_id) || { repId: c.rep_id, count: 0, cents: 0 }
    r.count++; r.cents += c.amount_cents
    byRep.set(c.rep_id, r)
  }
  const reps = [...byRep.values()].map(r => {
    const account = acctBy.get(r.repId) || null
    const state = !canPay(account) ? 'nobank' : overCap.has(r.repId) ? 'held' : 'ready'
    return { ...r, account, state, bank: bankText(account), over: overCap.get(r.repId) || 0 }
  }).sort((a, b) => b.cents - a.cents)

  const mode = !live ? 'off' : paused ? 'paused' : 'auto'
  const past = runs.filter(r => r.paid_cents > 0).map(r => ({
    id: r.id, day: monDay(r.pay_date), sub: `${weekSpan(r.period_start)} · ${r.cancels} cancel${r.cancels === 1 ? '' : 's'}`, cents: r.paid_cents,
  }))
  const oldest = runs.filter(r => r.paid_cents > 0).map(r => r.period_start).sort()[0]

  return {
    mode,
    nextRun: { date: nextPayDate(now), cents: reps.reduce((s, r) => s + r.cents, 0), count: reps.reduce((s, r) => s + r.count, 0) },
    reps,
    past,
    paidTotal: runs.reduce((s, r) => s + (r.paid_cents || 0), 0),
    paidSince: oldest || null,
    listen: listen.map(c => ({ ...c, reasonText: listenReason(c.reason) })),
  }
}

// Does the Stripe balance cover Monday? null = couldn't read it.
export const balanceCovers = (balance, needed) => (balance == null ? null : balance >= needed)
