import test from 'node:test'
import assert from 'node:assert/strict'
import {
  bucketCounts, bucketRows, checklistProgress, isChecklistComplete, startingChecklist, countdown, secondsLeft,
  timeSince, lostRace, heldRow, callbackOk, rowMeta,
} from './vaQueue.js'

const NOW = Date.parse('2026-10-28T20:00:00Z')
const ago = m => new Date(NOW - m * 60e3).toISOString()
const rows = [
  { lead_id: 'n1', bucket: 'new', created_at: ago(120) },
  { lead_id: 'n2', bucket: 'new', created_at: ago(10) },
  { lead_id: 'r1', bucket: 'not_reached', created_at: ago(300), va_attempts: 2 },
  { lead_id: 'c2', bucket: 'callback_due', created_at: ago(900), va_callback_at: ago(5) },
  { lead_id: 'c1', bucket: 'callback_due', created_at: ago(900), va_callback_at: ago(20) },
]

test('counts per section', () => {
  assert.deepEqual(bucketCounts(rows), { callback_due: 2, new: 2, not_reached: 1 })
  assert.deepEqual(bucketCounts([]), { callback_due: 0, new: 0, not_reached: 0 })
})

test('sections are sorted: callbacks by due time, others newest first', () => {
  const g = bucketRows(rows)
  assert.deepEqual(g.callback_due.map(r => r.lead_id), ['c1', 'c2'])
  assert.deepEqual(g.new.map(r => r.lead_id), ['n2', 'n1'])
})

test('checklist unlocks only at 4 of 4', () => {
  const full = { question_type: 'Claim', carrier: 'Carrier A', state: 'TX', urgency: 'Today' }
  assert.equal(isChecklistComplete(full), true)
  assert.deepEqual(checklistProgress(full), { done: 4, total: 4, complete: true })
  for (const k of Object.keys(full)) {
    const three = { ...full, [k]: '' }
    assert.equal(checklistProgress(three).done, 3)
    assert.equal(isChecklistComplete(three), false)
  }
  assert.equal(isChecklistComplete({ ...full, urgency: 'Whenever' }), false)
  assert.equal(isChecklistComplete({ ...full, state: 'Texas' }), false)
  assert.equal(isChecklistComplete(null), false)
})

test('starting checklist: state from the lead, then server, then draft', () => {
  const row = { state: 'tx', va_checklist: { carrier: 'A', urgency: 'Today' } }
  assert.deepEqual(startingChecklist(row, { urgency: 'This week' }), { question_type: '', carrier: 'A', state: 'TX', urgency: 'This week' })
})

test('hold clock and errors', () => {
  const end = new Date(NOW + 872e3).toISOString()
  assert.equal(secondsLeft(end, NOW), 872)
  assert.equal(countdown(872), '14:32')
  assert.equal(secondsLeft(ago(1), NOW), 0)
  assert.equal(lostRace({ code: '55006' }), true)
  assert.equal(lostRace({ code: '22023' }), false)
  assert.equal(heldRow([{ claimed_by_me: true, claim_expires_at: ago(1) }], NOW), null)
  assert.equal(heldRow([{ lead_id: 'x', claimed_by_me: true, claim_expires_at: end }], NOW).lead_id, 'x')
})

test('labels', () => {
  assert.equal(timeSince(ago(12), NOW), '12 min ago')
  assert.equal(timeSince(ago(30 * 60), NOW), 'Yesterday')
  assert.equal(rowMeta({ state: 'TX', lead_type: 'policy_help', created_at: ago(300), bucket: 'not_reached', va_attempts: 1 }, NOW), 'TX · Policy help · 5 h ago · 1 try')
  assert.equal(callbackOk(new Date(NOW + 3600e3), NOW), true)
  assert.equal(callbackOk(new Date(NOW - 1), NOW), false)
  assert.equal(callbackOk(new Date(NOW + 91 * 864e5), NOW), false)
})
