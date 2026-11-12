// P958 — every week calendar (agent, VA, admin Fulfillment): two-line boxes that never clip, a call that has passed
// takes its result's colour (dimmed), click a call → its day opens first then the details slide in, and nothing
// replays its entrance. Pure parts (template/cal958.js) plus source checks on the three calendars.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { EV_MIN_PX, DAY_FIRST_MS, SETTLE_MS, evLine2, clientAt, minsOf, stampOf, isPast, evLook, evClass, leadResultTone, vaResultTone, ADMIN_RESULT_TONE } from './template/cal958.js'

const read = p => readFileSync(new URL(p, import.meta.url), 'utf8')

test('two lines: type · client time, empty parts drop out', () => {
  assert.equal(evLine2('Appointment', 'client 2:00 PM ET'), 'Appointment · client 2:00 PM ET')
  assert.equal(evLine2('Appointment', ''), 'Appointment')
  assert.ok(EV_MIN_PX >= 16 * 2 + 10, 'a box always has room for both lines and its padding')
})

test('client time only when their clock differs', () => {
  const iso = '2026-11-02T19:00:00Z' // 1:00 PM Central
  assert.equal(clientAt(iso, 'America/Chicago', 'America/New_York'), 'client 2:00 PM ET')
  assert.equal(clientAt(iso, 'America/Chicago', 'America/Chicago'), '')
  assert.equal(clientAt(iso, 'America/Chicago', null), '')
})

test('past = the call has ended on the same wall clock', () => {
  assert.equal(minsOf('1:30 PM'), 13 * 60 + 30)
  assert.equal(minsOf('12:15 AM'), 15)
  assert.equal(stampOf('2026-11-02', '1:00 PM'), '2026-11-02T13:00')
  assert.equal(isPast('2026-11-02T13:00', '2026-11-02T14:14', 30), true)
  assert.equal(isPast('2026-11-02T14:00', '2026-11-02T14:14', 30), false, 'still going')
  assert.equal(isPast('2026-11-02T14:00', '2026-11-02T14:30', 30), true)
  assert.equal(isPast(null, '2026-11-02T14:30'), false)
})

test('look: past with a result = result colour, dimmed; past without = own colour + dot', () => {
  assert.deepEqual(evLook({ base: 'blue', past: true, result: 'green' }), { tone: 'green', done: true, mark: false })
  assert.deepEqual(evLook({ base: 'blue', past: true, result: null }), { tone: 'blue', done: false, mark: true })
  assert.deepEqual(evLook({ base: 'blue', past: true, result: null, needs: false }), { tone: 'blue', done: false, mark: false })
  assert.deepEqual(evLook({ base: 'blue', past: false, result: 'green' }), { tone: 'blue', done: false, mark: false }, 'a result never paints a call still ahead')
  assert.equal(evClass({ tone: 'mute', done: true, mark: false }), 'ev958 is-mute is-past')
  assert.equal(evClass({ tone: 'sky', done: false, mark: true }), 'ev958 is-sky has-mark')
})

test('result colours: agent Sold green, No show grey, Follow up yellow, Not interested orange', () => {
  assert.equal(leadResultTone({ stage: 'sold' }), 'green')
  assert.equal(leadResultTone({ stage: 'no_show' }), 'mute')
  assert.equal(leadResultTone({ stage: 'follow_up' }), 'teal')
  assert.equal(leadResultTone({ stage: 'not_interested' }), 'warn')
  assert.equal(leadResultTone({ stage: 'booked' }), null)
  assert.equal(leadResultTone(null), null)
  assert.equal(vaResultTone({ kind: 'call', status: 'cancelled' }), 'green')
  assert.equal(vaResultTone({ kind: 'call', status: 'no_answer' }), 'warn')
  assert.equal(vaResultTone({ kind: 'call', status: 'booked' }), null)
  assert.equal(vaResultTone({ kind: 'task', status: 'done', row: { outcome: 'not_reached' } }), 'warn')
  assert.equal(vaResultTone({ kind: 'task', status: 'done', row: { outcome: 'completed' } }), 'green')
  assert.deepEqual(ADMIN_RESULT_TONE, { cancelled: 'green', no_answer: 'warn', failed: 'rose', passed: 'mute' })
})

test('timings: the day box (280 ms) is in before the details; the entrance is over before it settles', () => {
  assert.ok(DAY_FIRST_MS >= 280)
  assert.ok(SETTLE_MS >= 750)
})

test('all three calendars use the two-line box, day first, and settle', () => {
  for (const p of ['./template/screens/Calendar.jsx', './template/ful/screens/Calendar.jsx', './adminshell/screens/Team.jsx']) {
    const src = read(p)
    assert.match(src, /<EvText /, `${p}: two-line box`)
    assert.match(src, /useDayFirst\(\)/, `${p}: day opens first`)
    assert.match(src, /is-settled/, `${p}: no replayed entrance`)
    assert.doesNotMatch(src, /<CountUp value=\{list\.length\}/, `${p}: the day count doesn't count up again`)
  }
  // The agent's box is not defined inside the page (a new component each render remounts every box).
  assert.doesNotMatch(read('./template/screens/Calendar.jsx'), /const Ev = \(/)
  // VA details slide in from the right (not the centred pop-up); admin details never replace the day list.
  assert.doesNotMatch(read('./template/ful/screens/Calendar.jsx'), /onClose=\{closeDrawer\} center/)
  assert.doesNotMatch(read('./adminshell/screens/Team.jsx'), /picked \? <DayCall/)
  assert.match(read('./template/cal958.css'), /\.fx-week\.is-settled, \.fx-week\.is-settled \.tp-ev \{ animation: none; \}/)
})
