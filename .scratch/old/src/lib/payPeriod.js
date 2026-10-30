import { startOfWeek } from './agentBookings'

// Getting Paid (Prompt 681) — pay period + hours math, one place so the rep's
// panel and the admin table can't disagree.
//
// Pay period: weekly, Monday 00:00 to the next Monday 00:00, in the viewer's
// local time (same week boundary the agent side already uses). Nothing in the
// database depends on this; switching to biweekly is a change here only.

export const WEEKDAYS = [
  { value: 1, short: 'Mon' }, { value: 2, short: 'Tue' }, { value: 3, short: 'Wed' },
  { value: 4, short: 'Thu' }, { value: 5, short: 'Fri' }, { value: 6, short: 'Sat' }, { value: 7, short: 'Sun' },
]

export function payPeriod(now = Date.now()) {
  const start = startOfWeek(new Date(now))
  const end = new Date(start)
  end.setDate(end.getDate() + 7)
  return { start, end }
}

export function fmtPeriod({ start, end }) {
  const last = new Date(end.getTime() - 1)
  const o = { month: 'short', day: 'numeric' }
  return `${start.toLocaleDateString('en-US', o)} – ${last.toLocaleDateString('en-US', o)}`
}

// Prompt 685 — hours are automatic: a rep is assumed to work their scheduled
// shift (days + start/end in fulfillment_pay), no punching in. One entry per
// scheduled day in the period, in the viewer's local time. `hours` is what has
// elapsed so far (today's shift accrues as the day goes); `full` is the whole
// shift. A past period is entirely elapsed, so hours === full.
export function shiftSegments(pay, period, now = Date.now()) {
  if (!pay?.shift_start || !pay?.shift_end || !pay.shift_days?.length) return []
  const [sh, sm] = pay.shift_start.split(':').map(Number)
  const [eh, em] = pay.shift_end.split(':').map(Number)
  const out = []
  for (let i = 0; i < 7; i++) {
    const y = period.start.getFullYear(), m = period.start.getMonth(), d = period.start.getDate() + i
    const day = new Date(y, m, d)
    if (day >= period.end) break
    if (!pay.shift_days.includes(day.getDay() === 0 ? 7 : day.getDay())) continue
    const start = new Date(y, m, d, sh, sm)
    const end = new Date(y, m, d, eh, em)
    out.push({
      start, end,
      full: (end - start) / 3600e3,
      hours: Math.max(0, Math.min(end.getTime(), now) - start.getTime()) / 3600e3,
    })
  }
  return out
}

export function workedHours(pay, period, now = Date.now()) {
  return shiftSegments(pay, period, now).reduce((s, g) => s + g.hours, 0)
}

export function fmtHours(h) {
  if (h == null) return '—'
  const mins = Math.round(h * 60)
  return `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, '0')}m`
}

export function fmtCents(cents) {
  if (cents == null) return '—'
  return (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

export function estimateCents(hours, rateCents) {
  if (rateCents == null) return null
  return Math.round(hours * rateCents)
}

// "09:00:00" -> "9:00 AM"
export function fmtTime(t) {
  if (!t) return ''
  const [h, m] = t.split(':').map(Number)
  const d = new Date(2000, 0, 1, h, m)
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

// "Mon–Fri · 9:00 AM – 5:00 PM", or null when no shift is set.
export function fmtShift(pay) {
  if (!pay?.shift_start) return null
  const days = [...(pay.shift_days || [])].sort((a, b) => a - b)
  const contiguous = days.length > 2 && days.every((d, i) => i === 0 || d === days[i - 1] + 1)
  const name = d => WEEKDAYS[d - 1].short
  const dayLabel = !days.length ? 'No days'
    : days.length === 7 ? 'Every day'
      : contiguous ? `${name(days[0])}–${name(days[days.length - 1])}`
        : days.map(name).join(', ')
  return `${dayLabel} · ${fmtTime(pay.shift_start)} – ${fmtTime(pay.shift_end)}`
}

// Scheduled hours in one pay period, for "worked vs scheduled".
export function scheduledHours(pay) {
  if (!pay?.shift_start) return null
  const [sh, sm] = pay.shift_start.split(':').map(Number)
  const [eh, em] = pay.shift_end.split(':').map(Number)
  return ((eh * 60 + em) - (sh * 60 + sm)) / 60 * (pay.shift_days?.length || 0)
}
