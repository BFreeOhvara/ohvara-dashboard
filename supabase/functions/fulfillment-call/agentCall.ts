// fulfillment-call, P916 — an agent's Call through Deedstone, and connecting the agent's phone. core.ts is the
// cancellation phone, lines.ts the VA lines; this file is the agent path ({ action: 'agent_*' }).
//   agent_call    tap Call on a lead or client: the agent's connected phone rings first (from their Deedstone
//                 number); when they answer and press 1, help-voice dials the client from that same number. The
//                 lead or client is the agent's own, and the pre-dial check runs (consent, do not call, the state's
//                 hours, the attempt cap) before anything rings. No recording (Q51).
//   agent_hangup  end the call (the agent's leg; the client's leg ends with it)
//   verify_phone  "Your phone for Deedstone calls": a short voice call that reads a 6-digit code (works while
//                 texting is off). The agent types it in Settings (deedstone_code_confirm, an RPC).
// Nothing rings while recovery_config.voice_live is off.

import { toE164, type Twilio } from './core.ts'

export const AGENT_ACTIONS = ['agent_call', 'agent_hangup', 'verify_phone'] as const
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type Begin = {
  ok: boolean; reason?: string | null; next_at?: string | null
  call_id?: string; from?: string; agent_phone?: string; client_phone?: string; name?: string | null
}
export type AgentCallRow = { id: string; agent_id: string; agent_call_sid: string | null; status: string }

export interface AgentStore {
  role(userId: string): Promise<string | null>
  voiceLive(): Promise<boolean>
  callBegin(agentId: string, leadId: string | null, policyId: string | null): Promise<Begin>   // deedstone_call_begin
  agentCall(id: string): Promise<AgentCallRow | null>
  saveAgentCall(id: string, patch: Record<string, unknown>): Promise<void>
  codeBegin(agentId: string, phone: string): Promise<string>   // deedstone_code_begin (raises bad_phone / too_many)
  numberFor(agentId: string): Promise<string | null>           // deedstone_from with no log
}
// helpUrl: help-voice (it answers the agent's leg and dials the client). from: the old single number (fallback for
// the code call when the pool is empty).
export type AgentEnv = { from: string | null; helpUrl: string; configured: boolean }

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

// Why a Call can't go now, in the agent's words.
export const AGENT_WORDS: Record<string, string> = {
  not_agent: 'Only agents can call through Deedstone.',
  demo: 'This is a sample account: no real calls are placed.',
  not_yours: 'This lead or client isn\'t yours.',
  no_task: 'Pick a lead or client to call.',
  no_phone: 'No valid phone number on file for them.',
  no_agent_phone: 'Connect your phone in Settings first.',
  no_number: 'Deedstone calling isn\'t set up yet.',
  busy: 'You\'re already on a Deedstone call.',
  opted_out: 'They opted out. No calls or texts.',
  dnc: 'They asked not to be called.',
  national_dnc: 'On the national Do Not Call list with no written consent.',
  no_consent: 'No consent to call on file.',
  unknown_state: 'Their state isn\'t on file, so their legal hours are unknown.',
  outside_hours: 'Outside legal calling hours where they are.',
  attempt_cap: 'Called the most times their state allows in 24 hours.',
}

// The code read slowly, twice.
export function codeTwiml(code: string) {
  const said = code.split('').join(', ')
  return `<Response><Pause length="1"/><Say>Your Deedstone code is ${said}.</Say><Pause length="1"/>` +
    `<Say>Again, your code is ${said}.</Say></Response>`
}

const bridgeUrl = (env: AgentEnv, event: string, id: string) => `${env.helpUrl}?${new URLSearchParams({ event, dc: id })}`

export async function actAgent(store: AgentStore, twilio: Twilio, env: AgentEnv, userId: string, body: any) {
  const role = await store.role(userId)
  if (role !== 'agent') refuse('Only agents can call through Deedstone.', 403, 'not_agent')
  const action = body?.action
  if (!AGENT_ACTIONS.includes(action)) refuse('Unknown action', 400)
  if (!(await store.voiceLive())) refuse('Calling through Deedstone isn\'t on yet.', 409, 'voice_off')
  if (!env.configured) refuse('Calling isn\'t set up yet.', 503, 'not_configured')

  if (action === 'verify_phone') {
    const phone = toE164(body.phone)
    if (!phone) refuse('Enter a 10-digit US phone number.', 400, 'bad_phone')
    let code = ''
    try { code = await store.codeBegin(userId, phone!) } catch (e) {
      const m = (e as Error).message || ''
      if (m.includes('too_many')) refuse('Too many code calls. Try again in an hour.', 429, 'too_many')
      if (m.includes('bad_phone')) refuse('Enter a 10-digit US phone number.', 400, 'bad_phone')
      refuse('Couldn\'t start the code call.', 409, 'code')
    }
    const from = (await store.numberFor(userId)) || env.from
    if (!from) refuse('Deedstone calling isn\'t set up yet.', 503, 'no_number')
    const res = await twilio('POST', '/Calls.json', { To: phone!, From: from!, Twiml: codeTwiml(code), Timeout: '30' })
    if (res.status >= 400) refuse('The code call didn\'t go through. Check the number and try again.', 502, 'twilio')
    return { ok: true, calling: phone }
  }

  if (action === 'agent_hangup') {
    if (!UUID.test(body.call_id ?? '')) refuse('call_id required', 400)
    const c = await store.agentCall(body.call_id)
    if (!c || c.agent_id !== userId) refuse('Call not found', 404)
    if (c!.status === 'ended') return { ok: true }
    if (c!.agent_call_sid) await twilio('POST', `/Calls/${c!.agent_call_sid}.json`, { Status: 'completed' }).catch(() => null)
    await store.saveAgentCall(c!.id, { status: 'ended', end_reason: 'agent_hung_up', ended_at: new Date().toISOString() })
    return { ok: true }
  }

  // agent_call
  const leadId = UUID.test(body.lead_id ?? '') ? body.lead_id : null
  const policyId = UUID.test(body.policy_id ?? '') ? body.policy_id : null
  if (!leadId && !policyId) refuse('Pick a lead or client to call.', 400, 'no_task')
  const b = await store.callBegin(userId, leadId, policyId)
  if (!b.ok) {
    const why = b.reason || 'refused'
    refuse(AGENT_WORDS[why] ? `Can't call now: ${AGENT_WORDS[why]}` : 'Can\'t call now.', 409, why, { next_at: b.next_at ?? null })
  }
  const id = b.call_id!
  const res = await twilio('POST', '/Calls.json', {
    To: b.agent_phone!, From: b.from!, Url: bridgeUrl(env, 'ds_bridge', id), Method: 'POST', Timeout: '25',
    StatusCallback: bridgeUrl(env, 'ds_agent_leg', id), StatusCallbackMethod: 'POST',
    StatusCallbackEvent: ['answered', 'completed'],
  }).catch(e => ({ status: 599, data: { message: (e as Error).message } }))
  if (res.status >= 400 || !res.data?.sid) {
    await store.saveAgentCall(id, { status: 'ended', end_reason: 'ring_failed', ended_at: new Date().toISOString() })
    refuse('Your phone couldn\'t be rung. Try again.', 502, 'twilio')
  }
  await store.saveAgentCall(id, { agent_call_sid: res.data.sid })
  return { ok: true, call_id: id, name: b.name ?? null }
}
