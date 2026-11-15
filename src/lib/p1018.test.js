// P1018 — Messages kinds for admins, and the Connect checklist rules.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { toThreads, threadKey } from './admReal.js'
import { CONNECT_STEPS, checkValue, doneOf, progressOf, heardAnswer, makePassword, SECRET } from '../adminshell/connectSteps.js'

const ME = 'a0000000-0000-4000-8000-00000000000a'
const JO = 'a0000000-0000-4000-8000-00000000000b'
const AG = 'a0000000-0000-4000-8000-0000000000c1'
const V1 = 'a0000000-0000-4000-8000-0000000000f1'
const V2 = 'a0000000-0000-4000-8000-0000000000f2'
const NOW = Date.parse('2026-11-15T20:00:00Z')

test('admin sees every kind of conversation, with real names', () => {
  const t = toThreads([
    { agent_id: AG, peer_key: 'admin', agent_name: 'Dana Walker', agent_role: 'agent', unread_count: 1 },
    { agent_id: ME, peer_id: JO, peer_key: JO, agent_name: 'Brayden', peer_name: 'Jordan McNutt', agent_role: 'admin' },
    { agent_id: V1, peer_id: V2, peer_key: V2, agent_name: 'Ana', peer_name: 'Leo', agent_role: 'fulfillment' },
    { agent_id: AG, peer_id: V1, peer_key: V1, agent_name: 'Dana Walker', peer_name: 'Ana', agent_role: 'agent' },
  ], [
    { id: 'm1', agent_id: AG, peer_key: 'admin', sender_id: JO, sender_name: 'Jordan McNutt', sender_role: 'admin', body: 'Hi Dana', created_at: '2026-11-15T19:00:00Z' },
    { id: 'm2', agent_id: ME, peer_key: JO, sender_id: JO, sender_name: 'Jordan McNutt', sender_role: 'admin', body: 'Hey', created_at: '2026-11-15T19:01:00Z' },
  ], ME, NOW, { clientThreads: [{ policy_id: 'p1', client_first_name: 'Gloria', client_last_name: 'Santos', agent_id: AG, agent_name: 'Dana Walker', fulfillment_name: 'Ana' }],
    clientMsgs: [{ id: 'c1', policy_id: 'p1', sender_id: V1, sender_name: 'Ana', body: 'Booked', created_at: '2026-11-15T19:02:00Z' }] })
  assert.deepEqual(t.map(x => x.role || 'support'), ['support', 'Admin', 'VAs', 'Client'], 'never an agent-VA line')
  assert.equal(t[0].messages[0].from, 'team', 'another admin on a Support line')
  assert.equal(t[0].messages[0].who, 'Jordan McNutt')
  assert.equal(t[1].who, JO)
  assert.equal(t[1].messages[0].from, 'them')
  assert.equal(t[2].readOnly, true)
  assert.equal(t[2].agentName, 'Ana & Leo')
  assert.equal(t[3].id, 'pm:p1')
  assert.equal(t[3].agentName, 'Gloria Santos')
  assert.equal(t[3].agent, 'Dana Walker')
  assert.deepEqual(threadKey(`${ME}.${JO}`), { agentId: ME, peerKey: JO })
  assert.deepEqual(threadKey(`${AG}.admin`), { agentId: AG, peerKey: 'admin' })
})

test('Connect: every step required, values checked, progress counted', () => {
  assert.equal(CONNECT_STEPS.length, 9)
  for (const s of CONNECT_STEPS) {
    assert.ok(s.what && s.why && s.where && s.how.length >= 3 && s.test, s.key)
    assert.ok(!/optional/i.test(JSON.stringify(s)), `${s.key} says optional`)
  }
  const step = k => CONNECT_STEPS.find(s => s.key === k)
  assert.equal(checkValue(step('location'), 'abc'), 'That doesn\'t look like a location ID: letters and numbers only, 6 to 64 of them.')
  assert.equal(checkValue(step('location'), 've9EPM428h8vShlRW1KT'), '')
  assert.match(checkValue(step('control'), 'https://example.com/x'), /must start/)
  assert.equal(checkValue(step('control'), 'https://services.leadconnectorhq.com/hooks/abc/webhook-trigger/xyz'), '')
  assert.equal(checkValue(step('noAnswer'), 'not an id!'), 'That doesn\'t look like a workflow ID: letters, numbers and dashes only (the part after /workflow/).')
  const pw = makePassword()
  assert.equal(pw.length, 40)
  assert.equal(checkValue(step('hook'), pw), '')
  const empty = progressOf({})
  assert.deepEqual(empty, { done: 0, total: 9, next: 'location' })
  const half = { settings: { location_id: 'x1y2z3', workflow_no_answer: 'wf-1' }, secrets: new Set([SECRET.key, SECRET.hook]), heard: { leads: 0 } }
  assert.equal(progressOf(half).done, 4)
  assert.equal(progressOf(half).next, 'leads')
  const all = { settings: { location_id: 'x', workflow_no_answer: 'a', workflow_appointment_reminder: 'b' }, secrets: new Set(Object.values(SECRET)), heard: { leads: 2, campaigns: 1, reply_at: 'x' } }
  assert.equal(progressOf(all).done, 9)
  assert.equal(doneOf(step('replies'), { heard: { opt_out_at: 'x' } }), true)
  assert.match(heardAnswer(step('leads'), { leads: 0, bridge_on: false }).message, /Brayden turns the GoHighLevel connection on/)
  assert.equal(heardAnswer(step('leads'), { leads: 3, lead_at: '2026-11-15T19:00:00Z' }).ok, true)
})
