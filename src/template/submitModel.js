import { BOOK_DAYS } from './carriers.js'
import { phoneComplete, toE164, formatPhone } from './phoneMask.js'
import { findCarrier, logUnknownCarrier } from '../lib/carriers/catalog.js'
import { zoneAbbr } from '../lib/callSlots.js'
import { US_STATES } from '../lib/usStates.js'

const stateName = code => US_STATES.find(s => s.code === code)?.name || code || ''

// P868 — Submit a policy's form value and what it saves. Reaching the client is one of two: the best time (a window)
// or a booked call (an exact time on the client's clock, P854's rules). A booked call is saved with the policy.
// P907: the window is Morning · Afternoon · Evening (the client's clock); the system books the hand-off call at the
// next open time in it with a free VA (lib/callSlots nextSlot). "Exact time" is the booked call.
export const TIMES = ['Morning', 'Afternoon', 'Evening']
export const EMPTY_BOOKING = { day: 5, time: '', iso: null, tz: null, vaId: null }
// P899 (Brayden): the client fields are name, phone, city, state, carrier and draft day; monthly premium and notes are
// optional. Policy number, date of birth, email, face amount and product are no longer asked (the database keeps the
// columns). Replacing a policy asks the old carrier and the old draft day: the old policy is cancelled once the new
// one is issued, timed to stop the old policy's next draft (lib/clientCheck.js cancelDueBy). A second insured (a
// spouse) is their own client in the same household (N-D-18).
// P923: "Before our team calls" (Brayden, Nov 9): the VA must know before the first call whether an old policy has to
// be cancelled. Replacing is a Yes / No the agent has to answer (null = not answered yet); Yes asks the old carrier,
// the old monthly premium (optional) and the old draft date (required). "Anything our team should know?" is `notes`.
export const EMPTY_SPOUSE = { name: '', premium: '' }
export const EMPTY_SUBMIT = {
  name: '', phone: '', city: '', state: '', reach: 'best', best: 'Afternoon', booking: EMPTY_BOOKING, carrier: '',
  premium: '', draftDay: '', replacing: null, oldCarrier: '', oldPremium: '', oldDraftDay: '', spouse: null, notes: '',
}
export const NEEDED = { name: 'Client name', phone: 'Phone number', city: 'City', state: 'State', licence: 'A state you’re licensed in', booking: 'Call time', carrier: 'Carrier', draftDay: 'Draft day', replacing: 'Replacing a policy, yes or no', oldCarrier: 'The carrier being replaced', oldDraftDay: 'The old policy’s draft date', spouse: 'Second insured’s name' }
export const DRAFT_DAYS = Array.from({ length: 28 }, (_, i) => String(i + 1))
const amount = v => Number(String(v || '').replace(/[^\d.]/g, ''))

const booked = f => f.reach === 'book' && !!f.booking?.time && !!f.booking.iso && !!f.booking.tz

// The required fields still missing: a name, all 10 digits of the phone, a carrier, and (Book a call) a picked time.
// With { policy: true } also city, state and draft day (and, when replacing, the old carrier and draft day);
// licensed = the agent's licensed states (a sale in any other state can't be submitted).
export function missingFields(f, { policy = false, licensed = null } = {}) {
  const out = []
  if (!f.name.trim()) out.push('name')
  if (!phoneComplete(f.phone)) out.push('phone')
  if (policy && !f.city.trim()) out.push('city')
  if (policy && !f.state) out.push('state')
  if (licensed && f.state && !licensed.includes(f.state)) out.push('licence')
  if (f.reach === 'book' && !booked(f)) out.push('booking')
  if (!f.carrier.trim()) out.push('carrier')
  if (policy) {
    if (!f.draftDay) out.push('draftDay')
    if (f.replacing == null) out.push('replacing')
    if (f.replacing && !f.oldCarrier.trim()) out.push('oldCarrier')
    if (f.replacing && !f.oldDraftDay) out.push('oldDraftDay')
    if (f.spouse && !f.spouse.name.trim()) out.push('spouse')
  }
  return out
}

export function bookingText(b) {
  if (!b?.iso) return 'No time picked'
  const d = BOOK_DAYS.find(x => x[1] === b.day)
  return `${d?.[0] || ''}, Nov ${b.day}, ${b.time} ${zoneAbbr(b.tz, b.iso)} (their time)`
}
export const reachText = f => (f.reach === 'book' ? bookingText(f.booking) : `${f.best}, booked at the next open time`)
export const livesIn = f => [f.city.trim(), f.state ? stateName(f.state) : ''].filter(Boolean).join(', ')

// What gets saved: the phone as E.164 (digits only), the carrier as listed (or as typed, logged for review), and
// either the best time or the booked call. null while anything required is missing.
export function buildSubmission(f, by = 'agent', opts = {}) {
  if (missingFields(f, opts).length) return null
  const listed = findCarrier(f.carrier)
  if (!listed) logUnknownCarrier(f.carrier, by)
  return {
    name: f.name.trim(),
    phone: toE164(f.phone),
    phoneShown: formatPhone(f.phone),
    city: f.city.trim() || null,
    state: f.state || null,
    carrier: listed ? listed.name : f.carrier.trim(),
    carrierListed: !!listed,
    bestTime: f.reach === 'best' ? f.best : null,
    booking: f.reach === 'book' ? { iso: f.booking.iso, tz: f.booking.tz, vaId: f.booking.vaId, day: f.booking.day, time: f.booking.time } : null,
    // P899: the policy is its carrier and draft day (premium optional); the old one it replaces is cancelled once the
    // new one is issued, before the old one's next draft. A spouse is their own client in the same household.
    policy: { premium: amount(f.premium) || null, draftDay: Number(f.draftDay) || null },
    notes: (f.notes || '').trim() || null,
    replaces: f.replacing ? { carrier: f.oldCarrier.trim(), premium: amount(f.oldPremium) || null, draftDay: Number(f.oldDraftDay) || null, cancelWhen: 'after_new_issued_before_old_draft' } : null,
    household: f.spouse ? [{ name: f.spouse.name.trim(), premium: amount(f.spouse.premium) || null, carrier: listed ? listed.name : f.carrier.trim() }] : [],
  }
}
