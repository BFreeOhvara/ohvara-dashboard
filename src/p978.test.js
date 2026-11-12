import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resultsFor } from './template/agentView.js'
import { seedEvents, SAMPLE_NOW } from './template/leadLifecycle.js'
import { dragResults, canDrag, laneResults, DRAG_REFUSED } from './template/leadDrag.js'

// P978 — drag a lead waiting for its result onto its result's column: only then, only onto the results its Mark result
// menu offers. The phone app has no drag.
const mk = (id, stage, o = {}) => {
  const l = { id, first_name: 'Ann', last_name: 'Test', phone: '(919) 555-0164', city: 'Raleigh', state: 'NC', kind: 'appointment', status: 'assigned', outcome: null, stage, came: '2026-10-30T10:00', ...o }
  return { ...l, events: seedEvents(l) }
}
const NOW = SAMPLE_NOW
const past = mk('p', 'booked', { apptAt: '2026-11-02T11:00' }) // the time has passed, no result: shows Mark result
const future = mk('f', 'booked', { apptAt: '2026-12-30T11:00' })
const live = mk('l', 'showed', { kind: 'live_call', apptAt: null })

test('a lead waiting for its result can be picked up, nothing else', () => {
  assert.ok(canDrag(past, NOW), 'a booked time that has passed')
  assert.ok(canDrag(live, NOW), 'a live call the agent took')
  assert.ok(!canDrag(future, NOW), 'a Booked lead in the future')
  assert.ok(!canDrag(mk('r', 'ringing', { kind: 'live_call' }), NOW), 'a transfer still ringing')
  for (const stage of ['no_show', 'follow_up', 'not_interested', 'sold', 'unreachable', 'opted_out', 'calling']) assert.ok(!canDrag(mk(stage, stage), NOW), stage)
})

test('the columns that take the drop are exactly the Mark result choices', () => {
  assert.deepEqual(dragResults(past, NOW), resultsFor(past))
  assert.deepEqual(Object.keys(laneResults(past, NOW)).sort(), ['follow', 'no_show', 'not_interested', 'sold'])
  // A live call happened, so No show is refused (and Booked is never a drop).
  assert.deepEqual(Object.keys(laneResults(live, NOW)).sort(), ['follow', 'not_interested', 'sold'])
  assert.equal(laneResults(past, NOW).follow, 'follow_up')
  assert.equal(laneResults(live, NOW).no_show, undefined)
  assert.equal(laneResults(past, NOW).booked, undefined)
  assert.equal(DRAG_REFUSED, 'Use Mark result for this one')
})

test('a drop opens the Mark result prompt on that result, the phone app does not drag', () => {
  const leads = readFileSync(new URL('./template/screens/Leads.jsx', import.meta.url), 'utf8')
  assert.match(leads, /<OutcomePrompt lead=\{askedLead\} start=\{asked\.start\}/)
  assert.match(leads, /useResultDrag\(/)
  const drag = readFileSync(new URL('./template/ResultDrag.jsx', import.meta.url), 'utf8')
  assert.match(drag, /pointerType !== 'mouse' && e\.pointerType !== 'pen'/, 'mouse and pen only')
  assert.match(drag, /key === 'Escape'/, 'Escape cancels')
  for (const f of ['m/MLeads.jsx', 'm/MLead.jsx']) {
    let src
    try { src = readFileSync(new URL(`./template/${f}`, import.meta.url), 'utf8') } catch { continue }
    assert.doesNotMatch(src, /ResultDrag|leadDrag/, `${f} has no drag`)
  }
})
