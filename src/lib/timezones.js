// Lightweight, dependency-free timezone helpers for appointment scheduling
// (Prompt 33). All appointment times are stored in UTC (timestamptz); these
// helpers convert between UTC and a wall-clock time in a specific IANA zone
// — either the lead's inferred client timezone (for booking input) or a
// viewing user's profiles.timezone (for display).

export const DEFAULT_TIMEZONE = 'America/Chicago'

// US state (2-letter abbreviation) → IANA timezone. A handful of states
// split across zones (FL panhandle, IN, KY, TN, ND/SD, etc.) — this picks
// the zone covering the majority of the state's population, per the "a
// simple state→timezone lookup is fine" spec note, not a county-level map.
const STATE_TIMEZONES = {
  AL: 'America/Chicago', AK: 'America/Anchorage', AZ: 'America/Phoenix', AR: 'America/Chicago',
  CA: 'America/Los_Angeles', CO: 'America/Denver', CT: 'America/New_York', DE: 'America/New_York',
  FL: 'America/New_York', GA: 'America/New_York', HI: 'Pacific/Honolulu', ID: 'America/Boise',
  IL: 'America/Chicago', IN: 'America/Indiana/Indianapolis', IA: 'America/Chicago', KS: 'America/Chicago',
  KY: 'America/New_York', LA: 'America/Chicago', ME: 'America/New_York', MD: 'America/New_York',
  MA: 'America/New_York', MI: 'America/Detroit', MN: 'America/Chicago', MS: 'America/Chicago',
  MO: 'America/Chicago', MT: 'America/Denver', NE: 'America/Chicago', NV: 'America/Los_Angeles',
  NH: 'America/New_York', NJ: 'America/New_York', NM: 'America/Denver', NY: 'America/New_York',
  NC: 'America/New_York', ND: 'America/Chicago', OH: 'America/New_York', OK: 'America/Chicago',
  OR: 'America/Los_Angeles', PA: 'America/New_York', RI: 'America/New_York', SC: 'America/New_York',
  SD: 'America/Chicago', TN: 'America/Chicago', TX: 'America/Chicago', UT: 'America/Denver',
  VT: 'America/New_York', VA: 'America/New_York', WA: 'America/Los_Angeles', WV: 'America/New_York',
  WI: 'America/Chicago', WY: 'America/Denver', DC: 'America/New_York',
}

const TZ_SHORT_LABELS = {
  'America/New_York': 'Eastern', 'America/Chicago': 'Central', 'America/Denver': 'Mountain',
  'America/Phoenix': 'Mountain (AZ)', 'America/Los_Angeles': 'Pacific',
  'America/Anchorage': 'Alaska', 'Pacific/Honolulu': 'Hawaii',
  'America/Boise': 'Mountain', 'America/Detroit': 'Eastern', 'America/Indiana/Indianapolis': 'Eastern',
}

// Compact 2-3 letter form for tight table cells (Prompt 224 — CloserPipeline's
// fixed-width "Scheduled" column has no room for "Eastern"/"Mountain (AZ)").
const TZ_ABBR = {
  'America/New_York': 'ET', 'America/Chicago': 'CT', 'America/Denver': 'MT',
  'America/Phoenix': 'MT', 'America/Los_Angeles': 'PT',
  'America/Anchorage': 'AKT', 'Pacific/Honolulu': 'HT',
  'America/Boise': 'MT', 'America/Detroit': 'ET', 'America/Indiana/Indianapolis': 'ET',
}

export function timezoneAbbr(tz) {
  return TZ_ABBR[tz] || tz || 'CT'
}

export function inferTimezoneFromState(state) {
  if (!state) return DEFAULT_TIMEZONE
  return STATE_TIMEZONES[state.trim().toUpperCase()] || DEFAULT_TIMEZONE
}

export function timezoneLabel(tz) {
  return TZ_SHORT_LABELS[tz] || tz || DEFAULT_TIMEZONE
}

// Common IANA timezones for an admin "set this user's timezone" dropdown.
export const SELECTABLE_TIMEZONES = [
  { value: 'America/New_York', label: 'Eastern' },
  { value: 'America/Chicago', label: 'Central' },
  { value: 'America/Denver', label: 'Mountain' },
  { value: 'America/Phoenix', label: 'Mountain (AZ, no DST)' },
  { value: 'America/Los_Angeles', label: 'Pacific' },
  { value: 'America/Anchorage', label: 'Alaska' },
  { value: 'Pacific/Honolulu', label: 'Hawaii' },
]

// The UTC offset (minutes) of `timeZone` at the instant `date` represents.
function getTimezoneOffsetMinutes(timeZone, date) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
  const parts = dtf.formatToParts(date).reduce((acc, p) => { acc[p.type] = p.value; return acc }, {})
  const asUTC = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second)
  return (asUTC - date.getTime()) / 60000
}

// Interprets a "YYYY-MM-DDTHH:mm" wall-clock string (the value of an
// <input type="datetime-local">) AS IF it were local time in `timeZone`,
// and returns the equivalent UTC ISO string. Lets a rep type the time the
// client said without converting it themselves.
export function zonedTimeToUtcIso(dateTimeLocalStr, timeZone) {
  if (!dateTimeLocalStr) return null
  const [datePart, timePart] = dateTimeLocalStr.split('T')
  const [year, month, day] = datePart.split('-').map(Number)
  const [hour, minute] = (timePart || '00:00').split(':').map(Number)

  // Two-pass correction: guess the offset, re-measure it at the guessed
  // instant, correct. Converges in one pass outside the literal hour of a
  // DST transition; the second pass catches that edge case too.
  let guess = Date.UTC(year, month - 1, day, hour, minute)
  for (let i = 0; i < 2; i++) {
    const offset = getTimezoneOffsetMinutes(timeZone, new Date(guess))
    guess = Date.UTC(year, month - 1, day, hour, minute) - offset * 60000
  }
  return new Date(guess).toISOString()
}

// Formats a UTC ISO timestamp in `timeZone` for display.
export function formatInTimezone(iso, timeZone, opts = {}) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d)) return '—'
  return d.toLocaleString('en-US', { timeZone: timeZone || DEFAULT_TIMEZONE, ...opts })
}

// Inverse of zonedTimeToUtcIso: given a stored UTC ISO timestamp, returns
// the "YYYY-MM-DDTHH:mm" wall-clock string for that instant in `timeZone`
// — for pre-filling a <input type="datetime-local"> when re-editing an
// already-booked appointment, so the edit field shows/accepts the same
// timezone it was originally entered in.
export function utcIsoToZonedDatetimeLocal(iso, timeZone) {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d)) return ''
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: timeZone || DEFAULT_TIMEZONE, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  })
  const parts = dtf.formatToParts(d).reduce((acc, p) => { acc[p.type] = p.value; return acc }, {})
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`
}

// The calendar day (YYYY-MM-DD) that `nowMs` falls on from the perspective of
// `timeZone` — the rep's own local day, not the UTC day. en-CA locale formats
// dates as YYYY-MM-DD natively, so no manual part-assembly needed (Prompt 244
// — every calendar's "today"/future-day logic switches from UTC calendar day
// to this, sourced from the same profiles.timezone LiveClock/the per-rep
// batch reset already use).
export function zonedDateStr(nowMs, timeZone) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timeZone || DEFAULT_TIMEZONE }).format(new Date(nowMs))
}

// True if `nowMs` falls on a Saturday or Sunday from the perspective of
// `timeZone` (Prompt 324 — weekend lead-pause). Mirrors the isodow check
// assign_daily_batches() runs server-side against the rep's own local
// calendar day, so the frontend's "is it the weekend" read never disagrees
// with the cron's.
export function isWeekendInTimezone(nowMs, timeZone) {
  const day = new Intl.DateTimeFormat('en-US', { timeZone: timeZone || DEFAULT_TIMEZONE, weekday: 'short' }).format(new Date(nowMs))
  return day === 'Sat' || day === 'Sun'
}

// The UTC epoch ms of the next local midnight in `timeZone`, as of `nowMs`
// (Prompt 226 — the batch-reset countdown now tracks each rep's own
// timezone instead of a single hardcoded UTC instant, matching the
// per-rep-aware assign_daily_batches() cron).
export function nextLocalMidnightUtcMs(timeZone, nowMs) {
  const tz = timeZone || DEFAULT_TIMEZONE
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  })
  const parts = dtf.formatToParts(new Date(nowMs)).reduce((acc, p) => { acc[p.type] = p.value; return acc }, {})
  const tomorrow = new Date(Date.UTC(+parts.year, +parts.month - 1, +parts.day + 1))
  const y = tomorrow.getUTCFullYear()
  const m = String(tomorrow.getUTCMonth() + 1).padStart(2, '0')
  const d = String(tomorrow.getUTCDate()).padStart(2, '0')
  return new Date(zonedTimeToUtcIso(`${y}-${m}-${d}T00:00`, tz)).getTime()
}
