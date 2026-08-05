// Shared date+slot booking helpers — Cancellation Calendar and the
// Fulfillment intake's Callback time (Prompt 421) both book against a fixed
// set of hourly slots rather than a freeform time, since neither has a real
// shared calendar behind it yet (each surfaces that same limitation via its
// own GapNote).
export const SLOTS = ['9:00 AM', '10:00 AM', '11:00 AM', '12:00 PM', '1:00 PM', '2:00 PM', '3:00 PM', '4:00 PM']

export function slotToISO(dateStr, slot) {
  const [time, meridiem] = slot.split(' ')
  const [h, m] = time.split(':').map(Number)
  const hour = meridiem === 'PM' && h !== 12 ? h + 12 : meridiem === 'AM' && h === 12 ? 0 : h
  const [y, mo, d] = dateStr.split('-').map(Number)
  return new Date(y, mo - 1, d, hour, m).toISOString()
}
