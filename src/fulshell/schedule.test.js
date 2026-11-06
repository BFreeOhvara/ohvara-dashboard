import { test } from 'node:test'
import assert from 'node:assert/strict'
import { FUL, FUL_TABS, FUL_ROUTES, OLD_CALLS, fp, fulPageOf, fulTitleOf } from '../template/ful/paths.js'
import { whenOf, minutesOf, WEEKS } from '../template/ful/data.js'

// P846 — Calls became Schedule.
test('Schedule is a tab and Calls is gone', () => {
  assert.ok(FUL_TABS.some(([k, label]) => k === 'schedule' && label === 'Schedule'))
  assert.equal(FUL_TABS.some(([k]) => k === 'calls'), false)
  assert.equal(FUL.schedule, '/fulfillment/schedule')
  assert.deepEqual(fulTitleOf('schedule'), ['Your week', 'Schedule'])
  assert.ok(FUL_ROUTES.some(([k, p]) => k === 'schedule' && p === '/fulfillment/schedule/:id'))
})

test('the old Calls address and its drawers land on the Schedule page', () => {
  assert.equal(OLD_CALLS, '/fulfillment/desk')
  assert.equal(fulPageOf('/fulfillment/desk'), 'schedule')
  assert.equal(fulPageOf('/fulfillment/desk/cl-8'), 'schedule')
  assert.equal(fulPageOf('/fulfillment/schedule/cl-8'), 'schedule')
  assert.equal(fp('schedule', 'vq-1'), '/fulfillment/schedule/vq-1')
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
