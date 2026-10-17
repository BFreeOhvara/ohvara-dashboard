/**
 * Node unit tests for the pop-up phone's two Twilio functions (Prompt 751),
 * with a mocked Twilio REST client and an in-memory store. No real calls.
 * Run: node --test supabase/functions/fulfillment-call/core.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { act, handle, clientCallerId, toE164, type Leg, type Store, type Twilio } from './core.ts'
import { handle as voice, twilioSignature, legStatus, type Store as VoiceStore } from '../fulfillment-voice/core.ts'

const REP = '11111111-1111-4111-8111-111111111111'
const OTHER = '22222222-2222-4222-8222-222222222222'
const ADMIN = '33333333-3333-4333-8333-333333333333'
const POL = '44444444-4444-4444-8444-444444444444'
const ENV = { from: '+15550001111', voiceUrl: 'https://x.supabase.co/functions/v1/fulfillment-voice', configured: true }

function world(over: { legs?: Leg[]; live?: boolean; callerId?: boolean; stage?: string; carrierPhone?: string | null; demo?: boolean } = {}) {
  const legs: Leg[] = over.legs ?? []
  const calls: { method: string; path: string; params?: any }[] = []
  const roles: Record<string, string> = { [REP]: 'fulfillment', [OTHER]: 'fulfillment', [ADMIN]: 'admin' }
  const store: Store = {
    async userFromJwt(jwt) { return jwt === 'good' ? REP : null },
    async role(id) { return roles[id] ?? null },
    async policy(id) {
      return id === POL ? {
        id: POL, agent_id: 'agent', client_phone: '(555) 222-3333', fulfillment_assigned: true,
        assigned_fulfillment_id: REP, fulfillment_stage: over.stage ?? 'In Progress', carrier_id: 'car', is_demo: !!over.demo,
      } : null
    },
    async agentCallerId() { return over.callerId ? { caller_id_number: '+15559998888', caller_id_enabled: true } : { caller_id_number: '+15559998888', caller_id_enabled: false } },
    async carrierPhone() { return over.carrierPhone === undefined ? '1-800-555-0100' : over.carrierPhone },
    async voiceLive() { return over.live ?? true },
    async openLegs() { return legs.filter(l => l.status !== 'ended').map(l => ({ ...l })) },
    async saveLeg(patch) {
      const had = legs.find(l => l.call_sid === patch.call_sid)
      if (had) Object.assign(had, patch)
      else legs.push(patch as Leg)
    },
  }
  const twilio: Twilio = async (method, path, params) => {
    calls.push({ method, path, params })
    if (method === 'GET' && path.startsWith('/Conferences.json')) return { status: 200, data: { conferences: [{ sid: 'CF1' }] } }
    if (method === 'POST' && path === '/Conferences/CF1/Participants.json') return { status: 201, data: { call_sid: `CA${calls.length}` } }
    return { status: 200, data: {} }
  }
  return { store, twilio, legs, calls }
}

const leg = (party: 'client' | 'carrier', status: Leg['status'], on_hold = false): Leg =>
  ({ call_sid: `CA-${party}`, policy_id: POL, conference_sid: 'CF1', party, status, on_hold })

const posts = (calls: any[]) => calls.filter(c => c.method !== 'GET')

test('E.164 and the client caller ID rule', () => {
  assert.equal(toE164('(555) 222-3333'), '+15552223333')
  assert.equal(toE164('1-800-555-0100'), '+18005550100')
  assert.equal(toE164('12'), null)
  assert.equal(clientCallerId({ caller_id_number: '+1555', caller_id_enabled: true }, '+1000'), '+1555')
  assert.equal(clientCallerId({ caller_id_number: '+1555', caller_id_enabled: false }, '+1000'), '+1000')
  assert.equal(clientCallerId(null, '+1000'), '+1000')
})

test('permission checks: role, assignment, admin, done, voice off', async () => {
  const w = world()
  await assert.rejects(act(w.store, w.twilio, ENV, 'nobody', { policy_id: POL, action: 'ring_client' }), { status: 403 })
  await assert.rejects(act(w.store, w.twilio, ENV, OTHER, { policy_id: POL, action: 'ring_client' }), { status: 403 })
  await assert.rejects(act(w.store, w.twilio, ENV, REP, { policy_id: 'nope', action: 'ring_client' }), { status: 404 })
  await assert.rejects(act(w.store, w.twilio, ENV, REP, { policy_id: POL, action: 'fly' }), { status: 400 })
  const done = world({ stage: 'Complete' })
  await assert.rejects(act(done.store, done.twilio, ENV, REP, { policy_id: POL, action: 'ring_client' }), { code: 'done' })
  const off = world({ live: false })
  await assert.rejects(act(off.store, off.twilio, ENV, REP, { policy_id: POL, action: 'ring_client' }), { code: 'voice_off' })
  assert.equal(off.calls.length, 0)
  const admin = world()
  assert.equal((await act(admin.store, admin.twilio, ENV, ADMIN, { policy_id: POL, action: 'ring_client' })).ok, true)
})

test('P775: an App Review sample booking never reaches Twilio', async () => {
  const demo = world({ demo: true })
  for (const action of ['ring_client', 'ring_carrier', 'hold', 'end_all']) {
    await assert.rejects(act(demo.store, demo.twilio, ENV, REP, { policy_id: POL, action }), { code: 'demo', status: 409 })
  }
  assert.equal(demo.calls.length, 0)
})

test('handle: no JWT is 401, a refusal is its status + code', async () => {
  const w = world()
  const req = (auth: string | null, body: any) => new Request('http://x', { method: 'POST', headers: auth ? { Authorization: `Bearer ${auth}` } : {}, body: JSON.stringify(body) })
  assert.equal((await handle(req(null, {}), w.store, w.twilio, ENV)).status, 401)
  const res = await handle(req('good', { policy_id: POL, action: 'hold', party: 'client' }), w.store, w.twilio, ENV)
  assert.equal(res.status, 409)
  assert.equal((await res.json()).code, 'no_leg')
})

test('ring client: conference participant from the agent number when on, else Ohvara', async () => {
  const w = world({ callerId: true })
  await act(w.store, w.twilio, ENV, REP, { policy_id: POL, action: 'ring_client' })
  const [get, add] = w.calls
  assert.match(get.path, /FriendlyName=policy-44444444/)
  assert.match(get.path, /Status=in-progress/)
  assert.equal(add.path, '/Conferences/CF1/Participants.json')
  assert.equal(add.params.From, '+15559998888')
  assert.equal(add.params.To, '+15552223333')
  assert.equal(add.params.EndConferenceOnExit, 'false')
  assert.deepEqual(add.params.StatusCallbackEvent, ['initiated', 'ringing', 'answered', 'completed'])
  assert.match(add.params.StatusCallback, /event=leg&policy=44444444-4444-4444-8444-444444444444&party=client/)
  assert.equal(w.legs[0].party, 'client')
  assert.equal(w.legs[0].status, 'ringing')

  const plain = world()
  await act(plain.store, plain.twilio, ENV, REP, { policy_id: POL, action: 'ring_client' })
  assert.equal(plain.calls[1].params.From, '+15550001111')
  // already on the line
  await assert.rejects(act(plain.store, plain.twilio, ENV, REP, { policy_id: POL, action: 'ring_client' }), { code: 'already_on' })
})

test('ring carrier: from Ohvara\'s number; a talking client is put on hold first', async () => {
  const w = world({ legs: [leg('client', 'live')] })
  await act(w.store, w.twilio, ENV, REP, { policy_id: POL, action: 'ring_carrier' })
  const [hold, add] = posts(w.calls)
  assert.equal(hold.path, '/Conferences/CF1/Participants/CA-client.json')
  assert.deepEqual(hold.params, { Hold: 'true' })
  assert.equal(add.params.From, '+15550001111')
  assert.equal(add.params.To, '+18005550100')
  assert.equal(add.params.Label, 'carrier')
  assert.equal(w.legs.find(l => l.party === 'client')!.on_hold, true)

  // bringing the client back holds a talking carrier
  const back = world({ legs: [leg('carrier', 'live')] })
  await act(back.store, back.twilio, ENV, REP, { policy_id: POL, action: 'ring_client' })
  assert.deepEqual(posts(back.calls)[0], { method: 'POST', path: '/Conferences/CF1/Participants/CA-carrier.json', params: { Hold: 'true' } })

  const none = world({ carrierPhone: null })
  await assert.rejects(act(none.store, none.twilio, ENV, REP, { policy_id: POL, action: 'ring_carrier' }), { code: 'no_carrier_phone' })
})

test('no conference yet: refused before any participant call', async () => {
  const w = world()
  w.twilio = async (method, path) => (w.calls.push({ method, path }), { status: 200, data: { conferences: [] } })
  await assert.rejects(act(w.store, w.twilio, ENV, REP, { policy_id: POL, action: 'ring_client' }), { code: 'no_conference' })
  assert.equal(w.calls.length, 1)
})

test('hold, resume, swap, merge', async () => {
  const w = world({ legs: [leg('client', 'live'), leg('carrier', 'live', true)] })
  await act(w.store, w.twilio, ENV, REP, { policy_id: POL, action: 'swap' })
  assert.deepEqual(posts(w.calls).map(c => [c.path, c.params.Hold]), [
    ['/Conferences/CF1/Participants/CA-client.json', 'true'],
    ['/Conferences/CF1/Participants/CA-carrier.json', 'false'],
  ])
  w.calls.length = 0
  await act(w.store, w.twilio, ENV, REP, { policy_id: POL, action: 'merge' })
  assert.deepEqual(posts(w.calls).map(c => [c.path, c.params.Hold]), [['/Conferences/CF1/Participants/CA-client.json', 'false']])
  assert.ok(w.legs.every(l => !l.on_hold))
  await assert.rejects(act(w.store, w.twilio, ENV, REP, { policy_id: POL, action: 'swap' }), { code: 'no_swap' })
  w.calls.length = 0
  await act(w.store, w.twilio, ENV, REP, { policy_id: POL, action: 'hold', party: 'carrier' })
  await act(w.store, w.twilio, ENV, REP, { policy_id: POL, action: 'hold', party: 'carrier' }) // already held: no call
  await act(w.store, w.twilio, ENV, REP, { policy_id: POL, action: 'resume', party: 'carrier' })
  assert.deepEqual(posts(w.calls).map(c => c.params.Hold), ['true', 'false'])
  const one = world({ legs: [leg('client', 'live')] })
  await assert.rejects(act(one.store, one.twilio, ENV, REP, { policy_id: POL, action: 'merge' }), { code: 'no_merge' })
})

test('keypad: digits announced to the carrier leg only', async () => {
  const w = world({ legs: [leg('client', 'live', true), leg('carrier', 'live')] })
  await act(w.store, w.twilio, ENV, REP, { policy_id: POL, action: 'dtmf', digits: '1#' })
  const [dtmf] = posts(w.calls)
  assert.equal(dtmf.path, '/Conferences/CF1/Participants/CA-carrier.json')
  assert.equal(dtmf.params.AnnounceUrl, `${ENV.voiceUrl}?event=dtmf&digits=1%23`)
  await assert.rejects(act(w.store, w.twilio, ENV, REP, { policy_id: POL, action: 'dtmf', digits: '1;drop' }), { status: 400 })
  const noCarrier = world({ legs: [leg('client', 'live')] })
  await assert.rejects(act(noCarrier.store, noCarrier.twilio, ENV, REP, { policy_id: POL, action: 'dtmf', digits: '1' }), { code: 'no_leg' })
})

test('end one party resumes the one on hold; ringing legs are canceled; end all ends the conference', async () => {
  const w = world({ legs: [leg('client', 'live'), leg('carrier', 'live', true)] })
  await act(w.store, w.twilio, ENV, REP, { policy_id: POL, action: 'end', party: 'client' })
  assert.deepEqual(posts(w.calls).map(c => [c.path, c.params]), [
    ['/Calls/CA-client.json', { Status: 'completed' }],
    ['/Conferences/CF1/Participants/CA-carrier.json', { Hold: 'false' }],
  ])
  assert.equal(w.legs[0].status, 'ended')

  const ringing = world({ legs: [leg('carrier', 'ringing')] })
  await act(ringing.store, ringing.twilio, ENV, REP, { policy_id: POL, action: 'end', party: 'carrier' })
  assert.deepEqual(posts(ringing.calls)[0].params, { Status: 'canceled' })

  const all = world({ legs: [leg('client', 'live'), leg('carrier', 'live')] })
  await act(all.store, all.twilio, ENV, REP, { policy_id: POL, action: 'end_all' })
  assert.deepEqual(posts(all.calls), [{ method: 'POST', path: '/Conferences/CF1.json', params: { Status: 'completed' } }])
  assert.ok(all.legs.every(l => l.status === 'ended'))
})

// ── fulfillment-voice ──────────────────────────────────────────────────────
const VURL = 'https://x.supabase.co/functions/v1/fulfillment-voice'
const TOKEN = 'secret-token'

function voiceWorld(over: { live?: boolean; assigned?: string; recording?: boolean } = {}) {
  const saved: any[] = []
  const holds: any[] = []
  const ended: any[] = []
  const recs: any[] = []
  const noticed = new Set<string>()
  const store: VoiceStore = {
    async role(id) { return ({ [REP]: 'fulfillment', [OTHER]: 'fulfillment', [ADMIN]: 'admin' } as any)[id] ?? null },
    async policy(id) { return id === POL ? { id: POL, fulfillment_assigned: true, assigned_fulfillment_id: over.assigned ?? REP, fulfillment_stage: 'In Progress' } : null },
    async voiceLive() { return over.live ?? true },
    async saveLeg(p) { saved.push(p) },
    async setHold(sid, hold) { holds.push([sid, hold]) },
    async endLegs(pid, reason) { ended.push([pid, reason]) },
    async recording() { return { live: !!over.recording, notice: 'This call may be recorded & kept.' } },
    async startRecording(row) { recs.push(row) },
    async claimNotice(sid) { if (noticed.has(sid)) return null; noticed.add(sid); return 'CFconf' },
  }
  return { store, saved, holds, ended, recs }
}

async function signed(query: string, form: Record<string, string>, sig?: string) {
  const url = VURL + query
  const s = sig ?? await twilioSignature(TOKEN, url, form)
  return new Request(`http://internal/fulfillment-voice${query}`, {
    method: 'POST',
    headers: { 'X-Twilio-Signature': s, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form),
  })
}

test('signature: Twilio\'s published example, and a bad one is 403', async () => {
  // https://www.twilio.com/docs/usage/security#validating-requests
  const sig = await twilioSignature('12345', 'https://mycompany.com/myapp.php?foo=1&bar=2', {
    CallSid: 'CA1234567890ABCDE', Caller: '+12349013030', Digits: '1234', From: '+12349013030', To: '+18005551212',
  })
  assert.equal(sig, '0/KCTR6DLpKmkAf8muzZqo1nDgQ=')
  const w = voiceWorld()
  const res = await voice(await signed('', { From: `client:${REP}`, policy_id: POL }, 'nope'), w.store, { authToken: TOKEN, publicUrl: VURL })
  assert.equal(res.status, 403)
})

test('join: the assigned rep joins the policy conference; others are turned away', async () => {
  const w = voiceWorld()
  const env = { authToken: TOKEN, publicUrl: VURL }
  const ok = await (await voice(await signed('', { From: `client:${REP}`, policy_id: POL, CallSid: 'CArep' }), w.store, env)).text()
  assert.match(ok, /<Conference [^>]*endConferenceOnExit="true"[^>]*>policy-44444444-4444-4444-8444-444444444444<\/Conference>/)
  assert.match(ok, /statusCallback="https:\/\/x\.supabase\.co\/functions\/v1\/fulfillment-voice\?event=conf&amp;policy=/)
  assert.doesNotMatch(ok, /record/i)
  const other = await (await voice(await signed('', { From: `client:${OTHER}`, policy_id: POL }), w.store, env)).text()
  assert.match(other, /<Hangup\/>/)
  assert.doesNotMatch(other, /Conference/)
  const admin = await (await voice(await signed('', { From: `client:${ADMIN}`, policy_id: POL }), w.store, env)).text()
  assert.match(admin, /Conference/)
  const off = voiceWorld({ live: false })
  assert.match(await (await voice(await signed('', { From: `client:${REP}`, policy_id: POL }), off.store, env)).text(), /not on yet/)
})

test('callbacks: leg status, hold/unhold, conference end, keypad TwiML', async () => {
  const w = voiceWorld()
  const env = { authToken: TOKEN, publicUrl: VURL }
  const q = `?event=leg&policy=${POL}&party=carrier`
  await voice(await signed(q, { CallSid: 'CAk', CallStatus: 'ringing' }), w.store, env)
  await voice(await signed(q, { CallSid: 'CAk', CallStatus: 'in-progress' }), w.store, env)
  await voice(await signed(q, { CallSid: 'CAk', CallStatus: 'no-answer' }), w.store, env)
  assert.deepEqual(w.saved.map(s => [s.status, s.answered, s.end_reason]), [['ringing', false, undefined], ['live', true, undefined], ['ended', false, 'no-answer']])
  assert.equal(w.saved[0].party, 'carrier')
  const c = `?event=conf&policy=${POL}`
  await voice(await signed(c, { StatusCallbackEvent: 'participant-hold', CallSid: 'CAk' }), w.store, env)
  await voice(await signed(c, { StatusCallbackEvent: 'participant-unhold', CallSid: 'CAk' }), w.store, env)
  await voice(await signed(c, { StatusCallbackEvent: 'conference-end' }), w.store, env)
  assert.deepEqual(w.holds, [['CAk', true], ['CAk', false]])
  assert.deepEqual(w.ended, [[POL, 'conference-end']])
  const dt = await (await voice(await signed('?event=dtmf&digits=1%23', {}), w.store, env)).text()
  assert.match(dt, /<Play digits="1#"\/>/)
  assert.equal(legStatus('busy'), 'ended')
  assert.equal(legStatus('answered'), 'live')
})

test('recording on (P764): the conference records from the start, a row per rep leg, callback to cancel-check', async () => {
  const w = voiceWorld({ recording: true })
  const env = { authToken: TOKEN, publicUrl: VURL, checkUrl: 'https://x.supabase.co/functions/v1/fulfillment-cancel-check' }
  const xml = await (await voice(await signed('', { From: `client:${REP}`, policy_id: POL, CallSid: 'CArep' }), w.store, env)).text()
  assert.match(xml, /record="record-from-start"/)
  assert.match(xml, /recordingStatusCallback="https:\/\/x\.supabase\.co\/functions\/v1\/fulfillment-cancel-check\?event=rec&amp;policy=44444444-4444-4444-8444-444444444444&amp;call=CArep"/)
  assert.match(xml, /recordingStatusCallbackEvent="in-progress completed absent"/)
  assert.deepEqual(w.recs, [{ call_sid: 'CArep', policy_id: POL, rep_id: REP }])
  // Off: no record attribute, no row.
  const off = voiceWorld()
  const plain = await (await voice(await signed('', { From: `client:${REP}`, policy_id: POL, CallSid: 'CArep' }), off.store, env)).text()
  assert.doesNotMatch(plain, /record/i)
  assert.equal(off.recs.length, 0)
})

test('recording notice (P764): once per outside leg when it answers; never while recording is off', async () => {
  const calls: any[] = []
  const twilio = async (method: string, path: string, params?: any) => { calls.push([method, path, params]); return { status: 200, data: {} } }
  const w = voiceWorld({ recording: true })
  const env = { authToken: TOKEN, publicUrl: VURL, twilio: twilio as any }
  const q = `?event=leg&policy=${POL}&party=client`
  await voice(await signed(q, { CallSid: 'CAc', CallStatus: 'ringing' }), w.store, env)
  await voice(await signed(q, { CallSid: 'CAc', CallStatus: 'in-progress' }), w.store, env)
  await voice(await signed(q, { CallSid: 'CAc', CallStatus: 'in-progress' }), w.store, env)
  assert.deepEqual(calls, [['POST', '/Conferences/CFconf/Participants/CAc.json', { AnnounceUrl: `${VURL}?event=notice`, AnnounceMethod: 'POST' }]])
  const say = await (await voice(await signed('?event=notice', {}), w.store, env)).text()
  assert.match(say, /<Say>This call may be recorded &amp; kept\.<\/Say>/)
  const off = voiceWorld()
  calls.length = 0
  await voice(await signed(q, { CallSid: 'CAd', CallStatus: 'in-progress' }), off.store, env)
  assert.equal(calls.length, 0)
})
