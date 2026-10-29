// help-voice — Roadmap Goal 9, the inbound side of the VA desk. Logic only;
// index.ts wires Deno. No JWT: every request must carry a valid
// X-Twilio-Signature. Nothing here records a call.
//
// Requests, by ?event=
//   (none)   the tracking number's Voice URL: a caller rang it. With
//            recovery_config.voice_live off the call is hung up and nothing
//            else happens. On, the caller waits in the conference
//            "help-<CallSid>" and every active VA's browser phone rings.
//   va_join  a VA answered: the first one joins the conference, the other
//            ringing VA legs are canceled; a later one is hung up.
//   va_leg   a VA leg's call status. Once every VA leg has ended and nobody
//            joined, the caller hears a short message and is hung up.
//   conf     the conference's events: its start, and its end.
//
// help-transfer reuses helpConferenceName, helpConference, HelpCall and Store.

import { readTwilioRequest, xmlEsc, type Twilio } from '../_shared/twilio.ts'
export { twilioSignature } from '../_shared/twilio.ts'

export type HelpStatus = 'ringing' | 'live' | 'transferring' | 'transferred' | 'no_answer' | 'ended'

export type HelpCall = {
  call_sid: string
  caller_number: string | null
  tracking_number: string | null
  conference_sid: string | null
  va_id: string | null
  va_call_sid: string | null
  ringing_va_call_sids: string[]
  status: HelpStatus
  end_reason: string | null
  transfer_agent_id: string | null
  agent_call_sid: string | null
  outcome: 'transferred' | 'booked' | 'dropped' | null
  lead_id: string | null
  answered_at: string | null
  transfer_started_at: string | null
  transferred_at: string | null
  ended_at: string | null
}

export interface Store {
  voiceLive(): Promise<boolean>
  // Auth ids of the VAs to ring: profiles role 'fulfillment' and is_active.
  activeVas(): Promise<string[]>
  // false when the call_sid already has a row (Twilio retried the webhook).
  insertHelpCall(row: Partial<HelpCall> & { call_sid: string }): Promise<boolean>
  helpCall(callSid: string): Promise<HelpCall | null>
  // Atomic: sets the VA, status live and answered_at only while the row is
  // still ringing. The updated row for the winner, null for everyone else.
  claimHelpCall(callSid: string, vaId: string, vaCallSid: string): Promise<HelpCall | null>
  // whenStatus: update only while the row has one of these statuses. The
  // updated row, or null when nothing matched.
  updateHelpCall(callSid: string, patch: Partial<HelpCall>, whenStatus?: HelpStatus[]): Promise<HelpCall | null>
}

// trackingNumber: HELP_TRACKING_NUMBER (read-only config), the VA legs' From.
export type Env = { authToken: string | null; publicUrl: string; trackingNumber?: string | null }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SID = /^CA[0-9a-zA-Z]{1,64}$/
const FINAL = ['completed', 'busy', 'no-answer', 'failed', 'canceled']
const SORRY = 'Sorry, no one can take your call right now. Please call back soon.'

const twiml = (inner = '') =>
  new Response(`<?xml version="1.0" encoding="UTF-8"?><Response>${inner}</Response>`, {
    headers: { 'Content-Type': 'text/xml' },
  })

const sorry = () => `<Say>${xmlEsc(SORRY)}</Say><Hangup/>`

export const helpConferenceName = (callSid: string) => `help-${callSid}`

// The caller: startOnEnter false, endOnExit true. A VA: startOnEnter true,
// endOnExit false. The conference is never recorded.
export function helpConference(publicUrl: string, callSid: string, opts: { startOnEnter: boolean; endOnExit: boolean }) {
  const cb = `${publicUrl}?${new URLSearchParams({ event: 'conf', call: callSid })}`
  return `<Dial><Conference beep="false" startConferenceOnEnter="${opts.startOnEnter}" endConferenceOnExit="${opts.endOnExit}"` +
    ` statusCallback="${xmlEsc(cb)}" statusCallbackMethod="POST" statusCallbackEvent="start end join leave">` +
    `${xmlEsc(helpConferenceName(callSid))}</Conference></Dial>`
}

function toE164(raw: string) {
  if (/^\+\d{8,15}$/.test(raw)) return raw
  const d = raw.replace(/\D/g, '')
  if (d.length === 10) return `+1${d}`
  if (d.length === 11 && d.startsWith('1')) return `+${d}`
  return raw
}

const now = () => new Date().toISOString()

// Stops VA legs that are still ringing (one already answered, or the caller left).
async function cancelLegs(twilio: Twilio, sids: string[]) {
  await Promise.all(sids.map(async sid => {
    const res = await twilio('POST', `/Calls/${sid}.json`, { Status: 'canceled' }).catch(() => null)
    if (!res || res.status >= 400) console.error('cancel VA leg failed:', sid, res?.status, res?.data?.message)
  }))
}

async function inbound(store: Store, twilio: Twilio | null, env: Env, form: Record<string, string>) {
  // Off: hang up before any store or REST call.
  if (!(await store.voiceLive())) return twiml('<Hangup/>')
  const callSid = form.CallSid || ''
  if (!SID.test(callSid)) return twiml('<Hangup/>')
  const caller = toE164(form.From || '')
  const base = { call_sid: callSid, caller_number: caller || null, tracking_number: form.To || null }

  const vas = (await store.activeVas()).filter(id => UUID.test(id))
  if (!vas.length || !twilio) {
    await store.insertHelpCall({ ...base, status: 'ended', end_reason: twilio ? 'no_va_online' : 'not_configured', ended_at: now() })
    return twiml(sorry())
  }

  if (!(await store.insertHelpCall({ ...base, status: 'ringing', ringing_va_call_sids: [] }))) {
    // A retried webhook: don't ring the VAs twice.
    const had = await store.helpCall(callSid)
    return twiml(had?.status === 'ringing' ? helpConference(env.publicUrl, callSid, { startOnEnter: false, endOnExit: true }) : '<Hangup/>')
  }

  const from = env.trackingNumber || form.To || ''
  const sids = (await Promise.all(vas.map(async va => {
    const res = await twilio('POST', '/Calls.json', {
      To: `client:${va}?${new URLSearchParams({ callerNumber: caller, helpCall: callSid })}`,
      From: from,
      Url: `${env.publicUrl}?${new URLSearchParams({ event: 'va_join', call: callSid, va })}`,
      Method: 'POST',
      Timeout: '30',
      StatusCallback: `${env.publicUrl}?${new URLSearchParams({ event: 'va_leg', call: callSid })}`,
      StatusCallbackMethod: 'POST',
      StatusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
    }).catch(e => ({ status: 599, data: { message: (e as Error).message } }))
    if (res.status >= 400 || !res.data?.sid) console.error('ring VA failed:', res.status, res.data?.message)
    return res.status < 400 ? (res.data?.sid as string | undefined) : undefined
  }))).filter((s): s is string => !!s)

  if (!sids.length) {
    await store.updateHelpCall(callSid, { status: 'ended', end_reason: 'ring_failed', ended_at: now() }, ['ringing'])
    return twiml(sorry())
  }
  const saved = await store.updateHelpCall(callSid, { ringing_va_call_sids: sids })
  // A VA answered before the SIDs were saved: cancel the rest here instead.
  if (saved && saved.status !== 'ringing') await cancelLegs(twilio, sids.filter(s => s !== saved.va_call_sid))
  // Every leg ended before the SIDs were saved: va_leg ignored those
  // callbacks, so end the caller here (this answers the caller's own webhook).
  if (saved?.status === 'ringing' && await allEnded(twilio, sids)) {
    if (await store.updateHelpCall(callSid, { status: 'ended', end_reason: 'no_va_answer', ended_at: now() }, ['ringing'])) {
      return twiml(sorry())
    }
  }
  return twiml(helpConference(env.publicUrl, callSid, { startOnEnter: false, endOnExit: true }))
}

async function vaJoin(store: Store, twilio: Twilio | null, env: Env, callSid: string, vaId: string, vaCallSid: string) {
  if (!UUID.test(vaId) || !SID.test(vaCallSid)) return twiml('<Hangup/>')
  const won = await store.claimHelpCall(callSid, vaId, vaCallSid)
  if (!won) return twiml('<Hangup/>')
  if (twilio) await cancelLegs(twilio, (won.ringing_va_call_sids ?? []).filter(s => s !== vaCallSid))
  return twiml(helpConference(env.publicUrl, callSid, { startOnEnter: true, endOnExit: false }))
}

// Twilio's view of a VA leg: ended, or not (yet). A leg Twilio no longer
// knows counts as ended; any other error counts as still ringing.
async function legEnded(twilio: Twilio, sid: string) {
  const res = await twilio('GET', `/Calls/${sid}.json`).catch(() => null)
  if (!res) return false
  if (res.status === 404) return true
  return res.status < 400 && FINAL.includes(res.data?.status)
}

const allEnded = async (twilio: Twilio, sids: string[]) =>
  (await Promise.all(sids.map(sid => legEnded(twilio, sid)))).every(Boolean)

async function vaLeg(store: Store, twilio: Twilio | null, callSid: string, form: Record<string, string>) {
  if (!twilio || !FINAL.includes(form.CallStatus || '')) return twiml()
  const row = await store.helpCall(callSid)
  if (!row || row.status !== 'ringing') return twiml()
  const sids = row.ringing_va_call_sids ?? []
  // This leg isn't in the saved list yet (inbound is still ringing the VAs):
  // change nothing; inbound re-checks once the SIDs are saved.
  if (!form.CallSid || !sids.includes(form.CallSid)) return twiml()
  if (!(await allEnded(twilio, sids.filter(s => s !== form.CallSid)))) return twiml()
  // Nobody joined in time. Claim the end first, so only one callback ends
  // the caller's call; the row is kept.
  const ended = await store.updateHelpCall(callSid, { status: 'ended', end_reason: 'no_va_answer', ended_at: now() }, ['ringing'])
  if (!ended) return twiml()
  const res = await twilio('POST', `/Calls/${callSid}.json`, { Twiml: `<Response>${sorry()}</Response>` }).catch(() => null)
  if (!res || res.status >= 400) console.error('end caller failed:', res?.status, res?.data?.message)
  return twiml()
}

async function conf(store: Store, twilio: Twilio | null, callSid: string, form: Record<string, string>) {
  const e = form.StatusCallbackEvent
  if (e === 'conference-start') {
    if (form.ConferenceSid) await store.updateHelpCall(callSid, { conference_sid: form.ConferenceSid })
  } else if (e === 'conference-end') {
    const row = await store.helpCall(callSid)
    if (!row || row.status === 'ended') return twiml()
    const wasLive = row.status === 'live' || row.status === 'transferring'
    await store.updateHelpCall(callSid, {
      status: 'ended', ended_at: now(), end_reason: row.end_reason || 'conference_end',
      ...(row.outcome == null && wasLive ? { outcome: 'dropped' as const } : null),
    })
    // The caller left before a VA answered: stop the VA phones ringing.
    if (row.status === 'ringing' && twilio) await cancelLegs(twilio, row.ringing_va_call_sids ?? [])
  }
  return twiml()
}

export async function handle(req: Request, store: Store, twilio: Twilio | null, env: Env): Promise<Response> {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })
  if (!env.authToken) return new Response('Not configured', { status: 503 })

  const { form, query: q, ok } = await readTwilioRequest(req, env.authToken, env.publicUrl)
  if (!ok) return new Response('Bad signature', { status: 403 })

  const event = q.get('event')
  if (!event) return inbound(store, twilio, env, form)

  const callSid = q.get('call') || ''
  if (!SID.test(callSid)) return twiml(event === 'va_join' ? '<Hangup/>' : '')

  if (event === 'va_join') return vaJoin(store, twilio, env, callSid, q.get('va') || '', form.CallSid || '')
  if (event === 'va_leg') return vaLeg(store, twilio, callSid, form)
  if (event === 'conf') return conf(store, twilio, callSid, form)
  return twiml()
}
