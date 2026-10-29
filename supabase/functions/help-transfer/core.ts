// help-transfer — Roadmap Goal 9, the VA desk's transfer buttons. Logic only;
// the Deno wiring (secrets, the service-role store, Twilio's REST API) is
// index.ts.
//
// The caller and the VA are already in the conference help-<CallSid>
// (help-voice). This brings in an on-duty agent and lets the VA leave:
//   transfer  dial the agent who has been on duty longest into the
//             conference. The agent is picked here, never by the browser.
//             Nobody on duty: status no_answer and code no_agent, so the desk
//             offers "Book instead". help-voice ?event=agent_leg moves the row
//             to transferred (a person answered) or back to no_answer
//             (voicemail, fax, unknown or no answer: agentLegParams).
//   drop      the VA hangs up their own leg once the agent has answered. The
//             conference is never ended here: the VA joined with
//             endConferenceOnExit false, so the caller and agent keep talking.
//   book      nobody took it: the row ends with outcome booked. The lead
//             itself is saved by the desk (va_save_policy_help_lead, 175).
// Who: the VA who answered the call (or an admin), active, and only while
// recovery_config.voice_live is on. Nothing is recorded.

import { helpConferenceName, type HelpCall, type HelpStatus, type Store as VoiceStore } from '../help-voice/core.ts'
import type { Twilio } from '../_shared/twilio.ts'
export type { Twilio } from '../_shared/twilio.ts'

export type OnDutyAgent = { agent_id: string; phone: string }

export interface Store extends Pick<VoiceStore, 'voiceLive' | 'helpCall' | 'updateHelpCall'> {
  userFromJwt(jwt: string): Promise<string | null>
  caller(userId: string): Promise<{ role: string | null; is_active: boolean | null } | null>
  // The active agent (profiles role 'agent', not a demo account) on duty the
  // longest (agent_duty.since) whose phone is a valid number; null when none.
  onDutyAgent(): Promise<OnDutyAgent | null>
}

// from: HELP_TRACKING_NUMBER, the agent leg's caller ID. voiceUrl: help-voice.
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

export const ACTIONS = ['transfer', 'drop', 'book'] as const

const SID = /^CA[0-9a-zA-Z]{1,64}$/
const NOT_YOURS = 'Only the VA on this call can transfer it.'

export function toE164(raw: unknown): string | null {
  const d = String(raw ?? '').replace(/\D/g, '')
  if (d.length === 10) return `+1${d}`
  if (d.length === 11 && d.startsWith('1')) return `+${d}`
  return null
}

const now = () => new Date().toISOString()

async function twilioOk(twilio: Twilio, method: 'GET' | 'POST', path: string, params?: Record<string, string | string[]>) {
  const res = await twilio(method, path, params)
  if (res.status >= 400) refuse(res.data?.message || `Twilio refused it (${res.status})`, 502, 'twilio')
  return res.data
}

async function findConference(twilio: Twilio, callSid: string): Promise<string | null> {
  const q = new URLSearchParams({ FriendlyName: helpConferenceName(callSid), Status: 'in-progress' })
  const data = await twilioOk(twilio, 'GET', `/Conferences.json?${q}`)
  return data?.conferences?.[0]?.sid ?? null
}

// The agent's leg into the conference. EndConferenceOnExit stays 'false': the
// agent leaving never ends the call by itself (help-voice ends it once the
// caller would be alone). Timeout 25 s: not answered by then is no answer.
// A phone (PSTN) leg also gets synchronous answering machine detection, so a
// voicemail never counts as the agent picking up (help-voice ?amd=1 reads
// AnsweredBy). A browser leg (client:...) gets none: AMD doesn't apply there.
export function agentLegParams(env: Env, to: string, callSid: string): Record<string, string | string[]> {
  const phone = !to.startsWith('client:')
  const cb = new URLSearchParams({ event: 'agent_leg', call: callSid, ...(phone ? { amd: '1' } : null) })
  return {
    From: env.from!, To: to, Label: 'agent', Beep: 'false', EndConferenceOnExit: 'false', Timeout: '25',
    // AMD adds a small Twilio charge per phone-leg call: expected, fine under the cap.
    ...(phone ? { MachineDetection: 'Enable', MachineDetectionTimeout: '10' } : null),
    StatusCallback: `${env.voiceUrl}?${cb}`, StatusCallbackMethod: 'POST',
    StatusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
  }
}

async function transfer(store: Store, twilio: Twilio, env: Env, row: HelpCall) {
  if (row.status !== 'live' && row.status !== 'no_answer') refuse('This call can\'t be transferred right now.', 409, 'not_live')
  if (!env.from) refuse('No Twilio number to place calls from yet.', 503, 'no_from_number')

  const agent = await store.onDutyAgent()
  const to = toE164(agent?.phone)
  if (!agent || !to) {
    await store.updateHelpCall(row.call_sid, { status: 'no_answer', agent_call_sid: null }, ['live', 'no_answer'])
    return { ok: false, code: 'no_agent' }
  }

  const conf = await findConference(twilio, row.call_sid)
  if (!conf) refuse('The caller isn\'t on the line anymore.', 409, 'no_conference')

  // Claim first, so a double click dials one agent, and an agent_leg callback
  // that lands before the agent's CallSid is saved still finds the row.
  const was: HelpStatus[] = ['live', 'no_answer']
  const claimed = await store.updateHelpCall(row.call_sid,
    { status: 'transferring', transfer_agent_id: agent.agent_id, agent_call_sid: null, transfer_started_at: now() }, was)
  if (!claimed) refuse('A transfer is already ringing.', 409, 'busy')

  const res = await twilio('POST', `/Conferences/${conf}/Participants.json`, agentLegParams(env, to, row.call_sid))
    .catch(e => ({ status: 599, data: { message: (e as Error).message } }))
  if (res.status >= 400 || !res.data?.call_sid) {
    await store.updateHelpCall(row.call_sid, { status: row.status, transfer_agent_id: null, transfer_started_at: null }, ['transferring'])
    refuse(res.data?.message || `Twilio refused it (${res.status})`, 502, 'twilio')
  }
  await store.updateHelpCall(row.call_sid, { agent_call_sid: res.data.call_sid }, ['transferring', 'transferred'])
  return { ok: true, status: 'transferring' }
}

async function drop(twilio: Twilio, row: HelpCall) {
  if (row.status !== 'transferred') refuse('Wait for the agent to answer', 409, 'not_transferred')
  if (!row.va_call_sid || !SID.test(row.va_call_sid)) refuse('Your line isn\'t connected.', 409, 'no_va_leg')
  // Only the VA's own leg. The conference itself is never completed here.
  await twilioOk(twilio, 'POST', `/Calls/${row.va_call_sid}.json`, { Status: 'completed' })
  return { ok: true }
}

async function book(store: Store, row: HelpCall) {
  const open: HelpStatus[] = ['live', 'no_answer', 'ended']
  if (!open.includes(row.status) || row.outcome === 'transferred') refuse('This call was already handed to an agent.', 409, 'not_bookable')
  const saved = await store.updateHelpCall(row.call_sid,
    { outcome: 'booked', status: 'ended', end_reason: 'booked', ended_at: row.ended_at ?? now() }, open)
  if (!saved) refuse('This call changed. Try again.', 409, 'busy')
  return { ok: true }
}

export async function act(store: Store, twilio: Twilio, env: Env, userId: string, body: any) {
  const me = await store.caller(userId)
  const admin = me?.role === 'admin'
  if (!me?.is_active || (me.role !== 'fulfillment' && !admin)) refuse(NOT_YOURS, 403)
  const action = body?.action
  if (!ACTIONS.includes(action)) refuse('Unknown action', 400)
  const callSid = String(body?.call_sid ?? '')
  if (!SID.test(callSid)) refuse('call_sid required', 400)

  const row = await store.helpCall(callSid)
  if (!row) refuse('Call not found', 404)
  if (!admin && row!.va_id !== userId) refuse(NOT_YOURS, 403)
  if (!(await store.voiceLive())) refuse('Calling in the portal isn\'t on yet.', 409, 'voice_off')
  if (!env.configured) refuse('Calling isn\'t set up yet.', 503, 'not_configured')

  // Any agent_id in the body is ignored: the agent comes from onDutyAgent().
  if (action === 'transfer') return transfer(store, twilio, env, row!)
  if (action === 'drop') return drop(twilio, row!)
  return book(store, row!)
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
    console.error('help-transfer', e)
    return json({ error: 'Something went wrong with that transfer.' }, 500)
  }
}
