// P941 — the sign-up details an agent fills in BEFORE paying for a lead plan: 3 to 10 licensed states (no New York)
// with the licence tick, their time zone, the hours they take calls, and live transfers yes/no (with the phone they
// ring). Pure rules + the two calls (migration 264: my_signup_details / save_signup_details). No React, so
// node --test reads it. The server checks every rule again; lead-spend won't charge a lead plan while one is missing.

import { US_STATES } from './usStates.js'
import { WEEKDAYS, weekFromRows, rowsFromWeek, validateWeek, normalizePhone, timeLabel } from './agentSettings.js'
import { SELECTABLE_TIMEZONES } from './timezones.js'

export const MIN_STATES = 3
export const MAX_STATES = 10
export const NOT_TAKING = ['NY']
export const LICENSED_WORDS = 'I’m licensed for life insurance in every state I picked'
export const STATE_CHOICES = US_STATES

// Mon to Fri, 9 to 5: what the hours start as.
export const DEFAULT_WEEK = weekFromRows([1, 2, 3, 4, 5].map(weekday => ({ weekday, start: '09:00', end: '17:00' })))

const ZONES = new Set(SELECTABLE_TIMEZONES.map(z => z.value))
export function deviceZone() {
  try { const z = Intl.DateTimeFormat().resolvedOptions().timeZone; return ZONES.has(z) ? z : '' } catch { return '' }
}

export const emptyDetails = (tz = deviceZone()) => ({ states: [], licensed: false, timezone: tz, week: DEFAULT_WEEK, live: null, phone: '' })

// my_signup_details() -> the form's shape. An empty save (nothing filled yet) keeps the defaults.
export function fromSaved(d, fallback = emptyDetails()) {
  if (!d) return fallback
  const rows = Array.isArray(d.workingHours) ? d.workingHours : []
  const any = (d.states || []).length || rows.length || d.timezone
  return {
    states: [...(d.states || [])].sort(),
    licensed: !!d.licensed,
    timezone: d.timezone || fallback.timezone,
    week: rows.length ? weekFromRows(rows) : fallback.week,
    live: any ? !!d.liveTransfers : null,
    phone: d.phone || '',
  }
}

// Pick or unpick a state. Picking changes what the tick covered, so the tick clears.
export function toggleState(d, code, notTaking = NOT_TAKING) {
  if (notTaking.includes(code)) return d
  const on = d.states.includes(code)
  if (!on && d.states.length >= MAX_STATES) return d
  const states = on ? d.states.filter(s => s !== code) : [...d.states, code].sort()
  return { ...d, states, licensed: false }
}

// What's still missing, in the words the form shows (empty = ready to pay).
export function detailsMissing(d, notTaking = NOT_TAKING) {
  const out = []
  const n = d.states.length
  if (n < MIN_STATES) out.push({ key: 'states', text: `Pick ${MIN_STATES - n} more ${MIN_STATES - n === 1 ? 'state' : 'states'} (3 to 10)` })
  else if (n > MAX_STATES) out.push({ key: 'states', text: `Pick at most ${MAX_STATES} states` })
  if (d.states.some(s => notTaking.includes(s))) out.push({ key: 'states', text: 'We aren’t taking New York yet' })
  if (!d.licensed) out.push({ key: 'licence', text: 'Tick the box: licensed in every state you picked' })
  if (!d.timezone) out.push({ key: 'timezone', text: 'Pick your time zone' })
  if (!d.week.some(x => x.open)) out.push({ key: 'hours', text: 'Turn on at least one day of hours' })
  else { const bad = validateWeek(d.week); if (bad) out.push({ key: 'hours', text: bad }) }
  if (d.live === null) out.push({ key: 'live', text: 'Say if you take live transfers' })
  else if (d.live && !normalizePhone(d.phone).value) out.push({ key: 'phone', text: 'Add the phone live transfers ring' })
  return out
}

// The form -> save_signup_details' payload.
export function toPayload(d) {
  return {
    states: d.states, licensed: !!d.licensed, timezone: d.timezone, working_hours: rowsFromWeek(d.week),
    live_transfers: !!d.live, live_transfer_phone: d.live ? normalizePhone(d.phone).value : null,
  }
}

// ── Words shared by the ticket and the agent's setup progress ───────────────
export const zoneWord = tz => SELECTABLE_TIMEZONES.find(z => z.value === tz)?.label || tz || ''

// Rows [{ weekday, start, end }] -> "Mon–Fri 9:00 AM to 5:00 PM · Sat 10:00 AM to 2:00 PM". Days in a row with the
// same times are joined.
export function hoursText(rows = []) {
  const days = [...rows].filter(r => r && r.weekday).sort((a, b) => a.weekday - b.weekday)
  const runs = []
  for (const r of days) {
    const last = runs[runs.length - 1]
    if (last && last.to + 1 === r.weekday && last.start === r.start && last.end === r.end) last.to = r.weekday
    else runs.push({ from: r.weekday, to: r.weekday, start: r.start, end: r.end })
  }
  const short = n => WEEKDAYS.find(w => w.weekday === n)?.short || ''
  return runs.map(x => `${short(x.from)}${x.to > x.from ? `–${short(x.to)}` : ''} ${timeLabel(x.start)} to ${timeLabel(x.end)}`).join(' · ')
}
export const weekText = week => hoursText(rowsFromWeek(week))

// ── The two calls ───────────────────────────────────────────────────────────
export async function loadSignupDetails(db) {
  const { data, error } = await db.rpc('my_signup_details')
  if (error) throw error
  return data
}
export async function saveSignupDetails(db, d) {
  const { data, error } = await db.rpc('save_signup_details', { p: toPayload(d) })
  if (error) throw Object.assign(new Error(error.message || 'Couldn’t save your details'), { code: error.hint || error.code })
  return data
}
