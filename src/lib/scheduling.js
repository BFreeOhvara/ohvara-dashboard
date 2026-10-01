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

// Brayden's own framing: bookings should default to today or tomorrow — "if
// we're booked out, then we're booked out" is the exception, not the norm.
// Far out here means the day after tomorrow or later.
export function isFarOut(iso) {
  if (!iso) return false
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() + 2)
  cutoff.setHours(0, 0, 0, 0)
  return new Date(iso) >= cutoff
}

export function fmtSlotTime(iso) {
  return new Date(iso).toLocaleString('en-US', { hour: 'numeric', minute: '2-digit' })
}

export function fmtBooking(iso) {
  if (!iso) return 'No time booked'
  return new Date(iso).toLocaleString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  })
}
