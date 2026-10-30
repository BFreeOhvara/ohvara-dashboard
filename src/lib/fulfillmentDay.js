import { zonedDateStr, zonedTimeToUtcIso, DEFAULT_TIMEZONE } from './timezones'
import { addDaysStr } from './scheduling'
import { isLive, stageOf } from './agentBookings'
import { fullName } from './policyFormat'
import { needsCancellation } from './fulfillmentFlags'

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

// Prompt 757 — "booked" per frame day (14 counts, index 0 = last Monday): every
// call on the calendar that day, done or still to come (buildCalls entries, so
// it is the same number My calls shows). The one definition of "booked".
export function bookedByDay(frame, calls) {
  const out = new Array(14).fill(0)
  for (const c of calls) {
    const i = frame.dates.indexOf(c.date)
    if (i >= 0) out[i]++
  }
  return out
}

// The two trend cards and the chart, from per-day counts of calls booked
// (bookedByDay) and of old policies confirmed cancelled.
export function weekStats(frame, bookedCalls, cancelIsos) {
  const calls = bookedByDay(frame, bookedCalls)
  const cancels = binByDay(frame, cancelIsos)
  const part = a => ({ value: sum(a, 7, 14), diff: sum(a, 7, 14) - sum(a, 0, 7), week: a.slice(7, 14) })
  return {
    calls: part(calls),
    cancelled: part(cancels),
    lastWeek: frame.dates.slice(0, 7).map((d, i) => ({ date: noonOf(d), booked: calls[i], cancelled: cancels[i] })),
  }
}

// Prompt 758 — the admin Overview's week, from one buildCalls list (last Monday
// to this Sunday, with that range's policy_events) so the cards and the chart
// agree with My calls: booked = every call on the calendar, cancelled = calls
// that ended Cancelled, rate = cancelled / calls that ended (cancelled or no
// answer; null before any ended).
export function adminWeek(frame, calls) {
  const part = a => ({ value: sum(a, 7, 14), diff: sum(a, 7, 14) - sum(a, 0, 7), week: a.slice(7, 14) })
  const booked = bookedByDay(frame, calls)
  const cancelled = bookedByDay(frame, calls.filter(c => c.done && c.tone === 'cancelled'))
  const ended = bookedByDay(frame, calls.filter(c => c.done && c.tone !== 'live'))
  const endedTotal = sum(ended, 7, 14)
  return {
    booked: part(booked),
    cancelled: part(cancelled),
    rate: endedTotal ? Math.round((sum(cancelled, 7, 14) / endedTotal) * 100) : null,
    days: frame.dates.slice(7, 14).map((d, i) => ({ date: noonOf(d), booked: booked[7 + i], cancelled: cancelled[7 + i] })),
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

// Prompt 747 — status → colour, one map for everything that shows a call: the
// calendar's chips and legend, the day drawer's time tiles, pills and bar, and
// the Overview's Your day box. ov-st-* tokens only.
export const CALL_TONE = {
  booked:    { label: 'Booked, still to call', fg: 'var(--ov-st-booked)', tint: 'var(--ov-st-booked-tint)', edge: 'var(--ov-st-booked-edge)' },
  live:      { label: 'On a call', fg: 'var(--ov-live)', tint: 'color-mix(in srgb, var(--ov-live) 14%, transparent)', edge: 'color-mix(in srgb, var(--ov-live) 35%, transparent)' },
  noAnswer:  { label: 'No answer', fg: 'var(--ov-st-noanswer)', tint: 'var(--ov-st-noanswer-tint)', edge: 'var(--ov-st-noanswer-edge)' },
  cancelled: { label: 'Cancelled', fg: 'var(--ov-st-cancelled)', tint: 'var(--ov-st-cancelled-tint)', edge: 'var(--ov-st-cancelled-edge)' },
  late:      { label: 'Time passed', fg: 'var(--ov-warn)', tint: 'var(--ov-warn-tint)', edge: 'color-mix(in srgb, var(--ov-warn) 40%, transparent)' },
}

// Every call on the calendar between two zone days (`from`..`to`, YYYY-MM-DD,
// inclusive), soonest first. One rule set for the Overview's day and the
// Fulfillment calendar's month:
//   done      a live call (call_live_since), a cancellation, a no answer
//   upcoming  a Booked call at scheduled_call_at (a passed, never-called time
//             stays, marked `late`) and a No answer retry still ahead
// Done calls come from each row's last outcome or, when `events` (policy_events
// rows, kinds cancelled / no_answer) are given, from every outcome in the range,
// so a client with no answer at 11:45 and again at 5:30 shows both. A call can
// appear twice on purpose: a No answer at 11:45 is done, its retry at 5:30 is to go.
export function buildCalls(rows, nowMs, tz, { from, to, events = null } = {}) {
  const zone = zoneOf(tz)
  const dayOf = iso => zonedDateStr(new Date(iso).getTime(), zone)
  const inRange = iso => {
    if (!iso) return false
    const d = dayOf(iso)
    return d >= from && d <= to
  }
  const out = []
  const call = (p, at, tone, extra) => ({
    key: `${p.id}:${tone}:${at}`, id: p.id, p, name: fullName(p), at, ms: new Date(at).getTime(), date: dayOf(at), tone, ...extra,
  })

  for (const p of rows) {
    if (!needsCancellation(p)) continue
    const live = isLive(p)
    const complete = p.fulfillment_stage === 'Complete'
    if (live && inRange(p.call_live_since)) out.push(call(p, p.call_live_since, 'live', { done: true }))
    if (!events && !live) {
      if (complete && inRange(p.fulfillment_completed_at)) out.push(call(p, p.fulfillment_completed_at, 'cancelled', { done: true }))
      else if (!complete && p.last_call_outcome === 'no_answer' && inRange(p.last_call_at)) out.push(call(p, p.last_call_at, 'noAnswer', { done: true }))
    }

    if (live || complete || !inRange(p.scheduled_call_at)) continue
    const ms = new Date(p.scheduled_call_at).getTime()
    const st = stageOf(p)
    if (st === 'booked') out.push(call(p, p.scheduled_call_at, 'booked', { late: ms <= nowMs }))
    else if (st === 'noAnswer' && ms > nowMs) out.push(call(p, p.scheduled_call_at, 'noAnswer', { retry: true, attempt: (p.call_attempts || 0) + 1 }))
  }

  if (events) {
    const byId = new Map(rows.map(p => [p.id, p]))
    // Prompt 750 — a corrected result (detail.correction) replaces the outcome
    // it fixed, keeping that call's time; it isn't a second call. An admin's
    // fix of an earlier day's call isn't a call on the day it was made.
    const lastOf = new Map()
    for (const e of events) {
      const p = byId.get(e.policy_id)
      const tone = e.kind === 'cancelled' ? 'cancelled' : (e.kind === 'no_answer' || e.kind === 'rescheduling') ? 'noAnswer' : null
      if (!p || !tone || !inRange(e.at)) continue
      const prev = lastOf.get(e.policy_id)
      if (e.detail?.correction) {
        if (!prev) continue
        const i = out.indexOf(prev)
        const next = call(p, prev.at, tone, { done: true, attempt: prev.attempt, by: prev.by })
        out[i] = next
        lastOf.set(e.policy_id, next)
        continue
      }
      // `by` (Prompt 760): who ended the call, so admin's desk puts it on
      // that person's row even after the client moved to someone else.
      const c = call(p, e.at, tone, { done: true, attempt: e.detail?.attempt || null, by: e.actor_id || null })
      out.push(c)
      lastOf.set(e.policy_id, c)
    }
  }

  return out.sort((a, b) => a.ms - b.ms)
}

const DONE_RESULT = { live: 'On the call', cancelled: 'Cancelled', noAnswer: 'No answer' }

// Today on the rep's calendar (the Overview's Your day), from buildCalls.
//   done   what already happened today: cancelled, no answer, or live right now
//   later  Booked calls today (a passed, never-called time stays on the list)
//          and No answer retries still ahead
// `team` (admin) adds the rep's name to each sub-line.
export function buildDay(rows, nowMs, tz, { team = false } = {}) {
  const zone = zoneOf(tz)
  const today = zonedDateStr(nowMs, zone)
  const done = []
  const later = []

  for (const c of buildCalls(rows, nowMs, zone, { from: today, to: today })) {
    const { p } = c
    const row = e => ({ id: c.id, name: c.name, at: c.at, ms: c.ms, ...e })
    if (c.done) {
      done.push(row({ result: DONE_RESULT[c.tone], tone: c.tone }))
      continue
    }
    const rep = team ? `${p.assigned?.full_name || 'Unassigned'} · ` : ''
    const agent = p.agent?.full_name
    if (c.tone === 'booked') {
      later.push(row({
        tone: 'booked',
        sub: `${rep}Booked${agent ? ` · from ${agent}` : ''}`,
        subNext: `${rep}From ${agent || 'an agent'} · ${p.current_carrier || 'Carrier not noted'}`,
      }))
    } else {
      const last = p.last_call_at ? `No answer at ${timeText(p.last_call_at, zone)} · try ${c.attempt}` : `No answer · try ${c.attempt}`
      later.push(row({
        tone: 'noAnswer',
        sub: `${rep}${last}`,
        subNext: `${rep}${last} · ${p.current_carrier || 'Carrier not noted'}`,
      }))
    }
  }

  const next = later.find(e => e.ms > nowMs) || null
  const rest = later.filter(e => e !== next)

  return {
    today, done, left: later.length, total: done.length + later.length,
    next, rest: rest.slice(0, 4), more: Math.max(0, rest.length - 4), first: next || later[0] || null,
  }
}

// ── Prompt 747 — date labels ─────────────────────────────────────────────

// Zone-free labels for a YYYY-MM or YYYY-MM-DD.
const utcNoon = s => {
  const [y, m, d = 1] = s.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d, 12))
}
const fmt = (s, opts) => utcNoon(s).toLocaleDateString('en-US', { ...opts, timeZone: 'UTC' })
export const dayLong = date => fmt(date, { weekday: 'long', month: 'long', day: 'numeric' })  // Tuesday, October 13
export const dayShort = date => fmt(date, { weekday: 'short', month: 'short', day: 'numeric' }) // Tue, Oct 13

// ── Prompt 748 — My calls, one day at a time ─────────────────────────────

// The instants that start and end one zone day.
export function dayBounds(date, tz) {
  const zone = zoneOf(tz)
  return { startMs: dayStartMs(date, zone), endMs: dayStartMs(addDaysStr(date, 1), zone) }
}

// Whole days from `a` to `b` (YYYY-MM-DD, zone-free).
export const daysBetween = (a, b) => Math.round((utcNoon(b) - utcNoon(a)) / 864e5)

// "tomorrow" / "yesterday" / "in 3 days" / "2 days ago" ('' on today).
export function relDay(date, today) {
  const n = daysBetween(today, date)
  if (n === 0) return ''
  if (n === 1) return 'tomorrow'
  if (n === -1) return 'yesterday'
  return n > 0 ? `in ${n} days` : `${-n} days ago`
}

export const weekdayLong = date => fmt(date, { weekday: 'long' })                              // Sunday
export const todayBadge = date => fmt(date, { weekday: 'short', day: 'numeric' }).replace(/^(\d+)\s+(\w+)$/, '$2 $1') // Sat 10

// "tomorrow" / "Mon" (within a week) / "Tue, Oct 20" for the footer line.
export function dayWord(date, today) {
  const n = daysBetween(today, date)
  if (n === 0) return 'today'
  if (n === 1) return 'tomorrow'
  if (n === -1) return 'yesterday'
  if (n > 1 && n < 7) return fmt(date, { weekday: 'short' })
  return dayShort(date)
}

// The hour of day (9.5 = 9:30) of an instant in the zone.
export function hourOf(iso, tz) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: zoneOf(tz), hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(new Date(iso))
  const get = type => Number(parts.find(p => p.type === type)?.value || 0)
  return (get('hour') % 24) + get('minute') / 60
}

// The zone day a call belongs on: a live call today, a cancellation the day it
// was done, anything else its booked time (a No answer's next try).
export function callDayOf(p, nowMs, tz) {
  const zone = zoneOf(tz)
  const at = isLive(p) ? nowMs
    : p.fulfillment_stage === 'Complete' ? (p.fulfillment_completed_at || p.scheduled_call_at)
      : (p.scheduled_call_at || p.last_call_at)
  return zonedDateStr(at ? new Date(at).getTime() : nowMs, zone)
}

// "Today 3:30 PM" / "Tomorrow 9:00 AM" / "Tue 1:00 PM" / "Oct 20 1:00 PM".
export function whenShort(iso, nowMs, tz) {
  const zone = zoneOf(tz)
  const date = zonedDateStr(new Date(iso).getTime(), zone)
  const n = daysBetween(zonedDateStr(nowMs, zone), date)
  const day = n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : n === -1 ? 'Yesterday'
    : Math.abs(n) < 7 ? fmt(date, { weekday: 'short' }) : fmt(date, { month: 'short', day: 'numeric' })
  return `${day} ${timeText(iso, zone)}`
}

// ── Prompt 756 — the week tiles and the call unlock ─────────────────────

// This Monday to Sunday in the zone: the two dates and the instants around them.
export function thisWeek(nowMs, tz) {
  const zone = zoneOf(tz)
  const today = zonedDateStr(nowMs, zone)
  const from = addDaysStr(today, -dowOf(today))
  const to = addDaysStr(from, 6)
  return { from, to, startMs: dayStartMs(from, zone), endMs: dayStartMs(addDaysStr(from, 7), zone) }
}

// The My calls week tiles, from buildCalls over this week (with that week's
// policy_events). booked = every call on the calendar this week, done or still
// to come; rate = cancelled / finished results (null before anything finished).
export function weekScore(rows, nowMs, tz, events) {
  const { from, to } = thisWeek(nowMs, tz)
  const t = dayTally(buildCalls(rows, nowMs, tz, { from, to, events }))
  return { booked: t.total, cancelled: t.cancelled, finished: t.done, rate: t.done ? t.cancelled / t.done : null }
}

// "Call client" opens this many minutes before the call's time (the same
// instant buildCalls puts the call at: scheduled_call_at, a retry's slot or a
// rescheduled time). Late is fine; a later day never is. No time = always open.
// fulfillment_start_call (migration 140) holds the same line on the server.
export const CALL_UNLOCK_LEAD_MIN = 5

export const callTimeOf = p => p?.scheduled_call_at || null

export function unlockAt(p) {
  const at = callTimeOf(p)
  return at ? new Date(new Date(at).getTime() - CALL_UNLOCK_LEAD_MIN * 6e4).toISOString() : null
}

export function canStartCall(p, nowMs, tz) {
  const at = callTimeOf(p)
  if (!at) return true
  const ms = new Date(at).getTime()
  if (ms <= nowMs) return true
  const zone = zoneOf(tz)
  if (zonedDateStr(ms, zone) > zonedDateStr(nowMs, zone)) return false
  return nowMs >= ms - CALL_UNLOCK_LEAD_MIN * 6e4
}

// The toast for a locked button, or the server's too_early (its opens-at).
export const tooEarlyText = (opensAt, tz) => `It's not time to call yet.${opensAt ? ` Opens at ${timeText(opensAt, tz)}.` : ''}`

// One day's calls counted: done (cancelled + no answer), the live one, and the
// ones still to make (`late` = a booked time that passed without a call).
export function dayTally(calls) {
  const t = { total: calls.length, cancelled: 0, noAnswer: 0, live: 0, toGo: 0, late: 0 }
  for (const c of calls) {
    if (c.tone === 'live') t.live++
    else if (c.done && c.tone === 'cancelled') t.cancelled++
    else if (c.done) t.noAnswer++
    else {
      t.toGo++
      if (c.late) t.late++
    }
  }
  t.done = t.cancelled + t.noAnswer
  return t
}
