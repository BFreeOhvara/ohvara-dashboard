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
//
// P882 — Q51: NO call recording at launch. RECORDING_AT_LAUNCH keeps the 764 path shut whatever
// recording_live says; flip it only with Brayden's yes and the notice wording. Lines (every call type):
//   (none) + line_id   the VA's browser joins va_lines.conference (an inbound line joins help-voice's caller
//                      conference). An admin joins with mode listen (muted), whisper (coach the VA) or join.
//   leg  + line        an outside person's status on a line.
//   conf + line        hold / unhold; the VA's own leg leaving without End starts the 60 s rescue (the others
//                      wait on hold music); the conference ending closes the line (VA -> wrap-up).

import { readTwilioRequest, xmlEsc, type Twilio } from '../_shared/twilio.ts'
import { helpConference } from '../help-voice/core.ts'

export const RECORDING_AT_LAUNCH = false
export { twilioSignature } from '../_shared/twilio.ts'

export type Policy = {
  id: string
  fulfillment_assigned: boolean
  assigned_fulfillment_id: string | null
  fulfillment_stage: string | null
  is_demo?: boolean
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

export type VoiceLine = {
  id: string
  kind: 'lead' | 'servicing' | 'inbound' | 'carrier'
  conference: string
  help_call_sid: string | null
  va_id: string | null
  va_call_sid: string | null
  status: 'open' | 'live' | 'rescue' | 'handoff' | 'ended'
}
export type LineLegPatch = {
  call_sid: string
  line_id?: string
  conference_sid?: string | null
  party?: 'client' | 'lead' | 'carrier' | 'agent'
  status?: 'ringing' | 'live' | 'ended'
  on_hold?: boolean
  answered?: boolean
  end_reason?: string | null
}
// P882 — the line half of the store (optional, so the cancellation-only callers keep working).
export interface LineVoiceStore {
  line(id: string): Promise<VoiceLine | null>
  lineJoined(lineId: string, va: string, callSid: string): Promise<boolean>
  lineVaLeft(lineId: string, callSid: string): Promise<boolean>
  lineEnded(lineId: string, reason: string): Promise<void>
  lineHoldState(lineId: string): Promise<void>
  claimHelpCall(callSid: string, va: string, vaCallSid: string): Promise<boolean>
  saveLineLeg(patch: LineLegPatch): Promise<void>
  liveLineLegs(lineId: string): Promise<{ call_sid: string; on_hold: boolean }[]>
  endLineLegs(lineId: string, reason: string): Promise<void>
}

export interface Store {
  lines?: LineVoiceStore
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
export type Env = { authToken: string | null; publicUrl: string; checkUrl?: string; twilio?: Twilio | null; helpUrl?: string }

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

// The VA (or an admin) on a line. endConferenceOnExit false: if the VA's leg drops, the others stay.
// cbUrl + cbKey: whose status callbacks (fulfillment-voice ?line=, or help-voice ?call= for a caller's line).
export function lineConference(cbUrl: string, cbQuery: Record<string, string>, name: string,
  admin?: 'listen' | 'whisper' | 'join', coach?: string | null) {
  const cb = `${cbUrl}?${new URLSearchParams({ event: 'conf', ...cbQuery })}`
  const extra = admin === 'listen' ? ' muted="true"'
    : admin === 'whisper' && coach ? ` coach="${xmlEsc(coach)}"` : ''
  return `<Dial><Conference beep="false" startConferenceOnEnter="${admin ? 'false' : 'true'}" endConferenceOnExit="false"${extra}` +
    ` statusCallback="${xmlEsc(cb)}" statusCallbackMethod="POST" statusCallbackEvent="start end join leave hold">` +
    `${xmlEsc(name)}</Conference></Dial>`
}

async function lineJoin(store: Store, env: Env, form: Record<string, string>) {
  const lines = store.lines
  const who = (form.From || '').replace(/^client:/, '')
  const lineId = form.line_id || ''
  if (!lines || !UUID.test(who) || !UUID.test(lineId)) return twiml(say('This call could not be placed.'))
  const role = await store.role(who)
  if (role !== 'fulfillment' && role !== 'admin') return twiml(say('Only fulfillment can call from the portal.'))
  if (!(await store.voiceLive())) return twiml(say('Calling in the portal is not on yet.'))
  const line = await lines.line(lineId)
  if (!line || line.status === 'ended') return twiml(say('This call has ended.'))
  const inbound = line.kind === 'inbound' && !!line.help_call_sid && !!env.helpUrl
  if (role === 'admin' && line.va_id !== who) {
    const mode = form.mode
    if (mode !== 'listen' && mode !== 'whisper' && mode !== 'join') return twiml(say('Pick listen, whisper or join.'))
    return twiml(inbound
      ? lineConference(env.helpUrl!, { call: line.help_call_sid! }, line.conference, mode, line.va_call_sid)
      : lineConference(env.publicUrl, { line: line.id }, line.conference, mode, line.va_call_sid))
  }
  if (line.va_id !== who) return twiml(say('This call belongs to another VA.'))
  const callSid = form.CallSid || ''
  if (line.kind === 'inbound' && line.help_call_sid) {
    if (!env.helpUrl || !(await lines.claimHelpCall(line.help_call_sid, who, callSid))) {
      await lines.lineEnded(line.id, 'caller_gone')
      return twiml(say('The caller has hung up.'))
    }
    await lines.lineJoined(line.id, who, callSid)
    await lines.saveLineLeg({ call_sid: line.help_call_sid, line_id: line.id, party: 'lead', status: 'live', answered: true })
    return twiml(helpConference(env.helpUrl, line.help_call_sid, { startOnEnter: true, endOnExit: false }))
  }
  if (!(await lines.lineJoined(line.id, who, callSid))) return twiml(say('This call has ended.'))
  return twiml(lineConference(env.publicUrl, { line: line.id }, line.conference))
}

// The VA's leg left a live line without End: the rescue starts (60 s to come back, then the next VA). The
// others wait on hold music so nobody sits in silence. help-voice uses it for a caller's line too.
export async function lineVaLeft(lines: LineVoiceStore | undefined, twilio: Twilio | null | undefined, lineId: string,
  callSid: string, confSid: string | null) {
  if (!lines || !(await lines.lineVaLeft(lineId, callSid))) return false
  if (twilio && confSid) {
    for (const l of await lines.liveLineLegs(lineId)) {
      if (l.on_hold) continue
      const res = await twilio('POST', `/Conferences/${confSid}/Participants/${l.call_sid}.json`, { Hold: 'true' }).catch(() => null)
      if (!res || res.status >= 400) console.error('rescue hold failed:', l.call_sid, res?.status)
      else await lines.saveLineLeg({ call_sid: l.call_sid, on_hold: true })
    }
  }
  return true
}

async function joinRequest(store: Store, env: Env, form: Record<string, string>) {
  if (form.line_id) return lineJoin(store, env, form)
  const who = (form.From || '').replace(/^client:/, '')
  const policyId = form.policy_id || ''
  if (!UUID.test(who) || !UUID.test(policyId)) return twiml(say('This call could not be placed.'))
  const role = await store.role(who)
  if (role !== 'fulfillment' && role !== 'admin') return twiml(say('Only fulfillment can call from the portal.'))
  const p = await store.policy(policyId)
  if (!p || !p.fulfillment_assigned) return twiml(say('That cancellation was not found.'))
  if (role !== 'admin' && p.assigned_fulfillment_id !== who) return twiml(say('This cancellation is assigned to another rep.'))
  if (p.fulfillment_stage === 'Complete') return twiml(say('This one is already cancelled.'))
  // Prompt 775 — App Review sample bookings never place a real call.
  if (p.is_demo) return twiml(say('This is a sample account. No real calls are placed.'))
  if (!(await store.voiceLive())) return twiml(say('Calling in the portal is not on yet.'))
  const rec = RECORDING_AT_LAUNCH ? await store.recording() : { live: false, notice: '' }
  if (rec.live && env.checkUrl && form.CallSid) {
    await store.startRecording({ call_sid: form.CallSid, policy_id: policyId, rep_id: who })
    const callback = `${env.checkUrl}?${new URLSearchParams({ event: 'rec', policy: policyId, call: form.CallSid })}`
    return twiml(joinConference(env.publicUrl, policyId, { callback }))
  }
  return twiml(joinConference(env.publicUrl, policyId))
}

// The recording notice, once per outside leg, as soon as it's answered.
async function playNotice(store: Store, env: Env, callSid: string) {
  if (!RECORDING_AT_LAUNCH || !env.twilio || !(await store.recording()).live) return
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

  const lineId = q.get('line') || ''
  if (event === 'leg' && lineId && store.lines) {
    const party = q.get('party') || ''
    const status = legStatus(form.CallStatus || '')
    if (!form.CallSid || !status || !UUID.test(lineId) || !['client', 'lead', 'carrier', 'agent'].includes(party)) return twiml()
    await store.lines.saveLineLeg({
      call_sid: form.CallSid, line_id: lineId, party: party as LineLegPatch['party'],
      conference_sid: form.ConferenceSid || null, status, answered: status === 'live',
      ...(status === 'ended' ? { on_hold: false, end_reason: form.CallStatus } : null),
    })
    await store.lines.lineHoldState(lineId)
    return twiml()
  }

  if (event === 'conf' && lineId && store.lines && UUID.test(lineId)) {
    const e = form.StatusCallbackEvent
    if (e === 'participant-hold' || e === 'participant-unhold') {
      if (form.CallSid) await store.setHold(form.CallSid, e === 'participant-hold')
    } else if (e === 'participant-join' && form.CallSid) {
      // The VA (back) on the line: whoever waited through a rescue comes off hold.
      const line = await store.lines.line(lineId)
      if (line && line.va_call_sid === form.CallSid && env.twilio && form.ConferenceSid) {
        for (const l of await store.lines.liveLineLegs(lineId)) {
          if (!l.on_hold) continue
          const res = await env.twilio('POST', `/Conferences/${form.ConferenceSid}/Participants/${l.call_sid}.json`, { Hold: 'false' }).catch(() => null)
          if (res && res.status < 400) await store.lines.saveLineLeg({ call_sid: l.call_sid, on_hold: false })
        }
      }
    } else if (e === 'participant-leave' && form.CallSid) {
      const line = await store.lines.line(lineId)
      if (line && line.va_call_sid === form.CallSid) await lineVaLeft(store.lines, env.twilio, lineId, form.CallSid, form.ConferenceSid || null)
    } else if (e === 'conference-end') {
      await store.lines.endLineLegs(lineId, 'conference-end')
      await store.lines.lineEnded(lineId, 'conference-end')
    }
    return twiml()
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
