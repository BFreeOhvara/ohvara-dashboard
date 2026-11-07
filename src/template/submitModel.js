import { BOOK_DAYS } from './carriers.js'
import { phoneComplete, toE164, formatPhone } from './phoneMask.js'
import { findCarrier, logUnknownCarrier } from '../lib/carriers/catalog.js'
import { zoneAbbr } from '../lib/callSlots.js'
import { US_STATES } from '../lib/usStates.js'

const stateName = code => US_STATES.find(s => s.code === code)?.name || code || ''

// P868 — Submit a policy's form value and what it saves. Reaching the client is one of two: the best time (a window)
// or a booked call (an exact time on the client's clock, P854's rules). A booked call is saved with the policy.
export const TIMES = ['Mornings', 'Afternoons', 'Evenings']
export const EMPTY_BOOKING = { day: 5, time: '', iso: null, tz: null, vaId: null }
export const EMPTY_SUBMIT = { name: '', phone: '', city: '', state: '', email: '', reach: 'best', best: 'Evenings', booking: EMPTY_BOOKING, carrier: '', product: 'Mortgage protection' }
export const NEEDED = { name: 'Client name', phone: 'Phone number', carrier: 'Carrier', booking: 'Call time' }

const booked = f => f.reach === 'book' && !!f.booking?.time && !!f.booking.iso && !!f.booking.tz

// The required fields still missing: a name, all 10 digits of the phone, a carrier, and (Book a call) a picked time.
export function missingFields(f) {
  const out = []
  if (!f.name.trim()) out.push('name')
  if (!phoneComplete(f.phone)) out.push('phone')
  if (!f.carrier.trim()) out.push('carrier')
  if (f.reach === 'book' && !booked(f)) out.push('booking')
  return out
}

export function bookingText(b) {
  if (!b?.iso) return 'No time picked'
  const d = BOOK_DAYS.find(x => x[1] === b.day)
  return `${d?.[0] || ''}, Nov ${b.day}, ${b.time} ${zoneAbbr(b.tz, b.iso)} (their time)`
}
export const reachText = f => (f.reach === 'book' ? bookingText(f.booking) : `Best time: ${f.best.toLowerCase()}`)
export const livesIn = f => [f.city.trim(), f.state ? stateName(f.state) : ''].filter(Boolean).join(', ')

// What gets saved: the phone as E.164 (digits only), the carrier as listed (or as typed, logged for review), and
// either the best time or the booked call. null while anything required is missing.
export function buildSubmission(f, by = 'agent') {
  if (missingFields(f).length) return null
  const listed = findCarrier(f.carrier)
  if (!listed) logUnknownCarrier(f.carrier, by)
  return {
    name: f.name.trim(),
    phone: toE164(f.phone),
    phoneShown: formatPhone(f.phone),
    email: f.email.trim() || null,
    city: f.city.trim() || null,
    state: f.state || null,
    product: f.product,
    carrier: listed ? listed.name : f.carrier.trim(),
    carrierListed: !!listed,
    bestTime: f.reach === 'best' ? f.best : null,
    booking: f.reach === 'book' ? { iso: f.booking.iso, tz: f.booking.tz, vaId: f.booking.vaId, day: f.booking.day, time: f.booking.time } : null,
  }
}
