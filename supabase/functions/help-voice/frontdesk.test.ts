/**
 * P932 — the hold line and the AI front desk, through help-voice's handle(): mocked Twilio callbacks, an in-memory
 * help_calls + front desk store, a Twilio REST spy. No real calls.
 * Run: deno test --no-check --node-modules-dir=none -A supabase/functions/help-voice
 */
import assert from 'node:assert/strict'
import { handle, twilioSignature, type HelpCall, type Store, type RouteStore } from './core.ts'
import type { DeskState } from './frontdesk.ts'
import type { Twilio } from '../_shared/twilio.ts'

const URL_ = 'https://x.supabase.co/functions/v1/help-voice'
const TOKEN = 'secret-token'
const ENV = { authToken: TOKEN, publicUrl: URL_, holdBase: 'https://app.example/hold' }
const CALLER = { CallSid: 'CA900', From: '+12145550401', To: '+12145550900' }
globalThis.fetch = (() => { throw new Error('real fetch in a test') }) as typeof fetch

const SETTINGS = { track: 'warm', custom_url: null, front_desk_on: true, ai_after_sec: 20, update_every_sec: 60, max_wait_min: 10 }
function world(over: Partial<DeskState> = {}, opts: { deskOpen?: boolean; redirectFails?: boolean } = {}) {
  const rows: HelpCall[] = []
  const saved: Record<string, unknown>[] = []
  const callbacks: string[] = []
  const calls: { method: string; path: string; params?: any }[] = []
  const desk: Record<string, any> = { status: 'greeting', known: false }
  let state: DeskState = {
    taken: false, gone: false, queued: true, ahead: 1, free: 0, busy: 2, online: 2, avg_min: 6, waited_sec: 25,
    desk_open: true, voice_live: true, sms_live: false, ai_live: true, settings: SETTINGS,
    client: { policy_id: 'p1', name: 'Gloria Hayes', carrier: 'Foresters' }, desk: null, ...over,
  }
  const row = (sid: string) => rows.find(r => r.call_sid === sid) ?? null
  const store: Store = {
    async voiceLive() { return true },
    async activeVas() { return [] },
    async insertHelpCall(r) { if (row(r.call_sid)) return false; rows.push({ ringing_va_call_sids: [], ...r } as HelpCall); return true },
    async helpCall(sid) { const r = row(sid); return r && { ...r } },
    async claimHelpCall() { return null },
    async updateHelpCall(sid, patch, when) { const r = row(sid); if (!r || (when && !when.includes(r.status))) return null; Object.assign(r, patch); return { ...r } },
    async setLeadTransferStatus() {},
    async logMissedTransfer() {},
  }
  const route: RouteStore = {
    deskOpen: async () => opts.deskOpen ?? true,
    afterHoursText: async () => null,
    routeInbound: async () => ({ queue_id: 'q1' }),
    afterHoursCall: async () => {},
    inboundGone: async () => {},
    vaLeftLine: async () => false,
    isCron: async () => false,
    frontDesk: {
      async start(sid) { const r = row(sid); if (r) r.hold_line = true; return { ...state, desk: { ...desk } as any } },
      async state() { return { ...state, desk: { ...desk } as any } },
      async save(_sid, p) { saved.push(p); Object.assign(desk, p) },
      async callback(_sid, reason) { callbacks.push(reason); desk.status = 'callback'; return { ok: true } },
      async path(carrier, need) { return carrier === 'Foresters' && need === 'beneficiary' ? { path: 'esign' } : { path: 'merge' } },
      async settings() { return SETTINGS },
    },
  }
  const twilio: Twilio = async (method, path, params) => {
    calls.push({ method, path, params })
    if (opts.redirectFails && /^\/Calls\/CA900\.json$/.test(path)) return { status: 404, data: { message: 'gone' } }
    return { status: 200, data: {} }
  }
  return { store, route, twilio, rows, saved, callbacks, calls, desk, set: (p: Partial<DeskState>) => { state = { ...state, ...p } } }
}

async function post(w: ReturnType<typeof world>, query: string, form: Record<string, string> = {}) {
  const sig = await twilioSignature(TOKEN, URL_ + query, form)
  const req = new Request(`http://internal/help-voice${query}`, {
    method: 'POST', headers: { 'X-Twilio-Signature': sig, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form),
  })
  return (await handle(req, w.store, w.twilio, ENV, w.route)).text()
}

Deno.test('1. a call in: greeting, our hold music, then the front desk at ~20 s', async () => {
  const w = world()
  const xml = await post(w, '', CALLER)
  assert.match(xml, /Thanks for calling Deedstone Insurance\. Connecting you now\./)
  assert.match(xml, /<Play loop="1">https:\/\/app\.example\/hold\/warm\.mp3<\/Play>/)
  assert.match(xml, /event=fd&amp;call=CA900/)
  assert.doesNotMatch(xml, /<Conference/)
  assert.equal(w.rows[0].hold_line, true)
})

Deno.test('2. all VAs busy: the AI knows the client, asks the need, then one follow-up', async () => {
  const w = world()
  await post(w, '', CALLER)
  let xml = await post(w, '?event=fd&call=CA900')
  assert.match(xml, /<Gather input="speech"/)
  assert.match(xml, /Hi Gloria, I see your Foresters policy\. What can we help you with today\?/)
  xml = await post(w, '?event=fd_need&call=CA900', { SpeechResult: 'I want to change my beneficiary' })
  assert.equal(w.desk.need, 'beneficiary')
  assert.match(xml, /Who would you like the new beneficiary to be/)
})

Deno.test('3. the summary, the wait from live data, hold by default (e-sign not offered while texting is off)', async () => {
  const w = world()
  await post(w, '', CALLER)
  await post(w, '?event=fd_need&call=CA900', { SpeechResult: 'change my beneficiary' })
  const xml = await post(w, '?event=fd_detail&call=CA900', { SpeechResult: 'my son Marcus Hayes' })
  assert.equal(w.desk.summary, 'Gloria Hayes · Foresters\nBeneficiary change: “change my beneficiary”\nThey said: “my son Marcus Hayes”')
  assert.equal(w.desk.estimate_min, 6)    // 1 ahead, 2 busy, 6 min average: 3 + 1×6/2
  assert.match(xml, /A specialist will be with you in about 6 minutes\. Stay on the line, or press 1/)
  assert.match(xml, /numDigits="1".*allow=1"/)
  assert.match(xml, /event=hold&amp;call=CA900<\/Redirect>/)
})

Deno.test('4. texting live and a form carrier: the e-sign link is offered first (press 2)', async () => {
  const w = world({ sms_live: true })
  await post(w, '', CALLER)
  await post(w, '?event=fd_need&call=CA900', { SpeechResult: 'beneficiary change' })
  const xml = await post(w, '?event=fd_detail&call=CA900', { SpeechResult: 'my daughter' })
  assert.match(xml, /Good news: this change can be done by signing a form on your phone\. Press 2/)
  const k = await post(w, '?event=fd_key&call=CA900&allow=12', { Digits: '2' })
  assert.equal(w.desk.choice, 'esign'); assert.equal(w.desk.status, 'esign_requested')
  assert.match(k, /We’ll text you the link/)
})

Deno.test('5. hold: an update every ~60 s and the music in between; press 1 → callback', async () => {
  const w = world({ ahead: 0, busy: 2 })
  await post(w, '', CALLER)
  const xml = await post(w, '?event=hold&call=CA900')
  assert.match(xml, /You’re next\. A specialist will be with you shortly\. Press 1 any time/)
  assert.match(xml, /<Play loop="3">https:\/\/app\.example\/hold\/warm\.mp3<\/Play><\/Gather>/)
  const k = await post(w, '?event=fd_key&call=CA900&allow=1', { Digits: '1' })
  assert.deepEqual(w.callbacks, ['pressed_1'])
  assert.match(k, /call you back in about 10 minutes\. You’ll get a text to confirm\.<\/Say><Hangup\/>/)
})

Deno.test('6. waited past 10 minutes, or nobody on shift: the callback is booked', async () => {
  const w = world({ waited_sec: 601 })
  await post(w, '', CALLER)
  assert.match(await post(w, '?event=hold&call=CA900'), /call you back.*<Hangup\/>/)
  assert.deepEqual(w.callbacks, ['too_long'])
  const v = world({ online: 0 })
  await post(v, '', CALLER)
  await post(v, '?event=hold&call=CA900')
  assert.deepEqual(v.callbacks, ['no_va'])
})

Deno.test('7. a VA takes the call: the caller is moved into the conference with the summary on the VA’s screen', async () => {
  const w = world()
  await post(w, '', CALLER)
  Object.assign(w.rows[0], { status: 'live', va_id: 'va1', va_call_sid: 'CAvaleg' })
  await post(w, '?event=conf&call=CA900', { StatusCallbackEvent: 'participant-join', ConferenceSid: 'CF1', CallSid: 'CAvaleg' })
  const redirect = w.calls.find(c => c.path === '/Calls/CA900.json')
  assert.ok(redirect && /event=fd_join&call=CA900/.test(redirect.params.Url))
  assert.equal(w.desk.status, 'with_va')
  const xml = await post(w, '?event=fd_join&call=CA900')
  assert.match(xml, /Thanks for holding\. Connecting you now\..*<Conference[^>]*>help-CA900<\/Conference>/)
  // Mid-question: the next step joins the VA instead of asking more.
  w.set({ taken: true })
  assert.match(await post(w, '?event=fd_need&call=CA900', { SpeechResult: 'bank' }), /<Conference/)
})

Deno.test('8. the caller hung up before the VA joined: the line ends, nobody sits in an empty call', async () => {
  const w = world({}, { redirectFails: true })
  await post(w, '', CALLER)
  Object.assign(w.rows[0], { status: 'live', va_id: 'va1', va_call_sid: 'CAvaleg' })
  await post(w, '?event=conf&call=CA900', { StatusCallbackEvent: 'participant-join', ConferenceSid: 'CF1', CallSid: 'CAvaleg' })
  assert.equal(w.rows[0].status, 'ended')
  assert.ok(w.calls.some(c => c.path === '/Conferences/CF1.json' && c.params.Status === 'completed'))
})

Deno.test('9. after hours with the AI on: it asks the details, then books the callback', async () => {
  const w = world({ desk_open: false, client: null }, { deskOpen: false })
  let xml = await post(w, '', CALLER)
  assert.match(xml, /Our team is away right now\. I can take a few details.*May I have your first and last name\?/)
  xml = await post(w, '?event=fd_name&call=CA900', { SpeechResult: 'Sam Ortiz' })
  assert.match(xml, /Thanks, Sam\. And your date of birth\?/)
  await post(w, '?event=fd_dob&call=CA900', { SpeechResult: 'March 4 1950' })
  await post(w, '?event=fd_need&call=CA900', { SpeechResult: 'I moved' })
  xml = await post(w, '?event=fd_detail&call=CA900', { SpeechResult: '12 Oak Street Dallas' })
  assert.match(w.desk.summary, /^Sam Ortiz \(not on file: check name and date of birth\) · DOB March 4 1950\nAddress change/)
  assert.deepEqual(w.callbacks, ['after_hours'])
  assert.match(xml, /after 8 AM Central on the next business day/)
})

Deno.test('10. AI off: the caller hears the wait and the hold line, no questions', async () => {
  const w = world({ ai_live: false })
  await post(w, '', CALLER)
  const xml = await post(w, '?event=fd&call=CA900')
  assert.doesNotMatch(xml, /<Gather input="speech"/)
  assert.match(xml, /All our specialists are helping other clients right now\. A specialist will be with you in about 6 minutes\. Press 1/)
})

Deno.test('11. the merge-call hold plays the track admin picked', async () => {
  const w = world()
  const xml = await post(w, '?event=music')
  assert.match(xml, /<Play loop="0">https:\/\/app\.example\/hold\/warm\.mp3<\/Play>/)
})
