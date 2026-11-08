import { addDaysStr } from './scheduling'
import { zonedDateStr } from './timezones'

// Prompt 765 — the numbers behind Admin Payouts. Pure, so the page and the QA
// harness agree. P890: VAs are paid by the hour from clock in and out, so
// there is no per-cancel pay picture here any more: just the pay mode, the next
// pay day and the past runs.

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

export const clock = sec => {
  const s = Math.max(0, Math.round(sec || 0))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

// raw: { now, settings, runs }
export function payoutsModel({ now, settings, runs = [] }) {
  const live = !!settings?.payouts_live
  const paused = !!settings?.payouts_paused
  const mode = !live ? 'off' : paused ? 'paused' : 'auto'
  const paid = runs.filter(r => r.paid_cents > 0)
  const past = paid.map(r => ({ id: r.id, day: monDay(r.pay_date), sub: weekSpan(r.period_start), cents: r.paid_cents }))
  const oldest = paid.map(r => r.period_start).sort()[0]

  return {
    mode,
    nextPayDate: nextPayDate(now),
    past,
    paidTotal: runs.reduce((s, r) => s + (r.paid_cents || 0), 0),
    paidSince: oldest || null,
    listen: [], // P890: nothing is held for a listen any more (kept for the phone Home's old Listen sheet)
  }
}
