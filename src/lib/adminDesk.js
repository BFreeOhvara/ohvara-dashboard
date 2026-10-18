import { isLive, stageOf } from './agentBookings'
import { SLOT_MS } from './fulfillmentFlags'
import { DEFAULT_TIMEZONE, zonedDateStr, zonedTimeToUtcIso } from './timezones'
import { buildCalls, hourOf } from './fulfillmentDay'

// The desk's rules, shared by Admin Fulfillment (Prompt 760, desktop) and the
// admin phone's Desk and Home (Prompt 774): which calls are on a day, what
// kind each is, whose row it sits on, and who can take a call that's stuck.

export const NOBODY = 'nobody'

// Dot kinds: cancelled, no answer, live, stuck (past its time, never started), still to call.
export const KIND = {
  cx:    { label: 'Cancelled',     seg: 'var(--ov-st-cancelled)' },
  na:    { label: 'No answer',     seg: 'var(--ov-st-noanswer)' },
  live:  { label: 'Live',          seg: 'var(--ov-live)' },
  stuck: { label: 'Stuck',         seg: 'var(--ov-warn)' },
  bk:    { label: 'Still to call', seg: 'color-mix(in srgb, var(--ov-st-booked) 35%, transparent)' },
}
export const KEY_ORDER = ['cx', 'na', 'live', 'stuck', 'bk']
export const canGive = c => c.k === 'stuck' || c.k === 'bk'

export function kindOf(c) {
  if (c.tone === 'live') return 'live'
  if (c.done) return c.tone === 'cancelled' ? 'cx' : 'na'
  return c.late ? 'stuck' : 'bk'
}

// The day's calls for the desk: buildCalls plus No answer retries whose time
// passed without a call (buildCalls only lists retries still ahead), which
// count as stuck like a passed Booked time.
export function deskCalls(rows, nowMs, tz, day, events) {
  const list = buildCalls(rows, nowMs, tz, { from: day, to: day, events })
  for (const p of rows) {
    if (isLive(p) || p.fulfillment_stage === 'Complete' || !p.scheduled_call_at || stageOf(p) !== 'noAnswer') continue
    const ms = new Date(p.scheduled_call_at).getTime()
    if (ms > nowMs || zonedDateStr(ms, tz) !== day) continue
    // P780 — with no retry booked (texting off), the call keeps the time it
    // was just tried at; that's the No answer itself, not a retry nobody made.
    if (p.last_call_at && new Date(p.last_call_at).getTime() >= ms) continue
    list.push({ key: `${p.id}:retry:${p.scheduled_call_at}`, id: p.id, p, at: p.scheduled_call_at, ms, date: day, tone: 'noAnswer', late: true, retry: true, attempt: (p.call_attempts || 0) + 1 })
  }
  return list.sort((a, b) => a.ms - b.ms)
}

// deskCalls with each call's kind, hour and owner: a finished call sits on the
// row of the person who ended it (the event's actor), the rest on the person
// it is assigned to.
export function deskDay(rows, nowMs, tz, day, events, repById) {
  return deskCalls(rows, nowMs, tz, day, events).map(c => {
    const owner = c.done && c.tone !== 'live' && repById.has(c.by) ? c.by : (c.p.assigned_fulfillment_id || NOBODY)
    const r = repById.get(owner)
    return { ...c, k: kindOf(c), h: hourOf(c.at, tz), owner, ownerName: r?.full_name || c.p.assigned?.full_name || 'Nobody yet' }
  })
}

// A rep's shift on `day`, as instants (null when no working hours are set).
export function shiftOf(rep, day) {
  if (!rep?.working_hours_start || !rep?.working_hours_end) return null
  const zone = rep.timezone || DEFAULT_TIMEZONE
  const at = t => new Date(zonedTimeToUtcIso(`${day}T${String(t).slice(0, 5)}`, zone)).getTime()
  return { startMs: at(rep.working_hours_start), endMs: at(rep.working_hours_end) }
}

// Who can take these calls: every active Fulfillment person, with whether
// they are free (no open call within a slot, counting the ones given before
// in the same batch) and on shift at each call's time.
export function giveOptions(calls, reps, rows) {
  return reps.map(r => {
    const taken = []
    const ids = []
    let mine = 0
    let offShift = 0
    for (const c of calls) {
      if (c.p.assigned_fulfillment_id === r.id) { mine++; continue }
      const clash = rows.some(o => o.id !== c.id && o.assigned_fulfillment_id === r.id && o.fulfillment_stage !== 'Complete'
        && o.scheduled_call_at && Math.abs(new Date(o.scheduled_call_at).getTime() - c.ms) < SLOT_MS)
        || taken.some(ms => Math.abs(ms - c.ms) < SLOT_MS)
      if (clash) continue
      const s = shiftOf(r, zonedDateStr(c.ms, r.timezone || DEFAULT_TIMEZONE))
      if (s && (c.ms < s.startMs || c.ms >= s.endMs)) offShift++
      taken.push(c.ms)
      ids.push(c.id)
    }
    return { rep: r, ids, mine, offShift, open: calls.length - mine }
  }).filter(o => o.open > 0)
}

// Prompt 774 — the phone's one-tap "Give both to <name>": the person who can
// take every one of these calls, on shift, and is free soonest (not on a call
// now, then the fewest calls still ahead today). null = nobody can take them
// all, so the phone asks who.
export function bestTaker(calls, reps, rows, nowMs) {
  const opts = giveOptions(calls, reps, rows).filter(o => o.mine === 0 && o.ids.length === calls.length && o.offShift === 0)
  if (!opts.length) return null
  const liveBy = new Set(rows.filter(isLive).map(p => p.assigned_fulfillment_id))
  const ahead = id => rows.filter(p => p.assigned_fulfillment_id === id && p.fulfillment_stage !== 'Complete' && p.scheduled_call_at && new Date(p.scheduled_call_at).getTime() > nowMs).length
  return opts
    .map(o => ({ ...o, live: liveBy.has(o.rep.id), ahead: ahead(o.rep.id) }))
    .sort((a, b) => a.live - b.live || a.ahead - b.ahead || (a.rep.full_name || '').localeCompare(b.rep.full_name || ''))[0]
}
