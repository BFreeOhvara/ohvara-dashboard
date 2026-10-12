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
}

export type Env = { authToken: string | null; publicUrl: string }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const xmlEsc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const twiml = (inner = '') =>
  new Response(`<?xml version="1.0" encoding="UTF-8"?><Response>${inner}</Response>`, {
    headers: { 'Content-Type': 'text/xml' },
  })

function b64(bytes: ArrayBuffer) {
  let bin = ''
  for (const b of new Uint8Array(bytes)) bin += String.fromCharCode(b)
  return btoa(bin)
}

// Twilio's request signature: HMAC-SHA1 (auth token) over the full URL, then
// every POST param name + value, sorted by name; base64.
export async function twilioSignature(authToken: string, url: string, params: Record<string, string>) {
  const data = url + Object.keys(params).sort().map(k => k + params[k]).join('')
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(authToken), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign'])
  return b64(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data)))
}

function sameString(a: string, b: string) {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export function joinConference(publicUrl: string, policyId: string) {
  const cb = `${publicUrl}?${new URLSearchParams({ event: 'conf', policy: policyId })}`
  return `<Dial><Conference beep="false" startConferenceOnEnter="true" endConferenceOnExit="true"` +
    ` statusCallback="${xmlEsc(cb)}" statusCallbackMethod="POST" statusCallbackEvent="start end join leave hold">` +
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
  return twiml(joinConference(env.publicUrl, policyId))
}

export async function handle(req: Request, store: Store, env: Env): Promise<Response> {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })
  if (!env.authToken) return new Response('Not configured', { status: 503 })

  const search = new URL(req.url).search
  const form: Record<string, string> = {}
  for (const [k, v] of new URLSearchParams(await req.text())) form[k] = v
  const expected = await twilioSignature(env.authToken, env.publicUrl + search, form)
  if (!sameString(req.headers.get('X-Twilio-Signature') || '', expected)) {
    return new Response('Bad signature', { status: 403 })
  }

  const q = new URLSearchParams(search)
  const event = q.get('event')
  const policyId = q.get('policy') || ''

  if (!event) return joinRequest(store, env, form)

  if (event === 'dtmf') {
    const digits = q.get('digits') || ''
    if (!/^[0-9*#w]{1,32}$/.test(digits)) return twiml()
    return twiml(`<Play digits="${digits}"/>`)
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
