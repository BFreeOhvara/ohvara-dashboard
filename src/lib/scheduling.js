import { zonedTimeToUtcIso, zonedDateStr } from './timezones'

// Shared date+slot booking helpers. The agent's Book a call flow (Prompt 665)
// books against a fixed set of slots rather than a freeform time, since
// there's no real shared calendar behind it yet (the page surfaces that same
// limitation via its own GapNote).
//
// Prompt 665 — 30-minute slots (was hourly). Same 9:00 AM–4:00 PM window.
export const SLOTS = [
  '9:00 AM', '9:30 AM', '10:00 AM', '10:30 AM', '11:00 AM', '11:30 AM',
  '12:00 PM', '12:30 PM', '1:00 PM', '1:30 PM', '2:00 PM', '2:30 PM',
  '3:00 PM', '3:30 PM', '4:00 PM',
]

export function slotToISO(dateStr, slot) {
  const [time, meridiem] = slot.split(' ')
  const [h, m] = time.split(':').map(Number)
  const hour = meridiem === 'PM' && h !== 12 ? h + 12 : meridiem === 'AM' && h === 12 ? 0 : h
  const [y, mo, d] = dateStr.split('-').map(Number)
  return new Date(y, mo - 1, d, hour, m).toISOString()
}

// Local YYYY-MM-DD for a Date (or now), offset by `addDays`.
export function localDateISO(addDays = 0, from = new Date()) {
  const d = new Date(from)
  d.setDate(d.getDate() + addDays)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Prompt 724 — every formatter takes an optional IANA `tz` (the client's
// zone, policies.client_timezone). Without one it's the viewer's own zone,
// exactly as before.
const inZone = tz => (tz ? { timeZone: tz } : {})

export function fmtSlotTime(iso, tz) {
  return new Date(iso).toLocaleString('en-US', { hour: 'numeric', minute: '2-digit', ...inZone(tz) })
}

// Prompt 717 — "Fri, Oct 2 · 6:07 PM", My Pipeline's call time.
export function callWhen(iso, tz) {
  if (!iso) return 'No time booked'
  const d = new Date(iso)
  return `${d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', ...inZone(tz) })} · ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', ...inZone(tz) })}`
}

// Prompt 718 — "Fri, Oct 9 at 11:00 AM", Activity's sentences.
export function callAt(iso, tz) {
  if (!iso) return 'no time booked'
  const d = new Date(iso)
  return `${d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', ...inZone(tz) })} at ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', ...inZone(tz) })}`
}

export function fmtBooking(iso, tz) {
  if (!iso) return 'No time booked'
  return new Date(iso).toLocaleString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', ...inZone(tz),
  })
}

// ── Prompt 724 — slots in the client's zone, 30 minutes' notice, one per slot ──

export const NOTICE_MS = 30 * 60e3

// "2:00 PM" → "14:00".
export function slotTo24h(slot) {
  const [time, meridiem] = slot.split(' ')
  const [h, m] = time.split(':').map(Number)
  const hour = meridiem === 'PM' && h !== 12 ? h + 12 : meridiem === 'AM' && h === 12 ? 0 : h
  return `${String(hour).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

// The UTC instant of `slot` on `dateStr` as wall-clock time in `tz`. No tz =
// the browser's zone (slotToISO), for rows booked before P724.
export function clientSlotISO(dateStr, slot, tz) {
  return tz ? zonedTimeToUtcIso(`${dateStr}T${slotTo24h(slot)}`, tz) : slotToISO(dateStr, slot)
}

// YYYY-MM-DD plus `n` calendar days (pure date maths, no zone involved).
export function addDaysStr(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d + n))
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`
}

// The calendar day `ms` falls on in `tz` (YYYY-MM-DD); no tz = the browser's.
export function dayIn(ms, tz) {
  return tz ? zonedDateStr(ms, tz) : localDateISO(0, new Date(ms))
}

// "Wednesday, Oct 7" / "Wed, Oct 7" for a YYYY-MM-DD date, zone-free.
export function dateLabel(dateStr, weekday = 'short') {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString('en-US', { weekday, month: 'short', day: 'numeric', timeZone: 'UTC' })
}

// One slot's state for the pickers. `openIsoSet` holds the instants
// (toISOString) of the agent's other open bookings. UI-only rules: the
// database doesn't enforce either (Brayden may relax them).
export function slotState(iso, { now = Date.now(), openIsoSet } = {}) {
  const t = new Date(iso).getTime()
  if (t <= now) return 'past'
  if (t <= now + NOTICE_MS) return 'soon'
  if (openIsoSet?.has(new Date(iso).toISOString())) return 'booked'
  return 'open'
}

// The instants an agent already has an open booking at: not cancelled, call
// still ahead. `exceptId` leaves out the booking being moved.
export function openBookingIsos(rows, { now = Date.now(), exceptId, stageOf } = {}) {
  const set = new Set()
  for (const p of rows || []) {
    if (!p.scheduled_call_at || p.id === exceptId) continue
    if (stageOf && stageOf(p) === 'cancelled') continue
    if (new Date(p.scheduled_call_at).getTime() <= now) continue
    set.add(new Date(p.scheduled_call_at).toISOString())
  }
  return set
}

// No slot left on `dateStr` that can still be booked (past or inside the notice window).
export function dayGone(dateStr, tz, now = Date.now()) {
  return slotState(clientSlotISO(dateStr, SLOTS[SLOTS.length - 1], tz), { now }) !== 'open'
}
