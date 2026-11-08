/**
 * P882 — the calling engine's Twilio side, simulated (mocked Twilio REST, in-memory stores, no real calls):
 * fulfillment-call's line path (every call type), fulfillment-voice's line joins and the dropped-call rescue,
 * and help-voice ringing ONE VA through the queue (after hours: the greeting; nobody in 2 min: the sweep).
 * Run: node --test supabase/functions/fulfillment-call/lines.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { handle as callHandle, type Store as CallStore } from './core.ts'
import { actLine, endLine, PREDIAL_WORDS, type Line, type LineLeg, type LineStore } from './lines.ts'
import { handle as voice, twilioSignature, type Store as VoiceStore, type LineVoiceStore, type VoiceLine } from '../fulfillment-voice/core.ts'
import { handle as help, AFTER_HOURS, type Store as HelpStore, type RouteStore, type HelpCall } from '../help-voice/core.ts'

const VA = '11111111-1111-4111-8111-111111111111'
const VA2 = '22222222-2222-4222-8222-222222222222'
const ADMIN = '33333333-3333-4333-8333-333333333333'
const LEAD = '55555555-5555-4555-8555-555555555555'
const POL = '44444444-4444-4444-8444-444444444444'
const LINE = '66666666-6666-4666-8666-666666666666'
const ENV = { from: '+15550001111', voiceUrl: 'https://x.supabase.co/functions/v1/fulfillment-voice', configured: true }

function world(over: { line?: Partial<Line>; legs?: LineLeg[]; predial?: { ok: boolean; reason: string | null; next_at: string | null };
  live?: boolean; handoff?: 'queued' | 'no_one'; vm?: string | null; conf?: boolean } = {}) {
  const legs: LineLeg[] = over.legs ?? []
  const calls: { method: string; path: string; params?: any }[] = []
  const log: any[] = []
  const line: Line = { id: LINE, kind: 'lead', conference: `line-${LINE}`, lead_id: LEAD, policy_id: null, help_call_sid: null,
    va_id: VA, va_call_sid: 'CAva', status: 'live', ...over.line }
  const roles: Record<string, string> = { [VA]: 'fulfillment', [VA2]: 'fulfillment', [ADMIN]: 'admin' }
  const store: LineStore = {
    async role(id) { return roles[id] ?? null },
    async voiceLive() { return over.live ?? true },
    async line(id) { return id === LINE ? { ...line } : null },
    async lead(id) { return id === LEAD ? { id: LEAD, phone: '(555) 222-3333', state: 'TX', assigned_rep_id: 'agent-1' } : null },
    async policyRow(id) { return id === POL ? { id: POL, agent_id: 'agent-1', client_phone: '555-777-8888', carrier_id: 'car', state: 'FL' } : null },
    async agentCallerId() { return { caller_id_number: '+15559998888', caller_id_enabled: true } },
    async agentPhone() { return '555-444-0000' },
    async carrierPhone(id) { return id === 'car' || id === 'car-2' ? '1-800-555-0100' : null },
    async voicemailText() { return over.vm === undefined ? 'Hi, this is Deedstone returning your call.' : over.vm },
    async lineLegs() { return legs.filter(l => l.status !== 'ended').map(l => ({ ...l })) },
    async saveLineLeg(p) { const had = legs.find(l => l.call_sid === p.call_sid); if (had) Object.assign(had, p); else legs.push(p as LineLeg) },
    async lineOpen(va, lead, pol) { log.push(['open', va, lead, pol]); if (va === VA2) throw new Error('Take this lead from your queue first'); return LINE },
    async lineEnded(id, reason) { log.push(['ended', id, reason]) },
    async lineHoldState(id) { log.push(['holdstate', id]) },
    async lineHandoff(id, va, detail) { log.push(['handoff', id, va, detail]); return over.handoff ?? 'queued' },
    async lineRequeue(id) { log.push(['requeue', id]) },
    async predial(phone, state, lead, pol) { log.push(['predial', phone, state, lead, pol]); return over.predial ?? { ok: true, reason: null, next_at: null } },
    async logAttempt(phone) { log.push(['attempt', phone]) },
    async endHelpCall(sid, reason) { log.push(['helpEnded', sid, reason]) },
  }
  const twilio = async (method: 'GET' | 'POST' | 'DELETE', path: string, params?: any) => {
    calls.push({ method, path, params })
    if (method === 'GET' && path.startsWith('/Conferences.json')) return { status: 200, data: { conferences: over.conf === false ? [] : [{ sid: 'CF1' }] } }
    if (method === 'POST' && path === '/Conferences/CF1/Participants.json') return { status: 201, data: { call_sid: `CA${calls.length}` } }
    return { status: 200, data: {} }
  }
  return { store, twilio, legs, calls, log }
}
const leg = (party: LineLeg['party'], status: LineLeg['status'] = 'live', on_hold = false): LineLeg =>
  ({ call_sid: `CA-${party}`, line_id: LINE, conference_sid: 'CF1', party, status, on_hold })
const posts = (calls: any[]) => calls.filter(c => c.method !== 'GET')

test('open_line: only from a task (lead or policy), the SQL rule decides; no number is ever taken from the browser', async () => {
  const w = world()
  assert.deepEqual(await actLine(w.store, w.twilio, ENV, VA, { action: 'open_line', lead_id: LEAD }), { ok: true, line_id: LINE })
  await assert.rejects(actLine(w.store, w.twilio, ENV, VA, { action: 'open_line', phone: '+15551234567' }), { code: 'no_task' })
  await assert.rejects(actLine(w.store, w.twilio, ENV, VA2, { action: 'open_line', lead_id: LEAD }), { code: 'task', message: /queue first/ })
  await assert.rejects(actLine(w.store, w.twilio, ENV, 'agent', { action: 'open_line', lead_id: LEAD }), { status: 403 })
  const off = world({ live: false })
  await assert.rejects(actLine(off.store, off.twilio, ENV, VA, { action: 'open_line', lead_id: LEAD }), { code: 'voice_off' })
  assert.equal(posts(w.calls).length, 0)
})

test('ring_client runs the pre-dial check first; a block says why and when, and nothing is dialed', async () => {
  const blocked = world({ predial: { ok: false, reason: 'outside_hours', next_at: '2026-11-08T14:00:00Z' } })
  await assert.rejects(actLine(blocked.store, blocked.twilio, ENV, VA, { line_id: LINE, action: 'ring_client' }),
    (e: any) => e.code === 'predial' && e.extra.reason === 'outside_hours' && e.extra.next_at === '2026-11-08T14:00:00Z'
      && e.message.includes(PREDIAL_WORDS.outside_hours))
  assert.equal(posts(blocked.calls).length, 0)
  for (const r of ['opted_out', 'dnc', 'no_consent', 'attempt_cap', 'national_dnc']) {
    const w = world({ predial: { ok: false, reason: r, next_at: null } })
    await assert.rejects(actLine(w.store, w.twilio, ENV, VA, { line_id: LINE, action: 'ring_client' }), { code: 'predial' })
    assert.equal(posts(w.calls).length, 0, r)
  }
  const ok = world()
  const res = await actLine(ok.store, ok.twilio, ENV, VA, { line_id: LINE, action: 'ring_client' })
  assert.ok(res.call_sid)
  const add = posts(ok.calls)[0]
  assert.equal(add.params.To, '+15552223333')
  assert.equal(add.params.From, ENV.from, 'a lead sees Deedstone (Ohvara) caller ID')
  assert.equal(add.params.Label, 'lead')
  assert.deepEqual(ok.log.find(l => l[0] === 'predial'), ['predial', '+15552223333', 'TX', LEAD, null])
  assert.ok(ok.log.some(l => l[0] === 'attempt'), 'the attempt is logged for the cap')
})

test('servicing call: the client sees Ohvara\'s number (P890); carriers and the agent come from the directory and profile', async () => {
  const w = world({ line: { kind: 'servicing', lead_id: null, policy_id: POL } })
  await actLine(w.store, w.twilio, ENV, VA, { line_id: LINE, action: 'ring_client' })
  assert.equal(posts(w.calls)[0].params.From, '+15550001111')
  assert.equal(posts(w.calls)[0].params.Label, 'client')
  await actLine(w.store, w.twilio, ENV, VA, { line_id: LINE, action: 'ring_carrier', carrier_id: 'car-2' })
  const car = posts(w.calls).find(c => c.params?.Label === 'carrier')
  assert.equal(car.params.To, '+18005550100')
  await actLine(w.store, w.twilio, ENV, VA, { line_id: LINE, action: 'ring_agent' })
  assert.equal(posts(w.calls).find(c => c.params?.Label === 'agent').params.To, '+15554440000')
  await assert.rejects(actLine(w.store, w.twilio, ENV, VA, { line_id: LINE, action: 'ring_carrier', carrier_id: 'nope' }), { code: 'no_carrier_phone' })
})

test('hold, keypad, merge 3+, drop one person', async () => {
  const w = world({ legs: [leg('lead'), leg('carrier', 'live', true), leg('agent', 'live', true)] })
  await actLine(w.store, w.twilio, ENV, VA, { line_id: LINE, action: 'dtmf', digits: '1#', party: 'carrier' })
  assert.match(posts(w.calls).at(-1).params.AnnounceUrl, /event=dtmf&digits=1%23/)
  const m = await actLine(w.store, w.twilio, ENV, VA, { line_id: LINE, action: 'merge' })
  assert.equal(m.on_call, 4, 'VA + lead + carrier + agent')
  assert.ok(w.legs.every(l => !l.on_hold))
  await actLine(w.store, w.twilio, ENV, VA, { line_id: LINE, action: 'hold', party: 'lead' })
  assert.equal(w.legs.find(l => l.party === 'lead')!.on_hold, true)
  await actLine(w.store, w.twilio, ENV, VA, { line_id: LINE, action: 'end', party: 'agent' })
  assert.equal(w.legs.find(l => l.party === 'agent')!.status, 'ended')
  assert.ok(w.log.filter(l => l[0] === 'holdstate').length >= 3, 'presence (carrier-only hold) is recomputed after changes')
  await assert.rejects(actLine(w.store, w.twilio, ENV, VA, { line_id: LINE, action: 'dtmf', digits: 'abc' }), { status: 400 })
})

test('another VA cannot touch the line; an admin can; end_all closes it (VA to wrap-up)', async () => {
  const w = world({ legs: [leg('lead')] })
  await assert.rejects(actLine(w.store, w.twilio, ENV, VA2, { line_id: LINE, action: 'hold', party: 'lead' }), { status: 403 })
  await actLine(w.store, w.twilio, ENV, ADMIN, { line_id: LINE, action: 'hold', party: 'lead' })
  await actLine(w.store, w.twilio, ENV, VA, { line_id: LINE, action: 'end_all' })
  assert.deepEqual(posts(w.calls).at(-1), { method: 'POST', path: '/Conferences/CF1.json', params: { Status: 'completed' } })
  assert.ok(w.log.some(l => l[0] === 'ended' && l[2] === 'va_end'))
})

test('voicemail drop: says the set message and drops that leg; refused until the words are set', async () => {
  const w = world({ legs: [leg('lead')] })
  await actLine(w.store, w.twilio, ENV, VA, { line_id: LINE, action: 'voicemail' })
  const vm = posts(w.calls).at(-1)
  assert.equal(vm.path, '/Calls/CA-lead.json')
  assert.match(vm.params.Twiml, /<Say>Hi, this is Deedstone returning your call\.<\/Say><Hangup\/>/)
  assert.equal(w.legs[0].status, 'ended')
  const none = world({ legs: [leg('lead')], vm: null })
  await assert.rejects(actLine(none.store, none.twilio, ENV, VA, { line_id: LINE, action: 'voicemail' }), { code: 'no_voicemail_words' })
})

test('carrier hold hand-off: only with no client on; queued, or nobody on shift (overtime or re-queue)', async () => {
  const withClient = world({ legs: [leg('carrier'), leg('client', 'live', true)] })
  await assert.rejects(actLine(withClient.store, withClient.twilio, ENV, VA, { line_id: LINE, action: 'handoff_hold' }), { code: 'client_on' })
  const w = world({ legs: [leg('carrier')] })
  const r = await actLine(w.store, w.twilio, ENV, VA, { line_id: LINE, action: 'handoff_hold',
    detail: { carrier: 'Acme Life', menu_path: '2, 1, 4', client: 'Ann Lee', notes: 'Asked for the cancel desk', junk: { x: 1 } } })
  assert.deepEqual(r, { ok: true, queued: true })
  assert.deepEqual(w.log.find(l => l[0] === 'handoff')[3], { carrier: 'Acme Life', menu_path: '2, 1, 4', client: 'Ann Lee', notes: 'Asked for the cancel desk' })
  const nobody = world({ legs: [leg('carrier')], handoff: 'no_one' })
  assert.deepEqual(await actLine(nobody.store, nobody.twilio, ENV, VA, { line_id: LINE, action: 'handoff_hold' }), { ok: true, no_one: true })
  const rq = await actLine(nobody.store, nobody.twilio, ENV, VA, { line_id: LINE, action: 'requeue' })
  assert.deepEqual(rq, { ok: true, requeued: true })
  assert.ok(nobody.log.some(l => l[0] === 'requeue'))
})

test('Need help: an admin listens muted, whispers to the VA only, or joins', async () => {
  const w = world()
  await assert.rejects(actLine(w.store, w.twilio, ENV, VA, { line_id: LINE, action: 'coach', mode: 'listen', call_sid: 'CAadm' }), { status: 403 })
  await actLine(w.store, w.twilio, ENV, ADMIN, { line_id: LINE, action: 'coach', mode: 'listen', call_sid: 'CAadm' })
  assert.deepEqual(posts(w.calls).at(-1).params, { Muted: 'true', Coaching: 'false' })
  await actLine(w.store, w.twilio, ENV, ADMIN, { line_id: LINE, action: 'coach', mode: 'whisper', call_sid: 'CAadm' })
  assert.deepEqual(posts(w.calls).at(-1).params, { Muted: 'false', Coaching: 'true', CallSidToCoach: 'CAva' })
  await actLine(w.store, w.twilio, ENV, ADMIN, { line_id: LINE, action: 'coach', mode: 'join', call_sid: 'CAadm' })
  assert.deepEqual(posts(w.calls).at(-1).params, { Muted: 'false', Coaching: 'false' })
})

test('the sweep\'s end_line: x-ohvara-cron only, ends every leg and the caller with a short message', async () => {
  const w = world({ line: { kind: 'inbound', help_call_sid: 'CAcaller', conference: 'help-CAcaller' }, legs: [leg('carrier')] })
  const legacy = { userFromJwt: async () => null } as unknown as CallStore
  const lines = { store: w.store, isCron: async (s: string) => s === 'right' }
  const req = (secret: string) => new Request('http://x/fulfillment-call', { method: 'POST', headers: { 'x-ohvara-cron': secret }, body: JSON.stringify({ cron: 'end_line', line_id: LINE }) })
  assert.equal((await callHandle(req('wrong'), legacy, w.twilio, ENV, lines)).status, 403)
  const res = await callHandle(req('right'), legacy, w.twilio, ENV, lines)
  assert.equal(res.status, 200)
  assert.ok(posts(w.calls).some(c => c.path === '/Calls/CAcaller.json' && /Hangup/.test(c.params.Twiml)))
  assert.ok(w.log.some(l => l[0] === 'helpEnded') && w.log.some(l => l[0] === 'ended' && l[2] === 'rescue_timeout'))
  assert.deepEqual(await endLine(w.store, w.twilio, '66666666-6666-4666-8666-000000000000'), { ok: true, gone: true })
})

// ── fulfillment-voice: joining a line, the rescue ───────────────────────────────────────────────────────────
const TOKEN = 'tok'
const VURL = 'https://x.supabase.co/functions/v1/fulfillment-voice'
const HURL = 'https://x.supabase.co/functions/v1/help-voice'
async function signed(url: string, path: string, query: string, form: Record<string, string>) {
  return new Request(`http://internal/${path}${query}`, {
    method: 'POST',
    headers: { 'X-Twilio-Signature': await twilioSignature(TOKEN, url + query, form), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form),
  })
}
function voiceWorld(line: Partial<VoiceLine> = {}, claim = true) {
  const log: any[] = []
  const l: VoiceLine = { id: LINE, kind: 'lead', conference: `line-${LINE}`, help_call_sid: null, va_id: VA, va_call_sid: 'CAva', status: 'open', ...line }
  const lines: LineVoiceStore = {
    async line(id) { return id === LINE ? { ...l } : null },
    async lineJoined(id, va, sid) { log.push(['joined', va, sid]); return l.status !== 'ended' },
    async lineVaLeft(id, sid) { log.push(['left', sid]); return l.status === 'live' && sid === l.va_call_sid },
    async lineEnded(id, r) { log.push(['ended', r]) },
    async lineHoldState() { log.push(['holdstate']) },
    async claimHelpCall(sid, va, vaSid) { log.push(['claim', sid, va, vaSid]); return claim },
    async saveLineLeg(p) { log.push(['leg', p]) },
    async liveLineLegs() { return [{ call_sid: 'CA-lead', on_hold: false }, { call_sid: 'CA-carrier', on_hold: true }] },
    async endLineLegs(id, r) { log.push(['legsEnded', r]) },
  }
  const store = {
    lines,
    async role(id: string) { return ({ [VA]: 'fulfillment', [VA2]: 'fulfillment', [ADMIN]: 'admin' } as any)[id] ?? null },
    async policy() { return null },
    async voiceLive() { return true },
    async saveLeg() {}, async setHold(sid: string, h: boolean) { log.push(['setHold', sid, h]) }, async endLegs() {},
    async recording() { return { live: true, notice: 'x' } }, async startRecording() { log.push(['REC']) }, async claimNotice() { return 'CF' },
  } as VoiceStore
  return { store, log }
}

test('fulfillment-voice: the VA joins their line (no recording, stays up if they drop); others are refused', async () => {
  const w = voiceWorld()
  const env = { authToken: TOKEN, publicUrl: VURL, helpUrl: HURL }
  const xml = await (await voice(await signed(VURL, 'fulfillment-voice', '', { From: `client:${VA}`, line_id: LINE, CallSid: 'CAnew' }), w.store, env)).text()
  assert.match(xml, new RegExp(`<Conference beep="false" startConferenceOnEnter="true" endConferenceOnExit="false".*>line-${LINE}</Conference>`))
  assert.doesNotMatch(xml, /record/i)
  assert.deepEqual(w.log[0], ['joined', VA, 'CAnew'])
  const other = await (await voice(await signed(VURL, 'fulfillment-voice', '', { From: `client:${VA2}`, line_id: LINE, CallSid: 'CAx' }), w.store, env)).text()
  assert.match(other, /belongs to another VA/)
  const adminListen = await (await voice(await signed(VURL, 'fulfillment-voice', '', { From: `client:${ADMIN}`, line_id: LINE, mode: 'listen', CallSid: 'CAadm' }), w.store, env)).text()
  assert.match(adminListen, /muted="true"/)
  const adminWhisper = await (await voice(await signed(VURL, 'fulfillment-voice', '', { From: `client:${ADMIN}`, line_id: LINE, mode: 'whisper', CallSid: 'CAadm' }), w.store, env)).text()
  assert.match(adminWhisper, /coach="CAva"/)
  assert.ok(!w.log.some(l => l[0] === 'REC'))
})

test('fulfillment-voice: a caller\'s line joins help-voice\'s conference; a caller who hung up ends it', async () => {
  const w = voiceWorld({ kind: 'inbound', help_call_sid: 'CAcaller', conference: 'help-CAcaller' })
  const env = { authToken: TOKEN, publicUrl: VURL, helpUrl: HURL }
  const xml = await (await voice(await signed(VURL, 'fulfillment-voice', '', { From: `client:${VA}`, line_id: LINE, CallSid: 'CAva2' }), w.store, env)).text()
  assert.match(xml, />help-CAcaller<\/Conference>/)
  assert.match(xml, /help-voice\?event=conf&amp;call=CAcaller/)
  assert.deepEqual(w.log.find(l => l[0] === 'claim'), ['claim', 'CAcaller', VA, 'CAva2'])
  const gone = voiceWorld({ kind: 'inbound', help_call_sid: 'CAcaller', conference: 'help-CAcaller' }, false)
  const say = await (await voice(await signed(VURL, 'fulfillment-voice', '', { From: `client:${VA}`, line_id: LINE, CallSid: 'CAva2' }), gone.store, env)).text()
  assert.match(say, /caller has hung up/)
})

test('rescue: the VA\'s leg dropping puts the others on hold music; their return takes them off; conference end = wrap-up', async () => {
  const calls: any[] = []
  const twilio = async (method: string, path: string, params?: any) => { calls.push([method, path, params]); return { status: 200, data: {} } }
  const w = voiceWorld({ status: 'live' })
  const env = { authToken: TOKEN, publicUrl: VURL, twilio: twilio as any }
  const q = `?event=conf&line=${LINE}`
  await voice(await signed(VURL, 'fulfillment-voice', q, { StatusCallbackEvent: 'participant-leave', CallSid: 'CAva', ConferenceSid: 'CF9' }), w.store, env)
  assert.deepEqual(calls, [['POST', '/Conferences/CF9/Participants/CA-lead.json', { Hold: 'true' }]], 'only the one not already on hold')
  calls.length = 0
  await voice(await signed(VURL, 'fulfillment-voice', q, { StatusCallbackEvent: 'participant-leave', CallSid: 'CA-lead', ConferenceSid: 'CF9' }), w.store, env)
  assert.equal(calls.length, 0, 'someone else leaving is not a rescue')
  await voice(await signed(VURL, 'fulfillment-voice', q, { StatusCallbackEvent: 'participant-join', CallSid: 'CAva', ConferenceSid: 'CF9' }), w.store, env)
  assert.deepEqual(calls, [['POST', '/Conferences/CF9/Participants/CA-carrier.json', { Hold: 'false' }]])
  await voice(await signed(VURL, 'fulfillment-voice', q, { StatusCallbackEvent: 'conference-end', ConferenceSid: 'CF9' }), w.store, env)
  assert.ok(w.log.some(l => l[0] === 'ended' && l[1] === 'conference-end'))
})

// ── help-voice: ring ONE VA through the queue ─────────────────────────────────────────────────────────────
function helpWorld(over: { desk?: boolean; queued?: boolean; rescue?: boolean } = {}) {
  const rows = new Map<string, HelpCall>()
  const log: any[] = []
  const store: HelpStore = {
    async voiceLive() { return true },
    async activeVas() { log.push(['activeVas']); return [VA, VA2] },
    async insertHelpCall(row) { if (rows.has(row.call_sid)) return false; rows.set(row.call_sid, row as HelpCall); return true },
    async helpCall(sid) { return rows.get(sid) ?? null },
    async claimHelpCall() { return null },
    async updateHelpCall(sid, patch, when) {
      const r = rows.get(sid); if (!r || (when && !when.includes(r.status))) return null
      Object.assign(r, patch); return { ...r }
    },
    async setLeadTransferStatus() {}, async logMissedTransfer() {},
  }
  const route: RouteStore = {
    async deskOpen() { return over.desk ?? true },
    async afterHoursText() { return null },
    async routeInbound(sid, caller) { log.push(['route', sid, caller]); return { queue_id: over.queued === false ? null : 'q1' } },
    async afterHoursCall(sid, caller) { log.push(['afterHours', sid, caller]) },
    async inboundGone(sid) { log.push(['gone', sid]) },
    async vaLeftLine(sid, leg) { log.push(['vaLeft', sid, leg]); return over.rescue ?? true },
    async isCron(s) { return s === 'right' },
  }
  return { store, route, rows, log }
}

test('help-voice: a caller is queued for ONE VA and waits on hold music; no VA phone is rung by Twilio', async () => {
  const calls: any[] = []
  const twilio = async (m: string, p: string, params?: any) => { calls.push([m, p, params]); return { status: 201, data: { sid: 'CAleg' } } }
  const w = helpWorld()
  const env = { authToken: TOKEN, publicUrl: HURL }
  const xml = await (await help(await signed(HURL, 'help-voice', '', { CallSid: 'CAin', From: '+15552223333', To: '+15550009999' }), w.store, twilio as any, env, w.route)).text()
  assert.match(xml, /startConferenceOnEnter="false" endConferenceOnExit="true"/)
  assert.deepEqual(w.log, [['route', 'CAin', '+15552223333']])
  assert.equal(calls.length, 0, 'never rings every VA')
  assert.equal(w.rows.get('CAin')!.status, 'ringing')
})

test('help-voice after 6 PM Central: the greeting, a callback for the morning, no wait', async () => {
  const w = helpWorld({ desk: false })
  const xml = await (await help(await signed(HURL, 'help-voice', '', { CallSid: 'CAlate', From: '+15552223333' }), w.store, null, { authToken: TOKEN, publicUrl: HURL }, w.route)).text()
  assert.match(xml, new RegExp(`<Say>${AFTER_HOURS.replace(/\./g, '\\.')}</Say><Hangup/>`))
  assert.deepEqual(w.log, [['afterHours', 'CAlate', '+15552223333']])
  assert.equal(w.rows.get('CAlate')!.end_reason, 'after_hours')
})

test('help-voice: the VA dropping off a live caller = rescue (caller on hold), not the end; the sweep times out a wait', async () => {
  const calls: any[] = []
  const twilio = async (m: string, p: string, params?: any) => { calls.push([m, p, params]); return { status: 200, data: {} } }
  const w = helpWorld()
  w.rows.set('CAin', { call_sid: 'CAin', status: 'live', va_call_sid: 'CAva', conference_sid: 'CF1', outcome: null } as HelpCall)
  const env = { authToken: TOKEN, publicUrl: HURL }
  await help(await signed(HURL, 'help-voice', '?event=conf&call=CAin', { StatusCallbackEvent: 'participant-leave', CallSid: 'CAva', ConferenceSid: 'CF1' }), w.store, twilio as any, env, w.route)
  assert.deepEqual(calls, [['POST', '/Conferences/CF1/Participants/CAin.json', { Hold: 'true' }]])
  assert.equal(w.rows.get('CAin')!.status, 'live')
  calls.length = 0
  await help(await signed(HURL, 'help-voice', '?event=conf&call=CAin', { StatusCallbackEvent: 'participant-join', CallSid: 'CAva', ConferenceSid: 'CF1' }), w.store, twilio as any, env, w.route)
  assert.deepEqual(calls, [['POST', '/Conferences/CF1/Participants/CAin.json', { Hold: 'false' }]])
  // The sweep's timeout: cron secret only.
  w.rows.set('CAwait', { call_sid: 'CAwait', status: 'ringing' } as HelpCall)
  const cron = (s: string) => new Request('http://x/help-voice', { method: 'POST', headers: { 'x-ohvara-cron': s }, body: JSON.stringify({ cron: 'timeout', call: 'CAwait' }) })
  assert.equal((await help(cron('wrong'), w.store, twilio as any, env, w.route)).status, 403)
  const res = await (await help(cron('right'), w.store, twilio as any, env, w.route)).json()
  assert.deepEqual(res, { ok: true, ended: true })
  assert.equal(w.rows.get('CAwait')!.end_reason, 'no_va_in_time')
})
