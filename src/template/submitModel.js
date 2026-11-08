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
// P878 (N-D-02): the policy details the team needs to service it: policy or application number, face amount, premium,
// draft day, the insured's date of birth, a beneficiary (optional), and, when it replaces a policy, the old carrier
// and number. A second insured (a spouse) is their own client and policy in the same household (N-D-18).
export const PRODUCTS = ['Mortgage protection', 'Final expense', 'Term life', 'Whole life', 'Universal life', 'Other life policy']
export const EMPTY_SPOUSE = { name: '', dob: '', number: '', face: '', premium: '' }
export const EMPTY_SUBMIT = {
  name: '', phone: '', city: '', state: '', email: '', dob: '', reach: 'best', best: 'Evenings', booking: EMPTY_BOOKING, carrier: '', product: 'Mortgage protection',
  numberKind: 'policy', number: '', face: '', premium: '', draftDay: '', beneficiary: '', relation: '',
  replacing: false, oldCarrier: '', oldNumber: '', spouse: null, notes: '',
}
export const NEEDED = { name: 'Client name', phone: 'Phone number', city: 'City', state: 'State', licence: 'A state you’re licensed in', booking: 'Call time', carrier: 'Carrier', product: 'Product', premium: 'Monthly premium', draftDay: 'Draft day', oldCarrier: 'The carrier being replaced', spouse: 'Second insured details' }
export const DRAFT_DAYS = Array.from({ length: 28 }, (_, i) => String(i + 1))
const amount = v => Number(String(v || '').replace(/[^\d.]/g, ''))

const booked = f => f.reach === 'book' && !!f.booking?.time && !!f.booking.iso && !!f.booking.tz

// The required fields still missing: a name, all 10 digits of the phone, a carrier, and (Book a call) a picked time.
// P878: with { policy: true } also the policy details; licensed = the agent's licensed states (a sale in any other
// state can't be submitted).
// P893 (Brayden): required = full name, phone, city, state, carrier, product, monthly premium, draft day. Optional =
// email, date of birth, policy number (often unknown at submit; added later), face amount, notes.
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
    if (!f.product) out.push('product')
    if (!(amount(f.premium) > 0)) out.push('premium')
    if (!f.draftDay) out.push('draftDay')
    if (f.replacing && !f.oldCarrier.trim()) out.push('oldCarrier')
    if (f.spouse && (!f.spouse.name.trim() || !(amount(f.spouse.premium) > 0))) out.push('spouse')
  }
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
export function buildSubmission(f, by = 'agent', opts = {}) {
  if (missingFields(f, opts).length) return null
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
    // P878: the policy, the old one it replaces (cancelled only after the new one is issued and its first payment
    // goes through), and a spouse as their own policy in the same household.
    dob: f.dob || null,
    // P893: the policy number is optional (often unknown at submit), so the policy is kept whenever it has a premium.
    policy: f.number.trim() || amount(f.premium) > 0 ? { kind: f.numberKind, number: f.number.trim() || null, face: amount(f.face) || null, premium: amount(f.premium), draftDay: Number(f.draftDay) || null, beneficiary: f.beneficiary.trim() || null, relation: f.relation.trim() || null } : null,
    notes: (f.notes || '').trim() || null,
    replaces: f.replacing ? { carrier: f.oldCarrier.trim(), number: f.oldNumber.trim() || null, cancelWhen: 'after_new_issued_and_first_payment' } : null,
    household: f.spouse ? [{ name: f.spouse.name.trim(), dob: f.spouse.dob || null, number: f.spouse.number.trim() || null, face: amount(f.spouse.face) || null, premium: amount(f.spouse.premium), carrier: listed ? listed.name : f.carrier.trim() }] : [],
  }
}
