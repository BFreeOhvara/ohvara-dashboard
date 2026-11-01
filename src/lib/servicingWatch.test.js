// The one-watch-per-policy read (src/lib/servicingWatch.js). It fails if a policy's 12 monthly watch rows
// reach the Clients pages as more than one step, or if today's single-row data changes.
// Run: npm run test:unit   (or: node --test src/lib/servicingWatch.test.js)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { oneWatchPerPolicy, watchProgress } from './servicingWatch.js'

const DAY = 864e5
const CREATED = Date.parse('2026-11-01T15:00:00Z')
const at = n => new Date(CREATED + n * DAY).toISOString()

// 12 monthly rows for one owner, month m due 30 days x m after created_at.
const twelve = (owner, prefix) => Array.from({ length: 12 }, (_, i) => ({
  id: `${prefix}${i + 1}`, kind: 'chargeback_watch', status: 'requested',
  created_at: at(0), due_at: at(30 * (i + 1)), ...owner,
}))
const one = (id, owner, extra = {}) => ({ id, kind: 'chargeback_watch', status: 'requested', created_at: at(0), due_at: at(365), ...owner, ...extra })

test('12 rows for a policy give 1 row with the month 12 due date', () => {
  const kept = oneWatchPerPolicy(twelve({ policy_id: 'p1', lead_id: 'l1' }, 'w'))
  assert.equal(kept.length, 1)
  assert.equal(kept[0].id, 'w12')
  assert.equal(kept[0].due_at, at(360))
})

test('the order the rows arrive in does not change which one is kept', () => {
  const kept = oneWatchPerPolicy(twelve({ policy_id: 'p1' }, 'w').reverse())
  assert.deepEqual(kept.map(t => t.id), ['w12'])
})

test('a client with two policies, one watch each, keeps both rows unchanged', () => {
  const rows = [one('a', { policy_id: 'p1', lead_id: 'l1' }), one('b', { policy_id: 'p2', lead_id: 'l1' })]
  assert.deepEqual(oneWatchPerPolicy(rows), rows)
})

test('two policies with 12 rows each keep one each', () => {
  const rows = [...twelve({ policy_id: 'p1', lead_id: 'l1' }, 'a'), ...twelve({ policy_id: 'p2', lead_id: 'l1' }, 'b')]
  assert.deepEqual(oneWatchPerPolicy(rows).map(t => t.id), ['a12', 'b12'])
})

test('a lead-only group (no policy yet) keys on lead_id', () => {
  const rows = [...twelve({ policy_id: null, lead_id: 'l9' }, 'x'), one('y', { policy_id: null, lead_id: 'l8' })]
  assert.deepEqual(oneWatchPerPolicy(rows).map(t => t.id), ['x12', 'y'])
})

test('other kinds are untouched and the original order is kept', () => {
  const rows = [
    { id: 'r1', kind: 'review_call', policy_id: 'p1', due_at: at(10) },
    ...twelve({ policy_id: 'p1' }, 'w').slice(0, 3),
    { id: 'r2', kind: 'review_call', policy_id: 'p1', due_at: at(20) },
    { id: 'c1', kind: 'lapse_save', policy_id: 'p1', due_at: null },
    ...twelve({ policy_id: 'p1' }, 'w').slice(3),
  ]
  assert.deepEqual(oneWatchPerPolicy(rows).map(t => t.id), ['r1', 'r2', 'c1', 'w12'])
})

test('a null due_at counts as earliest', () => {
  const rows = [one('late', { policy_id: 'p1' }, { due_at: at(30) }), one('none', { policy_id: 'p1' }, { due_at: null })]
  assert.deepEqual(oneWatchPerPolicy(rows).map(t => t.id), ['late'])
  assert.deepEqual(oneWatchPerPolicy([...rows].reverse()).map(t => t.id), ['late'])
})

test('a single old row, and no rows at all, come back the same', () => {
  const rows = [one('old', { policy_id: 'p1', lead_id: 'l1' }), { id: 'r', kind: 'packet_check', policy_id: 'p1' }]
  assert.deepEqual(oneWatchPerPolicy(rows), rows)
  assert.deepEqual(oneWatchPerPolicy([]), [])
  assert.deepEqual(oneWatchPerPolicy(null), [])
})

test('watchProgress on the kept row reads month 1 of 12, not done, one week after created_at', () => {
  const kept = oneWatchPerPolicy(twelve({ policy_id: 'p1' }, 'w'))[0]
  const w = watchProgress(kept, CREATED + 7 * DAY)
  assert.equal(w.month, 1)
  assert.equal(w.months, 12)
  assert.equal(w.done, false)
  assert.equal(w.end, at(360))
})
