import { describe, test, beforeEach } from 'node:test'
import { expect } from './testExpect.js'
import LIST from './list.js'
import {
  CARRIER_CATALOG, CATALOG_COUNTS, MEDIAN_HOURS, CENTRAL, medianHours, median, toCentralMin, findCarrier, matchCarriers,
  bookingCarrierFor, isVerified, logUnknownCarrier, unknownCarriers, clearUnknownCarriers,
} from './catalog.js'
import { DAYS, toMin, normalizeName } from '../carriers.js'
import { carrierDaySlots, carrierTakesCallAt, CLOSE_BUFFER_MIN } from '../scheduling.js'
import { clientSlotISO } from '../scheduling.js'

const WEEK = (open, close) => Object.fromEntries(DAYS.map(d => [d, ['sat', 'sun'].includes(d) ? null : { open, close }]))
const row = (name, hours, tz) => ({ name, aliases: [], hours, hours_tz: tz, hours_status: 'verified' })

describe('P868 carrier list', () => {
  test('well over 100 carriers, each with a unique name, aliases and a version', () => {
    expect(CATALOG_COUNTS.listed).toBeGreaterThan(200)
    expect(new Set(CARRIER_CATALOG.map(c => c.name.toLowerCase())).size).toBe(CARRIER_CATALOG.length)
    expect(LIST.version).toMatch(/^\d{4}-\d{2}-\d{2}\.\d+$/)
    expect(CATALOG_COUNTS.verified + CATALOG_COUNTS.unverified).toBe(CATALOG_COUNTS.listed)
  })

  test('every verified carrier has weekday hours in a US zone, a source URL and a check date', () => {
    const ok = CARRIER_CATALOG.filter(isVerified)
    expect(ok.length).toBeGreaterThan(100)
    for (const c of ok) {
      expect(c.hours_tz, c.name).toMatch(/^(America|Pacific)\//)
      expect(c.hours_source_url, c.name).toMatch(/^https?:\/\//)
      expect(c.hours_checked_at, c.name).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(DAYS.some(d => c.hours[d]), c.name).toBe(true)
      for (const d of DAYS) if (c.hours[d]) expect(toMin(c.hours[d].open), `${c.name} ${d}`).toBeLessThan(toMin(c.hours[d].close))
    }
  })

  test('unverified carriers carry no hours ("Hours not verified")', () => {
    for (const c of CARRIER_CATALOG.filter(x => !isVerified(x))) { expect(c.hours).toBeNull(); expect(c.hours_status).toBeNull() }
  })
})

describe('type-ahead', () => {
  test('"A" brings up the A carriers, A to Z among equals', () => {
    const hits = matchCarriers('A', 100).filter(h => !h.alias)
    expect(hits.length).toBeGreaterThan(15)
    expect(hits.every(h => /(^| )a/.test(normalizeName(h.carrier.name)))).toBe(true)
    expect(hits[0].carrier.name[0].toLowerCase()).toBe('a')
  })
  test('matches the name, a short name, a parent and an issuing company', () => {
    expect(matchCarriers('mutual of o')[0].carrier.name).toBe('Mutual of Omaha')
    const moo = matchCarriers('MOO')[0]
    expect(moo.carrier.name).toBe('Mutual of Omaha')
    expect(moo.alias).toBe('MOO')
    expect(matchCarriers('CNO')[0].carrier.name).toBe('Bankers Life') // parent company
    expect(matchCarriers('united of omaha')[0].carrier.name).toBe('Mutual of Omaha') // issuing company
    expect(matchCarriers('Torchmark').map(h => h.carrier.name)).toContain('Globe Life')
  })
  test('case and punctuation do not matter; nothing typed gives nothing', () => {
    expect(findCarrier('f and g')?.name).toBe(findCarrier('F&G')?.name)
    expect(findCarrier('  mutual OF omaha ')?.name).toBe('Mutual of Omaha')
    expect(matchCarriers('')).toEqual([])
    expect(findCarrier('Acme Made Up Life')).toBeNull()
  })
})

describe('median default', () => {
  test('median of odd and even lists', () => {
    expect(median([3, 1, 2])).toBe(2)
    expect(median([1, 2, 3, 4])).toBe(2.5)
    expect(median([])).toBeNull()
  })
  test('hours in other zones are moved to Central before the median', () => {
    expect(toCentralMin('08:00', 'America/New_York', 'mon')).toBe(7 * 60)
    expect(toCentralMin('06:00', 'America/Los_Angeles', 'mon')).toBe(8 * 60)
    expect(toCentralMin('08:00', CENTRAL, 'fri')).toBe(8 * 60)
    const m = medianHours([
      row('East', WEEK('08:00', '17:00'), 'America/New_York'), // 7:00–4:00 CT
      row('Central', WEEK('08:00', '18:00'), CENTRAL), //            8:00–6:00 CT
      row('West', WEEK('07:00', '15:00'), 'America/Los_Angeles'), // 9:00–5:00 CT
    ])
    expect(m.hours.mon).toEqual({ open: '08:00', close: '17:00' })
    expect(m.hours.sat).toBeNull()
    expect(m.hours_tz).toBe(CENTRAL)
  })
  test('a day fewer than half are open on is closed; unverified rows are ignored', () => {
    const sat = { ...WEEK('08:00', '17:00'), sat: { open: '09:00', close: '12:00' } }
    const m = medianHours([row('A', sat, CENTRAL), row('B', WEEK('08:00', '17:00'), CENTRAL), row('C', WEEK('08:00', '17:00'), CENTRAL), { name: 'X', hours: null, hours_status: null }])
    expect(m.count).toBe(3)
    expect(m.hours.sat).toBeNull()
  })
  test('the shipped default is a weekday window in Central', () => {
    for (const d of ['mon', 'tue', 'wed', 'thu', 'fri']) {
      expect(MEDIAN_HOURS.hours[d]).not.toBeNull()
      expect(toMin(MEDIAN_HOURS.hours[d].close) - toMin(MEDIAN_HOURS.hours[d].open)).toBeGreaterThanOrEqual(7 * 60)
    }
    expect(MEDIAN_HOURS.hours.sun).toBeNull()
  })
  test('unverified and typed-in carriers book on the median; verified ones on their own hours', () => {
    const unv = CARRIER_CATALOG.find(c => !isVerified(c))
    expect(bookingCarrierFor(unv.name)).toMatchObject({ name: unv.name, hours: MEDIAN_HOURS.hours, hours_tz: CENTRAL, hours_status: 'median', listed: true })
    expect(bookingCarrierFor('Acme Made Up Life')).toMatchObject({ name: 'Acme Made Up Life', hours_status: 'median', listed: false })
    expect(bookingCarrierFor('Globe Life').hours_status).toBe('verified')
    expect(bookingCarrierFor('')).toBeNull()
  })
})

describe('slots stay inside carrier hours', () => {
  const ZONES = ['America/New_York', 'America/Chicago', 'America/Phoenix', 'Pacific/Honolulu']
  const DATES = ['2026-11-13', '2026-11-14', '2027-07-15']
  const fmts = new Map()
  const fmtOf = tz => fmts.get(tz) || fmts.set(tz, new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })).get(tz)
  test('every slot for every carrier, client zone and day falls inside the carrier\'s open hours', () => {
    const list = [...CARRIER_CATALOG.filter(isVerified), bookingCarrierFor('Acme Made Up Life')]
    let n = 0
    for (const c of list) for (const tz of ZONES) for (const date of DATES) {
      for (const s of carrierDaySlots(date, tz, c)) {
        const ms = new Date(clientSlotISO(date, s, tz)).getTime()
        expect(carrierTakesCallAt(ms, c), `${c.name} ${date} ${s} ${tz}`).toBe(true)
        // and explicitly: on the carrier's clock it's open, and starts an hour before close at the latest
        const p = Object.fromEntries(fmtOf(c.hours_tz).formatToParts(new Date(ms)).map(x => [x.type, x.value]))
        const h = c.hours[p.weekday.slice(0, 3).toLowerCase()]
        const min = (+p.hour % 24) * 60 + +p.minute
        expect(h).toBeTruthy()
        expect(min).toBeGreaterThanOrEqual(toMin(h.open))
        expect(min).toBeLessThanOrEqual(toMin(h.close) - CLOSE_BUFFER_MIN)
        n++
      }
    }
    expect(n).toBeGreaterThan(1000)
  })
  test('a carrier in another zone: Pacific Life 6 AM–5 PM PT gives an East Coast client 9:00 AM to 7:00 PM', () => {
    const c = findCarrier('Pacific Life')
    expect(c.hours_tz).toBe('America/Los_Angeles')
    const s = carrierDaySlots('2026-11-10', 'America/New_York', c)
    expect(s[0]).toBe('9:00 AM')
    expect(s[s.length - 1]).toBe('7:00 PM')
  })
  test('closed on Sunday means no slots', () => {
    expect(carrierDaySlots('2026-11-15', 'America/Chicago', findCarrier('Pacific Life'))).toEqual([])
  })
})

describe('typed-in carriers go to the review list', () => {
  beforeEach(() => clearUnknownCarriers())
  test('a listed name is not logged; an unlisted one is counted once per name', () => {
    expect(logUnknownCarrier('Globe Life')).toBe(false)
    expect(logUnknownCarrier('Acme Life', 'agent')).toBe(true)
    expect(logUnknownCarrier('ACME life', 'va')).toBe(true)
    expect(logUnknownCarrier('  ')).toBe(false)
    expect(unknownCarriers()).toEqual([{ name: 'Acme Life', count: 2, by: ['agent', 'va'] }])
  })
})
