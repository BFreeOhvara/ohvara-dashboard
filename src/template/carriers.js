import { carrierDaySlots } from '../lib/scheduling.js'
import { timezoneAbbr } from '../lib/timezones.js'
import { hoursSummary } from '../lib/carriers.js'
import { CARRIER_CATALOG, bookingCarrierFor } from '../lib/carriers/catalog.js'

// P847 — the carriers for both shells' carrier dropdowns. P868: every US life carrier, from lib/carriers/catalog
// (hours per weekday in the carrier's own zone, read on its own site). The booking step runs the real slot rule on
// them (carrierDaySlots: open only while the carrier takes calls, the last start an hour before it closes, 8 AM to
// 8 PM on the client's clock). A carrier whose hours aren't verified, or one typed that isn't listed, books inside the
// median of every verified carrier's hours. P848 swaps in the live table.
export const SAMPLE_CARRIERS = CARRIER_CATALOG
export const CARRIER_NAMES = CARRIER_CATALOG.map(c => c.name)
export const carrierByName = name => bookingCarrierFor(name)

// The sample week: Thu Nov 5 2026 is "today" in both shells.
export const BOOK_DAYS = [['Thu', 5], ['Fri', 6], ['Mon', 9], ['Tue', 10], ['Wed', 11]]
export const isoOf = day => `2026-11-${String(day).padStart(2, '0')}`

// Bookable call times on a day on the clock of the client's zone `tz` (P854: the zone, not just the state, so split
// states and a picked zone come out right) leaving `carrier` (none picked yet: then 8 AM to 6 PM on the client's
// clock stands in; the VA shift is checked on top, lib/callSlots).
const SHIFT_SLOTS = ['8:00 AM', '8:30 AM', '9:00 AM', '9:30 AM', '10:00 AM', '10:30 AM', '11:00 AM', '11:30 AM', '12:00 PM', '12:30 PM', '1:00 PM', '1:30 PM', '2:00 PM', '2:30 PM', '3:00 PM', '3:30 PM', '4:00 PM', '4:30 PM', '5:00 PM']
export function sampleSlots(day, tz, carrierName) {
  if (!tz) return []
  const c = carrierByName(carrierName)
  if (!c) return SHIFT_SLOTS
  return carrierDaySlots(isoOf(day), tz, c)
}
export const hoursLine = carrierName => {
  const c = carrierByName(carrierName)
  if (!c) return 'Pick the carrier they are leaving to see its open hours.'
  const when = hoursSummary(c.hours, c.hours_tz).replace(/ [A-Z]+$/, ` ${timezoneAbbr(c.hours_tz)}`)
  return c.hours_status === 'median'
    ? `We don't have ${c.name}'s hours yet, so times stay inside usual carrier hours: ${when}. The last start is an hour before they close.`
    : `${c.name} takes calls ${when}. The last start is an hour before they close.`
}
