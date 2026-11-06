import { carrierDaySlots } from '../lib/scheduling'
import { timezoneAbbr } from '../lib/timezones'

// P847 — sample carriers for both shells' carrier dropdowns, in the real `carriers` row shape (lib/carriers.js:
// hours per weekday in the carrier's own zone). The booking step runs the real slot rule on them (carrierDaySlots:
// open only while the carrier takes calls, the last start an hour before it closes, 8 AM to 8 PM on the client's
// clock), so the sample behaves like the live Book a call. P848 swaps in useCarriers().
const H = (open, close) => ({ open, close })
const WEEK = (h, sat = null) => ({ mon: h, tue: h, wed: h, thu: h, fri: h, sat, sun: null })
export const SAMPLE_CARRIERS = [
  { id: 'cr-globe', name: 'Globe Life', hours: WEEK(H('08:00', '19:00'), H('09:00', '13:00')), hours_tz: 'America/Chicago' },
  { id: 'cr-colonial', name: 'Colonial Penn', hours: WEEK(H('08:30', '20:00')), hours_tz: 'America/New_York' },
  { id: 'cr-aarp', name: 'AARP / New York Life', hours: WEEK(H('08:00', '18:00')), hours_tz: 'America/New_York' },
  { id: 'cr-gerber', name: 'Gerber Life', hours: WEEK(H('08:00', '18:00')), hours_tz: 'America/New_York' },
  { id: 'cr-lincoln', name: 'Lincoln Heritage', hours: WEEK(H('07:00', '17:00')), hours_tz: 'America/Phoenix' },
  { id: 'cr-mutual', name: 'Mutual of Omaha', hours: WEEK(H('07:00', '18:00')), hours_tz: 'America/Chicago' },
  { id: 'cr-americo', name: 'Americo', hours: WEEK(H('08:00', '17:00')), hours_tz: 'America/Chicago' },
  { id: 'cr-foresters', name: 'Foresters', hours: WEEK(H('08:00', '20:00')), hours_tz: 'America/New_York' },
  { id: 'cr-transamerica', name: 'Transamerica', hours: WEEK(H('08:00', '19:00')), hours_tz: 'America/Chicago' },
  { id: 'cr-aetna', name: 'Aetna (CVS Health)', hours: WEEK(H('08:00', '18:00')), hours_tz: 'America/New_York' },
  { id: 'cr-cica', name: 'CICA Life', hours: WEEK(H('08:00', '17:00')), hours_tz: 'America/Chicago' },
  { id: 'cr-fidelity', name: 'Fidelity & Guaranty', hours: WEEK(H('08:00', '18:00')), hours_tz: 'America/Chicago' },
  { id: 'cr-liberty', name: 'Liberty Bankers', hours: WEEK(H('08:00', '17:00')), hours_tz: 'America/Chicago' },
  { id: 'cr-royal', name: 'Royal Neighbors', hours: WEEK(H('08:00', '16:30')), hours_tz: 'America/Chicago' },
  { id: 'cr-sbli', name: 'SBLI', hours: WEEK(H('08:30', '17:00')), hours_tz: 'America/New_York' },
  { id: 'cr-prosperity', name: 'Prosperity Life', hours: WEEK(H('08:30', '17:00')), hours_tz: 'America/New_York' },
]
export const CARRIER_NAMES = SAMPLE_CARRIERS.map(c => c.name)
export const carrierByName = name => SAMPLE_CARRIERS.find(c => c.name.toLowerCase() === String(name || '').trim().toLowerCase()) || null

// The sample week: Thu Nov 5 2026 is "today" in both shells.
export const BOOK_DAYS = [['Thu', 5], ['Fri', 6], ['Mon', 9], ['Tue', 10], ['Wed', 11]]
export const isoOf = day => `2026-11-${String(day).padStart(2, '0')}`

// Bookable call times on a day on the clock of the client's zone `tz` (P854: the zone, not just the state, so split
// states and a picked zone come out right) leaving `carrier` (null when the carrier isn't known yet: then 8 AM to
// 6 PM on the client's clock stands in, like the live fallback hours; the VA shift is checked on top, lib/callSlots).
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
  const h = c.hours.mon
  const fmt = t => { const [hh, mm] = t.split(':').map(Number); return `${hh % 12 || 12}:${String(mm).padStart(2, '0')} ${hh < 12 ? 'AM' : 'PM'}` }
  return `${c.name} takes calls ${fmt(h.open)} to ${fmt(h.close)} ${timezoneAbbr(c.hours_tz)} weekdays${c.hours.sat ? ', Saturday mornings' : ''}. The last start is an hour before they close.`
}
