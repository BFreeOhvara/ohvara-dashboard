import { test } from 'node:test'
import assert from 'node:assert/strict'
import { FUL, FUL_TABS, FUL_ROUTES, OLD_CALLS, fp, fulPageOf, fulTitleOf } from '../template/ful/paths.js'
import { readFileSync } from 'node:fs'
import { whenOf, minutesOf, WEEKS, atVa, teamOn, busyOf, pickVa } from '../template/ful/data.js'

// P846 — Calls became Schedule. P918 — booked calls are the Calendar; Schedule is the VA's own hours. Six tabs, no Servicing.
test('six VA tabs: Overview, Calendar, Clients, Schedule, Pay, Training', () => {
  assert.deepEqual(FUL_TABS.map(([, label]) => label), ['Overview', 'Calendar', 'Clients', 'Schedule', 'Pay']) // P931: Training on the rail only
  assert.equal(FUL_TABS.some(([k]) => k === 'calls' || k === 'servicing'), false)
  assert.equal(FUL.calendar, '/fulfillment/calendar')
  assert.equal(FUL.schedule, '/fulfillment/schedule')
  assert.deepEqual(fulTitleOf('calendar'), ['Your booked calls', 'Calendar'])
  assert.deepEqual(fulTitleOf('schedule'), ['Your hours', 'Schedule'])
  assert.ok(FUL_ROUTES.some(([k, p]) => k === 'calendar' && p === '/fulfillment/calendar/:id'))
})

test('the old Calls, Schedule and Servicing call addresses land on the Calendar', () => {
  assert.equal(OLD_CALLS, '/fulfillment/desk')
  assert.equal(fulPageOf('/fulfillment/desk'), 'calendar')
  assert.equal(fulPageOf('/fulfillment/desk/cl-8'), 'calendar')
  assert.equal(fulPageOf('/fulfillment/schedule/cl-8'), 'calendar')
  assert.equal(fulPageOf('/fulfillment/servicing/vq-1'), 'calendar')
  assert.equal(fulPageOf('/fulfillment/schedule'), 'schedule')
  assert.equal(fp('calendar', 'vq-1'), '/fulfillment/calendar/vq-1')
})

test('a time text lands on the calendar', () => {
  assert.deepEqual(whenOf('Today, 1:45 PM'), { day: 5, time: '1:45 PM' })
  assert.deepEqual(whenOf('Fri, 10:00 AM'), { day: 6, time: '10:00 AM' })
  assert.deepEqual(whenOf('Thu, Nov 5, 2:30 PM'), { day: 5, time: '2:30 PM' })
  assert.deepEqual(whenOf('Mon, Nov 9, 10:00 AM'), { day: 9, time: '10:00 AM' })
  assert.equal(whenOf('soon'), null)
  assert.equal(minutesOf('8:00 AM'), 480)
  assert.equal(minutesOf('12:15 PM'), 735)
  assert.equal(minutesOf('6:00 PM'), 1080)
})

test('two weeks of rota', () => {
  assert.deepEqual(WEEKS, [[2, 3, 4, 5, 6], [9, 10, 11, 12, 13]])
})

// P854: one week view with a day you click open (no Week/Day toggle), and calls stored as one instant.
test('the Week/Day toggle is gone; a day opens from the URL', () => {
  for (const f of ['../template/ful/screens/Calendar.jsx', '../template/screens/Calendar.jsx']) {
    const src = readFileSync(new URL(f, import.meta.url), 'utf8')
    assert.doesNotMatch(src, /label="View"|'Week' \}, \{ key: 'day'/, `${f} still has the Week/Day toggle`)
    assert.match(src, /useOpenDay\(/, `${f} does not open a day from ?day=`)
    assert.match(src, /<DayBox /, `${f} has no day box`)
  }
})

test('sample calls are instants on the team clock', () => {
  assert.equal(atVa(5, '2:00 PM'), '2026-11-05T20:00:00.000Z') // CST, after Nov 1
  assert.equal(atVa(2, '8:00 AM'), '2026-11-02T14:00:00.000Z')
  assert.deepEqual(busyOf([{ id: 'a', day: 5, time: '9:00 AM' }, { id: 'b', day: 5, time: '9:30 AM', status: 'passed' }]).map(k => k.id), ['a'])
})

test('the usual VA first, then another free VA', () => {
  const iso = atVa(6, '10:00 AM')
  assert.ok(teamOn(iso).length > 0, 'nobody on the Fri rota')
  const mine = [{ id: 'm', day: 6, time: '10:00 AM', va_id: 'va-maya' }]
  const v = pickVa(6, '10:00 AM', mine)
  assert.notEqual(v.id, 'va-maya', 'Maya already has a call at 10:00 AM')
})
