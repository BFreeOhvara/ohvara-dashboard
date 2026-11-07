import { describe, test, beforeEach } from 'node:test'
import { expect } from '../lib/carriers/testExpect.js'
import { EMPTY_SUBMIT, missingFields, buildSubmission, reachText } from './submitModel.js'
import { clearUnknownCarriers, unknownCarriers } from '../lib/carriers/catalog.js'

const base = { ...EMPTY_SUBMIT, name: 'Ruth Ellison', phone: '5125550188', city: 'Austin', state: 'TX', carrier: 'Globe Life' }
const booking = { day: 6, time: '10:30 AM', iso: '2026-11-06T16:30:00.000Z', tz: 'America/Chicago', vaId: 'va-maya' }

describe('P868 Submit a policy', () => {
  beforeEach(() => clearUnknownCarriers())
  test('needs a name, all 10 digits and a carrier', () => {
    expect(missingFields(EMPTY_SUBMIT)).toEqual(['name', 'phone', 'carrier'])
    expect(missingFields({ ...base, phone: '512555' })).toEqual(['phone'])
    expect(missingFields(base)).toEqual([])
    expect(buildSubmission({ ...base, name: '' })).toBeNull()
  })
  test('best time: saved as the window, no booking', () => {
    const s = buildSubmission(base)
    expect(s).toMatchObject({ phone: '+15125550188', phoneShown: '(512) 555-0188', state: 'TX', carrier: 'Globe Life', carrierListed: true, bestTime: 'Evenings', booking: null })
  })
  test('book a call: needs a picked time, then the appointment is saved with the policy', () => {
    expect(missingFields({ ...base, reach: 'book' })).toEqual(['booking'])
    const s = buildSubmission({ ...base, reach: 'book', booking })
    expect(s.bestTime).toBeNull()
    expect(s.booking).toEqual({ iso: booking.iso, tz: booking.tz, vaId: 'va-maya', day: 6, time: '10:30 AM' })
    expect(reachText({ ...base, reach: 'book', booking })).toBe('Fri, Nov 6, 10:30 AM CT (their time)')
  })
  test('a carrier by alias saves as the listed name; one not listed saves as typed and is logged', () => {
    expect(buildSubmission({ ...base, carrier: 'moo' }).carrier).toBe('Mutual of Omaha')
    const s = buildSubmission({ ...base, carrier: 'Acme Life' })
    expect(s).toMatchObject({ carrier: 'Acme Life', carrierListed: false })
    expect(unknownCarriers().map(r => r.name)).toEqual(['Acme Life'])
  })
})
