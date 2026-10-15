// fulfillment-voice — Prompt 751, Twilio's side of the pop-up phone. Logic
// only; index.ts wires Deno. No JWT: every request must carry a valid
// X-Twilio-Signature. The pre-pivot twilio-voice-webhook (records and grades
// calls) is untouched; nothing here records.
//
// Requests, by ?event=
//   (none)  the TwiML App's Voice URL: the rep's browser placed a call with
//           { policy_id }. The caller is From = client:<auth id> (the identity
//           twilio-token signed). The assigned rep or an admin on a live,
//           unfinished cancellation joins the conference "policy-<id>";
//           anyone else is told no and hung up.
//   leg     an outside party's call status (fulfillment-call set it on the
//           participant): ringing → live → ended.
//   conf    the conference's events: participant hold / unhold, and the end.
//   dtmf    the keypad: TwiML that plays the digits to the carrier leg.
//   notice  TwiML that says the recording notice (played to one leg).
//
// Prompt 764: while recovery_config.recording_live is on, the conference is
// recorded from the start (every leg mixed) and a row goes into
// fulfillment_recordings for the rep's leg. Twilio reports the recording to
// fulfillment-cancel-check, which has the AI check the cancel. Each outside
// leg hears the recording notice once, as soon as it answers. With the switch
// off nothing is recorded and no notice plays.

import { readTwilioRequest, xmlEsc, type Twilio } from '../_shared/twilio.ts'
export { twilioSignature } from '../_shared/twilio.ts'

export type Policy = {
  id: string
  fulfillment_assigned: boolean
  assigned_fulfillment_id: string | null
  fulfillment_stage: string | null
}

export type LegPatch = {
  call_sid: string
  policy_id?: string
  conference_sid?: string | null
  party?: 'client' | 'carrier'
  status?: 'ringing' | 'live' | 'ended'
  on_hold?: boolean
  answered?: boolean
  end_reason?: string | null
}

export interface Store {
  role(userId: string): Promise<string | null>
  policy(id: string): Promise<Policy | null>
  voiceLive(): Promise<boolean>
  saveLeg(patch: LegPatch): Promise<void>      // upsert when policy_id + party are given
  setHold(callSid: string, hold: boolean): Promise<void>  // existing legs only
  endLegs(policyId: string, reason: string): Promise<void>
  recording(): Promise<{ live: boolean; notice: string }>
  startRecording(row: { call_sid: string; policy_id: string; rep_id: string }): Promise<void>
  // Marks the leg's notice as played: the leg's conference SID the first
  // time, null if it was already claimed (or the leg is unknown).
  claimNotice(callSid: string): Promise<string | null>
}

// checkUrl: fulfillment-cancel-check (Twilio's recording callbacks).
// twilio: REST, to play the notice to a leg; null = not configured.
export type Env = { authToken: string | null; publicUrl: string; checkUrl?: string; twilio?: Twilio | null }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const twiml = (inner = '') =>
  new Response(`<?xml version="1.0" encoding="UTF-8"?><Response>${inner}</Response>`, {
    headers: { 'Content-Type': 'text/xml' },
  })

// rec: record the conference from the start; Twilio reports the recording to
// rec.callback (the rep's leg is in its query, to find the row again).
export function joinConference(publicUrl: string, policyId: string, rec?: { callback: string }) {
  const cb = `${publicUrl}?${new URLSearchParams({ event: 'conf', policy: policyId })}`
  const record = rec
    ? ` record="record-from-start" recordingStatusCallback="${xmlEsc(rec.callback)}" recordingStatusCallbackMethod="POST"` +
      ` recordingStatusCallbackEvent="in-progress completed absent"`
    : ''
  return `<Dial><Conference beep="false" startConferenceOnEnter="true" endConferenceOnExit="true"` +
    ` statusCallback="${xmlEsc(cb)}" statusCallbackMethod="POST" statusCallbackEvent="start end join leave hold"${record}>` +
    `policy-${policyId}</Conference></Dial>`
}

const say = (text: string) => `<Say>${xmlEsc(text)}</Say><Hangup/>`

// Twilio CallStatus → our leg status.
export function legStatus(callStatus: string): 'ringing' | 'live' | 'ended' | null {
  if (['queued', 'initiated', 'ringing'].includes(callStatus)) return 'ringing'
  if (['in-progress', 'answered'].includes(callStatus)) return 'live'
  if (['completed', 'busy', 'no-answer', 'failed', 'canceled'].includes(callStatus)) return 'ended'
  return null
}

async function joinRequest(store: Store, env: Env, form: Record<string, string>) {
  const who = (form.From || '').replace(/^client:/, '')
  const policyId = form.policy_id || ''
  if (!UUID.test(who) || !UUID.test(policyId)) return twiml(say('This call could not be placed.'))
  const role = await store.role(who)
  if (role !== 'fulfillment' && role !== 'admin') return twiml(say('Only fulfillment can call from the portal.'))
  const p = await store.policy(policyId)
  if (!p || !p.fulfillment_assigned) return twiml(say('That cancellation was not found.'))
  if (role !== 'admin' && p.assigned_fulfillment_id !== who) return twiml(say('This cancellation is assigned to another rep.'))
  if (p.fulfillment_stage === 'Complete') return twiml(say('This one is already cancelled.'))
  if (!(await store.voiceLive())) return twiml(say('Calling in the portal is not on yet.'))
  const rec = await store.recording()
  if (rec.live && env.checkUrl && form.CallSid) {
    await store.startRecording({ call_sid: form.CallSid, policy_id: policyId, rep_id: who })
    const callback = `${env.checkUrl}?${new URLSearchParams({ event: 'rec', policy: policyId, call: form.CallSid })}`
    return twiml(joinConference(env.publicUrl, policyId, { callback }))
  }
  return twiml(joinConference(env.publicUrl, policyId))
}

// The recording notice, once per outside leg, as soon as it's answered.
async function playNotice(store: Store, env: Env, callSid: string) {
  if (!env.twilio || !(await store.recording()).live) return
  const conf = await store.claimNotice(callSid)
  if (!conf) return
  const res = await env.twilio('POST', `/Conferences/${conf}/Participants/${callSid}.json`, {
    AnnounceUrl: `${env.publicUrl}?event=notice`, AnnounceMethod: 'POST',
  })
  if (res.status >= 400) console.error('recording notice failed:', res.status, res.data?.message)
}

export async function handle(req: Request, store: Store, env: Env): Promise<Response> {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })
  if (!env.authToken) return new Response('Not configured', { status: 503 })

  const { form, query: q, ok } = await readTwilioRequest(req, env.authToken, env.publicUrl)
  if (!ok) return new Response('Bad signature', { status: 403 })

  const event = q.get('event')
  const policyId = q.get('policy') || ''

  if (!event) return joinRequest(store, env, form)

  if (event === 'dtmf') {
    const digits = q.get('digits') || ''
    if (!/^[0-9*#w]{1,32}$/.test(digits)) return twiml()
    return twiml(`<Play digits="${digits}"/>`)
  }

  if (event === 'notice') {
    const { notice } = await store.recording()
    return twiml(`<Say>${xmlEsc(notice)}</Say>`)
  }

  if (event === 'leg') {
    const party = q.get('party')
    const status = legStatus(form.CallStatus || '')
    if (!form.CallSid || !status || !UUID.test(policyId) || (party !== 'client' && party !== 'carrier')) return twiml()
    await store.saveLeg({
      call_sid: form.CallSid, policy_id: policyId, party,
      conference_sid: form.ConferenceSid || null,
      status, answered: status === 'live',
      ...(status === 'ended' ? { on_hold: false, end_reason: form.CallStatus } : null),
    })
    if (status === 'live') {
      try { await playNotice(store, env, form.CallSid) } catch (e) { console.error('recording notice:', (e as Error).message) }
    }
    return twiml()
  }

  if (event === 'conf') {
    const e = form.StatusCallbackEvent
    if (e === 'participant-hold' || e === 'participant-unhold') {
      if (form.CallSid) await store.setHold(form.CallSid, e === 'participant-hold')
    } else if (e === 'conference-end' && UUID.test(policyId)) {
      await store.endLegs(policyId, 'conference-end')
    }
    return twiml()
  }

  return twiml()
}
