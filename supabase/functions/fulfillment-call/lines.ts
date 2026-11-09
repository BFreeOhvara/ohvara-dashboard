// fulfillment-call, P882 — the VA phone's buttons for EVERY call type (a lead, a callback, someone calling in, a
// servicing call, a carrier call), not only cancellations. core.ts keeps the cancellation path ({ policy_id });
// this file is the line path ({ line_id }). A line is one Twilio Conference (va_lines.conference) the VA's browser
// is in; this adds and steers the outside people:
//   open_line     start a call from a task: a lead the VA holds, or a policy assigned to them (no free dialing:
//                 no action here ever takes a number from the browser)
//   ring_client   the lead or client on file, after the pre-dial check (consent, opt-out / do not call, legal
//                 hours in their time zone, attempt cap). A refusal says why and when it can go
//   ring_carrier  a carrier from the directory (carriers.service_phone)
//   ring_agent    the agent on the lead or policy (profiles.phone): warm hand-off, merge 3+
//   hold / resume one person · swap · merge (everyone on, 3+) · dtmf (keypad tones to one person)
//   end           drop one person (whoever was left on hold comes back)
//   end_all       the call is over for everyone; the VA goes to wrap-up
//   voicemail     leave the voicemail message on a leg a machine answered, then drop that leg
//   handoff_hold  hand a carrier hold (no client on it) to the next on-shift VA, or say nobody is on
//   requeue       nobody to hand to: end the call and queue a callback for the client
//   coach         an admin on the call: listen (muted), whisper (only the VA hears) or join
// The cron path (end_line) ends a dropped call nobody rescued in time. No recording at launch (Q51).

import { toE164, type Twilio } from './core.ts'

export type Party = 'client' | 'lead' | 'carrier' | 'agent'
export type LineLeg = {
  call_sid: string
  line_id: string
  conference_sid: string | null
  party: Party
  status: 'ringing' | 'live' | 'ended'
  on_hold: boolean
}
export type Line = {
  id: string
  kind: 'lead' | 'servicing' | 'inbound' | 'carrier'
  conference: string
  lead_id: string | null
  policy_id: string | null
  help_call_sid: string | null
  va_id: string | null
  va_call_sid: string | null
  status: 'open' | 'live' | 'rescue' | 'handoff' | 'ended'
}
export type LeadRow = { id: string; phone: string | null; state: string | null; assigned_rep_id: string | null; is_demo?: boolean }
export type PolicyRow = { id: string; agent_id: string; client_phone: string | null; carrier_id: string | null; state?: string | null; is_demo?: boolean }
export type Predial = { ok: boolean; reason: string | null; next_at: string | null }

export interface LineStore {
  role(userId: string): Promise<string | null>
  voiceLive(): Promise<boolean>
  line(id: string): Promise<Line | null>
  lead(id: string): Promise<LeadRow | null>
  policyRow(id: string): Promise<PolicyRow | null>
  agentPhone(agentId: string): Promise<string | null>
  carrierPhone(carrierId: string | null): Promise<string | null>
  voicemailText(): Promise<string | null>
  lineLegs(lineId: string): Promise<LineLeg[]>               // not ended
  saveLineLeg(leg: Partial<LineLeg> & { call_sid: string }): Promise<void>
  lineOpen(va: string, leadId: string | null, policyId: string | null): Promise<string>   // line_open (raises on a bad task)
  lineEnded(lineId: string, reason: string): Promise<void>
  lineHoldState(lineId: string): Promise<void>
  lineHandoff(lineId: string, va: string, detail: Record<string, unknown>): Promise<'queued' | 'no_one'>
  lineRequeue(lineId: string): Promise<void>
  predial(phone: string, state: string | null, leadId: string | null, policyId: string | null): Promise<Predial>
  logAttempt(phone: string, leadId: string | null, policyId: string | null, lineId: string, va: string): Promise<void>
  endHelpCall(callSid: string, reason: string): Promise<void>
  // P916: the agent's Deedstone number (kind logs one call on it; null = no log); null = the old single number.
  deedstoneFrom?(agentId: string, kind: string | null, ref: string): Promise<string | null>
}

export type LineEnv = { from: string | null; voiceUrl: string; configured: boolean }

export class Refused extends Error {
  status: number
  code?: string
  extra?: Record<string, unknown>
  constructor(message: string, status: number, code?: string, extra?: Record<string, unknown>) {
    super(message); this.status = status; this.code = code; this.extra = extra
  }
}
const refuse = (message: string, status: number, code?: string, extra?: Record<string, unknown>): never => {
  throw new Refused(message, status, code, extra)
}

export const LINE_ACTIONS = ['open_line', 'ring_client', 'ring_carrier', 'ring_agent', 'hold', 'resume', 'swap', 'merge',
  'dtmf', 'end', 'end_all', 'voicemail', 'handoff_hold', 'requeue', 'coach'] as const
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const PARTIES: Party[] = ['client', 'lead', 'carrier', 'agent']
const SORRY_DROPPED = 'Sorry, we lost the call. We will call you back shortly.'

// Why a call can't go now, in the VA's words.
export const PREDIAL_WORDS: Record<string, string> = {
  no_phone: 'No valid phone number on file.',
  opted_out: 'They opted out. No calls or texts.',
  dnc: 'They asked not to be called.',
  national_dnc: 'On the national Do Not Call list with no written consent.',
  no_consent: 'No consent to call on file.',
  unknown_state: 'Their state isn\'t on file, so their legal hours are unknown.',
  outside_hours: 'Outside legal calling hours where they are.',
  attempt_cap: 'Called the most times their state allows in 24 hours.',
}

async function twilioOk(twilio: Twilio, method: 'GET' | 'POST' | 'DELETE', path: string, params?: Record<string, string | string[]>) {
  const res = await twilio(method, path, params)
  if (res.status >= 400) refuse(res.data?.message || `Twilio refused it (${res.status})`, 502, 'twilio')
  return res.data
}

async function findConference(twilio: Twilio, name: string): Promise<string | null> {
  const q = new URLSearchParams({ FriendlyName: name, Status: 'in-progress' })
  const data = await twilioOk(twilio, 'GET', `/Conferences.json?${q}`)
  return data?.conferences?.[0]?.sid ?? null
}

const legEvents = (env: LineEnv, lineId: string, who: Party) => ({
  StatusCallback: `${env.voiceUrl}?${new URLSearchParams({ event: 'leg', line: lineId, party: who })}`,
  StatusCallbackMethod: 'POST',
  StatusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
})

async function setHold(twilio: Twilio, store: LineStore, conf: string, leg: LineLeg, hold: boolean) {
  if (leg.on_hold === hold) return
  await twilioOk(twilio, 'POST', `/Conferences/${conf}/Participants/${leg.call_sid}.json`, { Hold: String(hold) })
  await store.saveLineLeg({ call_sid: leg.call_sid, on_hold: hold })
  leg.on_hold = hold
}

const partyOf = (v: unknown): Party => (PARTIES.includes(v as Party) ? v as Party : refuse('Pick who on the call', 400))

// The person the call is about: a lead (lead calls, callbacks, call-ins) or a client (servicing).
const clientParty = (line: Line): Party => (line.lead_id && !line.policy_id ? 'lead' : 'client')

export async function actLine(store: LineStore, twilio: Twilio, env: LineEnv, userId: string, body: any) {
  const role = await store.role(userId)
  if (role !== 'fulfillment' && role !== 'admin') refuse('Fulfillment only', 403)
  const action = body?.action
  if (!LINE_ACTIONS.includes(action)) refuse('Unknown action', 400)
  if (!(await store.voiceLive())) refuse('Calling in the portal isn\'t on yet.', 409, 'voice_off')
  if (!env.configured) refuse('Calling isn\'t set up yet.', 503, 'not_configured')

  if (action === 'open_line') {
    const leadId = UUID.test(body.lead_id ?? '') ? body.lead_id : null
    const policyId = UUID.test(body.policy_id ?? '') ? body.policy_id : null
    if (!leadId && !policyId) refuse('A call starts from a task.', 400, 'no_task')
    if (leadId && (await store.lead(leadId))?.is_demo) refuse('This is a sample account: no real calls are placed.', 409, 'demo')
    if (policyId && (await store.policyRow(policyId))?.is_demo) refuse('This is a sample account: no real calls are placed.', 409, 'demo')
    try {
      return { ok: true, line_id: await store.lineOpen(userId, leadId, policyId) }
    } catch (e) {
      refuse((e as Error).message || 'Couldn\'t start this call.', 409, 'task')
    }
  }

  if (!UUID.test(body?.line_id ?? '')) refuse('line_id required', 400)
  const line = await store.line(body.line_id)
  if (!line) refuse('Call not found', 404)
  if (action === 'coach') {
    if (role !== 'admin') refuse('Admins only', 403)
  } else if (line!.va_id !== userId && role !== 'admin') {
    refuse('This call belongs to another VA.', 403)
  }
  if (line!.status === 'ended' && action !== 'end_all') refuse('This call has ended.', 409, 'ended')

  const legs = await store.lineLegs(line!.id)
  const live = legs.filter(l => l.status === 'live')
  const legOf = (who: Party) => legs.find(l => l.party === who) || null
  const conf = await findConference(twilio, line!.conference)

  if (action === 'end_all') {
    if (conf) await twilioOk(twilio, 'POST', `/Conferences/${conf}.json`, { Status: 'completed' })
    for (const l of legs) await store.saveLineLeg({ call_sid: l.call_sid, status: 'ended', on_hold: false })
    await store.lineEnded(line!.id, 'va_end')
    return { ok: true }
  }
  if (!conf) refuse('Your line isn\'t connected yet.', 409, 'no_conference')

  const done = async (out: Record<string, unknown> = { ok: true }) => { await store.lineHoldState(line!.id); return out }

  if (action === 'ring_client' || action === 'ring_carrier' || action === 'ring_agent') {
    const lead = line!.lead_id ? await store.lead(line!.lead_id) : null
    const pol = line!.policy_id ? await store.policyRow(line!.policy_id) : null
    if (lead?.is_demo || pol?.is_demo) refuse('This is a sample account: no real calls are placed.', 409, 'demo')
    let who: Party
    let to: string | null
    let callerId: string | null = env.from
    if (action === 'ring_client') {
      who = clientParty(line!)
      if (line!.kind === 'inbound') refuse('They are already on the line.', 409, 'already_on')
      to = toE164(pol?.client_phone ?? lead?.phone)
      if (!to) refuse('No valid phone number on file.', 400, 'no_client_phone')
      const chk = await store.predial(to!, pol?.state ?? lead?.state ?? null, line!.lead_id, line!.policy_id)
      if (!chk.ok) {
        refuse(`Can't call now: ${PREDIAL_WORDS[chk.reason || ''] || chk.reason}`, 409, 'predial',
          { reason: chk.reason, next_at: chk.next_at })
      }
      // P916: clients and leads see their agent's Deedstone number, the same one on every call about them.
    } else if (action === 'ring_carrier') {
      who = 'carrier'
      to = toE164(await store.carrierPhone(body.carrier_id ?? pol?.carrier_id ?? null))
      if (!to) refuse('No phone number on file for this carrier.', 400, 'no_carrier_phone')
    } else {
      who = 'agent'
      const agent = pol?.agent_id ?? lead?.assigned_rep_id ?? null
      to = toE164(agent ? await store.agentPhone(agent) : null)
      if (!to) refuse('No phone number on file for the agent.', 400, 'no_agent_phone')
    }
    if (legOf(who!)) refuse('They are already on the line.', 409, 'already_on')
    // P916: every call about an agent's lead or client goes out from that agent's Deedstone number (carriers keep
    // the old number). A call to the agent's own phone shows it too, without counting toward the number's day.
    const agentId = pol?.agent_id ?? lead?.assigned_rep_id ?? null
    if (agentId && who! !== 'carrier' && store.deedstoneFrom) {
      callerId = (await store.deedstoneFrom(agentId, who! === 'agent' ? null : 'va_call', line!.id)) || callerId
    }
    if (!callerId) refuse('No Twilio number to place calls from yet.', 503, 'no_from_number')
    // Whoever is talking waits on hold while the new person rings.
    for (const l of live.filter(x => !x.on_hold)) await setHold(twilio, store, conf!, l, true)
    const data = await twilioOk(twilio, 'POST', `/Conferences/${conf}/Participants.json`, {
      From: callerId!, To: to!, Label: who!, Beep: 'false', EarlyMedia: 'true',
      EndConferenceOnExit: 'false', Timeout: '30', MachineDetection: 'Enable', ...legEvents(env, line!.id, who!),
    })
    await store.saveLineLeg({ call_sid: data.call_sid, line_id: line!.id, conference_sid: conf, party: who!, status: 'ringing', on_hold: false })
    if (who! === 'lead' || who! === 'client') await store.logAttempt(to!, line!.lead_id, line!.policy_id, line!.id, userId)
    return done({ ok: true, call_sid: data.call_sid })
  }

  if (action === 'hold' || action === 'resume') {
    const leg = legOf(partyOf(body.party))
    if (!leg || leg.status !== 'live') refuse('That line isn\'t connected.', 409, 'no_leg')
    await setHold(twilio, store, conf!, leg!, action === 'hold')
    return done()
  }

  if (action === 'swap') {
    const talking = live.filter(l => !l.on_hold)
    const held = live.filter(l => l.on_hold)
    if (talking.length !== 1 || held.length !== 1) refuse('Swap needs one person talking and one on hold.', 409, 'no_swap')
    await setHold(twilio, store, conf!, talking[0], true)
    await setHold(twilio, store, conf!, held[0], false)
    return done()
  }

  if (action === 'merge') {
    if (live.length < 2) refuse('Merge needs at least two people connected.', 409, 'no_merge')
    for (const l of live) await setHold(twilio, store, conf!, l, false)
    return done({ ok: true, on_call: live.length + 1 })
  }

  if (action === 'dtmf') {
    const digits = String(body.digits ?? '')
    if (!/^[0-9*#w]{1,32}$/.test(digits)) refuse('Digits must be 0-9, * or #', 400)
    const leg = legOf(body.party ? partyOf(body.party) : 'carrier')
    if (!leg || leg.status !== 'live') refuse('They aren\'t connected.', 409, 'no_leg')
    await twilioOk(twilio, 'POST', `/Conferences/${conf}/Participants/${leg!.call_sid}.json`, {
      AnnounceUrl: `${env.voiceUrl}?${new URLSearchParams({ event: 'dtmf', digits })}`, AnnounceMethod: 'POST',
    })
    return { ok: true }
  }

  if (action === 'voicemail') {
    const leg = legOf(body.party ? partyOf(body.party) : clientParty(line!))
    if (!leg || leg.status !== 'live') refuse('Wait for the voicemail to answer.', 409, 'no_leg')
    const words = await store.voicemailText()
    if (!words) refuse('The voicemail message isn\'t set yet.', 409, 'no_voicemail_words')
    // Taking the leg out of the conference to say the message, then hanging up, is a voicemail drop.
    await twilioOk(twilio, 'POST', `/Calls/${leg!.call_sid}.json`, { Twiml: `<Response><Pause length="1"/><Say>${xmlEsc(words!)}</Say><Hangup/></Response>` })
    await store.saveLineLeg({ call_sid: leg!.call_sid, status: 'ended', on_hold: false })
    return done()
  }

  if (action === 'handoff_hold' || action === 'requeue') {
    if (live.some(l => l.party !== 'carrier')) refuse('Only a carrier hold with no client on the line can be handed off.', 409, 'client_on')
    if (action === 'requeue') {
      await twilioOk(twilio, 'POST', `/Conferences/${conf}.json`, { Status: 'completed' })
      for (const l of legs) await store.saveLineLeg({ call_sid: l.call_sid, status: 'ended', on_hold: false })
      await store.lineRequeue(line!.id)
      return { ok: true, requeued: true }
    }
    const detail = typeof body.detail === 'object' && body.detail ? body.detail : {}
    const clean: Record<string, unknown> = {}
    for (const k of ['carrier', 'menu_path', 'client', 'notes', 'reason']) {
      if (typeof detail[k] === 'string') clean[k] = detail[k].slice(0, 500)
    }
    const out = await store.lineHandoff(line!.id, userId, clean)
    return out === 'queued' ? { ok: true, queued: true } : { ok: true, no_one: true }
  }

  if (action === 'coach') {
    const mode = body.mode
    if (!['listen', 'whisper', 'join'].includes(mode)) refuse('mode must be listen, whisper or join', 400)
    const me = String(body.call_sid ?? '')
    if (!/^CA[0-9a-zA-Z]{1,64}$/.test(me)) refuse('call_sid required', 400)
    if (mode === 'whisper' && !line!.va_call_sid) refuse('The VA isn\'t on the line.', 409, 'no_va')
    await twilioOk(twilio, 'POST', `/Conferences/${conf}/Participants/${me}.json`, mode === 'listen'
      ? { Muted: 'true', Coaching: 'false' }
      : mode === 'whisper'
        ? { Muted: 'false', Coaching: 'true', CallSidToCoach: line!.va_call_sid! }
        : { Muted: 'false', Coaching: 'false' })
    return { ok: true, mode }
  }

  // end: drop one person; whoever was left on hold comes back.
  const leg = legOf(partyOf(body.party))
  if (!leg) refuse('That line isn\'t connected.', 409, 'no_leg')
  await twilioOk(twilio, 'POST', `/Calls/${leg!.call_sid}.json`, { Status: leg!.status === 'ringing' ? 'canceled' : 'completed' })
  await store.saveLineLeg({ call_sid: leg!.call_sid, status: 'ended', on_hold: false })
  const rest = legs.filter(l => l !== leg && l.status === 'live')
  if (rest.length && rest.every(l => l.on_hold)) for (const l of rest) await setHold(twilio, store, conf!, l, false)
  return done()
}

// The sweep (route_tick, via fulfillment_cron_post): a dropped call nobody took back in time. End it for whoever
// is still on, with a short message to the caller; the callback is already queued by the sweep.
export async function endLine(store: LineStore, twilio: Twilio, lineId: string) {
  if (!UUID.test(lineId)) refuse('line_id required', 400)
  const line = await store.line(lineId)
  if (!line) return { ok: true, gone: true }
  for (const l of await store.lineLegs(line.id)) {
    const res = await twilio('POST', `/Calls/${l.call_sid}.json`, { Twiml: `<Response><Say>${xmlEsc(SORRY_DROPPED)}</Say><Hangup/></Response>` }).catch(() => null)
    if (!res || res.status >= 400) console.error('end_line leg failed:', l.call_sid, res?.status)
    await store.saveLineLeg({ call_sid: l.call_sid, status: 'ended', on_hold: false })
  }
  if (line.help_call_sid) {
    await twilio('POST', `/Calls/${line.help_call_sid}.json`, { Twiml: `<Response><Say>${xmlEsc(SORRY_DROPPED)}</Say><Hangup/></Response>` }).catch(() => null)
    await store.endHelpCall(line.help_call_sid, 'rescue_timeout')
  }
  const conf = await findConference(twilio, line.conference).catch(() => null)
  if (conf) await twilio('POST', `/Conferences/${conf}.json`, { Status: 'completed' }).catch(() => null)
  await store.lineEnded(line.id, 'rescue_timeout')
  return { ok: true }
}

function xmlEsc(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

