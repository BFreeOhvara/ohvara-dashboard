/**
 * Unit tests for help-transfer (Roadmap Goal 9), with a mocked Twilio REST
 * client and an in-memory help_calls store. No real calls.
 * Run: deno test --node-modules-dir=none supabase/functions/help-transfer
 *  or: node --test supabase/functions/help-transfer/core.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { act, handle, type OnDutyAgent, type Store, type Twilio } from './core.ts'
import type { HelpCall } from '../help-voice/core.ts'

const VA = '11111111-1111-4111-8111-111111111111'
const OTHER_VA = '22222222-2222-4222-8222-222222222222'
const ADMIN = '33333333-3333-4333-8333-333333333333'
const AGENT = '44444444-4444-4444-8444-444444444444'
const OTHER_AGENT = '55555555-5555-4555-8555-555555555555'
const ENV = { from: '+15125550199', voiceUrl: 'https://x.supabase.co/functions/v1/help-voice', configured: true }

const live = (over: Partial<HelpCall> = {}): HelpCall => ({
  call_sid: 'CA123', caller_number: '+15125550100', tracking_number: '+15125550199', conference_sid: 'CF1',
  va_id: VA, va_call_sid: 'CAva1', ringing_va_call_sids: ['CAva1'], status: 'live', end_reason: null,
  transfer_agent_id: null, agent_call_sid: null, outcome: null, lead_id: null, answered_at: 'then',
  transfer_started_at: null, transferred_at: null, ended_at: null, ...over,
})

function world(over: { live?: boolean; agent?: OnDutyAgent | null; row?: HelpCall | null; user?: string; active?: boolean } = {}) {
  const rows: HelpCall[] = over.row === null ? [] : [over.row ?? live()]
  const writes: any[] = []
  const calls: { method: string; path: string; params?: any }[] = []
  const roles: Record<string, string> = { [VA]: 'fulfillment', [OTHER_VA]: 'fulfillment', [ADMIN]: 'admin', [AGENT]: 'agent' }
  const store: Store = {
    async userFromJwt(jwt) { return jwt === 'good' ? (over.user ?? VA) : null },
    async caller(id) { return roles[id] ? { role: roles[id], is_active: over.active ?? true } : null },
    async voiceLive() { return over.live ?? true },
    async helpCall(sid) { const r = rows.find(x => x.call_sid === sid); return r ? { ...r } : null },
    async updateHelpCall(sid, patch, when) {
      writes.push([sid, patch])
      const r = rows.find(x => x.call_sid === sid)
      if (!r || (when && !when.includes(r.status))) return null
      Object.assign(r, patch)
      return { ...r }
    },
    async onDutyAgent() { return over.agent === undefined ? { agent_id: AGENT, phone: '(512) 555-0142' } : over.agent },
  }
  const twilio: Twilio = async (method, path, params) => {
    calls.push({ method, path, params })
    if (method === 'GET' && path.startsWith('/Conferences.json')) return { status: 200, data: { conferences: [{ sid: 'CF1' }] } }
    if (method === 'POST' && path === '/Conferences/CF1/Participants.json') return { status: 201, data: { call_sid: 'CAag1' } }
    return { status: 200, data: {} }
  }
  return { store, twilio, rows, writes, calls }
}

const req = (body: unknown, jwt?: string) => new Request('http://internal/help-transfer', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(jwt ? { Authorization: `Bearer ${jwt}` } : null) },
  body: JSON.stringify(body),
})

const posts = (calls: any[]) => calls.filter(c => c.method === 'POST')

test('1. no JWT, or a bad one: 401, nothing else happens', async () => {
  for (const jwt of [undefined, 'bad']) {
    const w = world()
    const res = await handle(req({ action: 'transfer', call_sid: 'CA123' }, jwt), w.store, w.twilio, ENV)
    assert.equal(res.status, 401)
    assert.equal(w.calls.length, 0)
    assert.equal(w.writes.length, 0)
  }
})

test('2. a VA who doesn\'t hold the call: 403, 0 Twilio calls, no writes', async () => {
  for (const action of ['transfer', 'drop', 'book']) {
    const w = world({ user: OTHER_VA })
    const res = await handle(req({ action, call_sid: 'CA123' }, 'good'), w.store, w.twilio, ENV)
    assert.equal(res.status, 403, action)
    assert.equal((await res.json()).error, 'Only the VA on this call can transfer it.')
    assert.equal(w.calls.length, 0)
    assert.equal(w.writes.length, 0)
  }
  // An agent, or the right VA with access off: 403 too.
  for (const w of [world({ user: AGENT }), world({ active: false })]) {
    assert.equal((await handle(req({ action: 'transfer', call_sid: 'CA123' }, 'good'), w.store, w.twilio, ENV)).status, 403)
    assert.equal(w.calls.length, 0)
  }
  // An admin may act on any call; an unknown call is 404.
  const a = world({ user: ADMIN })
  assert.equal((await handle(req({ action: 'transfer', call_sid: 'CA123' }, 'good'), a.store, a.twilio, ENV)).status, 200)
  const none = world({ row: null })
  assert.equal((await handle(req({ action: 'transfer', call_sid: 'CA123' }, 'good'), none.store, none.twilio, ENV)).status, 404)
})

test('3. voice_live off: 409 voice_off, 0 Twilio calls, no store writes', async () => {
  for (const action of ['transfer', 'drop', 'book']) {
    const w = world({ live: false, row: live({ status: action === 'drop' ? 'transferred' : 'live' }) })
    const res = await handle(req({ action, call_sid: 'CA123' }, 'good'), w.store, w.twilio, ENV)
    assert.equal(res.status, 409, action)
    assert.equal((await res.json()).code, 'voice_off')
    assert.equal(w.calls.length, 0)
    assert.equal(w.writes.length, 0)
  }
})

test('4. no on-duty agent: status no_answer, code no_agent, 0 Twilio calls', async () => {
  const w = world({ agent: null })
  const res = await handle(req({ action: 'transfer', call_sid: 'CA123' }, 'good'), w.store, w.twilio, ENV)
  assert.equal(res.status, 200)
  assert.deepEqual(await res.json(), { ok: false, code: 'no_agent' })
  assert.equal(w.rows[0].status, 'no_answer')
  assert.equal(w.calls.length, 0)
  // An agent whose phone isn't a real number counts as nobody.
  const bad = world({ agent: { agent_id: AGENT, phone: '12' } })
  assert.deepEqual(await act(bad.store, bad.twilio, ENV, VA, { action: 'transfer', call_sid: 'CA123' }), { ok: false, code: 'no_agent' })
  assert.equal(bad.calls.length, 0)
})

test('5. an agent on duty: exactly one Participants POST, EndConferenceOnExit false, To = the agent, status transferring', async () => {
  const w = world()
  const out = await act(w.store, w.twilio, ENV, VA, { action: 'transfer', call_sid: 'CA123' })
  assert.deepEqual(out, { ok: true, status: 'transferring' })
  assert.equal(w.calls[0].method, 'GET')
  assert.equal(w.calls[0].path, '/Conferences.json?FriendlyName=help-CA123&Status=in-progress')
  const p = posts(w.calls)
  assert.equal(p.length, 1)
  assert.equal(p[0].path, '/Conferences/CF1/Participants.json')
  assert.deepEqual(p[0].params, {
    From: '+15125550199', To: '+15125550142', Label: 'agent', Beep: 'false', EndConferenceOnExit: 'false', Timeout: '25',
    StatusCallback: 'https://x.supabase.co/functions/v1/help-voice?event=agent_leg&call=CA123', StatusCallbackMethod: 'POST',
    StatusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
  })
  const r = w.rows[0]
  assert.deepEqual([r.status, r.transfer_agent_id, r.agent_call_sid], ['transferring', AGENT, 'CAag1'])
  assert.ok(r.transfer_started_at)
  // Nothing recorded.
  assert.doesNotMatch(JSON.stringify(w.calls), /record/i)
  // A second click while it rings dials nobody else.
  w.calls.length = 0
  await assert.rejects(act(w.store, w.twilio, ENV, VA, { action: 'transfer', call_sid: 'CA123' }), /can't be transferred/)
  assert.equal(w.calls.length, 0)
  // A retry after no_answer dials again.
  const retry = world({ row: live({ status: 'no_answer' }) })
  await act(retry.store, retry.twilio, ENV, VA, { action: 'transfer', call_sid: 'CA123' })
  assert.equal(posts(retry.calls).length, 1)
  assert.equal(retry.rows[0].status, 'transferring')
})

test('5b. Twilio refuses the agent leg: 502 and the row goes back to live', async () => {
  const w = world()
  const twilio: Twilio = async (m, path, params) => path.endsWith('/Participants.json')
    ? { status: 400, data: { message: 'bad number' } } : w.twilio(m, path, params)
  const res = await handle(req({ action: 'transfer', call_sid: 'CA123' }, 'good'), w.store, twilio, ENV)
  assert.equal(res.status, 502)
  assert.deepEqual([w.rows[0].status, w.rows[0].transfer_agent_id, w.rows[0].agent_call_sid], ['live', null, null])
})

test('6. an agent_id in the body is ignored: the on-duty agent is dialed', async () => {
  const w = world()
  await act(w.store, w.twilio, ENV, VA, { action: 'transfer', call_sid: 'CA123', agent_id: OTHER_AGENT, to: '+15550000000' })
  assert.equal(posts(w.calls)[0].params.To, '+15125550142')
  assert.equal(w.rows[0].transfer_agent_id, AGENT)
})

test('7. drop: only the VA\'s own call is completed, never the conference', async () => {
  const early = world()
  const wait = await handle(req({ action: 'drop', call_sid: 'CA123' }, 'good'), early.store, early.twilio, ENV)
  assert.equal(wait.status, 409)
  assert.equal((await wait.json()).error, 'Wait for the agent to answer')
  assert.equal(early.calls.length, 0)

  const w = world({ row: live({ status: 'transferred', transfer_agent_id: AGENT, agent_call_sid: 'CAag1' }) })
  assert.deepEqual(await act(w.store, w.twilio, ENV, VA, { action: 'drop', call_sid: 'CA123' }), { ok: true })
  assert.deepEqual(w.calls, [{ method: 'POST', path: '/Calls/CAva1.json', params: { Status: 'completed' } }])
  assert.ok(!w.calls.some(c => /^\/Conferences\/[^/]+\.json$/.test(c.path)))
  assert.ok(!w.calls.some(c => c.path.includes('CAag1') || c.path.includes('CA123')))
})

test('8. book: outcome booked, status ended, 0 Twilio calls', async () => {
  for (const status of ['live', 'no_answer', 'ended'] as const) {
    const w = world({ row: live({ status }) })
    assert.deepEqual(await act(w.store, w.twilio, ENV, VA, { action: 'book', call_sid: 'CA123' }), { ok: true })
    const r = w.rows[0]
    assert.deepEqual([r.outcome, r.status, r.end_reason], ['booked', 'ended', 'booked'], status)
    assert.ok(r.ended_at)
    assert.equal(w.calls.length, 0)
  }
  // Already with an agent: not bookable.
  for (const row of [live({ status: 'transferring' }), live({ status: 'transferred', outcome: 'transferred' })]) {
    const w = world({ row })
    await assert.rejects(act(w.store, w.twilio, ENV, VA, { action: 'book', call_sid: 'CA123' }), /already handed/)
    assert.equal(w.writes.length, 0)
  }
})

test('bad input: unknown action or call_sid is 400; Twilio not set up is 503', async () => {
  const w = world()
  assert.equal((await handle(req({ action: 'end_all', call_sid: 'CA123' }, 'good'), w.store, w.twilio, ENV)).status, 400)
  assert.equal((await handle(req({ action: 'transfer', call_sid: 'x' }, 'good'), w.store, w.twilio, ENV)).status, 400)
  assert.equal((await handle(req({ action: 'transfer', call_sid: 'CA123' }, 'good'), w.store, w.twilio, { ...ENV, configured: false })).status, 503)
  assert.equal((await handle(req({ action: 'transfer', call_sid: 'CA123' }, 'good'), w.store, w.twilio, { ...ENV, from: null })).status, 503)
  assert.equal(w.calls.length, 0)
  assert.equal(w.writes.length, 0)
})
