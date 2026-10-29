/**
 * Deno unit tests for help-voice (Roadmap Goal 9): mocked Twilio callbacks,
 * an in-memory help_calls store and a Twilio REST spy. No real calls.
 * Run: deno test --node-modules-dir=none supabase/functions/help-voice
 */
import assert from 'node:assert/strict'
import { handle, helpConference, helpConferenceName, twilioSignature, type HelpCall, type Store } from './core.ts'
import type { Twilio } from '../_shared/twilio.ts'
import { agentLegParams } from '../help-transfer/core.ts'

const URL_ = 'https://x.supabase.co/functions/v1/help-voice'
const TOKEN = 'secret-token'
const VA1 = '11111111-1111-4111-8111-111111111111'
const VA2 = '22222222-2222-4222-8222-222222222222'
const ENV = { authToken: TOKEN, publicUrl: URL_, trackingNumber: '+15125550199' }
const CALLER = { CallSid: 'CA123', From: '+15125550100', To: '+15125550199' }

// No real HTTP, ever: every Twilio call goes through the fake below. Any
// stray fetch is counted (and throws) so the leave / voicemail tests fail.
let realFetches = 0
globalThis.fetch = (() => { realFetches++; throw new Error('real fetch in a test') }) as typeof fetch
const noRealFetch = () => assert.equal(realFetches, 0, 'a test made a real HTTP request')

type Participant = { call_sid: string; label?: string; status: string }

function world(over: {
  live?: boolean; vas?: string[]; rows?: HelpCall[]; legStatus?: Record<string, string>
  // conference SID -> who Twilio says is in it; answered_by per call SID.
  participants?: Record<string, Participant[]>; answeredBy?: Record<string, string>
} = {}) {
  const rows: HelpCall[] = over.rows ?? []
  const writes: any[] = []
  const calls: { method: string; path: string; params?: any }[] = []
  const legStatus: Record<string, string> = over.legStatus ?? {}
  const participants: Record<string, Participant[]> = over.participants ?? {}
  const leads: Record<string, string> = {}
  let n = 0
  const row = (sid: string) => rows.find(r => r.call_sid === sid) ?? null
  const store: Store = {
    async voiceLive() { return over.live ?? true },
    async activeVas() { return over.vas ?? [VA1, VA2] },
    async insertHelpCall(r) {
      writes.push(['insert', r])
      if (row(r.call_sid)) return false
      rows.push({ ringing_va_call_sids: [], conference_sid: null, va_id: null, va_call_sid: null, end_reason: null, outcome: null, answered_at: null, ended_at: null, ...r } as HelpCall)
      return true
    },
    async helpCall(sid) { const r = row(sid); return r && { ...r } },
    async claimHelpCall(sid, vaId, vaCallSid) {
      writes.push(['claim', sid, vaId, vaCallSid])
      const r = row(sid)
      if (!r || r.status !== 'ringing') return null
      Object.assign(r, { status: 'live', va_id: vaId, va_call_sid: vaCallSid, answered_at: 'now' })
      return { ...r }
    },
    async updateHelpCall(sid, patch, when) {
      writes.push(['update', sid, patch])
      const r = row(sid)
      if (!r || (when && !when.includes(r.status))) return null
      Object.assign(r, patch)
      return { ...r }
    },
    async setLeadTransferStatus(id, status) {
      writes.push(['lead', id, status])
      leads[id] = status
    },
  }
  const twilio: Twilio = async (method, path, params) => {
    calls.push({ method, path, params })
    if (method === 'POST' && path === '/Calls.json') return { status: 201, data: { sid: `CAva${++n}` } }
    const m = path.match(/^\/Calls\/(\w+)\.json$/)
    if (method === 'GET' && m) return { status: 200, data: { status: legStatus[m[1]] ?? 'ringing', answered_by: over.answeredBy?.[m[1]] ?? null } }
    const p = path.match(/^\/Conferences\/(\w+)\/Participants\.json$/)
    if (method === 'GET' && p) {
      return participants[p[1]] ? { status: 200, data: { participants: participants[p[1]] } } : { status: 404, data: { message: 'not found' } }
    }
    const c = path.match(/^\/Conferences\/(\w+)\.json$/)
    if (method === 'POST' && c && params?.Status === 'completed') {
      // Twilio ends the conference: everyone left, the conference is gone.
      delete participants[c[1]]
    }
    return { status: 200, data: {} }
  }
  return { store, twilio, rows, writes, calls, participants, leads }
}

async function signed(query: string, form: Record<string, string>, sig?: string) {
  const s = sig ?? await twilioSignature(TOKEN, URL_ + query, form)
  return new Request(`http://internal/help-voice${query}`, {
    method: 'POST',
    headers: { 'X-Twilio-Signature': s, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form),
  })
}

const posts = (calls: any[]) => calls.filter(c => c.method === 'POST')

// A ringing CA123 with two VA legs out.
const ringing = (over: Partial<HelpCall> = {}): HelpCall => ({
  call_sid: 'CA123', caller_number: '+15125550100', tracking_number: '+15125550199', conference_sid: null,
  va_id: null, va_call_sid: null, ringing_va_call_sids: ['CAva1', 'CAva2'], status: 'ringing', end_reason: null,
  transfer_agent_id: null, agent_call_sid: null, outcome: null, lead_id: null, answered_at: null,
  transfer_started_at: null, transferred_at: null, ended_at: null, ...over,
})

Deno.test('1. a bad signature is 403 on the inbound path and on every event', async () => {
  for (const q of ['', '?event=va_join&call=CA123&va=' + VA1, '?event=va_leg&call=CA123', '?event=agent_leg&call=CA123', '?event=conf&call=CA123']) {
    const w = world()
    const res = await handle(await signed(q, CALLER, 'nope'), w.store, w.twilio, ENV)
    assert.equal(res.status, 403, q)
    assert.equal(w.calls.length, 0)
    assert.equal(w.writes.length, 0)
  }
  // A good signature over a different query is still refused.
  const w = world()
  const sig = await twilioSignature(TOKEN, URL_ + '?event=conf&call=CA123', {})
  assert.equal((await handle(await signed('?event=va_join&call=CA123&va=' + VA1, {}, sig), w.store, w.twilio, ENV)).status, 403)
  // No auth token: 503.
  assert.equal((await handle(await signed('', CALLER), w.store, w.twilio, { ...ENV, authToken: null })).status, 503)
})

Deno.test('2. voice_live off: hang up, no <Dial>, no <Say>, 0 REST calls, no store writes', async () => {
  const w = world({ live: false })
  const xml = await (await handle(await signed('', CALLER), w.store, w.twilio, ENV)).text()
  assert.match(xml, /<Response><Hangup\/><\/Response>/)
  assert.doesNotMatch(xml, /<Dial|<Say/)
  assert.equal(w.calls.length, 0)
  assert.equal(w.writes.length, 0)
  assert.equal(w.rows.length, 0)
})

Deno.test('3. voice_live on: the caller waits in help-<CallSid>, ending it on exit', async () => {
  const w = world()
  const xml = await (await handle(await signed('', CALLER), w.store, w.twilio, ENV)).text()
  assert.match(xml, /<Conference [^>]*>help-CA123<\/Conference>/)
  assert.match(xml, /<Conference [^>]*endConferenceOnExit="true"/)
  assert.match(xml, /<Conference [^>]*startConferenceOnEnter="false"/)
  assert.match(xml, /statusCallback="https:\/\/x\.supabase\.co\/functions\/v1\/help-voice\?event=conf&amp;call=CA123"/)
  assert.equal(helpConferenceName('CA123'), 'help-CA123')
  assert.deepEqual(w.rows.map(r => [r.status, r.caller_number, r.tracking_number, r.ringing_va_call_sids]),
    [['ringing', '+15125550100', '+15125550199', ['CAva1', 'CAva2']]])
  // A retried webhook does not ring the VAs again.
  await handle(await signed('', CALLER), w.store, w.twilio, ENV)
  assert.equal(posts(w.calls).length, 2)
})

Deno.test('4. va_join: the first VA joins (endConferenceOnExit false), the other legs are canceled; a second gets <Hangup/>', async () => {
  const w = world({ rows: [ringing()] })
  const win = await (await handle(await signed(`?event=va_join&call=CA123&va=${VA1}`, { CallSid: 'CAva1' }), w.store, w.twilio, ENV)).text()
  assert.match(win, /<Conference [^>]*endConferenceOnExit="false"[^>]*>help-CA123<\/Conference>/)
  assert.match(win, /<Conference [^>]*startConferenceOnEnter="true"/)
  assert.deepEqual(w.rows[0].status, 'live')
  assert.equal(w.rows[0].va_id, VA1)
  assert.equal(w.rows[0].va_call_sid, 'CAva1')
  assert.ok(w.rows[0].answered_at)
  assert.deepEqual(posts(w.calls), [{ method: 'POST', path: '/Calls/CAva2.json', params: { Status: 'canceled' } }])

  w.calls.length = 0
  const lose = await (await handle(await signed(`?event=va_join&call=CA123&va=${VA2}`, { CallSid: 'CAva2' }), w.store, w.twilio, ENV)).text()
  assert.match(lose, /<Response><Hangup\/><\/Response>/)
  assert.doesNotMatch(lose, /Conference/)
  assert.equal(w.calls.length, 0)
  assert.equal(w.rows[0].va_id, VA1)
})

Deno.test('5. each VA client gets the caller number and help call as custom parameters', async () => {
  const w = world()
  await handle(await signed('', CALLER), w.store, w.twilio, ENV)
  const rings = posts(w.calls).filter(c => c.path === '/Calls.json')
  assert.deepEqual(rings.map(c => c.params.To), [
    `client:${VA1}?callerNumber=%2B15125550100&helpCall=CA123`,
    `client:${VA2}?callerNumber=%2B15125550100&helpCall=CA123`,
  ])
  for (const [i, c] of rings.entries()) {
    const va = [VA1, VA2][i]
    assert.equal(c.params.From, '+15125550199')
    assert.equal(c.params.Url, `${URL_}?event=va_join&call=CA123&va=${va}`)
    assert.equal(c.params.Timeout, '30')
    assert.equal(c.params.StatusCallback, `${URL_}?event=va_leg&call=CA123`)
    assert.deepEqual(c.params.StatusCallbackEvent, ['initiated', 'ringing', 'answered', 'completed'])
  }
})

Deno.test('6. no active VAs: Say + Hangup, 0 REST calls, the row is kept as ended / no_va_online', async () => {
  const w = world({ vas: [] })
  const xml = await (await handle(await signed('', CALLER), w.store, w.twilio, ENV)).text()
  assert.match(xml, /<Say>Sorry, no one can take your call right now\. Please call back soon\.<\/Say><Hangup\/>/)
  assert.doesNotMatch(xml, /<Dial/)
  assert.equal(w.calls.length, 0)
  assert.equal(w.rows.length, 1)
  assert.equal(w.rows[0].status, 'ended')
  assert.equal(w.rows[0].end_reason, 'no_va_online')
  assert.ok(w.rows[0].ended_at)
})

Deno.test('7. every VA leg ends unanswered: the caller hears the message and the row ends no_va_answer; one still ringing changes nothing', async () => {
  const w = world({ rows: [ringing()] })
  // CAva1 no-answer while CAva2 still rings: no change.
  await handle(await signed('?event=va_leg&call=CA123', { CallSid: 'CAva1', CallStatus: 'no-answer' }), w.store, w.twilio, ENV)
  assert.equal(posts(w.calls).length, 0)
  assert.equal(w.rows[0].status, 'ringing')
  assert.equal(w.writes.length, 0)

  // CAva2 no-answer too (Twilio reports CAva1 ended): end the caller once.
  w.calls.length = 0
  const done = world({ rows: [ringing()], legStatus: { CAva1: 'no-answer' } })
  await handle(await signed('?event=va_leg&call=CA123', { CallSid: 'CAva2', CallStatus: 'no-answer' }), done.store, done.twilio, ENV)
  assert.deepEqual(posts(done.calls), [{ method: 'POST', path: '/Calls/CA123.json',
    params: { Twiml: '<Response><Say>Sorry, no one can take your call right now. Please call back soon.</Say><Hangup/></Response>' } }])
  assert.equal(done.rows.length, 1)
  assert.equal(done.rows[0].status, 'ended')
  assert.equal(done.rows[0].end_reason, 'no_va_answer')
  assert.ok(done.rows[0].ended_at)
  // A late duplicate callback does nothing more.
  await handle(await signed('?event=va_leg&call=CA123', { CallSid: 'CAva1', CallStatus: 'no-answer' }), done.store, done.twilio, ENV)
  assert.equal(posts(done.calls).length, 1)
  // A non-final status is ignored.
  const r = world({ rows: [ringing()] })
  await handle(await signed('?event=va_leg&call=CA123', { CallSid: 'CAva1', CallStatus: 'ringing' }), r.store, r.twilio, ENV)
  assert.equal(r.calls.length, 0)
})

Deno.test('7b. a VA leg ends before the SIDs are saved: nothing changes; inbound re-checks once they are', async () => {
  // va_leg failed for CAva1 while the row's list is still empty.
  const early = world({ rows: [ringing({ ringing_va_call_sids: [] })] })
  await handle(await signed('?event=va_leg&call=CA123', { CallSid: 'CAva1', CallStatus: 'failed' }), early.store, early.twilio, ENV)
  assert.equal(early.calls.length, 0)
  assert.equal(early.rows[0].status, 'ringing')
  assert.equal(early.writes.length, 0)

  // Every leg had already ended when inbound saved the SIDs: the caller hears
  // the message on its own webhook and the row ends no_va_answer.
  const all = world({ legStatus: { CAva1: 'failed', CAva2: 'busy' } })
  const xml = await (await handle(await signed('', CALLER), all.store, all.twilio, ENV)).text()
  assert.match(xml, /<Say>Sorry, no one can take your call right now\. Please call back soon\.<\/Say><Hangup\/>/)
  assert.doesNotMatch(xml, /<Dial/)
  assert.deepEqual([all.rows[0].status, all.rows[0].end_reason], ['ended', 'no_va_answer'])
  assert.deepEqual(posts(all.calls).map(c => c.path), ['/Calls.json', '/Calls.json'])

  // One leg still ringing at save time: the caller waits in the conference.
  const one = world({ legStatus: { CAva1: 'failed' } })
  assert.match(await (await handle(await signed('', CALLER), one.store, one.twilio, ENV)).text(), /help-CA123<\/Conference>/)
  assert.equal(one.rows[0].status, 'ringing')
})

Deno.test('conf: start saves the conference SID; end closes the row, dropped only if it was live', async () => {
  const w = world({ rows: [ringing({ status: 'live', va_id: VA1, va_call_sid: 'CAva1' })] })
  await handle(await signed('?event=conf&call=CA123', { StatusCallbackEvent: 'conference-start', ConferenceSid: 'CF9' }), w.store, w.twilio, ENV)
  assert.equal(w.rows[0].conference_sid, 'CF9')
  await handle(await signed('?event=conf&call=CA123', { StatusCallbackEvent: 'conference-end', ConferenceSid: 'CF9' }), w.store, w.twilio, ENV)
  assert.deepEqual([w.rows[0].status, w.rows[0].end_reason, w.rows[0].outcome], ['ended', 'conference_end', 'dropped'])
  assert.ok(w.rows[0].ended_at)

  const booked = world({ rows: [ringing({ status: 'live', outcome: 'booked' })] })
  await handle(await signed('?event=conf&call=CA123', { StatusCallbackEvent: 'conference-end' }), booked.store, booked.twilio, ENV)
  assert.equal(booked.rows[0].outcome, 'booked')

  // The caller left while the VAs rang: no outcome, the VA phones stop.
  const left = world({ rows: [ringing()] })
  await handle(await signed('?event=conf&call=CA123', { StatusCallbackEvent: 'conference-end' }), left.store, left.twilio, ENV)
  assert.deepEqual([left.rows[0].status, left.rows[0].outcome], ['ended', null])
  assert.deepEqual(posts(left.calls).map(c => [c.path, c.params.Status]), [['/Calls/CAva1.json', 'canceled'], ['/Calls/CAva2.json', 'canceled']])
})

// A live CA123 with the agent CAag1 ringing (help-transfer dialed it).
const transferring = (over: Partial<HelpCall> = {}) =>
  ringing({ status: 'transferring', va_id: VA1, va_call_sid: 'CAva1', transfer_agent_id: VA2, agent_call_sid: 'CAag1', ...over })

Deno.test('9. agent_leg with a bad signature: 403, no store write, no REST call', async () => {
  const w = world({ rows: [transferring()] })
  const res = await handle(await signed('?event=agent_leg&call=CA123', { CallSid: 'CAag1', CallStatus: 'in-progress' }, 'nope'), w.store, w.twilio, ENV)
  assert.equal(res.status, 403)
  assert.equal(w.writes.length, 0)
  assert.equal(w.calls.length, 0)
  assert.equal(w.rows[0].status, 'transferring')
})

Deno.test('10. agent_leg: no-answer and busy go back to no_answer (agent_call_sid cleared), answered is transferred', async () => {
  for (const s of ['no-answer', 'busy', 'failed', 'canceled']) {
    const w = world({ rows: [transferring()] })
    await handle(await signed('?event=agent_leg&call=CA123', { CallSid: 'CAag1', CallStatus: s }), w.store, w.twilio, ENV)
    assert.deepEqual([w.rows[0].status, w.rows[0].agent_call_sid, w.rows[0].outcome], ['no_answer', null, null], s)
    assert.equal(w.calls.length, 0)
  }
  const w = world({ rows: [transferring()] })
  // initiated / ringing change nothing.
  for (const s of ['initiated', 'ringing']) {
    await handle(await signed('?event=agent_leg&call=CA123', { CallSid: 'CAag1', CallStatus: s }), w.store, w.twilio, ENV)
  }
  assert.equal(w.writes.length, 0)
  await handle(await signed('?event=agent_leg&call=CA123', { CallSid: 'CAag1', CallStatus: 'in-progress' }), w.store, w.twilio, ENV)
  assert.deepEqual([w.rows[0].status, w.rows[0].outcome, w.rows[0].agent_call_sid], ['transferred', 'transferred', 'CAag1'])
  assert.ok(w.rows[0].transferred_at)
  // The agent hanging up later doesn't undo the transfer.
  await handle(await signed('?event=agent_leg&call=CA123', { CallSid: 'CAag1', CallStatus: 'completed' }), w.store, w.twilio, ENV)
  assert.equal(w.rows[0].status, 'transferred')
  assert.equal(w.calls.length, 0)

  // A leg from an earlier attempt changes nothing.
  const old = world({ rows: [transferring({ agent_call_sid: 'CAag2' })] })
  await handle(await signed('?event=agent_leg&call=CA123', { CallSid: 'CAag1', CallStatus: 'no-answer' }), old.store, old.twilio, ENV)
  assert.equal(old.rows[0].status, 'transferring')
  // A callback before help-transfer saved the agent's CallSid still counts.
  const early = world({ rows: [transferring({ agent_call_sid: null })] })
  await handle(await signed('?event=agent_leg&call=CA123', { CallSid: 'CAag1', CallStatus: 'failed' }), early.store, early.twilio, ENV)
  assert.equal(early.rows[0].status, 'no_answer')
  // Not transferring (the VA booked, the call ended): nothing changes.
  const ended = world({ rows: [transferring({ status: 'ended', outcome: 'booked' })] })
  await handle(await signed('?event=agent_leg&call=CA123', { CallSid: 'CAag1', CallStatus: 'in-progress' }), ended.store, ended.twilio, ENV)
  assert.deepEqual([ended.rows[0].status, ended.rows[0].outcome], ['ended', 'booked'])
})

Deno.test('8. nothing is ever recorded: helpConference and every response', async () => {
  const bodies: string[] = [
    helpConference(URL_, 'CA123', { startOnEnter: false, endOnExit: true }),
    helpConference(URL_, 'CA123', { startOnEnter: true, endOnExit: false }),
  ]
  const w = world()
  bodies.push(await (await handle(await signed('', CALLER), w.store, w.twilio, ENV)).text())
  bodies.push(await (await handle(await signed(`?event=va_join&call=CA123&va=${VA1}`, { CallSid: 'CAva1' }), w.store, w.twilio, ENV)).text())
  bodies.push(await (await handle(await signed(`?event=va_join&call=CA123&va=${VA2}`, { CallSid: 'CAva2' }), w.store, w.twilio, ENV)).text())
  bodies.push(await (await handle(await signed('?event=va_leg&call=CA123', { CallSid: 'CAva2', CallStatus: 'canceled' }), w.store, w.twilio, ENV)).text())
  bodies.push(await (await handle(await signed('?event=conf&call=CA123', { StatusCallbackEvent: 'conference-end' }), w.store, w.twilio, ENV)).text())
  const off = world({ live: false }), none = world({ vas: [] })
  bodies.push(await (await handle(await signed('', CALLER), off.store, off.twilio, ENV)).text())
  bodies.push(await (await handle(await signed('', CALLER), none.store, none.twilio, ENV)).text())
  for (const b of bodies) assert.doesNotMatch(b, /record/i)
  for (const c of w.calls) assert.doesNotMatch(JSON.stringify(c.params ?? {}), /record/i)
  assert.equal(helpConference.length, 3)
})

// ── Live transfer: end the call when nobody is left, ignore agent voicemail ──
const AGENT = '44444444-4444-4444-8444-444444444444'
const LEAD = '66666666-6666-4666-8666-666666666666'
// Everyone on CF9: the caller CA123, the VA CAva1 and the agent CAag1.
const onCall = (): Participant[] => [
  { call_sid: 'CA123', status: 'connected' },
  { call_sid: 'CAva1', status: 'connected' },
  { call_sid: 'CAag1', label: 'agent', status: 'connected' },
]
const handedOver = (over: Partial<HelpCall> = {}) => ringing({
  status: 'transferred', conference_sid: 'CF9', va_id: VA1, va_call_sid: 'CAva1', transfer_agent_id: AGENT,
  agent_call_sid: 'CAag1', outcome: 'transferred', lead_id: LEAD, transferred_at: 'then', ...over,
})
const confEnds = (calls: any[]) => calls.filter(c => c.method === 'POST' && /^\/Conferences\/\w+\.json$/.test(c.path))
const hangups = (calls: any[], sid: string) => calls.filter(c => c.method === 'POST' && c.path === `/Calls/${sid}.json`)

// Twilio drops the leg from the conference, then sends participant-leave.
async function leave(w: ReturnType<typeof world>, sid: string, label?: string) {
  if (w.participants.CF9) w.participants.CF9 = w.participants.CF9.filter(p => p.call_sid !== sid)
  const form: Record<string, string> = { StatusCallbackEvent: 'participant-leave', ConferenceSid: 'CF9', CallSid: sid }
  if (label) form.ParticipantLabel = label
  const res = await handle(await signed('?event=conf&call=CA123', form), w.store, w.twilio, ENV)
  assert.equal(res.status, 200)
  return res
}

async function agentAnswer(w: ReturnType<typeof world>, form: Record<string, string>, amd = true) {
  const q = `?event=agent_leg&call=CA123${amd ? '&amd=1' : ''}`
  return handle(await signed(q, { CallSid: 'CAag1', CallStatus: 'in-progress', ...form }), w.store, w.twilio, ENV)
}

Deno.test('VA drops then agent leaves: conference completed, caller ended', async () => {
  const w = world({ rows: [handedOver()], participants: { CF9: onCall() } })
  await leave(w, 'CAva1')
  assert.equal(posts(w.calls).length, 0)
  assert.equal(w.rows[0].status, 'transferred')

  await leave(w, 'CAag1', 'agent')
  assert.deepEqual(confEnds(w.calls), [{ method: 'POST', path: '/Conferences/CF9.json', params: { Status: 'completed' } }])
  // The conference is ended, not just the caller's leg.
  assert.equal(hangups(w.calls, 'CA123').length, 0)
  assert.deepEqual([w.rows[0].status, w.rows[0].end_reason, w.rows[0].outcome], ['ended', 'caller_alone', 'transferred'])
  assert.ok(w.rows[0].ended_at)
  assert.equal(w.leads[LEAD], 'dropped')
  noRealFetch()
})

Deno.test('agent leaves while VA is on: call not ended', async () => {
  const w = world({ rows: [handedOver()], participants: { CF9: onCall() } })
  await leave(w, 'CAag1', 'agent')
  assert.equal(posts(w.calls).length, 0)
  assert.equal(w.writes.length, 0)
  assert.equal(w.rows[0].status, 'transferred')
  assert.equal(w.leads[LEAD], undefined)
  // Twilio's list was checked, not guessed from order.
  assert.deepEqual(w.calls.map(c => [c.method, c.path]), [['GET', '/Conferences/CF9/Participants.json']])
  noRealFetch()
})

Deno.test('agent already gone then VA leaves: conference completed', async () => {
  const w = world({ rows: [handedOver()], participants: { CF9: onCall() } })
  await leave(w, 'CAag1', 'agent')
  assert.equal(posts(w.calls).length, 0)
  await leave(w, 'CAva1')
  assert.deepEqual(confEnds(w.calls).map(c => [c.path, c.params.Status]), [['/Conferences/CF9.json', 'completed']])
  assert.deepEqual([w.rows[0].status, w.rows[0].end_reason], ['ended', 'caller_alone'])
  assert.equal(w.leads[LEAD], 'dropped')

  // The VA hanging up on a live call nobody was transferred on: same, the
  // caller isn't left in silence (no transfer, so the lead is not touched).
  const solo = world({ rows: [handedOver({ status: 'live', transfer_agent_id: null, agent_call_sid: null, outcome: null })],
    participants: { CF9: onCall().slice(0, 2) } })
  await leave(solo, 'CAva1')
  assert.equal(confEnds(solo.calls).length, 1)
  assert.deepEqual([solo.rows[0].status, solo.rows[0].outcome], ['ended', 'dropped'])
  assert.deepEqual(solo.leads, {})
  noRealFetch()
})

Deno.test('caller hangs up first: legs ended, no error, no extra Twilio end call', async () => {
  const w = world({ rows: [handedOver()], participants: { CF9: onCall() } })
  const res = await leave(w, 'CA123')
  assert.equal(res.status, 200)
  assert.equal(w.calls.length, 0)
  assert.deepEqual([w.rows[0].status, w.rows[0].end_reason, w.rows[0].outcome], ['ended', 'caller_hung_up', 'transferred'])
  assert.ok(w.rows[0].ended_at)
  assert.equal(w.leads[LEAD], 'dropped')
  // The caller ended the conference (endConferenceOnExit true): Twilio's
  // leave callbacks for the VA and agent, and conference-end, change nothing.
  delete w.participants.CF9
  const writes = w.writes.length
  await leave(w, 'CAva1')
  await leave(w, 'CAag1', 'agent')
  await handle(await signed('?event=conf&call=CA123', { StatusCallbackEvent: 'conference-end', ConferenceSid: 'CF9' }), w.store, w.twilio, ENV)
  assert.equal(w.calls.length, 0)
  assert.equal(w.writes.length, writes)

  // A transferring call where the caller leaves: dropped, still no Twilio call.
  const t = world({ rows: [handedOver({ status: 'transferring', outcome: null, transferred_at: null })], participants: { CF9: onCall() } })
  await leave(t, 'CA123')
  assert.deepEqual([t.rows[0].status, t.rows[0].outcome], ['ended', 'dropped'])
  assert.equal(t.calls.length, 0)
  noRealFetch()
})

// The agent leg rings while the VA waits on the line with the caller.
const ringingAgent = (over: Partial<HelpCall> = {}) =>
  handedOver({ status: 'transferring', outcome: null, transferred_at: null, ...over })

Deno.test('voicemail pickup (machine_end_beep) is not answered: leg hung up, fallback taken, never connected', async () => {
  const w = world({ rows: [ringingAgent()], participants: { CF9: onCall() } })
  await agentAnswer(w, { AnsweredBy: 'machine_end_beep' })
  assert.deepEqual(hangups(w.calls, 'CAag1').map(c => c.params), [{ Status: 'completed' }])
  const r = w.rows[0]
  // Fallback: back to no_answer, so the desk offers another try or Book instead.
  assert.deepEqual([r.status, r.agent_call_sid, r.end_reason, r.outcome, r.transferred_at], ['no_answer', null, 'voicemail', null, null])
  assert.equal(w.leads[LEAD], 'dropped')
  assert.ok(!w.writes.some(x => x[0] === 'lead' && x[2] === 'connected'))
  // The VA is still on: the call goes on.
  assert.equal(confEnds(w.calls).length, 0)
  // The leg's later completed callback and its participant-leave change nothing.
  const before = w.writes.length
  await handle(await signed('?event=agent_leg&call=CA123&amd=1', { CallSid: 'CAag1', CallStatus: 'completed' }), w.store, w.twilio, ENV)
  await leave(w, 'CAag1', 'agent')
  assert.equal(w.writes.length, before)
  assert.equal(confEnds(w.calls).length, 0)

  // The VA had already hung up: the caller would sit alone, so the call ends.
  const alone = world({ rows: [ringingAgent()], participants: { CF9: [onCall()[0], onCall()[2]] } })
  await agentAnswer(alone, { AnsweredBy: 'machine_end_beep' })
  assert.equal(hangups(alone.calls, 'CAag1').length, 1)
  assert.deepEqual(confEnds(alone.calls).map(c => c.params), [{ Status: 'completed' }])
  assert.deepEqual([alone.rows[0].status, alone.rows[0].end_reason, alone.rows[0].outcome], ['ended', 'caller_alone', 'dropped'])
  assert.ok(!alone.writes.some(x => x[0] === 'lead' && x[2] === 'connected'))
  noRealFetch()
})

Deno.test('unknown and fax and no-answer count as not answered', async () => {
  const cases: [Record<string, string>, string, Record<string, string>?][] = [
    [{ AnsweredBy: 'unknown' }, 'no-answer'],
    [{ AnsweredBy: 'fax' }, 'no-answer'],
    [{ AnsweredBy: 'machine_start' }, 'voicemail'],
    [{ AnsweredBy: 'machine_end_silence' }, 'voicemail'],
    [{ AnsweredBy: 'machine_end_other' }, 'voicemail'],
    // No AnsweredBy on the callback: the call's answered_by is fetched.
    [{}, 'no-answer', { CAag1: 'fax' }],
    [{}, 'voicemail', { CAag1: 'machine_start' }],
    // Twilio has no answer for it at all: unknown, not answered.
    [{}, 'no-answer'],
  ]
  for (const [form, reason, answeredBy] of cases) {
    const w = world({ rows: [ringingAgent()], participants: { CF9: onCall() }, answeredBy })
    await agentAnswer(w, form)
    const label = JSON.stringify([form, answeredBy])
    assert.deepEqual([w.rows[0].status, w.rows[0].end_reason, w.rows[0].outcome], ['no_answer', reason, null], label)
    assert.equal(hangups(w.calls, 'CAag1').filter(c => c.params?.Status === 'completed').length, 1, label)
    assert.equal(w.leads[LEAD], 'dropped', label)
    if (!form.AnsweredBy) assert.ok(w.calls.some(c => c.method === 'GET' && c.path === '/Calls/CAag1.json'), label)
  }
  // No answer within the leg's 25 s Timeout: Twilio ends the leg itself, so
  // nothing is hung up; no_answer, never connected.
  for (const s of ['no-answer', 'busy', 'failed', 'canceled']) {
    const w = world({ rows: [ringingAgent()], participants: { CF9: onCall() } })
    await handle(await signed('?event=agent_leg&call=CA123&amd=1', { CallSid: 'CAag1', CallStatus: s }), w.store, w.twilio, ENV)
    assert.deepEqual([w.rows[0].status, w.rows[0].end_reason], ['no_answer', 'no-answer'], s)
    assert.equal(hangups(w.calls, 'CAag1').length, 0, s)
    assert.equal(w.leads[LEAD], 'dropped', s)
  }
  noRealFetch()
})

Deno.test('human on the phone leg counts as connected; browser leg gets no MachineDetection', async () => {
  const w = world({ rows: [ringingAgent()], participants: { CF9: onCall() } })
  await agentAnswer(w, { AnsweredBy: 'human' })
  assert.deepEqual([w.rows[0].status, w.rows[0].outcome, w.rows[0].agent_call_sid], ['transferred', 'transferred', 'CAag1'])
  assert.ok(w.rows[0].transferred_at)
  assert.equal(w.leads[LEAD], 'connected')
  assert.equal(posts(w.calls).length, 0)
  // answered_by fetched when the callback has none.
  const fetched = world({ rows: [ringingAgent()], answeredBy: { CAag1: 'human' } })
  await agentAnswer(fetched, {})
  assert.equal(fetched.rows[0].status, 'transferred')
  assert.equal(fetched.leads[LEAD], 'connected')

  const env = { from: '+15125550199', voiceUrl: URL_, configured: true }
  const phone = agentLegParams(env, '+15125550142', 'CA123')
  assert.equal(phone.MachineDetection, 'Enable')
  assert.equal(phone.MachineDetectionTimeout, '10')
  assert.equal(phone.EndConferenceOnExit, 'false')
  assert.equal(phone.Timeout, '25')
  assert.equal(phone.StatusCallback, `${URL_}?event=agent_leg&call=CA123&amd=1`)
  const browser = agentLegParams(env, `client:${AGENT}`, 'CA123')
  assert.ok(!('MachineDetection' in browser) && !('MachineDetectionTimeout' in browser))
  assert.equal(browser.EndConferenceOnExit, 'false')
  assert.equal(browser.StatusCallback, `${URL_}?event=agent_leg&call=CA123`)
  // A person answering the browser leg (no amd) counts, with no answered_by lookup.
  const web = world({ rows: [ringingAgent()] })
  await agentAnswer(web, {}, false)
  assert.equal(web.rows[0].status, 'transferred')
  assert.equal(web.calls.length, 0)
  noRealFetch()
})

Deno.test('repeated participant-leave is a no-op', async () => {
  const w = world({ rows: [handedOver()], participants: { CF9: onCall() } })
  await leave(w, 'CAva1')
  await leave(w, 'CAag1', 'agent')
  assert.equal(confEnds(w.calls).length, 1)
  const calls = w.calls.length, writes = w.writes.length
  // The same leave again, the other one late, and conference-end: nothing more.
  await leave(w, 'CAag1', 'agent')
  await leave(w, 'CAva1')
  await leave(w, 'CA123')
  await handle(await signed('?event=conf&call=CA123', { StatusCallbackEvent: 'conference-end', ConferenceSid: 'CF9' }), w.store, w.twilio, ENV)
  assert.equal(w.calls.length, calls)
  assert.equal(w.writes.length, writes)
  assert.equal(confEnds(w.calls).length, 1)

  // A late leave for a conference Twilio already completed (404): no-op.
  const late = world({ rows: [handedOver()] })
  await leave(late, 'CAag1', 'agent')
  assert.equal(posts(late.calls).length, 0)
  assert.equal(late.writes.length, 0)
  // A leg that isn't on the row (an old VA leg, no label): nothing at all.
  const stray = world({ rows: [handedOver()], participants: { CF9: onCall() } })
  await leave(stray, 'CAva2')
  assert.equal(stray.calls.length, 0)
  noRealFetch()
})
