import { isLive, stageOf } from './agentBookings'
import { DAYS, toMin } from './carriers'
import { zonedDateStr, zonedTimeToUtcIso, timezoneAbbr } from './timezones'
import { timeText } from './fulfillmentDay'

// Prompt 748 — the call helpers My calls' focus card and its call drawer share.

export const firstName = name => (name || '').trim().split(/\s+/)[0] || ''
export const initialsOf = name => (name || '').trim().split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('') || '?'
export const telHref = phone => `tel:${phone.replace(/[^\d+]/g, '')}`

// The agent verified their number and left it on: the client sees it.
export const agentCallerIdOn = p => !!(p.agent?.caller_id_verified_at && p.agent?.caller_id_enabled)

// The tone a call shows in: live / cancelled / noAnswer / late / booked.
export function callTone(p, now) {
  if (isLive(p)) return 'live'
  const stage = stageOf(p)
  if (stage === 'cancelled') return 'cancelled'
  if (stage === 'noAnswer') return 'noAnswer'
  return p.scheduled_call_at && new Date(p.scheduled_call_at).getTime() <= now ? 'late' : 'booked'
}

// "Open until 7:00 PM your time" from the carrier's saved hours (Prompt 728),
// only when they were found (not the 9-5 stand-in).
export function carrierOpenText(carrier, nowMs, tz) {
  if (!carrier?.hours || !carrier.hours_tz || !['verified', 'ai'].includes(carrier.hours_status)) return null
  const date = zonedDateStr(nowMs, carrier.hours_tz)
  const [y, m, d] = date.split('-').map(Number)
  const key = DAYS[(new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7]
  const h = carrier.hours[key]
  if (!h) return 'Closed today'
  const at = hhmm => new Date(zonedTimeToUtcIso(`${date}T${hhmm}`, carrier.hours_tz)).getTime()
  const open = at(h.open)
  const close = at(h.close)
  if (!(toMin(h.close) > toMin(h.open))) return null
  if (nowMs < open) return `Opens at ${timeText(open, tz)} your time`
  if (nowMs < close) return `Open until ${timeText(close, tz)} your time`
  return 'Closed for today'
}

// "2:30 PM for the client (MT)" when the client's zone reads differently.
export function clientTimeText(p, at, tz) {
  if (!at || !p.client_timezone) return null
  const theirs = timeText(at, p.client_timezone)
  return theirs !== timeText(at, tz) ? `${theirs} for the client (${timezoneAbbr(p.client_timezone)})` : null
}

// "Rings your phone first, shows {agent}'s number" / a direct dial.
export function callHint(p, canBridge) {
  if (!p.client_phone) return 'No client phone on file. Message the agent for one.'
  return canBridge
    ? ['Rings your phone first,', `shows ${p.agent?.full_name || 'the agent'}'s number`]
    : ['Dials from your phone,', 'shows your own number']
}
