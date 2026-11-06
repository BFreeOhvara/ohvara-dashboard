import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { VA_HUES, vaHue, minutesOf, clockOf, shiftSpan, theirTime, weekCalls, lanes, rotaCell } from './calendar.js'

// P867 A/B: the admin Fulfillment calendar (every VA's calls and shifts, one colour per VA) and the rota grid cells.
const team = [{ id: 'v1', name: 'Maya Brooks', hours: '9:00 AM to 5:00 PM' }, { id: 'v2', name: 'Andre Lewis', hours: '10:00 AM to 6:00 PM' }, { id: 'v3', name: 'Keisha Grant', hours: '8:00 AM to 4:00 PM' }]

test('each VA keeps one colour from the shell palette', () => {
  assert.deepEqual(team.map(v => vaHue(team, v.id)), VA_HUES.slice(0, 3))
  assert.equal(new Set(team.map(v => vaHue(team, v.id))).size, team.length)
})

test('times: clock text <-> minutes, shift hours, and the client\'s own time in another zone', () => {
  assert.equal(minutesOf('1:30 PM'), 13 * 60 + 30)
  assert.equal(minutesOf('12:15 AM'), 15)
  assert.equal(clockOf(9 * 60 + 5), '9:05 AM')
  assert.deepEqual(shiftSpan('9:00 AM to 5:00 PM'), [540, 1020])
  assert.equal(shiftSpan(''), null)
  assert.equal(theirTime('10:00 AM', 'FL'), '11:00 AM ET')
  assert.equal(theirTime('10:00 AM', 'CA'), '8:00 AM PT')
  assert.equal(theirTime('10:00 AM', 'TX'), '', 'same clock as the company: no second label')
})

test('the week: today is the desk, other days come from the rota, inside each VA\'s hours', () => {
  const desk = [{ id: 'c1', va_id: 'v1', va: 'Maya Brooks', time: '10:00 AM', client: 'A', status: 'late' }]
  const rota = { 4: ['v1', 'v2'], 5: ['v1'], 6: ['v3'] }
  const calls = weekCalls({ desk, rota, vas: team, today: 5, days: [4, 5, 6] })
  assert.ok(calls.some(c => c.id === 'c1' && c.day === 5 && c.state))
  assert.equal(calls.filter(c => c.day === 4).length, 4, 'two calls each for the two VAs on shift')
  assert.equal(calls.filter(c => c.day === 6).length, 2)
  for (const c of calls.filter(c => c.day !== 5)) {
    const [s, e] = shiftSpan(team.find(v => v.id === c.va_id).hours)
    const m = minutesOf(c.time)
    assert.ok(m >= s && m < e, `${c.id} at ${c.time} is inside the shift`)
    assert.equal(c.status, c.day < 5 ? (c.status === 'no_answer' ? 'no_answer' : 'cancelled') : 'booked')
  }
  assert.equal(new Set(calls.map(c => c.id)).size, calls.length, 'ids are unique (the call drawer opens by id)')
})

test('overlapping calls sit side by side', () => {
  const l = lanes([{ id: 'a', time: '9:00 AM' }, { id: 'b', time: '9:15 AM' }, { id: 'c', time: '11:00 AM' }])
  assert.deepEqual(l.get('a'), [0, 2])
  assert.deepEqual(l.get('b'), [1, 2])
  assert.deepEqual(l.get('c'), [0, 1])
})

test('rota cells: on (with hours), asked off, approved off, or empty', () => {
  const rota = { 3: ['v1'], 4: ['v1'], 5: [] }
  const dayOff = [{ va_id: 'v1', date: 4, status: 'pending', reason: 'Dentist' }, { va_id: 'v1', date: 5, status: 'approved' }, { va_id: 'v1', date: 6, status: 'declined' }]
  const v = team[0]
  assert.deepEqual(rotaCell({ rota, dayOff, va: v, day: 3 }), { kind: 'on', hours: v.hours })
  assert.deepEqual(rotaCell({ rota, dayOff, va: v, day: 4 }), { kind: 'requested', on: true, reason: 'Dentist' })
  assert.deepEqual(rotaCell({ rota, dayOff, va: v, day: 5 }), { kind: 'off' })
  assert.deepEqual(rotaCell({ rota, dayOff, va: v, day: 6 }), { kind: '' }, 'a declined request leaves the day as it was')
})

test('Today is the calendar and the rota is the grid (no drag pool, no desk timeline)', () => {
  const src = readFileSync(new URL('./screens/Team.jsx', import.meta.url), 'utf8')
  assert.match(src, /function TeamCalendar/)
  assert.match(src, /<DayBox/)
  assert.match(src, /className="adm-rt"/)
  assert.match(src, /role="radiogroup" aria-label="Show a VA"/)
  assert.doesNotMatch(src, /draggable|adm-tl-|function Desk\b/)
})
