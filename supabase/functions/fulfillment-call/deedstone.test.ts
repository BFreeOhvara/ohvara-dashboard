/**
 * P916 — Deedstone on every call, simulated (mocked Twilio REST, in-memory stores, no real calls):
 * an agent's Call (their phone first, then the client from their Deedstone number), the phone code call, the
 * bridge TwiML in help-voice, calls in finding the right agent (→ a VA → a booked callback), and VA calls,
 * the live transfer and the AI caller using the agent's Deedstone number.
 * Run: node --test supabase/functions/fulfillment-call/deedstone.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { handle as callHandle, type Store as CallStore } from './core.ts'
import { actAgent, AGENT_WORDS, codeTwiml, type AgentStore, type AgentCallRow, type Begin } from './agentCall.ts'
import { actLine, type Line, type LineStore } from './lines.ts'
import { twilioSignature } from '../_shared/twilio.ts'
import { handle as help, type Store as HelpStore, type RouteStore, type HelpCall } from '../help-voice/core.ts'
import type { BridgeStore, BridgeRow } from '../help-voice/deedstone.ts'
import { agentCallParams } from '../help-transfer/core.ts'
import { start as aiStart } from '../ai-caller/core.ts'

const AGENT = '11111111-1111-4111-8111-111111111111'
const VA = '22222222-2222-4222-8222-222222222222'
const LEAD = '55555555-5555-4555-8555-555555555555'
const POL = '44444444-4444-4444-8444-444444444444'
const CALL = '66666666-6666-4666-8666-666666666666'
const LINE = '77777777-7777-4777-8777-777777777777'
const DS = '+12145550001'       // the agent's Deedstone number
const OLD = '+15550001111'      // the old single number
const MYPHONE = '+12145550100'  // the agent's connected phone
const TOKEN = 'test-token'
const HURL = 'https://x.supabase.co/functions/v1/help-voice'
const ENV = { from: OLD, helpUrl: HURL, configured: true }

function agentWorld(over: { begin?: Begin; live?: boolean; role?: string; tooMany?: boolean; ring?: number } = {}) {
  const calls: { method: string; path: string; params?: any }[] = []
  const log: any[] = []
  const row: AgentCallRow = { id: CALL, agent_id: AGENT, agent_call_sid: 'CAagent', status: 'calling_agent' }
  const store: AgentStore = {
    async role(id) { return id === AGENT ? (over.role ?? 'agent') : 'fulfillment' },
    async voiceLive() { return over.live ?? true },
    async callBegin(a, l, p) {
      log.push(['begin', a, l, p])
      return over.begin ?? { ok: true, call_id: CALL, from: DS, agent_phone: MYPHONE, client_phone: '+12145550301', name: 'Lou Lead' }
    },
    async agentCall(id) { return id === CALL ? { ...row } : null },
    async saveAgentCall(id, patch) { log.push(['save', id, patch]) },
    async codeBegin(a, phone) { log.push(['code', a, phone]); if (over.tooMany) throw new Error('too_many'); return '481516' },
    async numberFor() { return DS },
  }
  const twilio = async (method: 'GET' | 'POST' | 'DELETE', path: string, params?: any) => {
    calls.push({ method, path, params })
    return { status: over.ring ?? 201, data: { sid: 'CAagent' } }
  }
  return { store, twilio, calls, log }
}
const refused = async (p: Promise<unknown>) => { try { await p } catch (e) { return e as any } ; assert.fail('expected a refusal') }

// ── an agent's Call ──────────────────────────────────────────────────────────────────────────────────────────
test('Call: the agent\'s phone rings first, from their Deedstone number, and help-voice answers it', async () => {
  const w = agentWorld()
  const out = await actAgent(w.store, w.twilio as any, ENV, AGENT, { action: 'agent_call', lead_id: LEAD })
  assert.deepEqual(out, { ok: true, call_id: CALL, name: 'Lou Lead' })
  assert.deepEqual(w.log[0], ['begin', AGENT, LEAD, null])
  assert.equal(w.calls.length, 1)
  const p = w.calls[0].params
  assert.equal(w.calls[0].path, '/Calls.json')
  assert.equal(p.To, MYPHONE, 'the agent\'s own phone')
  assert.equal(p.From, DS, 'shows as Deedstone')
  assert.equal(p.Url, `${HURL}?event=ds_bridge&dc=${CALL}`)
  assert.equal(p.StatusCallback, `${HURL}?event=ds_agent_leg&dc=${CALL}`)
  assert.ok(!('Record' in p), 'no recording (Q51)')
  assert.deepEqual(w.log.at(-1), ['save', CALL, { agent_call_sid: 'CAagent' }])
})

test('Call: refusals — not an agent, switch off, pre-dial reasons in the agent\'s words with when it can go', async () => {
  const notAgent = await refused(actAgent(agentWorld({ role: 'fulfillment' }).store, agentWorld().twilio as any, ENV, AGENT, { action: 'agent_call', lead_id: LEAD }))
  assert.equal(notAgent.status, 403)
  const off = agentWorld({ live: false })
  const voiceOff = await refused(actAgent(off.store, off.twilio as any, ENV, AGENT, { action: 'agent_call', lead_id: LEAD }))
  assert.equal(voiceOff.code, 'voice_off')
  assert.equal(off.calls.length, 0, 'nothing rings while voice_live is off')
  for (const reason of ['no_consent', 'dnc', 'opted_out', 'outside_hours', 'attempt_cap', 'no_agent_phone', 'not_yours']) {
    const w = agentWorld({ begin: { ok: false, reason, next_at: reason === 'outside_hours' ? '2026-11-10T14:00:00Z' : null } })
    const e = await refused(actAgent(w.store, w.twilio as any, ENV, AGENT, { action: 'agent_call', lead_id: LEAD }))
    assert.equal(e.code, reason)
    assert.equal(e.message, `Can't call now: ${AGENT_WORDS[reason]}`)
    if (reason === 'outside_hours') assert.equal(e.extra.next_at, '2026-11-10T14:00:00Z')
    assert.equal(w.calls.length, 0, `${reason}: nothing rings`)
  }
  const none = agentWorld()
  assert.equal((await refused(actAgent(none.store, none.twilio as any, ENV, AGENT, { action: 'agent_call', lead_id: 'x' }))).code, 'no_task')
})

test('Call: a ring that fails closes the row; Hang up ends the agent\'s leg', async () => {
  const bad = agentWorld({ ring: 400 })
  assert.equal((await refused(actAgent(bad.store, bad.twilio as any, ENV, AGENT, { action: 'agent_call', policy_id: POL }))).code, 'twilio')
  assert.equal(bad.log.at(-1)[2].end_reason, 'ring_failed')
  const w = agentWorld()
  await actAgent(w.store, w.twilio as any, ENV, AGENT, { action: 'agent_hangup', call_id: CALL })
  assert.deepEqual(w.calls[0], { method: 'POST', path: '/Calls/CAagent.json', params: { Status: 'completed' } })
  assert.equal(w.log.at(-1)[2].end_reason, 'agent_hung_up')
})

test('Connect your phone: a voice call reads the code twice; 3 an hour', async () => {
  const w = agentWorld()
  const out = await actAgent(w.store, w.twilio as any, ENV, AGENT, { action: 'verify_phone', phone: '(214) 555-0100' })
  assert.deepEqual(out, { ok: true, calling: MYPHONE })
  assert.deepEqual(w.log[0], ['code', AGENT, MYPHONE])
  assert.equal(w.calls[0].params.To, MYPHONE)
  assert.equal(w.calls[0].params.From, DS)
  assert.equal(w.calls[0].params.Twiml, codeTwiml('481516'))
  assert.match(codeTwiml('481516'), /code is 4, 8, 1, 5, 1, 6\..*Again, your code is 4, 8, 1, 5, 1, 6/)
  const many = agentWorld({ tooMany: true })
  const e = await refused(actAgent(many.store, many.twilio as any, ENV, AGENT, { action: 'verify_phone', phone: '2145550100' }))
  assert.equal(e.status, 429)
  assert.equal((await refused(actAgent(w.store, w.twilio as any, ENV, AGENT, { action: 'verify_phone', phone: '12' }))).code, 'bad_phone')
})

test('fulfillment-call routes agent_* to the agent path (signed-in agent)', async () => {
  const w = agentWorld()
  const store = { async userFromJwt() { return AGENT } } as unknown as CallStore
  const req = new Request('http://x/fulfillment-call', { method: 'POST', headers: { Authorization: 'Bearer jwt' }, body: JSON.stringify({ action: 'agent_call', lead_id: LEAD }) })
  const res = await callHandle(req, store, w.twilio as any, { from: OLD, voiceUrl: '', configured: true }, undefined, { store: w.store, env: ENV })
  assert.equal(res.status, 200)
  const bad = agentWorld({ begin: { ok: false, reason: 'no_consent' } })
  const req2 = new Request('http://x/fulfillment-call', { method: 'POST', headers: { Authorization: 'Bearer jwt' }, body: JSON.stringify({ action: 'agent_call', lead_id: LEAD }) })
  const res2 = await callHandle(req2, store, bad.twilio as any, { from: OLD, voiceUrl: '', configured: true }, undefined, { store: bad.store, env: ENV })
  assert.equal(res2.status, 409)
  assert.equal((await res2.json()).code, 'no_consent')
})

// ── help-voice: the bridge and calls in ──────────────────────────────────────────────────────────────────────
async function signed(query: string, form: Record<string, string>) {
  return new Request(`http://internal/help-voice${query}`, {
    method: 'POST',
    headers: { 'X-Twilio-Signature': await twilioSignature(TOKEN, HURL + query, form), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form),
  })
}
function helpWorld(over: { inbound?: { agent: boolean; phone: string | null; name: string | null }; took?: boolean; connect?: any } = {}) {
  const rows = new Map<string, HelpCall>()
  const log: any[] = []
  const bridgeRow: BridgeRow = { id: CALL, status: 'calling_agent', client_name: 'Lou Lead' }
  const store: HelpStore = {
    async voiceLive() { return true },
    async activeVas() { return [VA] },
    async insertHelpCall(row) { if (rows.has(row.call_sid)) return false; rows.set(row.call_sid, row as HelpCall); return true },
    async helpCall(sid) { return rows.get(sid) ?? null },
    async claimHelpCall() { return null },
    async updateHelpCall() { return null },
    async setLeadTransferStatus() {}, async logMissedTransfer() {},
  }
  let took = over.took ?? false
  const route: RouteStore = {
    async deskOpen() { return true },
    async afterHoursText() { return null },
    async routeInbound(sid, caller) { log.push(['route', sid, caller]); return { queue_id: 'q1' } },
    async afterHoursCall(sid, caller) { log.push(['afterHours', sid, caller]) },
    async inboundGone() {}, async vaLeftLine() { return false }, async isCron() { return false },
    deedstone: {
      async inboundStart(sid, caller, to) { log.push(['dsStart', sid, caller, to]); return over.inbound ?? { agent: true, phone: MYPHONE, name: 'Lou Lead' } },
      async inboundName() { return 'Lou Lead' },
      async inboundTook(sid) { log.push(['took', sid]); took = true },
      async inboundDone() { return took },
    },
  }
  const bridge: BridgeStore = {
    async bridgeCall(id) { return id === CALL ? { ...bridgeRow } : null },
    async bridgeConnect(id) { log.push(['connect', id]); return over.connect ?? { ok: true, from: DS, client_phone: '+12145550301', name: 'Lou Lead' } },
    async bridgeSave(id, patch) { log.push(['bsave', id, patch]) },
  }
  return { store, route, bridge, rows, log }
}
const env = { authToken: TOKEN, publicUrl: HURL }
const run = async (w: ReturnType<typeof helpWorld>, q: string, form: Record<string, string>) =>
  (await help(await signed(q, form), w.store, null, env, w.route, w.bridge)).text()

test('bridge: the agent answers → press 1 → the client is dialed from the agent\'s Deedstone number', async () => {
  const w = helpWorld()
  const ask = await run(w, `?event=ds_bridge&dc=${CALL}`, { CallSid: 'CAagent' })
  assert.match(ask, /<Gather numDigits="1"[^>]*event=ds_bridge_go&amp;dc=/)
  assert.match(ask, /Deedstone call to Lou\. Press 1 to connect\./)
  assert.equal(w.log[0][2].status, 'agent_on')
  const dial = await run(w, `?event=ds_bridge_go&dc=${CALL}`, { CallSid: 'CAagent', Digits: '1' })
  assert.match(dial, new RegExp(`<Dial callerId="\\${DS}"`), 'the client sees the Deedstone number')
  assert.match(dial, />\+12145550301<\/Number><\/Dial>/)
  assert.ok(!/record/i.test(dial), 'no recording')
  assert.deepEqual(w.log.find(l => l[0] === 'connect'), ['connect', CALL])
  await run(w, `?event=ds_client_leg&dc=${CALL}`, { CallSid: 'CAclient', CallStatus: 'in-progress' })
  assert.equal(w.log.at(-1)[2].status, 'live')
  const done = await run(w, `?event=ds_bridge_done&dc=${CALL}`, { CallSid: 'CAagent', DialCallStatus: 'no-answer' })
  assert.match(done, /didn't answer/)
  assert.equal(w.log.at(-1)[2].end_reason, 'client_no_answer')
})

test('bridge: no key (voicemail) cancels; a pre-dial refusal at the dial is said; a bad signature is 403', async () => {
  const w = helpWorld()
  const vm = await run(w, `?event=ds_bridge_go&dc=${CALL}`, { CallSid: 'CAagent', Digits: '' })
  assert.match(vm, /Cancelled/)
  assert.ok(!w.log.some(l => l[0] === 'connect'), 'the client is never dialed into a voicemail')
  const late = helpWorld({ connect: { ok: false, reason: 'outside_hours' } })
  const said = await run(late, `?event=ds_bridge_go&dc=${CALL}`, { CallSid: 'CAagent', Digits: '1' })
  assert.match(said, /outside legal calling hours/)
  assert.ok(!/<Dial/.test(said))
  const forged = new Request(`http://internal/help-voice?event=ds_bridge&dc=${CALL}`, { method: 'POST', headers: { 'X-Twilio-Signature': 'nope' }, body: '' })
  assert.equal((await help(forged, w.store, null, env, w.route, w.bridge)).status, 403)
})

test('calls in: a known caller rings their agent (~20 s, press 1); taken → done', async () => {
  const w = helpWorld()
  const xml = await run(w, '', { CallSid: 'CAin', From: '(214) 555-0301', To: DS })
  assert.deepEqual(w.log[0], ['dsStart', 'CAin', '+12145550301', DS])
  assert.match(xml, new RegExp(`<Dial timeout="20" callerId="\\${DS}"`))
  assert.match(xml, /event=ds_screen&amp;call=CAin/)
  assert.match(xml, />\+12145550100<\/Number>/)
  assert.ok(!/Lou/.test(xml), 'no name in a URL')
  const whisper = await run(w, '?event=ds_screen&call=CAin', { CallSid: 'CAleg' })
  assert.match(whisper, /Deedstone call from Lou\. Press 1 to take it\./)
  assert.equal(await run(w, '?event=ds_take&call=CAin', { CallSid: 'CAleg', Digits: '1' }), '<?xml version="1.0" encoding="UTF-8"?><Response></Response>')
  const after = await run(w, '?event=ds_after_agent&call=CAin', { CallSid: 'CAin', From: '+12145550301', To: DS, CallStatus: 'in-progress', DialCallStatus: 'completed' })
  assert.match(after, /<Hangup\/>/)
  assert.ok(!w.log.some(l => l[0] === 'route'), 'no VA needed')
})

test('calls in: the agent doesn\'t take it → the next free VA; unknown caller → a VA; caller hung up → nothing queued', async () => {
  const w = helpWorld()
  await run(w, '', { CallSid: 'CAin', From: '+12145550301', To: DS })
  const nokey = await run(w, '?event=ds_take&call=CAin', { CallSid: 'CAleg', Digits: '' })
  assert.match(nokey, /<Hangup\/>/)
  const after = await run(w, '?event=ds_after_agent&call=CAin', { CallSid: 'CAin', From: '+12145550301', To: DS, CallStatus: 'in-progress', DialCallStatus: 'no-answer' })
  assert.match(after, /startConferenceOnEnter="false"/, 'waits for a VA on hold music')
  assert.deepEqual(w.log.find(l => l[0] === 'route'), ['route', 'CAin', '+12145550301'])

  const unknown = helpWorld({ inbound: { agent: false, phone: null, name: null } })
  const u = await run(unknown, '', { CallSid: 'CAnew', From: '+19725559999', To: DS })
  assert.match(u, /<Conference/)
  assert.deepEqual(unknown.log.find(l => l[0] === 'route'), ['route', 'CAnew', '+19725559999'])

  const gone = helpWorld()
  await run(gone, '', { CallSid: 'CAin', From: '+12145550301', To: DS })
  await run(gone, '?event=ds_after_agent&call=CAin', { CallSid: 'CAin', CallStatus: 'completed', DialCallStatus: 'no-answer' })
  assert.ok(!gone.log.some(l => l[0] === 'route'), 'a caller who hung up isn\'t queued')
})

// ── the same Deedstone number everywhere ─────────────────────────────────────────────────────────────────────
function lineWorld(withPool = true) {
  const calls: any[] = []
  const log: any[] = []
  const line: Line = { id: LINE, kind: 'lead', conference: `line-${LINE}`, lead_id: LEAD, policy_id: null, help_call_sid: null,
    va_id: VA, va_call_sid: 'CAva', status: 'live' }
  const store = {
    async role() { return 'fulfillment' }, async voiceLive() { return true },
    async line() { return { ...line } },
    async lead() { return { id: LEAD, phone: '2145550301', state: 'TX', assigned_rep_id: AGENT } },
    async policyRow() { return null },
    async agentPhone() { return '2145550100' },
    async carrierPhone() { return '1-800-555-0100' },
    async voicemailText() { return null },
    async lineLegs() { return [] }, async saveLineLeg() {},
    async lineOpen() { return LINE }, async lineEnded() {}, async lineHoldState() {}, async lineHandoff() { return 'queued' as const },
    async lineRequeue() {}, async predial() { return { ok: true, reason: null, next_at: null } },
    async logAttempt() {}, async endHelpCall() {},
    ...(withPool ? { async deedstoneFrom(a: string, kind: string | null) { log.push(['ds', a, kind]); return DS } } : null),
  } as LineStore
  const twilio = async (method: string, path: string, params?: any) => {
    calls.push({ method, path, params })
    if (method === 'GET') return { status: 200, data: { conferences: [{ sid: 'CF1' }] } }
    return { status: 201, data: { call_sid: 'CAx' } }
  }
  return { store, twilio, calls, log }
}

test('VA calls about the agent\'s lead use the agent\'s Deedstone number; carriers keep the old one; no pool = old', async () => {
  const lineEnv = { from: OLD, voiceUrl: 'https://x/fulfillment-voice', configured: true }
  const w = lineWorld()
  await actLine(w.store, w.twilio as any, lineEnv, VA, { action: 'ring_client', line_id: LINE })
  assert.equal(w.calls.find((c: any) => c.method === 'POST').params.From, DS)
  assert.deepEqual(w.log[0], ['ds', AGENT, 'va_call'])
  const a = lineWorld()
  await actLine(a.store, a.twilio as any, lineEnv, VA, { action: 'ring_agent', line_id: LINE })
  assert.equal(a.calls.find((c: any) => c.method === 'POST').params.From, DS)
  assert.deepEqual(a.log[0], ['ds', AGENT, null], 'the agent\'s own phone doesn\'t count toward the number\'s day')
  const c = lineWorld()
  await actLine(c.store, c.twilio as any, lineEnv, VA, { action: 'ring_carrier', line_id: LINE })
  assert.equal(c.calls.find((x: any) => x.method === 'POST').params.From, OLD)
  assert.equal(c.log.length, 0)
  const none = lineWorld(false)
  await actLine(none.store, none.twilio as any, lineEnv, VA, { action: 'ring_client', line_id: LINE })
  assert.equal(none.calls.find((x: any) => x.method === 'POST').params.From, OLD)
})

test('the live transfer rings the agent from their Deedstone number', () => {
  const env = { from: OLD, voiceUrl: 'https://x/transfer-voice', configured: true, senders: {} as any }
  assert.equal(agentCallParams(env, MYPHONE, 'chk', DS).From, DS)
  assert.equal(agentCallParams(env, MYPHONE, 'chk', null).From, OLD)
})

test('the AI\'s first call goes out from the agent\'s Deedstone number (Vapi gets that number\'s id)', async () => {
  const started: any[] = []
  const store: any = {
    async live() { return { on: true, maxSecs: 300 } },
    async call() { return { id: 'c1', lead_id: LEAD, agent_id: AGENT, attempt: 1, status: 'queued', provider_call_id: null, check_id: null, routed: null, summary: null, booked_for: null } },
    async takes() { return { by: 'ai', reason: null } },
    async lead() { return { id: LEAD, first: 'Lou', phone: '+12145550301', state: 'TX', tz: null, need: null, age: null } },
    async agent() { return { id: AGENT, first: 'Avery', phone: MYPHONE, mode: 'both', hours: {}, tz: 'America/Chicago', reachable: true } },
    async status() { return null },
    async deedstoneFrom(a: string, id: string) { started.push(['ds', a, id]); return { phone: DS, providerId: 'vapi-num-1' } },
  }
  const provider: any = { ready: true, async start(a: any) { started.push(a); return { providerCallId: 'p1' } } }
  const out = await aiStart(store, provider, { now: () => 0, from: OLD, words: { opening: 'Hi {first}' } }, 'c1')
  assert.equal(out.ok, true)
  assert.deepEqual(started[0], ['ds', AGENT, 'c1'])
  assert.equal(started[1].from, DS)
  assert.equal(started[1].fromId, 'vapi-num-1')
  delete store.deedstoneFrom
  started.length = 0
  await aiStart(store, provider, { now: () => 0, from: OLD, words: { opening: 'Hi {first}' } }, 'c1')
  assert.equal(started[0].from, OLD, 'no pool yet: AI_FROM_NUMBER')
})
