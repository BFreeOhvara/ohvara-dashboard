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
//   agent_leg the agent help-transfer dialed in: answered by a person =
//            transferred; voicemail, fax, unknown or no answer = no_answer.
//   conf     the conference's events: its start, a participant leaving, and
//            its end. When the VA or the agent leaves and nobody but the
//            caller is left, the whole conference is completed.
//
// help-transfer reuses helpConferenceName, helpConference, HelpCall and Store.
//
// P916 — every Deedstone number's Voice URL is this function. A caller is looked up by their phone number and
// rings their own agent first (inside the agent's hours, ~20 s, press 1 to take it), else the VA desk below. An
// agent's Call through Deedstone runs its TwiML here too (deedstone.ts: ds_* events).
//
// P882 — ring the next free VA, never everyone. With the routing store on (Store.route), a caller is put on
// call_queue (route_inbound) and waits in the conference on hold music; the queue offers the call to ONE VA
// (longest idle, 15 s, then the next) in their portal, and the VA's browser joins through fulfillment-voice
// ({ line_id }). Nobody takes it in 2 minutes → the sweep posts ?cron timeout here and the caller becomes a
// callback. After 6 PM Central (Q15/16) the caller hears the after-hours greeting and a VA calls back at 8 AM.
// The VA's leg dropping on a live caller starts the 60 s rescue (caller on hold music). va_join / va_leg stay
// for calls rung the old way.

import { readTwilioRequest, xmlEsc, type Twilio } from '../_shared/twilio.ts'
import { bridgeEvent, inboundToAgent, screen, take, type BridgeStore, type DeedstoneInbound } from './deedstone.ts'
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
  // leads.transfer_status (175) on the call's lead: 'connected' once a person
  // answers the agent leg, 'dropped' when nobody does or the call ends alone.
  setLeadTransferStatus(leadId: string, status: 'connected' | 'dropped'): Promise<void>
  // log_missed_transfer (211): one inbound_events 'missed' row per help call.
  logMissedTransfer(callSid: string): Promise<void>
}

// P882 — the routing half (optional: without it the old ring-every-VA path runs, as the 179 tests expect).
export interface RouteStore {
  deskOpen(): Promise<boolean>
  afterHoursText(): Promise<string | null>
  routeInbound(callSid: string, caller: string): Promise<{ queue_id: string | null }>
  afterHoursCall(callSid: string, caller: string): Promise<void>
  inboundGone(callSid: string): Promise<void>
  // The VA's leg on a caller's line left without End: starts the rescue. The line id, or null.
  vaLeftLine(callSid: string, vaLegSid: string): Promise<boolean>
  isCron(secret: string): Promise<boolean>
  // P916: a call to a Deedstone number tries the caller's own agent first (deedstone.ts).
  deedstone?: DeedstoneInbound
}

// The plain default after-hours greeting. Client-facing wording: Brayden sets recovery_config.after_hours_text
// before voice_live goes on (Q15/16: greeting + a text with a link to pick a callback time, sent by the engine).
export const AFTER_HOURS = 'Thanks for calling. Our team is away for the night. We will call you back after 8 AM Central.'

// trackingNumber: HELP_TRACKING_NUMBER (read-only config), the VA legs' From.
export type Env = { authToken: string | null; publicUrl: string; trackingNumber?: string | null }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SID = /^CA[0-9a-zA-Z]{1,64}$/
const FINAL = ['completed', 'busy', 'no-answer', 'failed', 'canceled']
// A row that hasn't ended yet.
const OPEN: HelpStatus[] = ['ringing', 'live', 'transferring', 'transferred', 'no_answer']
// Conference participant statuses that are no longer on the call.
const LEFT = ['complete', 'failed']
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

// P882: a caller rings ONE VA through the queue (route_inbound); after hours they hear the greeting.
async function inboundRouted(store: Store, route: RouteStore, env: Env, form: Record<string, string>) {
  const callSid = form.CallSid || ''
  const caller = toE164(form.From || '')
  const base = { call_sid: callSid, caller_number: caller || null, tracking_number: form.To || null }
  if (!(await route.deskOpen())) {
    if (await store.insertHelpCall({ ...base, status: 'ended', end_reason: 'after_hours', ended_at: now() })) {
      await route.afterHoursCall(callSid, caller)
    }
    return twiml(`<Say>${xmlEsc((await route.afterHoursText()) || AFTER_HOURS)}</Say><Hangup/>`)
  }
  if (!(await store.insertHelpCall({ ...base, status: 'ringing', ringing_va_call_sids: [] }))) {
    const had = await store.helpCall(callSid)   // a retried webhook: queue once
    return twiml(had?.status === 'ringing' ? helpConference(env.publicUrl, callSid, { startOnEnter: false, endOnExit: true }) : '<Hangup/>')
  }
  const q = await route.routeInbound(callSid, caller)
  if (!q.queue_id) {
    await store.updateHelpCall(callSid, { status: 'ended', end_reason: 'not_queued', ended_at: now() }, ['ringing'])
    return twiml(sorry())
  }
  return twiml(helpConference(env.publicUrl, callSid, { startOnEnter: false, endOnExit: true }))
}

async function inbound(store: Store, twilio: Twilio | null, env: Env, form: Record<string, string>, route?: RouteStore) {
  // Off: hang up before any store or REST call.
  if (!(await store.voiceLive())) return twiml('<Hangup/>')
  const callSid = form.CallSid || ''
  if (!SID.test(callSid)) return twiml('<Hangup/>')
  if (route?.deedstone) {
    const toAgent = await inboundToAgent(route.deedstone, env.publicUrl, form, toE164(form.From || ''))
    if (toAgent) return toAgent
  }
  if (route) return inboundRouted(store, route, env, form)
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

// The lead's transfer_status follows the call. A lead write that fails (175
// not applied yet) is logged and never breaks the call itself.
async function markLead(store: Store, row: HelpCall, status: 'connected' | 'dropped') {
  if (!row.lead_id) return
  try { await store.setLeadTransferStatus(row.lead_id, status) } catch (e) {
    console.error('lead transfer_status failed:', row.lead_id, status, (e as Error).message)
  }
}

// The agent's leg went unanswered. A failed write (211 not applied yet) is logged
// and never breaks the call itself, the same as markLead.
async function logMissed(store: Store, callSid: string) {
  try { await store.logMissedTransfer(callSid) } catch (e) {
    console.error('log missed transfer failed:', callSid, (e as Error).message)
  }
}

// Who picked up the agent's phone leg (help-transfer turns machine detection
// on there): the callback's AnsweredBy, else the call's answered_by.
async function answeredBy(twilio: Twilio | null, sid: string, form: Record<string, string>) {
  if (form.AnsweredBy) return form.AnsweredBy
  if (!twilio || !SID.test(sid)) return 'unknown'
  const res = await twilio('GET', `/Calls/${sid}.json`).catch(() => null)
  return (res && res.status < 400 && res.data?.answered_by) || 'unknown'
}

// The caller has no VA and no agent with them: complete the conference itself
// (not only the caller's leg), close the row and drop the lead's transfer.
// Twilio's participant list decides: anyone other than the caller and the
// legs in `leaving` still queued, ringing or connected counts as company. No
// list (an error, or the conference is already over): change nothing.
async function endIfAlone(store: Store, twilio: Twilio, row: HelpCall, confSid: string | null, leaving: string[]) {
  if (!confSid) return
  const res = await twilio('GET', `/Conferences/${confSid}/Participants.json`).catch(() => null)
  const list = res && res.status < 400 ? res.data?.participants : null
  if (!Array.isArray(list)) {
    if (res?.status !== 404) console.error('participants check failed:', confSid, res?.status, res?.data?.message)
    return
  }
  const on = list.filter((p: any) => !LEFT.includes(p?.status) && !leaving.includes(p?.call_sid))
  if (on.some((p: any) => p.call_sid !== row.call_sid)) return
  const callerOn = on.some((p: any) => p.call_sid === row.call_sid)
  // Claim the end first, so only one callback completes the conference.
  const ended = await store.updateHelpCall(row.call_sid, {
    status: 'ended', ended_at: now(), end_reason: callerOn ? 'caller_alone' : 'caller_hung_up',
    ...(row.outcome == null ? { outcome: 'dropped' as const } : null),
  }, OPEN)
  if (!ended) return
  if (callerOn) {
    const done = await twilio('POST', `/Conferences/${confSid}.json`, { Status: 'completed' }).catch(() => null)
    if (!done || done.status >= 400) console.error('end conference failed:', confSid, done?.status, done?.data?.message)
  }
  if (row.transfer_agent_id) await markLead(store, ended, 'dropped')
}

// The agent leg help-transfer dialed into the conference. Answered by a
// person: the call is transferred and the VA may drop. On the phone leg (amd)
// only AnsweredBy 'human' counts; machine_start, machine_end_beep / _silence /
// _other, fax and unknown are voicemail or nobody, and so is no answer within
// the leg's Timeout. Not answered: the leg is hung up and the row goes back to
// no_answer (end_reason voicemail or no-answer), so the desk offers another
// try or Book instead (Goal 9's fallback), and the miss is logged. Only while the row is
// transferring, and only for the leg on the row (one from an earlier attempt
// changes nothing).
async function agentLeg(store: Store, twilio: Twilio | null, callSid: string, form: Record<string, string>, amd: boolean) {
  const s = form.CallStatus || ''
  const picked = s === 'in-progress' || s === 'answered'
  if (!picked && !FINAL.includes(s)) return twiml()
  const row = await store.helpCall(callSid)
  if (!row || row.status !== 'transferring') return twiml()
  const leg = form.CallSid || ''
  if (row.agent_call_sid && leg !== row.agent_call_sid) return twiml()

  const by = picked && amd ? await answeredBy(twilio, leg, form) : null
  if (picked && (!amd || by === 'human')) {
    const won = await store.updateHelpCall(callSid,
      { status: 'transferred', transferred_at: now(), outcome: 'transferred', end_reason: null }, ['transferring'])
    if (won) await markLead(store, won, 'connected')
    return twiml()
  }

  const back = await store.updateHelpCall(callSid,
    { status: 'no_answer', agent_call_sid: null, end_reason: by?.startsWith('machine_') ? 'voicemail' : 'no-answer' }, ['transferring'])
  if (!back) return twiml()
  // A machine picked up, so the leg is live: hang it up. An ended leg is left alone.
  if (picked && twilio && SID.test(leg)) {
    const res = await twilio('POST', `/Calls/${leg}.json`, { Status: 'completed' }).catch(() => null)
    if (!res || res.status >= 400) console.error('hang up agent leg failed:', leg, res?.status, res?.data?.message)
  }
  await markLead(store, back, 'dropped')
  await logMissed(store, callSid)
  // The VA is already gone too: the caller would sit alone, so end the call.
  if (twilio) await endIfAlone(store, twilio, back, row.conference_sid, SID.test(leg) ? [leg] : [])
  return twiml()
}

// A participant left. The leg is told by its CallSid against the row's stored
// SIDs (the agent leg also by its 'agent' label), never by order.
//   the caller   the conference ends with them (endConferenceOnExit true):
//                close the row, nothing to hang up.
//   VA or agent  nobody else with the caller: end the call. The agent leaving
//                while the VA is on changes nothing.
// A repeated or late callback, or one for a row already ended, is a no-op.
// While still ringing (no VA joined yet) conference-end handles the caller.
async function participantLeave(store: Store, twilio: Twilio | null, callSid: string, form: Record<string, string>, route?: RouteStore) {
  const row = await store.helpCall(callSid)
  if (!row || row.status === 'ended' || row.status === 'ringing') return
  const leg = form.CallSid || ''
  if (!SID.test(leg)) return
  if (leg === row.call_sid) {
    const ended = await store.updateHelpCall(callSid, {
      status: 'ended', ended_at: now(), end_reason: 'caller_hung_up',
      ...(row.outcome == null ? { outcome: 'dropped' as const } : null),
    }, OPEN)
    if (ended && row.transfer_agent_id) await markLead(store, ended, 'dropped')
    return
  }
  const isVa = leg === row.va_call_sid
  const isAgent = leg === row.agent_call_sid || form.ParticipantLabel === 'agent'
  if (!isVa && !isAgent) return
  // P882: the VA's leg dropped while the caller is still with us (not a transfer): hold music, 60 s to rejoin.
  if (isVa && route && row.status === 'live' && await route.vaLeftLine(callSid, leg)) {
    const conf = form.ConferenceSid || row.conference_sid
    if (twilio && conf) {
      const res = await twilio('POST', `/Conferences/${conf}/Participants/${row.call_sid}.json`, { Hold: 'true' }).catch(() => null)
      if (!res || res.status >= 400) console.error('rescue hold (caller) failed:', res?.status)
    }
    return
  }
  if (twilio) await endIfAlone(store, twilio, row, form.ConferenceSid || row.conference_sid, [leg])
}

// P882: the VA (back, or the next one) joined a caller's line: the caller comes off hold.
async function participantJoin(store: Store, twilio: Twilio | null, callSid: string, form: Record<string, string>) {
  if (!twilio || !form.ConferenceSid || !form.CallSid || form.CallSid === callSid) return
  const row = await store.helpCall(callSid)
  if (!row || row.status !== 'live' || row.va_call_sid !== form.CallSid) return
  await twilio('POST', `/Conferences/${form.ConferenceSid}/Participants/${row.call_sid}.json`, { Hold: 'false' }).catch(() => null)
}

async function conf(store: Store, twilio: Twilio | null, callSid: string, form: Record<string, string>, route?: RouteStore) {
  const e = form.StatusCallbackEvent
  if (e === 'conference-start') {
    if (form.ConferenceSid) await store.updateHelpCall(callSid, { conference_sid: form.ConferenceSid })
  } else if (e === 'participant-join') {
    if (route) await participantJoin(store, twilio, callSid, form)
  } else if (e === 'participant-leave') {
    await participantLeave(store, twilio, callSid, form, route)
  } else if (e === 'conference-end') {
    const row = await store.helpCall(callSid)
    if (!row || row.status === 'ended') return twiml()
    const wasLive = row.status === 'live' || row.status === 'transferring'
    await store.updateHelpCall(callSid, {
      status: 'ended', ended_at: now(), end_reason: row.end_reason || 'conference_end',
      ...(row.outcome == null && wasLive ? { outcome: 'dropped' as const } : null),
    })
    // The caller left before a VA answered: stop the VA phones ringing (and take them off the queue).
    if (row.status === 'ringing' && twilio) await cancelLegs(twilio, row.ringing_va_call_sids ?? [])
    if (row.status === 'ringing' && route) await route.inboundGone(callSid)
  }
  return twiml()
}

// P882: the sweep (route_tick → fulfillment_cron_post) ends a caller nobody took in 2 minutes; the callback is
// already queued. Authorized by the x-ohvara-cron secret, not a Twilio signature.
async function cronTimeout(store: Store, twilio: Twilio | null, callSid: string) {
  if (!SID.test(callSid)) return Response.json({ error: 'call required' }, { status: 400 })
  const ended = await store.updateHelpCall(callSid, { status: 'ended', end_reason: 'no_va_in_time', ended_at: now() }, ['ringing'])
  if (ended && twilio) {
    const res = await twilio('POST', `/Calls/${callSid}.json`, { Twiml: `<Response>${sorry()}</Response>` }).catch(() => null)
    if (!res || res.status >= 400) console.error('timeout end caller failed:', res?.status, res?.data?.message)
  }
  return Response.json({ ok: true, ended: !!ended })
}

export async function handle(req: Request, store: Store, twilio: Twilio | null, env: Env, route?: RouteStore, bridge?: BridgeStore): Promise<Response> {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })
  const cron = req.headers.get('x-ohvara-cron')
  if (cron) {
    if (!route || !(await route.isCron(cron))) return new Response('Not allowed', { status: 403 })
    let body: any = {}
    try { body = await req.json() } catch { /* empty */ }
    if (body?.cron !== 'timeout') return Response.json({ error: 'Unknown job' }, { status: 400 })
    return cronTimeout(store, twilio, String(body.call ?? ''))
  }
  if (!env.authToken) return new Response('Not configured', { status: 503 })

  const { form, query: q, ok } = await readTwilioRequest(req, env.authToken, env.publicUrl)
  if (!ok) return new Response('Bad signature', { status: 403 })

  const event = q.get('event')
  if (!event) return inbound(store, twilio, env, form, route)
  // P916: an agent's Call through Deedstone (the agent's leg, then the client).
  if (event.startsWith('ds_bridge') || event === 'ds_client_leg' || event === 'ds_agent_leg') {
    return bridge ? bridgeEvent(event, q, form, bridge, env.publicUrl) : twiml('<Hangup/>')
  }

  const callSid = q.get('call') || ''
  if (!SID.test(callSid)) return twiml(event === 'va_join' ? '<Hangup/>' : '')

  // P916: a call in rang the caller's agent first.
  if (event === 'ds_screen') return route?.deedstone ? screen(route.deedstone, env.publicUrl, callSid) : twiml('<Hangup/>')
  if (event === 'ds_take') return route?.deedstone ? take(route.deedstone, callSid, form) : twiml('<Hangup/>')
  if (event === 'ds_after_agent') {
    if (!route?.deedstone || FINAL.includes(form.CallStatus || '')) return twiml('<Hangup/>')   // the caller hung up
    if (await route.deedstone.inboundDone(callSid)) return twiml('<Hangup/>')                  // the agent took it
    if (!(await store.voiceLive())) return twiml('<Hangup/>')
    return inboundRouted(store, route, env, form)                                               // → the VA desk
  }

  if (event === 'va_join') return vaJoin(store, twilio, env, callSid, q.get('va') || '', form.CallSid || '')
  if (event === 'va_leg') return vaLeg(store, twilio, callSid, form)
  if (event === 'agent_leg') return agentLeg(store, twilio, callSid, form, q.get('amd') === '1')
  if (event === 'conf') return conf(store, twilio, callSid, form, route)
  return twiml()
}
