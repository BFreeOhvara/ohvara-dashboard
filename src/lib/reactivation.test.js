// P952 — reactivation rules (src/lib/reactivation.js).
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  parseCsv, sniffDelimiter, guessMapping, looksLikeHeader, mappingMissing, normalizePhone, normalizeState, cleanList,
  listFit, billingLine, attemptDueAt, afterCall, listProgress, listQuality, reactOpener, REACT_DEFAULTS, inWindow,
} from './reactivation.js'

const MESSY = `First Name,Last Name,Phone,State,Age,Mortgage Balance,Lead Date,Vendor
Ann,Lee,(512) 555-2001,TX,54,"$210,000",2025-03-01,Acme
Bo,Ray,512-555-2001,Texas,61,,2025-03-02,Acme
Cy,Moe,123,TX,40,,,
Di,Fox,+1 404 555 2002,GA,47,150000,,Acme
Ed,Kim,602.555.2003,AZ,58,,,
Flo,Ng,7135552004,TX,66,,,
Gus,Ott,3055552005,FL,49,,,
Hal,Poe,2125552006,NY,52,,,
"Ivy ""J""",Qu,9155552007,tx,39,,,`

test('parses quoted CSV, a paste with tabs, and CRLF', () => {
  const rows = parseCsv(MESSY)
  assert.equal(rows.length, 10)
  assert.equal(rows[1][5], '$210,000')
  assert.equal(rows[9][0], 'Ivy "J"')
  assert.equal(sniffDelimiter('a\tb\tc\n1\t2\t3'), '\t')
  assert.deepEqual(parseCsv('a\tb\r\n1\t2\r\n'), [['a', 'b'], ['1', '2']])
})

test('guesses the columns from the header', () => {
  const [h] = parseCsv(MESSY)
  const m = guessMapping(h)
  assert.deepEqual({ first: m.first, last: m.last, phone: m.phone, state: m.state, age: m.age, mortgage: m.mortgage, lead_date: m.lead_date, source: m.source },
    { first: 0, last: 1, phone: 2, state: 3, age: 4, mortgage: 5, lead_date: 6, source: 7 })
  assert.equal(looksLikeHeader(h), true)
  assert.equal(looksLikeHeader(['Ann', '5125552001']), false)
  assert.deepEqual(mappingMissing({ phone: 1 }), ['name', 'state'])
})

test('phones and states', () => {
  assert.equal(normalizePhone('(512) 555-2001'), '+15125552001')
  assert.equal(normalizePhone('1-512-555-2001'), '+15125552001')
  assert.equal(normalizePhone('123'), null)
  assert.equal(normalizePhone('0125552001'), null)        // area code can't start with 0
  assert.equal(normalizePhone('5121552001'), null)        // exchange can't start with 1
  assert.equal(normalizePhone('5555555555'), null)        // all one digit
  assert.equal(normalizePhone('9115552001'), null)        // N11
  assert.equal(normalizePhone('5125550123'), null)        // 555-01xx
  assert.equal(normalizeState('Texas'), 'TX')
  assert.equal(normalizeState('tx'), 'TX')
  assert.equal(normalizeState('N.Y.'), 'NY')
  assert.equal(normalizeState('Narnia'), null)
})

test('cleans a messy list: bad numbers, duplicates, existing, unlicensed states, do-not-call', () => {
  const [h, ...rows] = parseCsv(MESSY)
  const r = cleanList(rows, guessMapping(h), { licensed: ['TX', 'GA', 'FL'], existing: ['+17135552004'], dnc: ['+13055552005'] })
  assert.equal(r.total, 9)
  assert.deepEqual(r.counts, { bad_number: 1, duplicate: 1, existing: 1, unlicensed: 2, dnc: 1 })
  assert.deepEqual(r.kept.map(k => k.first), ['Ann', 'Di', 'Ivy "J"'])
  assert.equal(r.kept[0].mortgage_cents, 21000000)
  assert.equal(r.kept[0].age, 54)
  assert.equal(r.callable, 3)
})

test('a single name column splits into first and last', () => {
  const rows = parseCsv('Name,Phone,State\nMary Ann Smith,5125552010,TX')
  const r = cleanList(rows.slice(1), guessMapping(rows[0]), { licensed: ['TX'] })
  assert.equal(r.kept[0].first, 'Mary')
  assert.equal(r.kept[0].last, 'Ann Smith')
})

test('P957: a list is free, no minimum; only the new-account room caps it', () => {
  assert.deepEqual(listFit(99), { n: 99, fits: 99, over: 0, empty: false })
  assert.deepEqual(listFit(480, { room: 300 }), { n: 480, fits: 300, over: 180, empty: false })
  assert.equal(listFit(0).empty, true)
  assert.equal(billingLine({ callable: 480, amount_cents: 96000 }), 'Reactivation · 480 leads · $960')
  assert.equal(billingLine({ callable: 468, amount_cents: 96000, refunded_cents: 2400 }), 'Reactivation · 468 leads · $960 · $24 back')
})

test('cadence: day 1, 2, 4, 7, 14 then stop', () => {
  const s = '2026-11-10T14:00:00.000Z'
  assert.equal(attemptDueAt(s, 1), s)
  assert.equal(attemptDueAt(s, 2), '2026-11-11T14:00:00.000Z')
  assert.equal(attemptDueAt(s, 3), '2026-11-13T14:00:00.000Z')
  assert.equal(attemptDueAt(s, 4), '2026-11-16T14:00:00.000Z')
  assert.equal(attemptDueAt(s, 5), '2026-11-23T14:00:00.000Z')
  assert.equal(attemptDueAt(s, 6), null)
  assert.equal(attemptDueAt(s, 4, { ...REACT_DEFAULTS, maxAttempts: 3 }), null)
})

test('after a call: board, do-not-call, retry or stop', () => {
  assert.deepEqual(afterCall('booked', 1), { status: 'booked', done: true, board: true })
  assert.deepEqual(afterCall('transferred', 2), { status: 'transferred', done: true, board: true })
  assert.deepEqual(afterCall('opt_out', 1), { status: 'stop', done: true, dnc: true })
  assert.deepEqual(afterCall('hard_no', 1), { status: 'not_interested', done: true, dnc: true })
  assert.deepEqual(afterCall('no_answer', 4), { status: 'queued' })
  assert.deepEqual(afterCall('no_answer', 5), { status: 'no_answer', done: true })
  assert.deepEqual(afterCall('not_now', 2), { status: 'queued', reached: true })
})

test('progress and the auto-pause on stops', () => {
  const people = [
    ...Array(10).fill({ status: 'booked', attempts: 1 }),
    ...Array(5).fill({ status: 'transferred', attempts: 2 }),
    ...Array(3).fill({ status: 'stop', attempts: 1 }),
    ...Array(4).fill({ status: 'not_interested', attempts: 1 }),
    ...Array(30).fill({ status: 'queued', attempts: 1 }),
    ...Array(48).fill({ status: 'queued', attempts: 0 }),
  ]
  const p = listProgress(people)
  assert.deepEqual(p, { total: 100, worked: 52, reached: 22, booked: 10, transferred: 5, stop: 3, wrong: 0, remaining: 78 })
  const q = listQuality(p)
  assert.equal(Math.round(q.contact * 100), 42)
  assert.equal(Math.round(q.booked * 100), 68)
  assert.equal(q.pause, true)   // 3 of 22 reached asked us to stop (14% > 5%)
  assert.equal(listQuality({ ...p, reached: 10, stop: 3 }).pause, false) // not enough reached yet
})

test('opener and window', () => {
  assert.match(reactOpener('Ann'), /^Hey Ann, this is Max with Deedstone Insurance\. A while back/)
  assert.match(reactOpener(''), /^Hey there,/)
  assert.equal(inWindow('07:59'), false)
  assert.equal(inWindow('08:00'), true)
  assert.equal(inWindow('19:59'), true)
  assert.equal(inWindow('20:00'), false)
})
