import { test } from 'node:test'
import assert from 'node:assert/strict'
import { groupTasks, heldTask, outcomesOf, outcomeLabel, servicingError, dueText, toneOf } from './vaServicing.js'

const NOW = Date.parse('2026-11-04T18:00:00Z')
const iso = h => new Date(NOW + h * 3600e3).toISOString()

test('groupTasks puts your live claim first, then overdue, today, later, none', () => {
  const rows = [
    { task_id: 'a', due_at: iso(-2) },
    { task_id: 'b', due_at: iso(1) },
    { task_id: 'c', due_at: iso(30) },
    { task_id: 'd', due_at: null },
    { task_id: 'e', due_at: iso(-5), mine: true, claim_expires_at: iso(0.2) },
    { task_id: 'f', due_at: iso(-1), mine: true, claim_expires_at: iso(-0.1) },
  ]
  const g = groupTasks(rows, NOW, NOW + 4 * 3600e3)
  assert.deepEqual(g.mine.map(r => r.task_id), ['e'])
  assert.deepEqual(g.overdue.map(r => r.task_id), ['a', 'f'])
  assert.deepEqual(g.today.map(r => r.task_id), ['b'])
  assert.deepEqual(g.later.map(r => r.task_id), ['c'])
  assert.deepEqual(g.none.map(r => r.task_id), ['d'])
  assert.equal(heldTask(rows, NOW).task_id, 'e')
  assert.equal(heldTask([{ mine: true, claim_expires_at: iso(-1) }], NOW), null)
})

test('outcomes are the server lists, per kind', () => {
  assert.deepEqual(outcomesOf('lapse_save').map(o => o[0]), ['saved', 'to_agent', 'agent_booked', 'fixing', 'not_saved', 'no_answer']) // P924
  assert.deepEqual(outcomesOf('packet_check').map(o => o[0]), ['delivered', 'not_delivered'])
  assert.deepEqual(outcomesOf('annual_review').map(o => o[0]), ['completed', 'not_reached'])
  assert.deepEqual(outcomesOf('chargeback_watch').map(o => o[0]), ['on_time', 'missed'])
  assert.deepEqual(outcomesOf('address_change').map(o => o[0]), ['completed', 'could_not_complete'])
  assert.deepEqual(outcomesOf('unknown_kind').map(o => o[0]), ['completed', 'could_not_complete'])
  assert.equal(outcomeLabel('lapse_save', 'saved'), 'Saved')
  assert.equal(outcomeLabel('lapse_save', 'nope'), null)
})

test('server refusals read as plain words', () => {
  assert.match(servicingError({ code: '55006' }), /Another VA/)
  assert.match(servicingError({ code: '42501' }), /ran out/)
  assert.equal(servicingError({ code: '22023', message: 'This step is done' }), 'This step is done')
  assert.match(servicingError(new Error('x')), /Nothing changed/)
})

test('dueText and tones', () => {
  const tz = 'America/Chicago'
  assert.equal(dueText(null, NOW, tz), 'No date yet')
  assert.match(dueText(iso(1), NOW, tz), /^Due \d/)
  assert.match(dueText(iso(-1), NOW, tz), /^Overdue since \d/)
  assert.match(dueText(iso(48), NOW, tz), /^Due [A-Z][a-z]{2}, /)
  assert.equal(toneOf('lapse_save'), 'warn')
  assert.equal(toneOf('address_change'), 'teal')
  assert.equal(toneOf('review_call'), 'blue')
})
