// fulfillment-call — Prompt 751, the pop-up phone's buttons. Logic only; the
// Deno wiring (secrets, the service-role store, Twilio's REST API) is index.ts.
//
// One Twilio Conference per call, named for the policy (policy-<id>). The
// rep's browser is already in it (fulfillment-voice answered the TwiML App);
// this adds and steers the two outside parties:
//   ring_client   add the client. Caller ID = the agent's verified number when
//                 it's on (start-agent-caller-id-call's rule), else Ohvara's.
//   ring_carrier  add the carrier's service_phone from Ohvara's number.
//                 Either way, the party already talking is put on hold.
//   hold / resume one party (participant hold, Twilio's hold music)
//   swap          hold the one you're talking to, resume the one on hold
//   merge         resume everyone
//   dtmf          keypad digits to the carrier leg (phone menus), played to
//                 that leg only through an announcement
//   end           hang up one party; a party left on hold is resumed
//   end_all       end the conference
// Who: the assigned rep or an admin, on a cancellation that isn't done, and
// only while recovery_config.voice_live is on. No recording.

export type Leg = {
  call_sid: string
  policy_id: string
  conference_sid: string | null
  party: 'client' | 'carrier'
  status: 'ringing' | 'live' | 'ended'
  on_hold: boolean
}

export type Policy = {
  id: string
  agent_id: string
  client_phone: string | null
  fulfillment_assigned: boolean
  assigned_fulfillment_id: string | null
  fulfillment_stage: string | null
  carrier_id: string | null
}

export interface Store {
  userFromJwt(jwt: string): Promise<string | null>
  role(userId: string): Promise<string | null>
  policy(id: string): Promise<Policy | null>
  agentCallerId(agentId: string): Promise<{ caller_id_number: string | null; caller_id_enabled: boolean | null } | null>
  carrierPhone(carrierId: string | null): Promise<string | null>
  voiceLive(): Promise<boolean>
  openLegs(policyId: string): Promise<Leg[]>
  saveLeg(leg: Partial<Leg> & { call_sid: string }): Promise<void>
}

type Params = Record<string, string | string[]>
export type Twilio = (method: 'GET' | 'POST' | 'DELETE', path: string, params?: Params) => Promise<{ status: number; data: any }>

export type Env = { from: string | null; voiceUrl: string; configured: boolean }

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

class Refused extends Error {
  status: number
  code?: string
  constructor(message: string, status: number, code?: string) { super(message); this.status = status; this.code = code }
}
const refuse = (message: string, status: number, code?: string): never => { throw new Refused(message, status, code) }

export const ACTIONS = ['ring_client', 'ring_carrier', 'hold', 'resume', 'swap', 'merge', 'dtmf', 'end', 'end_all'] as const

export const conferenceName = (policyId: string) => `policy-${policyId}`

export function toE164(raw: unknown): string | null {
  const d = String(raw ?? '').replace(/\D/g, '')
  if (d.length === 10) return `+1${d}`
  if (d.length === 11 && d.startsWith('1')) return `+${d}`
  return null
}

// The caller ID the client sees: the agent's verified number when it's on,
// otherwise Ohvara's Twilio number (same rule as start-agent-caller-id-call).
export function clientCallerId(agent: { caller_id_number: string | null; caller_id_enabled: boolean | null } | null, from: string | null) {
  return agent?.caller_id_enabled && agent.caller_id_number ? agent.caller_id_number : from
}

const party = (v: unknown) => (v === 'client' || v === 'carrier' ? v : refuse('party must be client or carrier', 400))

async function twilioOk(twilio: Twilio, method: 'GET' | 'POST' | 'DELETE', path: string, params?: Params) {
  const res = await twilio(method, path, params)
  if (res.status >= 400) refuse(res.data?.message || `Twilio refused it (${res.status})`, 502, 'twilio')
  return res.data
}

async function findConference(twilio: Twilio, policyId: string): Promise<string | null> {
  const q = new URLSearchParams({ FriendlyName: conferenceName(policyId), Status: 'in-progress' })
  const data = await twilioOk(twilio, 'GET', `/Conferences.json?${q}`)
  return data?.conferences?.[0]?.sid ?? null
}

function legEvents(env: Env, policyId: string, who: 'client' | 'carrier') {
  const q = new URLSearchParams({ event: 'leg', policy: policyId, party: who })
  return {
    StatusCallback: `${env.voiceUrl}?${q}`,
    StatusCallbackMethod: 'POST',
    StatusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
  }
}

async function setHold(twilio: Twilio, store: Store, conf: string, leg: Leg, hold: boolean) {
  if (leg.on_hold === hold) return
  await twilioOk(twilio, 'POST', `/Conferences/${conf}/Participants/${leg.call_sid}.json`, { Hold: String(hold) })
  await store.saveLeg({ call_sid: leg.call_sid, on_hold: hold })
  leg.on_hold = hold
}

export async function act(store: Store, twilio: Twilio, env: Env, userId: string, body: any) {
  const role = await store.role(userId)
  if (role !== 'fulfillment' && role !== 'admin') refuse('Fulfillment only', 403)
  if (!body?.policy_id) refuse('policy_id required', 400)
  const action = body.action
  if (!ACTIONS.includes(action)) refuse('Unknown action', 400)

  const p = await store.policy(body.policy_id)
  if (!p || !p.fulfillment_assigned) refuse('Cancellation not found', 404)
  if (role !== 'admin' && p!.assigned_fulfillment_id !== userId) refuse('Only the rep it\'s assigned to can call on this one.', 403)
  if (p!.fulfillment_stage === 'Complete' && action !== 'end_all' && action !== 'end') refuse('This one is already cancelled', 409, 'done')
  if (!(await store.voiceLive())) refuse('Calling in the portal isn\'t on yet.', 409, 'voice_off')
  if (!env.configured) refuse('Calling isn\'t set up yet.', 503, 'not_configured')

  const legs = await store.openLegs(p!.id)
  const live = legs.filter(l => l.status === 'live')
  const legOf = (who: 'client' | 'carrier') => legs.find(l => l.party === who) || null

  const conf = await findConference(twilio, p!.id)
  if (action === 'end_all') {
    if (conf) await twilioOk(twilio, 'POST', `/Conferences/${conf}.json`, { Status: 'completed' })
    for (const l of legs) await store.saveLeg({ call_sid: l.call_sid, status: 'ended', on_hold: false })
    return { ok: true }
  }
  if (!conf) refuse('Your line isn\'t connected yet.', 409, 'no_conference')

  if (action === 'ring_client' || action === 'ring_carrier') {
    const who = action === 'ring_client' ? 'client' : 'carrier'
    if (legOf(who)) refuse(`The ${who} is already on the line.`, 409, 'already_on')
    let to: string | null
    let callerId: string | null
    if (who === 'client') {
      to = toE164(p!.client_phone)
      if (!to) refuse('No valid client phone on file.', 400, 'no_client_phone')
      callerId = clientCallerId(await store.agentCallerId(p!.agent_id), env.from)
    } else {
      to = toE164(await store.carrierPhone(p!.carrier_id))
      if (!to) refuse('No phone number on file for this carrier.', 400, 'no_carrier_phone')
      callerId = env.from
    }
    if (!callerId) refuse('No Twilio number to place calls from yet.', 503, 'no_from_number')
    // Whoever the rep is talking to stays connected, on hold, while the other
    // one rings (the client while the rep works the carrier; the carrier while
    // the rep brings the client back).
    const talking = legOf(who === 'client' ? 'carrier' : 'client')
    if (talking?.status === 'live') await setHold(twilio, store, conf!, talking, true)
    const data = await twilioOk(twilio, 'POST', `/Conferences/${conf}/Participants.json`, {
      From: callerId!, To: to!, Label: who, Beep: 'false', EarlyMedia: 'true',
      EndConferenceOnExit: 'false', Timeout: '30', ...legEvents(env, p!.id, who),
    })
    await store.saveLeg({ call_sid: data.call_sid, policy_id: p!.id, conference_sid: conf, party: who, status: 'ringing', on_hold: false })
    return { ok: true, call_sid: data.call_sid }
  }

  if (action === 'hold' || action === 'resume') {
    const leg = legOf(party(body.party))
    if (!leg || leg.status !== 'live') refuse('That line isn\'t connected.', 409, 'no_leg')
    await setHold(twilio, store, conf!, leg!, action === 'hold')
    return { ok: true }
  }

  if (action === 'swap') {
    const talking = live.filter(l => !l.on_hold)
    const held = live.filter(l => l.on_hold)
    if (talking.length !== 1 || held.length !== 1) refuse('Swap needs one line talking and one on hold.', 409, 'no_swap')
    await setHold(twilio, store, conf!, talking[0], true)
    await setHold(twilio, store, conf!, held[0], false)
    return { ok: true }
  }

  if (action === 'merge') {
    if (live.length < 2) refuse('Merge needs both lines connected.', 409, 'no_merge')
    for (const l of live) await setHold(twilio, store, conf!, l, false)
    return { ok: true }
  }

  if (action === 'dtmf') {
    const digits = String(body.digits ?? '')
    if (!/^[0-9*#w]{1,32}$/.test(digits)) refuse('Digits must be 0-9, * or #', 400)
    const carrier = legOf('carrier')
    if (!carrier || carrier.status !== 'live') refuse('The carrier isn\'t connected.', 409, 'no_leg')
    const q = new URLSearchParams({ event: 'dtmf', digits })
    await twilioOk(twilio, 'POST', `/Conferences/${conf}/Participants/${carrier!.call_sid}.json`, {
      AnnounceUrl: `${env.voiceUrl}?${q}`, AnnounceMethod: 'POST',
    })
    return { ok: true }
  }

  // end: hang up one party; whoever is left on hold comes back.
  const leg = legOf(party(body.party))
  if (!leg) refuse('That line isn\'t connected.', 409, 'no_leg')
  await twilioOk(twilio, 'POST', `/Calls/${leg!.call_sid}.json`, { Status: leg!.status === 'ringing' ? 'canceled' : 'completed' })
  await store.saveLeg({ call_sid: leg!.call_sid, status: 'ended', on_hold: false })
  const other = legs.find(l => l !== leg && l.status === 'live' && l.on_hold)
  if (other) await setHold(twilio, store, conf!, other, false)
  return { ok: true }
}

export async function handle(req: Request, store: Store, twilio: Twilio, env: Env): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer /, '')
  const userId = jwt ? await store.userFromJwt(jwt) : null
  if (!userId) return json({ error: 'Not signed in' }, 401)
  let body: any = {}
  try { body = await req.json() } catch { /* empty body */ }
  try {
    return json(await act(store, twilio, env, userId, body))
  } catch (e) {
    if (e instanceof Refused) return json({ error: e.message, code: e.code }, e.status)
    console.error('fulfillment-call', e)
    return json({ error: 'Something went wrong placing that call.' }, 500)
  }
}
