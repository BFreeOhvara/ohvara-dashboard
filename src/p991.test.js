import { test } from 'node:test'
import assert from 'node:assert/strict'
import { weekShare, weekAgo, rangeSoFar, paceOf, lastWeekWords, PROJECT_FROM } from './template/weekPace.js'
import { readFileSync } from 'node:fs'

// P991 — "Delivered this week" is judged by pace while the week runs (Nov 2026: Mon 9, Wed 11, Fri 13, Sun 15).
const RANGE = { low: 9, high: 17 }

test('Monday morning: barely any of the week gone, nothing expected yet, never behind', () => {
  const s = weekShare('2026-11-09T09:00')
  assert.ok(Math.abs(s - 9 / 168) < 1e-9)
  assert.deepEqual(rangeSoFar(RANGE, s), { low: 0, high: 1 })
  assert.equal(paceOf({ total: 0, range: RANGE, share: s }).key, 'on')
  assert.equal(paceOf({ total: 3, range: RANGE, share: s }).key, 'ahead')
  assert.equal(paceOf({ total: 0, range: RANGE, share: s }).projected, null) // too early to project
})

test('Wednesday noon: 2.5 days in, about 3 to 6 so far', () => {
  const s = weekShare('2026-11-11T12:00')
  assert.ok(Math.abs(s - 2.5 / 7) < 1e-9)
  assert.deepEqual(rangeSoFar(RANGE, s), { low: 3, high: 6 })
  assert.equal(paceOf({ total: 2, range: RANGE, share: s }).key, 'behind')
  assert.equal(paceOf({ total: 4, range: RANGE, share: s }).key, 'on')
  assert.equal(paceOf({ total: 7, range: RANGE, share: s }).key, 'ahead')
  assert.equal(paceOf({ total: 4, range: RANGE, share: s }).projected, 11)
})

test('Friday noon: the 9 to 17 week expects about 6 to 11 so far; 6 is On pace, on pace for ~9 (Brayden\'s case)', () => {
  const s = weekShare('2026-11-13T12:00')
  assert.deepEqual(rangeSoFar(RANGE, s), { low: 6, high: 11 })
  const p = paceOf({ total: 6, range: RANGE, share: s })
  assert.equal(p.key, 'on')
  assert.equal(p.word, 'On pace')
  assert.equal(p.projected, 9)
  assert.equal(paceOf({ total: 5, range: RANGE, share: s }).word, 'Behind pace')
  assert.equal(paceOf({ total: 12, range: RANGE, share: s }).word, 'Ahead of pace')
  assert.notEqual(p.word, 'Below range so far')
})

test('Sunday night: nearly the whole range expected', () => {
  const s = weekShare('2026-11-15T23:00')
  assert.ok(s > 0.99 && s < 1)
  assert.deepEqual(rangeSoFar(RANGE, s), { low: 9, high: 17 })
  assert.equal(paceOf({ total: 8, range: RANGE, share: s }).key, 'behind')
  assert.equal(paceOf({ total: 8, range: RANGE, share: s }).closed, false)
})

test('Right after the week closes: the full week is judged against the full range, as before', () => {
  assert.equal(weekShare('2026-11-15T23:59') < 1, true)
  const closed = { range: RANGE, share: 1 }
  assert.equal(paceOf({ ...closed, total: 8 }).word, 'Below range')
  assert.equal(paceOf({ ...closed, total: 12 }).word, 'In range')
  assert.equal(paceOf({ ...closed, total: 18 }).word, 'Above range')
  assert.equal(paceOf({ ...closed, total: 12 }).projected, null)
  assert.equal(paceOf({ total: 8, range: RANGE, share: 0.5, closed: true }).key, 'below')
  // and the new week starts at nothing expected: Monday 12:05 AM is pace again
  const fresh = paceOf({ total: 0, range: RANGE, share: weekShare('2026-11-16T00:05') })
  assert.equal(fresh.closed, false)
  assert.equal(fresh.key, 'on')
})

test('projection starts two days in; same point last week', () => {
  assert.equal(paceOf({ total: 4, range: RANGE, share: PROJECT_FROM - 0.01 }).projected, null)
  assert.equal(paceOf({ total: 4, range: RANGE, share: PROJECT_FROM }).projected, 14)
  assert.equal(weekAgo('2026-11-13T12:00'), '2026-11-06T12:00')
  assert.equal(weekAgo('2026-11-02T09:30'), '2026-10-26T09:30')
  assert.equal(lastWeekWords(5, 12), '5 by this time last week · 12 by the end')
  assert.equal(lastWeekWords(5, 12, true), '12 last week')
  assert.equal(lastWeekWords(null, null), '')
})

test('the Overview never says "Below range so far" again', () => {
  const src = readFileSync(new URL('./template/screens/Overview.jsx', import.meta.url), 'utf8')
  assert.equal(src.includes('Below range so far'), false)
})
