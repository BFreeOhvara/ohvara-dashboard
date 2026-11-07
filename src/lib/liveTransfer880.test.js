// P880 — the live transfer's client logic: the agent's view of every state, late answers, push buttons / Android
// links, the timer from the server's clock, and the Setup push test's fix steps.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { agentView, answerWords, pushAction, transferLink, secondsLeft, statusNow, skewOf, testState, TEST_FIX } from './liveTransfer.js'

const T = Date.parse('2026-11-07T15:00:00Z')
const row = over => ({ id: 'c1', status: 'sent', summary: { name: 'Rosa Diaz', age: 64, state: 'TX', need: 'Final expense' }, sent_at: new Date(T).toISOString(), expires_at: new Date(T + 30000).toISOString(), ...over })

test('the agent sees name, age, state, need and a server-timed countdown; Your client is tagged', () => {
  const v = agentView(row(), 0, T + 4200)
  assert.equal(v.mode, 'ask')
  assert.equal(v.title, 'Rosa Diaz')
  assert.equal(v.line, '64 · TX · Final expense')
  assert.equal(v.left, 26)
  assert.equal(agentView(row({ summary: { name: 'Al', your_client: true } }), 0, T).title, 'Your client · Al')
  // This phone's clock is 5 s behind the server: the countdown still matches the server.
  assert.equal(secondsLeft(row(), 5000, T), 25)
  assert.equal(skewOf(new Date(T + 5000).toISOString(), T), 5000)
})

test('every state has its line; the 30 s passing reads Missed even before the sweep', () => {
  assert.equal(statusNow(row(), 0, T + 30001), 'no_answer')
  const say = (st, over) => agentView(row({ status: st, ...over }), 0, T + 31000)
  assert.equal(say('sent').mode, 'over')
  assert.match(say('sent').words, /Missed/)
  assert.equal(say('yes').mode, 'yes')
  assert.match(say('ringing', { ring_started_at: new Date(T + 25000).toISOString() }).words, /press 1/)
  assert.equal(say('ringing', { ring_started_at: new Date(T + 25000).toISOString() }).left, 14)
  assert.equal(say('connected').mode, 'connected')
  assert.match(say('booked', { booked_for: '2026-11-07T19:30:00Z' }).words, /Already booked for/)
  assert.match(say('cancelled').words, /No longer available/)
  assert.match(say('bounced').words, /went back to the VA/)
  assert.match(say('withdrawn').words, /took it back/)
})

test('late and second answers say what happened', () => {
  assert.match(answerWords({ ok: false, code: 'already_booked', booked_for: '2026-11-07T19:30:00Z' }), /Already booked for/)
  assert.equal(answerWords({ ok: false, code: 'gone' }), 'No longer available.')
  assert.match(answerWords({ ok: true, late: true, check: { status: 'late_yes' } }), /Late Yes/)
  assert.match(answerWords({ ok: true, already: true }), /other phone/)
  assert.equal(answerWords({ ok: true, check: { status: 'yes' } }), null)
})

test('push buttons (iOS actionId) and Android links become { check, answer }', () => {
  const n = id => ({ actionId: id, notification: { data: { type: 'transfer_check', check_id: 'c1' } } })
  assert.deepEqual(pushAction(n('YES')), { check: 'c1', answer: 'yes', device: null })
  assert.equal(pushAction(n('NO')).answer, 'no')
  assert.equal(pushAction(n('tap')).answer, null)
  assert.equal(pushAction({ actionId: 'tap', notification: { data: { type: 'message' } } }), null)
  assert.deepEqual(transferLink('ohvara://transfer?check=c1&answer=yes'), { check: 'c1', answer: 'yes' })
  assert.deepEqual(transferLink('ohvara://transfer?check=c1'), { check: 'c1', answer: null })
  assert.equal(transferLink('ohvara://transfer?check=c1&answer=maybe').answer, null)
  assert.equal(transferLink('https://evil.example/transfer?check=c1'), null)
})

test('Setup push test: ready, not tested, each failure with its fix, push passed while calling is off', () => {
  assert.equal(testState({ reach: { ready: true } }).label, 'Ready')
  assert.equal(testState({}).label, 'Not tested')
  assert.equal(testState({ reach: { ready: false, reason: 'no_device' } }).fix, TEST_FIX.no_device)
  assert.equal(testState({ reach: { ready: false, reason: 'notifications_off' } }).fix, TEST_FIX.denied)
  assert.equal(testState({ readiness: { fail_reason: 'call_no_answer' } }).fix, TEST_FIX.call_no_answer)
  const v = testState({ readiness: { push_ok_at: 'x', fail_reason: 'voice_off' } })
  assert.equal(v.label, 'Push passed')
  assert.match(v.fix.steps[0], /calling is switched on/)
  assert.equal(testState({ running: row() }).label, 'Testing')
  for (const f of Object.values(TEST_FIX)) assert.ok(f.title && f.steps.length)
})
