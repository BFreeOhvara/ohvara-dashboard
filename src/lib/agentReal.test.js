import { test } from 'node:test'
import assert from 'node:assert/strict'
import { wallOf, weekOf, stageOfInbound, toLead, phoneText } from './agentReal.js'
import { resolveMode, canPreviewReal, switchReady } from './dataMode.js'

test('wallOf puts an instant on the agent clock', () => {
  assert.equal(wallOf('2026-11-07T20:05:00Z', 'America/Chicago'), '2026-11-07T14:05')
  assert.equal(wallOf('2026-11-07T20:05:00Z', 'America/New_York'), '2026-11-07T15:05')
  assert.equal(wallOf(null), null)
})

test('weekOf is Mon to Fri around today, month-aware', () => {
  const w = weekOf('2026-11-07T14:05') // a Saturday
  assert.deepEqual(w.days.map(d => d[1]), [2, 3, 4, 5, 6])
  assert.equal(w.today, null)
  assert.equal(w.time, '2:05 PM')
  const x = weekOf('2026-12-01T09:00') // Tue; the week starts Mon Nov 30
  assert.deepEqual(x.days.map(d => `${d[2]} ${d[1]}`), ['Nov 30', 'Dec 1', 'Dec 2', 'Dec 3', 'Dec 4'])
  assert.equal(x.today, 1)
})

test('stageOfInbound maps database stages to the portal stages', () => {
  assert.equal(stageOfInbound({ inbound_stage: 'new' }), 'new')
  assert.equal(stageOfInbound({ inbound_stage: 'contacting' }), 'calling')
  assert.equal(stageOfInbound({ inbound_stage: 'contacting', inbound_product: 'live_call', transfer_status: 'requested' }), 'ringing')
  assert.equal(stageOfInbound({ inbound_stage: 'contacting', inbound_product: 'live_call', live_call_result: 'missed' }), 'missed')
  assert.equal(stageOfInbound({ inbound_stage: 'booked' }), 'booked')
  assert.equal(stageOfInbound({ inbound_stage: 'met' }), 'showed')
  assert.equal(stageOfInbound({ inbound_stage: 'follow_up', outcome: 'follow_up' }), 'follow_up')
  assert.equal(stageOfInbound({ inbound_stage: 'lost', outcome: 'not_interested' }), 'not_interested')
  assert.equal(stageOfInbound({ inbound_stage: 'lost' }), 'unreachable')
  assert.equal(stageOfInbound({ inbound_stage: 'sold', outcome: 'sold' }), 'sold')
})

test('toLead builds the record the Leads screen reads', () => {
  const l = toLead({
    lead_id: 'l1', inbound_product: 'booked_appointment', inbound_stage: 'booked', contact_name: 'Dana Q Example', phone: '+15125550148', city: 'Austin', state: 'TX',
    qualifier_answers: { age_band: '45 to 54', mortgage_balance_band: '$200,000 to $300,000', best_time: 'Evenings', homeowner: 'yes' }, delivered_at: '2026-11-02T16:52:00Z', client_policy_id: null,
  }, [
    { id: 'e1', lead_id: 'l1', kind: 'came_in', state: 'done', at: '2026-11-02T16:52:00Z', label: 'Came in', actor_role: 'system' },
    { id: 'e2', lead_id: 'l1', kind: 'booked', state: 'done', at: '2026-11-02T17:10:00Z', label: 'Booked', detail: { appointment_at: '2026-11-05T21:00:00Z' }, actor_name: 'Maya', actor_role: 'va' },
    { id: 'e3', lead_id: 'l1', kind: 'note', state: 'done', at: '2026-11-02T17:11:00Z', label: 'Note', detail: { note: 'Two kids' }, actor_role: 'agent' },
  ], 'America/Chicago')
  assert.equal(l.first_name, 'Dana')
  assert.equal(l.last_name, 'Q Example')
  assert.equal(l.phone, '(512) 555-0148')
  assert.equal(l.kind, 'appointment')
  assert.equal(l.stage, 'booked')
  assert.equal(l.came, '2026-11-02T10:52')
  assert.equal(l.apptAt, '2026-11-05T15:00')
  assert.equal(l.appt, 'Thu, Nov 5, 3:00 PM')
  assert.equal(l.homeowner, true)
  assert.equal(l.note, 'Two kids')
  assert.equal(l.events.length, 2) // notes sit in the note, not the timeline
  assert.equal(l.events[1].role, 'team')
})

test('phoneText formats US numbers', () => {
  assert.equal(phoneText('+15125550148'), '(512) 555-0148')
  assert.equal(phoneText(''), '')
})

test('the sample switch: on by default, admins and test accounts can preview', () => {
  assert.equal(resolveMode({ show: undefined, view: null, canPreview: false }), 'sample')
  assert.equal(resolveMode({ show: true, view: 'real', canPreview: false }), 'sample') // an agent can't override
  assert.equal(resolveMode({ show: true, view: 'real', canPreview: true }), 'real')
  assert.equal(resolveMode({ show: false, view: null, canPreview: false }), 'real')
  assert.equal(resolveMode({ show: false, view: 'sample', canPreview: true }), 'sample')
  assert.equal(canPreviewReal({ role: 'admin', id: 'x' }), true)
  assert.equal(canPreviewReal({ role: 'agent', id: 'x' }), false)
  // P934: test agents and the test VA no longer pick a view; only admins do
  assert.equal(canPreviewReal({ role: 'agent', id: '3f2b2df7-40b1-4921-80e2-09981c819642' }), false)
  assert.equal(canPreviewReal({ role: 'fulfillment', id: '402a7a07-c9b0-428f-9b9d-ff2b6480bed0' }), false)
  assert.equal(switchReady({ id: 1 }), false)
  assert.equal(switchReady({ id: 1, show_sample_data: true }), true)
})

test('boughtOf counts the agent leads in the range: booked and transferred apart (P889)', async () => {
  const { boughtOf } = await import('./agentReal.js')
  const r = boughtOf([
    { kind: 'appointment', stage: 'booked', came: '2026-11-03T10:00' },
    { kind: 'appointment', stage: 'sold', came: '2026-11-04T10:00', submitted: { premium: 80 } },
    { kind: 'appointment', stage: 'new', came: '2026-10-20T10:00' },
    { kind: 'live_call', stage: 'showed', came: '2026-11-05T10:00' },
  ], '2026-11-02')
  assert.deepEqual([r.leads, r.reached, r.booked, r.showed, r.sold, r.premium, r.spent], [3, 3, 2, 1, 1, 80, 0])
  assert.deepEqual([r.offered, r.transferred], [1, 1])
})
