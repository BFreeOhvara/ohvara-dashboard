import { timezoneAbbr, zonedDateStr, DEFAULT_TIMEZONE } from '../../../lib/timezones'
import { daysBetween, inLabel, timeText } from '../../../lib/fulfillmentDay'
import { agentStageOf, isLive, isMissedHold, recoveryLabel, placeOf } from '../../../lib/agentBookings'

// Prompt 772 — small helpers shared by the agent's phone screens.

const ZONE_WORD = { ET: 'Eastern', CT: 'Central', MT: 'Mountain', PT: 'Pacific', AKT: 'Alaska', HT: 'Hawaii' }
export const zoneWord = tz => ZONE_WORD[timezoneAbbr(tz)] || ''

export const initials = name => (name || '?').split(/\s+/).filter(Boolean).map(w => w[0]).join('').slice(0, 2).toUpperCase() || '?'

const noonOf = day => new Date(`${day}T12:00:00Z`)
const fmtDay = (day, opts) => noonOf(day).toLocaleDateString('en-US', { ...opts, timeZone: 'UTC' })

// A call's day as a tile: "TODAY" / "MON" over the date number, in `tz`.
export function dayTile(iso, nowMs, tz) {
  const zone = tz || DEFAULT_TIMEZONE
  const day = zonedDateStr(new Date(iso).getTime(), zone)
  const n = daysBetween(zonedDateStr(nowMs, zone), day)
  return { dow: n === 0 ? 'TODAY' : fmtDay(day, { weekday: 'short' }).toUpperCase(), d: fmtDay(day, { day: 'numeric' }), n, day }
}

// "Today, 2:00 PM" / "Tomorrow, 10:00 AM" / "Mon, Oct 19, 1:30 PM".
export function dayTime(iso, nowMs, tz) {
  const { n, day } = dayTile(iso, nowMs, tz)
  const word = n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : fmtDay(day, { weekday: 'short', month: 'short', day: 'numeric' })
  return `${word}, ${timeText(iso, tz || DEFAULT_TIMEZONE)}`
}

// "in 1 hr 20 min" today, "in 3 days" later on, "Oct 19" past a week or
// on an earlier day (P777: was "earlier today" for any past day).
export function untilText(iso, nowMs, tz) {
  const ms = new Date(iso).getTime()
  const { n, day } = dayTile(iso, nowMs, tz)
  if (n < 0) return fmtDay(day, { month: 'short', day: 'numeric' })
  if (n === 0) return ms > nowMs ? inLabel(ms, nowMs) : 'earlier today'
  if (n === 1) return 'tomorrow'
  if (n < 7) return `in ${n} days`
  return fmtDay(day, { month: 'short', day: 'numeric' })
}

const monthDay = iso => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
const cap = s => (s ? s[0].toUpperCase() + s.slice(1) : s)

// One client row's sub line: carrier · City, ST.
export const clientSub = p => [p.current_carrier || p.carrier_name, placeOf(p)].filter(Boolean).join(' · ') || 'Carrier not noted'

// The right side of a client row: [top, under, colour].
export function clientEnd(p, nowMs, { first } = {}) {
  const stage = agentStageOf(p)
  const tz = p.client_timezone || undefined
  const tries = p.call_attempts || 0
  if (stage === 'confirmNumber') return ['Confirm number', 'No answer', 'var(--ov-st-needs)']
  if (stage === 'needsAttention') return ['Call them', 'Couldn’t reach', 'var(--nt-purple)']
  if (stage === 'cancelled') return ['Cancelled', p.fulfillment_completed_at ? monthDay(p.fulfillment_completed_at) : '', 'var(--ov-st-cancelled)']
  if (stage === 'noAnswer') return [cap(recoveryLabel(p, nowMs)) || 'No answer', tries ? `${tries} ${tries === 1 ? 'try' : 'tries'}` : '', 'var(--ov-st-noanswer)']
  if (isLive(p)) return ['On a call', 'right now', 'var(--ov-live)']
  if (isMissedHold(p)) return ['Rebooking', 'Missed by us', 'var(--ov-st-needs)']
  if (!p.scheduled_call_at) return ['Booked', '', 'var(--ov-st-booked)']
  const { n, day } = dayTile(p.scheduled_call_at, nowMs, tz)
  const word = n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : fmtDay(day, { weekday: 'short' })
  const under = n <= 0 ? untilText(p.scheduled_call_at, nowMs, tz) : fmtDay(day, { month: 'short', day: 'numeric' })
  return [`${word} ${timeText(p.scheduled_call_at, tz || DEFAULT_TIMEZONE)}`, under, first ? 'var(--ph-next-time)' : 'var(--ov-hi)']
}

// The sheet's status pill: the tab and a short phrase.
export function statusPhrase(p, nowMs) {
  const stage = agentStageOf(p)
  if (stage === 'confirmNumber') return 'Needs you · confirm number'
  if (stage === 'needsAttention') return 'Needs you · call and rebook'
  if (stage === 'cancelled') return 'Cancelled'
  if (stage === 'noAnswer') return `No answer · ${recoveryLabel(p, nowMs) || 'Fulfillment will try again'}`
  if (isLive(p)) return 'Booked · on a call now'
  if (isMissedHold(p)) return 'Missed by us · rebooking'
  return 'Booked · waiting for Fulfillment'
}

