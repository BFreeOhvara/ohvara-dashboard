/**
 * Deno unit tests for help-voice (Roadmap Goal 9): mocked Twilio callbacks,
 * an in-memory help_calls store and a Twilio REST spy. No real calls.
 * Run: deno test --node-modules-dir=none supabase/functions/help-voice
 */
import assert from 'node:assert/strict'
import { handle, helpConference, helpConferenceName, twilioSignature, type HelpCall, type Store } from './core.ts'
import type { Twilio } from '../_shared/twilio.ts'

const URL_ = 'https://x.supabase.co/functions/v1/help-voice'
const TOKEN = 'secret-token'
const VA1 = '11111111-1111-4111-8111-111111111111'
const VA2 = '22222222-2222-4222-8222-222222222222'
const ENV = { authToken: TOKEN, publicUrl: URL_, trackingNumber: '+15125550199' }
const CALLER = { CallSid: 'CA123', From: '+15125550100', To: '+15125550199' }

function world(over: { live?: boolean; vas?: string[]; rows?: HelpCall[]; legStatus?: Record<string, string> } = {}) {
  const rows: HelpCall[] = over.rows ?? []
  const writes: any[] = []
  const calls: { method: string; path: string; params?: any }[] = []
  const legStatus: Record<string, string> = over.legStatus ?? {}
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
  }
  const twilio: Twilio = async (method, path, params) => {
    calls.push({ method, path, params })
    if (method === 'POST' && path === '/Calls.json') return { status: 201, data: { sid: `CAva${++n}` } }
    const m = path.match(/^\/Calls\/(\w+)\.json$/)
    if (method === 'GET' && m) return { status: 200, data: { status: legStatus[m[1]] ?? 'ringing' } }
    return { status: 200, data: {} }
  }
  return { store, twilio, rows, writes, calls }
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
  for (const q of ['', '?event=va_join&call=CA123&va=' + VA1, '?event=va_leg&call=CA123', '?event=conf&call=CA123']) {
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
