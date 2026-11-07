/**
 * P880 — the live transfer engine (help-transfer + transfer-voice), with a mocked Twilio, mocked push senders
 * and in-memory tables. No real calls, no real pushes; voice_live stays off in the real project.
 * Run: node --test supabase/functions/help-transfer/core.test.ts
 *
 * Branches: yes → transfer → press 1 (connected, delivered, VA dropped after the agent is on), no, no answer,
 * late yes (booked / still on the line), failed push, bounce-back (no pickup, voicemail, no key, ring failed),
 * withdraw (before and while ringing), VA leg drops (cancel), lead drops, one check per agent, first answer
 * wins with the other phones cleared, not reachable, the seen ping, the Setup test push + test call.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { act, effective, handle, handleVoice, handOff, whisperWords, type Check, type Env, type Readiness, type Store, type Twilio } from './core.ts'
import type { HelpCall } from '../help-voice/core.ts'
import type { Msg } from '../notify-push/core.ts'

const VA = '11111111-1111-4111-8111-111111111111'
const OTHER_VA = '22222222-2222-4222-8222-222222222222'
const ADMIN = '33333333-3333-4333-8333-333333333333'
const AGENT = '44444444-4444-4444-8444-444444444444'
const LEAD = '66666666-6666-4666-8666-666666666666'
const T0 = Date.parse('2026-11-07T15:00:00Z')

const live = (over: Partial<HelpCall> = {}): HelpCall => ({
  call_sid: 'CA123', caller_number: '+15125550100', tracking_number: '+15125550199', conference_sid: 'CF1',
  va_id: VA, va_call_sid: 'CAva1', ringing_va_call_sids: ['CAva1'], status: 'live', end_reason: null,
  transfer_agent_id: null, agent_call_sid: null, outcome: null, lead_id: LEAD, answered_at: 'then',
  transfer_started_at: null, transferred_at: null, ended_at: null, ...over,
})

type W = ReturnType<typeof world>
function world(over: {
  voice?: boolean; row?: HelpCall | null; reach?: { ready: boolean; reason: string | null }; phones?: number
  pushOk?: boolean | ((token: string) => boolean); agentPhone?: string | null; ringFails?: boolean; leadAgent?: string | null
} = {}) {
  let clock = T0
  const rows: HelpCall[] = over.row === null ? [] : [over.row ?? live()]
  const checks: Check[] = []
  const readiness: Record<string, Readiness> = {}
  const pushes: { token: string; m: Msg }[] = []
  const calls: { method: string; path: string; params?: any }[] = []
  const callbacks: string[] = []
  const leadStatus: string[] = []
  const dropped: string[] = []
  const roles: Record<string, string> = { [VA]: 'fulfillment', [OTHER_VA]: 'fulfillment', [ADMIN]: 'admin', [AGENT]: 'agent' }
  let devices = Array.from({ length: over.phones ?? 2 }, (_, i) => ({ token: `tok${i}`, platform: (i % 2 ? 'android' : 'ios') as 'ios' | 'android' }))
  let n = 0
  const store: Store = {
    async userFromJwt(jwt) { return roles[jwt] ? jwt : null },
    async caller(id) { return roles[id] ? { role: roles[id], is_active: true, phone: id === AGENT ? (over.agentPhone === undefined ? '(512) 555-0142' : over.agentPhone) : null } : null },
    async voiceLive() { return over.voice ?? true },
    async helpCall(sid) { const r = rows.find(x => x.call_sid === sid); return r ? { ...r } : null },
    async updateHelpCall(sid, patch, when) {
      const r = rows.find(x => x.call_sid === sid)
      if (!r || (when && !when.includes(r.status))) return null
      Object.assign(r, patch); return { ...r }
    },
    async lead(id) { return id === LEAD ? { agent_id: over.leadAgent === undefined ? AGENT : over.leadAgent, summary: { name: 'Rosa Diaz', age: 64, state: 'TX', need: 'Final expense', your_client: false } } : null },
    async reach() { return over.reach ?? { ready: true, reason: null } },
    async devices() { return devices.map(d => ({ ...d })) },
    async dropDevices(t) { dropped.push(...t); devices = devices.filter(d => !t.includes(d.token)) },
    async insertCheck(row) {
      const open = ['sent', 'seen', 'yes', 'late_yes', 'ringing']
      if (!row.is_test && checks.some(c => c.agent_id === row.agent_id && !c.is_test && open.includes(c.status))) return null
      if (row.is_test && checks.some(c => c.agent_id === row.agent_id && c.is_test && open.includes(c.status))) return null
      const c: Check = {
        id: `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`, call_sid: null, va_id: null, lead_id: null, summary: {},
        status: 'sent', is_test: false, seen_token: `tok-${n}`, devices: 0, fail_reason: null, created_at: new Date(clock).toISOString(),
        sent_at: null, expires_at: null, seen_at: null, answered_at: null, answer: null, answered_device: null, response_secs: null,
        ring_started_at: null, agent_call_sid: null, connected_at: null, delivered: false, bounced_at: null, ended_reason: null,
        booked_for: null, ...row,
      } as Check
      checks.push(c); return { ...c }
    },
    async check(id) { const c = checks.find(x => x.id === id); return c ? { ...c } : null },
    async updateCheck(id, patch, when) {
      const c = checks.find(x => x.id === id)
      if (!c || (when && !when.includes(c.status))) return null
      Object.assign(c, patch); return { ...c }
    },
    async readiness(id) { return readiness[id] ?? null },
    async setReadiness(id, p) { readiness[id] = { ...readiness[id], ...p } },
    async scheduleCallback(id) { callbacks.push(id) },
    async setLeadTransferStatus(id, s) { leadStatus.push(`${id}:${s}`) },
  }
  const okFor = (t: string) => (typeof over.pushOk === 'function' ? over.pushOk(t) : over.pushOk ?? true)
  const sender = async (token: string, m: Msg) => { pushes.push({ token, m }); return okFor(token) ? { ok: true } : { ok: false, dead: token === 'tok0', error: 'BadDeviceToken' } }
  const participants: any[] = [{ call_sid: 'CA123', status: 'connected', hold: false }, { call_sid: 'CAva1', status: 'connected' }]
  const twilio: Twilio = async (method, path, params) => {
    calls.push({ method, path, params })
    if (method === 'POST' && path === '/Calls.json') return over.ringFails ? { status: 400, data: { message: 'bad number' } } : { status: 201, data: { sid: 'CAag1' } }
    if (method === 'GET' && path === '/Conferences/CF1/Participants.json') return { status: 200, data: { participants } }
    return { status: 200, data: {} }
  }
  const env: Env = {
    from: '+15125550199', voiceUrl: 'https://x.supabase.co/functions/v1/transfer-voice', configured: true,
    senders: { ios: sender, android: sender }, now: () => clock, sleep: async () => { participants.push({ call_sid: 'CAag1', status: 'connected' }) },
  }
  const tick = (ms: number) => { clock += ms }
  return { store, twilio, env, rows, checks, readiness, pushes, calls, callbacks, leadStatus, dropped, participants, tick }
}

const run = (w: W, user: string, body: any) => act(w.store, w.twilio, w.env, user, body) as Promise<any>
const voice = (w: W, event: string, check: string, form: Record<string, string> = {}, signed = true) =>
  handleVoice(event, new URLSearchParams({ event, check }), form, w.store, w.twilio, w.env, signed)
const posts = (w: W, path: RegExp) => w.calls.filter(c => c.method === 'POST' && path.test(c.path))
const holds = (w: W) => posts(w, /Participants\/CA123\.json$/).map(c => c.params.Hold)

async function checked(w: W) {
  const r = await run(w, VA, { action: 'check', call_sid: 'CA123' })
  assert.equal(r.ok, true, JSON.stringify(r))
  return r.check.id as string
}

test('1. Check agent: a time-sensitive Yes/No push to every phone, Sent with a 30 s server timer', async () => {
  const w = world()
  const id = await checked(w)
  const c = w.checks[0]
  assert.equal(c.status, 'sent')
  assert.equal(c.devices, 2)
  assert.equal(Date.parse(c.expires_at!) - Date.parse(c.sent_at!), 30_000)
  assert.equal(w.pushes.length, 2)
  const m = w.pushes[0].m
  assert.equal(m.type, 'transfer_check')
  assert.equal(m.timeSensitive, true)
  assert.equal(m.category, 'OHVARA_TRANSFER')
  assert.equal(m.collapseId, id)
  assert.equal(m.ttlSec, 30)
  assert.match(m.title, /Live call: Rosa Diaz/)
  assert.match(m.body, /64 · TX · Final expense/)
  assert.match(m.data!.seen_url, new RegExp(`event=seen&check=${id}&t=tok-1`))
  assert.equal(c.lead_id, LEAD)
  assert.equal(c.va_id, VA)
})

test('2. Yes → Transfer now: hold music, agent rings 20 s with a whisper; press 1 = connected + delivered, VA dropped after the agent is on', async () => {
  const w = world()
  const id = await checked(w)
  w.tick(4000)
  assert.equal((await run(w, AGENT, { action: 'seen', check_id: id })).check.status, 'seen')
  w.tick(3000)
  const a = await run(w, AGENT, { action: 'answer', check_id: id, answer: 'yes', device: 'tok0' })
  assert.equal(a.check.status, 'yes')
  assert.equal(w.checks[0].response_secs, 7)
  // The other phone is cleared (N-C-14), the answering one isn't.
  const clears = w.pushes.filter(p => p.m.type === 'transfer_clear')
  assert.deepEqual(clears.map(p => p.token), ['tok1'])
  assert.match(clears[0].m.title, /Answered on your other phone/)

  const t = await run(w, VA, { action: 'transfer', check_id: id })
  assert.equal(t.ok, true)
  assert.equal(w.checks[0].status, 'ringing')
  assert.equal(w.rows[0].status, 'transferring')
  assert.deepEqual(holds(w), ['true'])
  const ring = posts(w, /^\/Calls\.json$/)[0].params
  assert.equal(ring.To, '+15125550142')
  assert.equal(ring.Timeout, '20')
  assert.match(ring.Url, /event=whisper/)

  const wh = await (await voice(w, 'whisper', id)).text()
  assert.match(wh, /<Gather numDigits="1"/)
  assert.match(wh, /Rosa Diaz, 64, from TX, looking for Final expense\. Press 1/)

  const acc = await (await voice(w, 'accept', id, { Digits: '1', CallSid: 'CAag1' })).text()
  assert.match(acc, /<Conference[^>]*participantLabel="agent"[^>]*>help-CA123<\/Conference>/)
  const c = w.checks[0]
  assert.equal(c.status, 'connected')
  assert.equal(c.delivered, true)
  assert.equal(w.rows[0].status, 'transferred')
  assert.equal(w.rows[0].outcome, 'transferred')
  assert.deepEqual(w.leadStatus, [`${LEAD}:connected`])
  // Unheld, then the VA's leg ended — only after the agent showed on the conference.
  assert.deepEqual(holds(w), ['true', 'false'])
  assert.equal(posts(w, /\/Calls\/CAva1\.json$/)[0].params.Status, 'completed')
  const order = w.calls.map(x => x.path)
  assert.ok(order.lastIndexOf('/Conferences/CF1/Participants.json') < order.indexOf('/Calls/CAva1.json'))
  // A late completed status for the agent leg changes nothing.
  await voice(w, 'agent_status', id, { CallStatus: 'completed' })
  assert.equal(w.checks[0].status, 'connected')
})

test('3. No → the VA books; a late Yes then reads "Already booked for [time]"', async () => {
  const w = world()
  const id = await checked(w)
  assert.equal((await run(w, AGENT, { action: 'answer', check_id: id, answer: 'no' })).check.status, 'no')
  await assert.rejects(run(w, VA, { action: 'transfer', check_id: id }), /hasn't said Yes/)
  const b = await run(w, VA, { action: 'book', check_id: id, call_sid: 'CA123', booked_for: '2026-11-07T19:30:00Z' })
  assert.equal(b.check.status, 'booked')
  assert.equal(w.rows[0].outcome, 'booked')
  const late = await run(w, AGENT, { action: 'answer', check_id: id, answer: 'yes' })
  assert.equal(late.code, 'already_booked')
  assert.equal(late.booked_for, '2026-11-07T19:30:00.000Z')
})

test('4. No answer in 30 s: the server timer says no_answer (survives a reload); booking clears the push', async () => {
  const w = world()
  const id = await checked(w)
  w.tick(30_001)
  assert.equal(effective(w.checks[0], T0 + 30_001), 'no_answer')
  const s = await run(w, VA, { action: 'status', check_id: id })
  assert.equal(s.check.status, 'no_answer')
  assert.ok(s.check.server_now)
  await run(w, VA, { action: 'book', check_id: id, booked_for: '2026-11-07T20:00:00Z' })
  assert.match(w.pushes.at(-1)!.m.title, /Booked on your calendar instead/)
})

test('5. Late Yes while the VA still has the lead on the line, unbooked: late_yes, and Transfer now works', async () => {
  const w = world()
  const id = await checked(w)
  w.tick(35_000)
  const late = await run(w, AGENT, { action: 'answer', check_id: id, answer: 'yes' })
  assert.equal(late.late, true)
  assert.equal(late.check.status, 'late_yes')
  assert.equal((await run(w, VA, { action: 'transfer', check_id: id })).ok, true)
  assert.equal(w.checks[0].status, 'ringing')
  // The lead gone by then: the late Yes is "no longer available".
  const g = world({ row: live({ status: 'ended' }) })
  g.rows[0].status = 'live'
  const gid = await checked(g)
  g.tick(31_000); g.rows[0].status = 'ended'
  assert.equal((await run(g, AGENT, { action: 'answer', check_id: gid, answer: 'yes' })).code, 'gone')
})

test('6. Failed push: no phone reached → failed at once ("Couldn\'t reach agent"), dead tokens dropped', async () => {
  const w = world({ pushOk: false })
  const r = await run(w, VA, { action: 'check', call_sid: 'CA123' })
  assert.equal(r.ok, false)
  assert.equal(r.code, 'push_failed')
  assert.match(r.message, /Couldn't reach agent/)
  assert.equal(w.checks[0].status, 'failed')
  assert.deepEqual(w.dropped, ['tok0'])
  // No phone at all: failed, no_device.
  const none = world({ phones: 0 })
  const n = await run(none, VA, { action: 'check', call_sid: 'CA123' })
  assert.equal(n.check.fail_reason, 'no_device')
  // One of two phones reached is enough.
  const half = world({ pushOk: t => t === 'tok1' })
  assert.equal((await run(half, VA, { action: 'check', call_sid: 'CA123' })).check.devices, 1)
  // The failed check doesn't block the next one, and booking it is allowed.
  assert.equal((await run(w, VA, { action: 'book', check_id: r.check.id })).ok, true)
})

test('7. Bounce-back: no pickup in 20 s, voicemail (no key), a wrong key, or the ring failing → lead unheld with the VA', async () => {
  for (const how of ['no-answer', 'no-key', 'wrong-key', 'ring-fail', 'no-phone'] as const) {
    const w = world({ ringFails: how === 'ring-fail', agentPhone: how === 'no-phone' ? null : undefined })
    const id = await checked(w)
    await run(w, AGENT, { action: 'answer', check_id: id, answer: 'yes' })
    const t = await run(w, VA, { action: 'transfer', check_id: id })
    if (how === 'no-answer') await voice(w, 'agent_status', id, { CallStatus: 'no-answer' })
    if (how === 'no-key') { await voice(w, 'whisper', id); await voice(w, 'agent_status', id, { CallStatus: 'completed' }) }
    if (how === 'wrong-key') { assert.match(await (await voice(w, 'accept', id, { Digits: '2' })).text(), /Hangup/); await voice(w, 'agent_status', id, { CallStatus: 'completed' }) }
    if (how === 'ring-fail' || how === 'no-phone') assert.equal(t.ok, false, how)
    assert.equal(w.checks[0].status, 'bounced', how)
    assert.equal(w.checks[0].delivered, false, how)
    assert.equal(w.rows[0].status, 'live', how)
    assert.equal(holds(w).at(-1), 'false', how)
    assert.equal(posts(w, /\/Calls\/CAva1\.json$/).length, 0, `${how}: the VA is never dropped`)
    assert.equal((await run(w, VA, { action: 'book', check_id: id })).check.status, 'booked', how)
  }
})

test('8. Withdraw: before Transfer the VA sees withdrawn; while ringing the agent leg is hung up and the lead unheld', async () => {
  const w = world()
  const id = await checked(w)
  await run(w, AGENT, { action: 'answer', check_id: id, answer: 'yes' })
  assert.equal((await run(w, AGENT, { action: 'withdraw', check_id: id })).check.status, 'withdrawn')
  await assert.rejects(run(w, VA, { action: 'transfer', check_id: id }), /hasn't said Yes/)

  const r = world()
  const rid = await checked(r)
  await run(r, AGENT, { action: 'answer', check_id: rid, answer: 'yes' })
  await run(r, VA, { action: 'transfer', check_id: rid })
  await run(r, AGENT, { action: 'withdraw', check_id: rid })
  assert.equal(r.checks[0].status, 'withdrawn')
  assert.equal(posts(r, /\/Calls\/CAag1\.json$/)[0].params.Status, 'completed')
  assert.equal(holds(r).at(-1), 'false')
  assert.equal(r.rows[0].status, 'live')
  // The agent leg's status callback afterwards is a no-op, and pressing 1 late says no longer available.
  await voice(r, 'agent_status', rid, { CallStatus: 'completed' })
  assert.equal(r.checks[0].status, 'withdrawn')
  assert.match(await (await voice(r, 'whisper', rid)).text(), /no longer available/)
})

test('9. VA leg drops after Check agent: cancelled, push replaced with "No longer available", callback task', async () => {
  const w = world()
  const id = await checked(w)
  const r = await run(w, VA, { action: 'cancel', check_id: id })
  assert.equal(r.check.status, 'cancelled')
  assert.deepEqual(w.callbacks, [LEAD])
  const clears = w.pushes.filter(p => p.m.type === 'transfer_clear')
  assert.equal(clears.length, 2)
  assert.match(clears[0].m.title, /No longer available/)
  assert.equal(clears[0].m.collapseId, id)
  // A Yes after that is refused.
  assert.equal((await run(w, AGENT, { action: 'answer', check_id: id, answer: 'yes' })).code, 'gone')
})

test('10. The lead hangs up while the agent rings: pressing 1 hears "the caller hung up", check cancelled', async () => {
  const w = world()
  const id = await checked(w)
  await run(w, AGENT, { action: 'answer', check_id: id, answer: 'yes' })
  await run(w, VA, { action: 'transfer', check_id: id })
  w.rows[0].status = 'ended'
  assert.match(await (await voice(w, 'accept', id, { Digits: '1', CallSid: 'CAag1' })).text(), /caller hung up/)
  assert.equal(w.checks[0].status, 'cancelled')
  assert.equal(w.checks[0].delivered, false)
})

test('11. One check per agent; first answer wins; not reachable, no agent and voice off are refused for the VA', async () => {
  const w = world()
  await checked(w)
  w.rows.push(live({ call_sid: 'CA999', va_id: OTHER_VA, va_call_sid: 'CAva2' }))
  const second = await run(w, OTHER_VA, { action: 'check', call_sid: 'CA999', lead_id: LEAD })
  assert.equal(second.code, 'agent_busy')
  // Two phones answer: the first wins, the second sees already/late.
  const id = w.checks[0].id
  assert.equal((await run(w, AGENT, { action: 'answer', check_id: id, answer: 'yes', device: 'tok0' })).check.status, 'yes')
  const b = await run(w, AGENT, { action: 'answer', check_id: id, answer: 'no', device: 'tok1' })
  assert.equal(b.late, true)
  assert.equal(w.checks[0].answer, 'yes')

  const u = world({ reach: { ready: false, reason: 'not_tested' } })
  const ur = await run(u, VA, { action: 'check', call_sid: 'CA123' })
  assert.equal(ur.code, 'not_reachable')
  assert.equal(u.pushes.length, 0)
  assert.equal((await run(world({ leadAgent: null }), VA, { action: 'check', call_sid: 'CA123' })).code, 'no_agent')
  await assert.rejects(run(world({ voice: false }), VA, { action: 'check', call_sid: 'CA123' }), /isn't on yet/)
  await assert.rejects(run(world(), OTHER_VA, { action: 'check', call_sid: 'CA123' }), /Only the VA/)
  await assert.rejects(run(world(), AGENT, { action: 'check', call_sid: 'CA123' }), /Unknown action/)
  await assert.rejects(run(world(), VA, { action: 'answer', check_id: id, answer: 'yes' }), /Unknown action/)
})

test('12. The phone\'s seen ping needs the check\'s token; Twilio events need a signature', async () => {
  const w = world()
  const id = await checked(w)
  assert.equal((await handleVoice('seen', new URLSearchParams({ check: id, t: 'wrong' }), {}, w.store, w.twilio, w.env, false)).status, 404)
  assert.equal((await handleVoice('seen', new URLSearchParams({ check: id, t: 'tok-1' }), {}, w.store, w.twilio, w.env, false)).status, 204)
  assert.equal(w.checks[0].status, 'seen')
  for (const e of ['hold', 'whisper', 'accept', 'agent_status']) assert.equal((await voice(w, e, id, {}, false)).status, 403, e)
  assert.match(await (await voice(w, 'hold', id)).text(), /connect you with your licensed agent.*<Play loop="0">/)
})

test('13. Setup push test: Yes → push passed, then a test call that must be pressed 1 before live calls turn on', async () => {
  const w = world()
  const t = await run(w, AGENT, { action: 'test_push' })
  assert.equal(t.ok, true)
  assert.match(w.pushes[0].m.title, /Test live call: Pat Sample/)
  const a = await run(w, AGENT, { action: 'answer', check_id: t.check.id, answer: 'yes', device: 'tok0' })
  assert.equal(a.call, 'ringing')
  assert.ok(w.readiness[AGENT].push_ok_at)
  assert.match(await (await voice(w, 'whisper', t.check.id)).text(), /test transfer\. Press 1/)
  assert.match(await (await voice(w, 'accept', t.check.id, { Digits: '1', CallSid: 'CAag1' })).text(), /Test passed/)
  assert.ok(w.readiness[AGENT].call_ok_at)
  assert.equal(w.readiness[AGENT].booking_only, false)
  // A test never touches a help call or the VA.
  assert.equal(holds(w).length, 0)

  // Calling off (voice_live): the push part passes, the call step waits; live calls stay off.
  const off = world({ voice: false })
  const ot = await run(off, AGENT, { action: 'test_push' })
  assert.equal((await run(off, AGENT, { action: 'answer', check_id: ot.check.id, answer: 'yes' })).call, 'voice_off')
  assert.equal(off.readiness[AGENT].fail_reason, 'voice_off')
  assert.equal(off.readiness[AGENT].call_ok_at, undefined)
  // Test call not answered: booking only, fail reason for the fix steps.
  const miss = world()
  const mt = await run(miss, AGENT, { action: 'test_push' })
  await run(miss, AGENT, { action: 'answer', check_id: mt.check.id, answer: 'yes' })
  await voice(miss, 'agent_status', mt.check.id, { CallStatus: 'no-answer' })
  assert.equal(miss.readiness[AGENT].fail_reason, 'call_no_answer')
  assert.equal(miss.readiness[AGENT].booking_only, true)
  // No phone: the test fails with no_device.
  const np = world({ phones: 0 })
  const nt = await run(np, AGENT, { action: 'test_push' })
  assert.equal(nt.code, 'no_device')
  assert.equal(np.readiness[AGENT].fail_reason, 'no_device')
})

test('14. handle(): 401 without a signed-in user; the hand-off keeps the VA on when the agent never shows', async () => {
  const w = world()
  const res = await handle(new Request('http://x/help-transfer', { method: 'POST', body: '{}' }), w.store, w.twilio, w.env)
  assert.equal(res.status, 401)
  const h = world()
  h.env.sleep = async () => {}
  const on = await handOff(h.twilio, h.env, h.rows[0], 'CAag1')
  assert.equal(on, false)
  assert.equal(posts(h, /\/Calls\/CAva1\.json$/).length, 0)
  assert.deepEqual(holds(h), ['false'])
  assert.match(whisperWords({ name: 'Al', your_client: true }, false), /your client\. Al\. Press 1/)
})
