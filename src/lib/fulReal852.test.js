import { test } from 'node:test'
import assert from 'node:assert/strict'
import { realClock, keyOf, whenText, toCall, callStatus, toQueueLead, toTask, dueOf, toThreads, toPay, toAgents, dayOf, scheduleOf, callResultRpc, feedKind } from './fulReal.js'
import { licensedIn } from '../template/ful/p879.js'

const TZ = 'America/Chicago'
const NOW = Date.parse('2026-11-07T18:00:00Z') // Sat, Nov 7, 12:00 PM Central

test('real clock: today, this week and next (Mon-Fri), booking days skip the weekend, across a month end', () => {
  const c = realClock(NOW, TZ)
  assert.equal(c.today, 20261107)
  assert.deepEqual(c.weeks[0], [20261102, 20261103, 20261104, 20261105, 20261106])
  assert.deepEqual(c.weeks[1], [20261109, 20261110, 20261111, 20261112, 20261113])
  assert.deepEqual(c.bookDays.map(d => d[1]), [20261109, 20261110, 20261111, 20261112, 20261113])
  assert.equal(c.dateText(20261109), 'Nov 9'); assert.equal(c.dayName(20261109), 'Mon'); assert.equal(c.dayNum(20261109), 9)
  const dec = realClock(Date.parse('2026-11-30T16:00:00Z'), TZ)
  assert.deepEqual(dec.weeks[0], [20261130, 20261201, 20261202, 20261203, 20261204])
  assert.ok(dec.weeks[0][1] > dec.today, 'Dec 1 sorts after Nov 30')
})

test('keys and time words follow the VA zone, not UTC', () => {
  assert.equal(keyOf('2026-11-08T03:00:00Z', TZ), 20261107) // 9 PM Saturday in Chicago
  assert.equal(whenText('2026-11-07T20:30:00Z', NOW, TZ), 'Today, 2:30 PM')
  assert.equal(whenText('2026-11-09T15:00:00Z', NOW, TZ), 'Mon, 9:00 AM')
})

const pol = o => ({
  id: 'p1', agent_id: 'a1', agent: { full_name: 'Dana Walker' }, client_first_name: 'Gloria', client_last_name: 'Santos', client_phone: '3055550156',
  state: 'FL', client_city: 'Miami', carrier_name: 'Americo', product_name: 'MP 25', monthly_premium: '88.40', fulfillment_stage: 'Pending',
  scheduled_call_at: '2026-11-09T19:00:00Z', current_carrier: 'Globe Life', created_at: '2026-11-01T12:00:00Z', ...o,
})

test('a policy assigned to the VA is a cancellation call with the sample call shape', () => {
  const k = toCall(pol(), NOW, TZ)
  assert.equal(k.status, 'booked'); assert.equal(k.day, 20261109); assert.equal(k.time, '1:00 PM'); assert.equal(k.name, 'Gloria Santos')
  assert.equal(k.old_carrier, 'Globe Life'); assert.equal(k.agent, 'Dana Walker'); assert.equal(k.tz, 'America/New_York'); assert.match(k.when, /client 2:00 PM/)
  assert.equal(k.client.monthly_premium, 88.4)
  assert.equal(callStatus(pol({ fulfillment_stage: 'Complete' })), 'cancelled')
  assert.equal(callStatus(pol({ last_call_outcome: 'no_answer', last_call_at: '2026-11-06T15:00:00Z', scheduled_call_at: '2026-11-05T15:00:00Z' })), 'no_answer')
  // a retry booked after the no answer is a call to make again
  assert.equal(callStatus(pol({ last_call_outcome: 'no_answer', last_call_at: '2026-11-06T15:00:00Z' })), 'booked')
})

test('va_queue rows become queue people; a claim only counts while it lasts', () => {
  const r = { lead_id: 'l1', contact_name: ' Angela Moore ', phone: '2105550147', city: 'San Antonio', state: 'TX', lead_type: 'mortgage_protection', bucket: 'callback_due', va_attempts: 1, va_callback_at: '2026-11-07T19:45:00Z', claimed_by_me: true, claim_expires_at: '2026-11-07T18:10:00Z', created_at: '2026-11-07T15:00:00Z', va_checklist: { carrier: 'Globe Life' } }
  const l = toQueueLead(r, NOW, TZ, 'me')
  assert.equal(l.name, 'Angela Moore'); assert.equal(l.type, 'Mortgage protection'); assert.equal(l.callback, 'Today, 1:45 PM'); assert.equal(l.checklist.carrier, 'Globe Life'); assert.equal(l.checklist.state, '')
  assert.equal(l.held_until, Date.parse('2026-11-07T18:10:00Z'))
  assert.equal(toQueueLead({ ...r, claim_expires_at: '2026-11-07T17:00:00Z' }, NOW, TZ).held_until, null)
})

test('servicing rows: due bucket on the VA clock, the agent reply joins the note', () => {
  const r = { task_id: 't1', policy_id: 'p1', kind: 'payment_change', status: 'requested', due_at: '2026-11-06T15:00:00Z', client_name: 'Luis Ortega', client_state: 'FL', carrier: 'Transamerica', agent_name: 'Priya Shah', mine: false, note: 'Draft failed', agent_reply_note: 'Try after 4' }
  const t = toTask(r, NOW, TZ)
  assert.equal(t.due, 'overdue'); assert.equal(t.client.client_first_name, 'Luis'); assert.equal(t.agent, 'Priya Shah'); assert.match(t.note, /Agent: Try after 4/)
  assert.equal(dueOf({ ...r, due_at: '2026-11-07T22:00:00Z' }, NOW, TZ), 'today')
  assert.equal(dueOf({ ...r, due_at: null }, NOW, TZ), 'none')
  assert.equal(dueOf({ ...r, status: 'done' }, NOW, TZ), 'done')
})

test('threads: mine vs the agent, oldest message first, newest thread first', () => {
  const th = toThreads(
    [{ policy_id: 'p1', client_first_name: 'Gloria', client_last_name: 'Santos', agent_id: 'a1', agent_name: 'Dana', unread_count: 2, last_at: '2026-11-07T10:00:00Z' }, { policy_id: 'p2', client_first_name: 'Luis', client_last_name: 'O', agent_name: 'Priya', unread_count: 0, last_at: '2026-11-07T12:00:00Z' }],
    [{ id: 'm2', policy_id: 'p1', sender_id: 'me', body: 'Yes', created_at: '2026-11-07T10:00:00Z' }, { id: 'm1', policy_id: 'p1', sender_id: 'a1', body: 'Can you?', created_at: '2026-11-07T09:00:00Z' }],
    'me', NOW, TZ)
  assert.deepEqual(th.map(t => t.id), ['p2', 'p1'])
  assert.deepEqual(th[1].messages.map(m => [m.from, m.text]), [['agent', 'Can you?'], ['me', 'Yes']])
})

test('pay: the live rate, this week only, no bank says so', () => {
  const p = toPay({ cancels: [{ id: 'c1', client_name: 'Tom', logged_at: '2026-11-04T16:00:00Z', amount_cents: 1000, status: 'verified' }, { id: 'c2', logged_at: '2026-10-20T16:00:00Z', amount_cents: 1000, status: 'verified' }, { id: 'c3', logged_at: '2026-11-05T16:00:00Z', status: 'checking' }], payouts: [{ id: 'o1', period_start: '2026-10-26', period_end: '2026-11-01', amount_cents: 16200, status: 'paid', paid_at: '2026-11-02T15:00:00Z', cancels: 9 }], rateCents: 1000, account: null }, NOW, TZ)
  assert.equal(p.rate, 10); assert.equal(p.rows.length, 2); assert.equal(p.verified, 10); assert.equal(p.checking, 10); assert.equal(p.lastWeek, 162)
  assert.equal(p.payouts[0].week, 'Oct 26 to Nov 1'); assert.equal(p.account.status, 'Add your bank in Settings')
})

test('agents from the roster have no licence states, so a VA can never book them blind', () => {
  const [a] = toAgents([{ id: 'a1', full_name: 'Dana Walker' }], [{ agent_id: 'a1' }, { agent_id: 'a2' }])
  assert.equal(a.clients, 1); assert.equal(a.states, null); assert.equal(licensedIn(a, 'TX'), false)
})

test('the day and the schedule from real rows', () => {
  const calls = [toCall(pol({ id: 'a', scheduled_call_at: '2026-11-07T20:00:00Z' }), NOW, TZ), toCall(pol({ id: 'b', fulfillment_stage: 'Complete', fulfillment_completed_at: '2026-11-07T15:00:00Z' }), NOW, TZ), toCall(pol({ id: 'c' }), NOW, TZ)]
  const queue = [toQueueLead({ lead_id: 'l', contact_name: 'A', bucket: 'callback_due', va_callback_at: '2026-11-07T21:00:00Z', created_at: '2026-11-07T15:00:00Z' }, NOW, TZ)]
  const d = dayOf({ calls, queue, tasks: [], threads: [{ unread: 3 }] }, 20261107)
  assert.equal(d.today.length, 2); assert.equal(d.next.id, 'a'); assert.equal(d.done.length, 1); assert.equal(d.tomorrow[0].id, 'c'); assert.equal(d.unread, 3); assert.equal(d.queue.callback_due.length, 1)
  assert.deepEqual(scheduleOf({ calls, queue }, TZ).map(i => i.ref), ['b', 'a', 'l', 'c'])
})

test('writes map to the existing server functions', () => {
  assert.deepEqual(callResultRpc('p', 'no_answer'), ['fulfillment_end_call', { p_policy: 'p', p_outcome: 'no_answer', p_reason: null }])
  assert.equal(callResultRpc('p', 'cancelled', { confirmation: 'GL-1', proof: true })[1].p_confirmation, 'GL-1')
  assert.equal(callResultRpc('p', 'passed')[0], 'fulfillment_pass_on')
  assert.equal(callResultRpc('p', 'booked'), null)
  assert.equal(feedKind('fulfillment_cancel_verified'), 'pay'); assert.equal(feedKind('va_new_lead'), 'queue')
})
