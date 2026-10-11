import { zonedDateStr, zonedTimeToUtcIso, DEFAULT_TIMEZONE } from './timezones'
import { addDaysStr } from './scheduling'
import { isLive, stageOf } from './agentBookings'
import { fullName } from './policyFormat'

// Prompt 745 — the Fulfillment Overview's day and week maths. Everything is
// read in the signed-in profile's zone (profiles.timezone), never the
// browser's, so a rep whose laptop is on another coast still sees their own
// Monday-to-Sunday week and their own "today".

const zoneOf = tz => tz || DEFAULT_TIMEZONE

// 0 = Monday … 6 = Sunday, for a YYYY-MM-DD date (zone-free).
const dowOf = dateStr => {
  const [y, m, d] = dateStr.split('-').map(Number)
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7
}

const dayStartMs = (dateStr, zone) => new Date(zonedTimeToUtcIso(`${dateStr}T00:00`, zone)).getTime()

// A Date at noon, browser-local, on a zone calendar day: formats to the same
// weekday and date in any browser zone (used for the chart's axis labels).
export const noonOf = dateStr => {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d, 12)
}

// Last Monday to this Sunday as 14 zone days. `bounds` holds the 15 instants
// that start each day (and end the last), so a DST change never skews a bin.
export function weekFrame(todayStr, tz) {
  const zone = zoneOf(tz)
  const todayIdx = dowOf(todayStr)
  const lastMonday = addDaysStr(todayStr, -todayIdx - 7)
  const dates = Array.from({ length: 14 }, (_, i) => addDaysStr(lastMonday, i))
  const bounds = [...dates.map(d => dayStartMs(d, zone)), dayStartMs(addDaysStr(lastMonday, 14), zone)]
  return { zone, todayStr, todayIdx, dates, bounds, sinceMs: bounds[0] }
}

// ISO timestamps → 14 per-day counts (index 0 = last Monday, 7 = this Monday).
export function binByDay(frame, isos) {
  const out = new Array(14).fill(0)
  for (const iso of isos) {
    const t = new Date(iso).getTime()
    if (!(t >= frame.bounds[0] && t < frame.bounds[14])) continue
    let i = 0
    while (i < 13 && t >= frame.bounds[i + 1]) i++
    out[i]++
  }
  return out
}

const sum = (a, from, to) => a.slice(from, to).reduce((s, n) => s + n, 0)

// The two trend cards and the chart, from per-day counts of calls started and
// of old policies confirmed cancelled.
export function weekStats(frame, callIsos, cancelIsos) {
  const calls = binByDay(frame, callIsos)
  const cancels = binByDay(frame, cancelIsos)
  const part = a => ({ value: sum(a, 7, 14), diff: sum(a, 7, 14) - sum(a, 0, 7), week: a.slice(7, 14) })
  return {
    calls: part(calls),
    cancelled: part(cancels),
    lastWeek: frame.dates.slice(0, 7).map((d, i) => ({ date: noonOf(d), booked: calls[i], cancelled: cancels[i] })),
  }
}

// "3:30" + "PM" for the time tiles; "3:30 PM" for sentences.
export function timeParts(iso, tz) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: zoneOf(tz), hour: 'numeric', minute: '2-digit', hour12: true }).formatToParts(new Date(iso))
  const get = type => parts.find(p => p.type === type)?.value || ''
  return { time: `${get('hour')}:${get('minute')}`, period: get('dayPeriod').toUpperCase() }
}
export const timeText = (iso, tz) => {
  const { time, period } = timeParts(iso, tz)
  return `${time} ${period}`
}

// "in 25 min" / "in 1 hr 12 min" / "in 2 hr".
export function inLabel(ms, nowMs) {
  const mins = Math.max(1, Math.round((ms - nowMs) / 6e4))
  if (mins < 60) return `in ${mins} min`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m ? `in ${h} hr ${m} min` : `in ${h} hr`
}

// Today on the rep's calendar. A call can appear twice on purpose: a No answer
// at 11:45 is a call done today, and its retry at 5:30 is a call still to go.
//   done   what already happened today: cancelled, no answer, or live right now
//   later  Booked calls today (a passed, never-called time stays on the list)
//          and No answer retries still ahead
// `team` (admin) adds the rep's name to each sub-line.
export function buildDay(rows, nowMs, tz, { team = false } = {}) {
  const zone = zoneOf(tz)
  const today = zonedDateStr(nowMs, zone)
  const onToday = iso => !!iso && zonedDateStr(new Date(iso).getTime(), zone) === today
  const done = []
  const later = []

  for (const p of rows) {
    const live = isLive(p)
    const complete = p.fulfillment_stage === 'Complete'
    const name = fullName(p)
    const rep = team ? `${p.assigned?.full_name || 'Unassigned'} · ` : ''
    const agent = p.agent?.full_name
    const row = e => ({ id: p.id, name, ...e })

    if (live && onToday(p.call_live_since)) {
      done.push(row({ at: p.call_live_since, ms: new Date(p.call_live_since).getTime(), result: 'On the call', tone: 'live' }))
    } else if (complete && onToday(p.fulfillment_completed_at)) {
      done.push(row({ at: p.fulfillment_completed_at, ms: new Date(p.fulfillment_completed_at).getTime(), result: 'Cancelled', tone: 'cancelled' }))
    } else if (!live && !complete && p.last_call_outcome === 'no_answer' && onToday(p.last_call_at)) {
      done.push(row({ at: p.last_call_at, ms: new Date(p.last_call_at).getTime(), result: 'No answer', tone: 'noAnswer' }))
    }

    if (live || complete || !onToday(p.scheduled_call_at)) continue
    const ms = new Date(p.scheduled_call_at).getTime()
    const st = stageOf(p)
    if (st === 'booked') {
      later.push(row({
        at: p.scheduled_call_at, ms, tone: 'booked',
        sub: `${rep}Booked${agent ? ` · from ${agent}` : ''}`,
        subNext: `${rep}From ${agent || 'an agent'} · ${p.current_carrier || 'Carrier not noted'}`,
      }))
    } else if (st === 'noAnswer' && ms > nowMs) {
      const attempts = (p.call_attempts || 0) + 1
      const last = p.last_call_at ? `No answer at ${timeText(p.last_call_at, zone)} · try ${attempts}` : `No answer · try ${attempts}`
      later.push(row({
        at: p.scheduled_call_at, ms, tone: 'noAnswer',
        sub: `${rep}${last}`,
        subNext: `${rep}${last} · ${p.current_carrier || 'Carrier not noted'}`,
      }))
    }
  }

  done.sort((a, b) => a.ms - b.ms)
  later.sort((a, b) => a.ms - b.ms)
  const next = later.find(e => e.ms > nowMs) || null
  const rest = later.filter(e => e !== next)

  return {
    today, done, left: later.length, total: done.length + later.length,
    next, rest: rest.slice(0, 4), more: Math.max(0, rest.length - 4), first: next || later[0] || null,
  }
}
