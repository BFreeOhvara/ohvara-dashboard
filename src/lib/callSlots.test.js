import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  zoneOf, findZone, instantOf, clockOf, dateOf, timeLines, blockTime, startsTooClose, vaFree, freeVa, vaSlots,
  agentFree, agentSlots, slotOptions, clocksBetween, GAP_MIN, DEFAULT_APPT_MIN,
} from './callSlots.js'

const CT = 'America/Chicago', ET = 'America/New_York', AZ = 'America/Phoenix', MT = 'America/Denver'
const team = [
  { id: 'va-maya', name: 'Maya Brooks', tz: CT },
  { id: 'va-leo', name: 'Leo Grant', tz: CT },
]

test('one-zone states come from the state alone', () => {
  assert.equal(zoneOf('GA', ''), ET)
  assert.equal(zoneOf('ca', 'anywhere'), 'America/Los_Angeles')
  assert.equal(zoneOf('CO', 'Denver'), MT)
})

test('split states resolve by city', () => {
  const cases = [
    ['TN', 'Knoxville', ET], ['TN', 'Nashville', CT], ['KY', 'Louisville', ET], ['KY', 'Bowling Green', CT],
    ['IN', 'Indianapolis', 'America/Indiana/Indianapolis'], ['IN', 'Gary', CT], ['IN', 'Evansville', CT],
    ['FL', 'Tampa', ET], ['FL', 'Pensacola', CT], ['FL', 'St. Petersburg', ET], ['FL', 'Saint Petersburg', ET],
    ['TX', 'El Paso', MT], ['TX', 'Austin', CT], ['ND', 'Dickinson', MT], ['ND', 'Fargo', CT],
    ['SD', 'Rapid City', MT], ['SD', 'Sioux Falls', CT], ['NE', 'Scottsbluff', MT], ['NE', 'Omaha', CT],
    ['KS', 'Goodland', MT], ['KS', 'Wichita', CT], ['ID', "Coeur d'Alene", 'America/Los_Angeles'], ['ID', 'Boise', 'America/Boise'],
    ['OR', 'Ontario', MT], ['OR', 'Portland', 'America/Los_Angeles'], ['AZ', 'Phoenix', AZ], ['AZ', 'Window Rock', MT], ['AZ', 'Tuba City', MT],
  ]
  for (const [st, city, tz] of cases) assert.equal(zoneOf(st, city), tz, `${city}, ${st}`)
})

test('a failed lookup is null, never a guess', async () => {
  assert.equal(zoneOf('TX', ''), null)
  assert.equal(zoneOf('TX', 'Nowhereville'), null)
  assert.equal(zoneOf('ZZ', 'Austin'), null)
  assert.equal(zoneOf('', ''), null)
  assert.equal(await findZone('TX', 'Nowhereville', async () => null), null)
  assert.equal(await findZone('TX', 'Nowhereville', async () => { throw new Error('offline') }), null)
  assert.equal(await findZone('TX', 'Van Horn', async () => CT), CT)
  assert.equal(await findZone('TX', '', async () => CT), null)
})

test('DST: the same client clock is a different instant across Nov 1 2026 and Mar 14 2027', () => {
  // Eastern: EDT (UTC-4) before Nov 1, EST (UTC-5) after; back to EDT on Mar 14.
  assert.equal(instantOf('2026-10-30', '3:00 PM', ET), '2026-10-30T19:00:00.000Z')
  assert.equal(instantOf('2026-11-02', '3:00 PM', ET), '2026-11-02T20:00:00.000Z')
  assert.equal(instantOf('2027-03-12', '3:00 PM', ET), '2027-03-12T20:00:00.000Z')
  assert.equal(instantOf('2027-03-15', '3:00 PM', ET), '2027-03-15T19:00:00.000Z')
  // The day itself: 9:00 AM on the switch day.
  assert.equal(instantOf('2026-11-01', '9:00 AM', CT), '2026-11-01T15:00:00.000Z')
  assert.equal(instantOf('2027-03-14', '9:00 AM', CT), '2027-03-14T14:00:00.000Z')
})

test('Arizona has no DST', () => {
  assert.equal(instantOf('2026-10-30', '3:00 PM', AZ), '2026-10-30T22:00:00.000Z')
  assert.equal(instantOf('2026-11-02', '3:00 PM', AZ), '2026-11-02T22:00:00.000Z')
  assert.equal(instantOf('2027-03-15', '3:00 PM', AZ), '2027-03-15T22:00:00.000Z')
  // So a Central viewer sees 3:00 PM Phoenix as 4:00 PM in winter and 5:00 PM in summer.
  assert.equal(clockOf(instantOf('2026-11-02', '3:00 PM', AZ), CT), '4:00 PM')
  assert.equal(clockOf(instantOf('2027-03-15', '3:00 PM', AZ), CT), '5:00 PM')
  // The Navajo Nation does keep DST.
  assert.equal(clockOf(instantOf('2027-03-15', '3:00 PM', zoneOf('AZ', 'Window Rock')), AZ), '2:00 PM')
})

test('viewer and client in different zones', () => {
  const iso = instantOf('2026-11-10', '3:00 PM', ET)
  assert.deepEqual(timeLines(iso, ET, CT, 'Tampa, FL'), { client: "3:00 PM ET, client's time (Tampa, FL)", mine: "That's 2:00 PM CT for you" })
  assert.deepEqual(timeLines(iso, ET, ET, 'Tampa, FL'), { client: "3:00 PM ET, client's time (Tampa, FL)", mine: '' })
  assert.equal(blockTime(iso, CT, ET), '2:00 PM · client 3:00 PM ET')
  assert.equal(blockTime(iso, ET, ET), '3:00 PM')
  assert.equal(blockTime(iso, CT, null), '2:00 PM')
  // Late on the client's clock can be the next day for a viewer further east.
  const late = instantOf('2026-11-10', '11:30 PM', 'America/Los_Angeles')
  assert.equal(dateOf(late, ET), '2026-11-11')
})

test('the 30-minute gap: 29 is too close, 30 and 31 are fine', () => {
  assert.equal(GAP_MIN, 30)
  const at = '2026-11-10T15:00:00.000Z'
  const plus = m => new Date(Date.parse(at) + m * 60e3).toISOString()
  assert.equal(startsTooClose(at, plus(29)), true)
  assert.equal(startsTooClose(at, plus(-29)), true)
  assert.equal(startsTooClose(at, plus(30)), false)
  assert.equal(startsTooClose(at, plus(31)), false)
  const calls = [{ id: 'k1', va_id: 'va-maya', iso: at }]
  assert.equal(vaFree('va-maya', plus(29), calls), false)
  assert.equal(vaFree('va-maya', plus(30), calls), true)
  assert.equal(vaFree('va-maya', plus(31), calls), true)
  assert.equal(vaFree('va-leo', plus(0), calls), true)
  assert.equal(vaFree('va-maya', at, calls, 'k1'), true, 'a call moving off its own time does not block itself')
})

test('another free VA takes it when the usual one is busy', () => {
  const iso = instantOf('2026-11-10', '10:00 AM', CT)
  const calls = [{ id: 'k1', va_id: 'va-maya', iso: instantOf('2026-11-10', '10:15 AM', CT) }]
  assert.equal(freeVa({ iso, team, prefer: 'va-maya' }).id, 'va-maya')
  assert.equal(freeVa({ iso, team, calls, prefer: 'va-maya' }).id, 'va-leo')
  const [slot] = vaSlots({ date: '2026-11-10', clocks: ['10:00 AM'], clientTz: CT, team, calls, prefer: 'va-maya' })
  assert.equal(slot.open, true)
  assert.equal(slot.va.id, 'va-leo')
  assert.equal(slotOptions([slot], { mine: 'va-maya' })[0].sub, 'Goes to Leo')
})

test('nobody free: the slot is Taken and greyed out', () => {
  const calls = [
    { id: 'k1', va_id: 'va-maya', iso: instantOf('2026-11-10', '10:00 AM', CT) },
    { id: 'k2', va_id: 'va-leo', iso: instantOf('2026-11-10', '10:20 AM', CT) },
  ]
  const slots = vaSlots({ date: '2026-11-10', clocks: ['9:30 AM', '10:00 AM', '10:30 AM', '11:00 AM'], clientTz: CT, team, calls, prefer: 'va-maya' })
  assert.deepEqual(slots.map(s => [s.clock, s.open, s.va?.id || null, s.why]), [
    ['9:30 AM', true, 'va-maya', null], // 30 from Maya's 10:00, 50 from Leo's 10:20
    ['10:00 AM', false, null, 'taken'],
    ['10:30 AM', true, 'va-maya', null], // 30 from Maya's, 10 from Leo's
    ['11:00 AM', true, 'va-maya', null],
  ])
  const opts = slotOptions(slots, { mine: 'va-maya' })
  assert.deepEqual(opts[1], { value: '10:00 AM', label: '10:00 AM', disabled: true, sub: 'Taken' })
})

test('a VA who is off that day never gets the call', () => {
  const iso = instantOf('2026-11-10', '10:00 AM', CT)
  const offTeam = [{ ...team[0], off: true }, team[1]]
  assert.equal(freeVa({ iso, team: offTeam, prefer: 'va-maya' }).id, 'va-leo')
  const allOff = team.map(v => ({ ...v, off: true }))
  const [slot] = vaSlots({ date: '2026-11-10', clocks: ['10:00 AM'], clientTz: CT, team: allOff })
  assert.equal(slot.open, false)
  assert.equal(slot.why, 'off')
})

test('the VA shift is on the VA’s clock, the slot on the client’s', () => {
  // 8:00 AM Eastern is 7:00 AM for a Central VA: before the shift.
  const early = vaSlots({ date: '2026-11-10', clocks: ['8:00 AM', '9:00 AM'], clientTz: ET, team })
  assert.deepEqual(early.map(s => [s.clock, s.open, s.why]), [['8:00 AM', false, 'off'], ['9:00 AM', true, null]])
  // 5:30 PM Phoenix is 6:30 PM Central in November: after the shift.
  const [late] = vaSlots({ date: '2026-11-10', clocks: ['5:30 PM'], clientTz: AZ, team })
  assert.equal(late.open, false)
  // Pass on skips yourself.
  const iso = instantOf('2026-11-10', '10:00 AM', CT)
  assert.equal(freeVa({ iso, team, skip: ['va-maya'] }).id, 'va-leo')
  assert.equal(freeVa({ iso, team, skip: ['va-maya'], calls: [{ id: 'x', va_id: 'va-leo', iso }] }), null)
  assert.equal(vaSlots({ date: '2026-11-10', clocks: ['9:00 AM'], clientTz: null, team }).length, 0)
})

test('agent appointments never overlap: length plus buffer, 30 minutes by default', () => {
  assert.equal(DEFAULT_APPT_MIN, 30)
  const appts = [{ id: 'a1', iso: instantOf('2026-11-10', '2:00 PM', CT) }]
  const at = c => instantOf('2026-11-10', c, CT)
  assert.equal(agentFree(at('2:15 PM'), appts), false)
  assert.equal(agentFree(at('1:30 PM'), appts), true)
  assert.equal(agentFree(at('2:30 PM'), appts), true)
  assert.equal(agentFree(at('2:30 PM'), appts, { length: 45 }), false)
  assert.equal(agentFree(at('2:45 PM'), appts, { length: 30, buffer: 15 }), true)
  assert.equal(agentFree(at('2:40 PM'), appts, { length: 30, buffer: 15 }), false)
  assert.equal(agentFree(at('2:00 PM'), appts, { exceptId: 'a1' }), true)
  const slots = agentSlots({ date: '2026-11-10', clocks: clocksBetween(13 * 60, 15 * 60), clientTz: CT, appts })
  assert.deepEqual(slots.map(s => [s.clock, s.open]), [['1:00 PM', true], ['1:30 PM', true], ['2:00 PM', false], ['2:30 PM', true], ['3:00 PM', true]])
  // The client's clock sets the instant: 3:00 PM Eastern is the agent's 2:00 PM Central.
  assert.equal(agentSlots({ date: '2026-11-10', clocks: ['3:00 PM'], clientTz: ET, appts })[0].open, false)
})
