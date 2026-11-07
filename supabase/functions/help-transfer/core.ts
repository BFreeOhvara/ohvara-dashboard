// help-transfer — P880, the live transfer for real (How Ohvara Works → Live transfer, decided Nov 7). Logic only;
// index.ts wires Deno (secrets, the service-role store, Twilio, the push senders). It replaces the old
// conference "dial the on-duty agent in" transfer and the portal's TransferAlert polling.
//
//   1. The VA has the lead on the line and clicks Check agent          action check    (VA)
//   2. A time-sensitive push with Yes / No goes to every phone the agent has
//   3. The VA's screen follows Sent → Seen → Yes / No / No answer, timer kept on the row (expires_at, 30 s)
//      A send that reached no phone is "Couldn't reach agent" at once.
//   4. Yes → the VA clicks Transfer now: the lead hears hold music,    action transfer (VA)
//      the agent's phone rings with a whisper (name, age, state, need) and "press 1 to take it".
//      Pressed 1: the lead is unheld with the agent and the VA's leg is dropped (cold, not three-way).
//      Not pressed within about 20 s: the lead is unheld with the VA (bounce-back), who books.
//      (transfer-voice runs the Twilio side: hold, whisper, accept, agent_status, seen.)
//   5. No, or no answer → the VA books on the agent's calendar           action book     (VA)
//      A late Yes: "Already booked for [time]", or, still on the line unbooked, the VA gets "Transfer now".
//   6. Delivered = the agent pressed 1 (Q26: never billed per call).
//
//   The agent: answer (Yes / No, first answer wins, other phones cleared), withdraw (take back a Yes before it
//   connects), seen, reach (am I reachable), test_push (Setup: test Check agent → Yes, then a test call).
//   The VA: cancel (their leg dropped after Check agent: check cancelled, push replaced, callback task), status.
//
// Who: a VA (fulfillment) on their own call, or an admin; the agent for their own checks. Calls need
// recovery_config.voice_live on; with it off the whole flow runs against mocks only (core.test.ts).

import { helpConferenceName, type HelpCall, type HelpStatus, type Store as VoiceStore } from '../help-voice/core.ts'
import type { Twilio } from '../_shared/twilio.ts'
import { xmlEsc } from '../_shared/twilio.ts'
import type { Device, Senders } from '../notify-push/core.ts'
import { CHECK_SECS, checkPush, clearPush, sendAll, type Summary, CLEAR_WORDS } from '../notify-push/transfer.ts'
export type { Twilio } from '../_shared/twilio.ts'

export type CheckStatus = 'sent' | 'seen' | 'yes' | 'no' | 'late_yes' | 'no_answer' | 'failed' | 'withdrawn'
  | 'cancelled' | 'ringing' | 'connected' | 'bounced' | 'booked'

export type Check = {
  id: string; call_sid: string | null; va_id: string | null; agent_id: string; lead_id: string | null
  summary: Summary; status: CheckStatus; is_test: boolean; seen_token: string; devices: number
  fail_reason: string | null; created_at: string; sent_at: string | null; expires_at: string | null
  seen_at: string | null; answered_at: string | null; answer: 'yes' | 'no' | null; answered_device: string | null
  response_secs: number | null; ring_started_at: string | null; agent_call_sid: string | null
  connected_at: string | null; delivered: boolean; bounced_at: string | null; ended_reason: string | null
  booked_for: string | null
}

export type Reach = { ready: boolean; reason: string | null }
export type Readiness = { push_ok_at?: string | null; call_ok_at?: string | null; last_test_at?: string; fail_reason?: string | null; booking_only?: boolean }

export interface Store extends Pick<VoiceStore, 'voiceLive' | 'helpCall' | 'updateHelpCall'> {
  userFromJwt(jwt: string): Promise<string | null>
  caller(userId: string): Promise<{ role: string | null; is_active: boolean | null; phone?: string | null } | null>
  // The lead's agent (leads.assigned_rep_id) and what the push says. your_client: the lead's phone matches one
  // of that agent's policies. null when the lead doesn't exist.
  lead(leadId: string): Promise<{ agent_id: string | null; summary: Summary } | null>
  reach(agentId: string): Promise<Reach>
  // P881: licence_allows(agent, state) — the agent's verified life licence covers the lead's state.
  licensed(agentId: string, state: string | null): Promise<boolean>
  devices(agentId: string): Promise<Device[]>
  dropDevices(tokens: string[]): Promise<void>
  // null when the agent already has an open check (the one-open-check index).
  insertCheck(row: Partial<Check> & { agent_id: string }): Promise<Check | null>
  check(id: string): Promise<Check | null>
  updateCheck(id: string, patch: Partial<Check>, whenStatus?: CheckStatus[]): Promise<Check | null>
  setReadiness(agentId: string, patch: Readiness): Promise<void>
  readiness(agentId: string): Promise<Readiness | null>
  // The lead goes back to the VA queue as a callback in 5 minutes (va_outcome callback).
  scheduleCallback(leadId: string): Promise<void>
  setLeadTransferStatus(leadId: string, status: 'connected' | 'dropped'): Promise<void>
}

// from: HELP_TRACKING_NUMBER (the agent leg's caller ID). voiceUrl: transfer-voice (Twilio webhooks).
export type Env = {
  from: string | null; voiceUrl: string; configured: boolean; senders: Senders
  now?: () => number
  // Runs work after the response (Supabase EdgeRuntime.waitUntil); tests await it directly.
  waitUntil?: (p: Promise<unknown>) => void
  sleep?: (ms: number) => Promise<void>
}

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

export const VA_ACTIONS = ['check', 'transfer', 'cancel', 'book', 'status'] as const
export const AGENT_ACTIONS = ['answer', 'withdraw', 'seen', 'reach', 'test_push', 'status'] as const

const SID = /^CA[0-9a-zA-Z]{1,64}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const NOT_YOURS = 'Only the VA on this call can do that.'
export const RING_SECS = 20          // the agent's phone rings about 20 s, then the lead bounces back
export const YES_VALID_SECS = 120    // a Yes older than this is stale: check again
const OPEN_CHECK: CheckStatus[] = ['sent', 'seen']
const PENDING: CheckStatus[] = ['sent', 'seen', 'yes', 'late_yes']

export const TEST_SUMMARY: Summary = { name: 'Pat Sample', age: 67, state: 'TX', need: 'Final expense', your_client: false }

export function toE164(raw: unknown): string | null {
  const d = String(raw ?? '').replace(/\D/g, '')
  if (d.length === 10) return `+1${d}`
  if (d.length === 11 && d.startsWith('1')) return `+${d}`
  return null
}

const clock = (env: Env) => (env.now ? env.now() : Date.now())
const iso = (env: Env, plusMs = 0) => new Date(clock(env) + plusMs).toISOString()

// The status a reader should see: a sent/seen check past its 30 s is no answer even before the sweep runs.
export function effective(c: Check, nowMs: number): CheckStatus {
  if (OPEN_CHECK.includes(c.status) && c.expires_at && Date.parse(c.expires_at) <= nowMs) return 'no_answer'
  return c.status
}

const view = (c: Check, env: Env) => {
  const { seen_token: _t, ...rest } = c
  return { ...rest, status: effective(c, clock(env)), server_now: iso(env) }
}

async function twilioOk(twilio: Twilio, method: 'GET' | 'POST', path: string, params?: Record<string, string | string[]>) {
  const res = await twilio(method, path, params)
  if (res.status >= 400) refuse(res.data?.message || `Twilio refused it (${res.status})`, 502, 'twilio')
  return res.data
}

async function conferenceOf(twilio: Twilio, row: HelpCall): Promise<string | null> {
  if (row.conference_sid) return row.conference_sid
  const q = new URLSearchParams({ FriendlyName: helpConferenceName(row.call_sid), Status: 'in-progress' })
  const res = await twilio('GET', `/Conferences.json?${q}`).catch(() => null)
  return (res && res.status < 400 && res.data?.conferences?.[0]?.sid) || null
}

// The lead's leg in the help conference: on hold (music) while the agent rings, unheld when it connects
// or bounces. Never fatal: a failure is logged.
async function holdCaller(twilio: Twilio, row: HelpCall, on: boolean, env: Env) {
  const conf = await conferenceOf(twilio, row)
  if (!conf) return false
  const res = await twilio('POST', `/Conferences/${conf}/Participants/${row.call_sid}.json`,
    on ? { Hold: 'true', HoldUrl: `${env.voiceUrl}?event=hold`, HoldMethod: 'POST' } : { Hold: 'false' })
    .catch(e => ({ status: 599, data: { message: (e as Error).message } }))
  if (res.status >= 400) { console.error('hold caller failed:', on, res.status, res.data?.message); return false }
  return true
}

async function hangUp(twilio: Twilio, sid: string | null) {
  if (!sid || !SID.test(sid)) return
  const res = await twilio('POST', `/Calls/${sid}.json`, { Status: 'completed' }).catch(() => null)
  if (!res || res.status >= 400) console.error('hang up failed:', sid, res?.status, res?.data?.message)
}

async function clearOthers(store: Store, env: Env, c: Check, why: keyof typeof CLEAR_WORDS, skip: string[] = []) {
  try {
    const devices = await store.devices(c.agent_id)
    const out = await sendAll(env.senders, devices, clearPush(c, why), skip)
    if (out.dead.length) await store.dropDevices(out.dead)
  } catch (e) { console.error('clear push failed:', c.id, (e as Error).message) }
}

// The agent's phone leg, for a real transfer or the Setup test call.
export function agentCallParams(env: Env, to: string, checkId: string): Record<string, string | string[]> {
  const q = (event: string) => `${env.voiceUrl}?${new URLSearchParams({ event, check: checkId })}`
  return {
    To: to, From: env.from!, Url: q('whisper'), Method: 'POST', Timeout: String(RING_SECS),
    StatusCallback: q('agent_status'), StatusCallbackMethod: 'POST', StatusCallbackEvent: ['answered', 'completed'],
  }
}

// Kept for help-voice's tests (the old conference leg); nothing in P880 dials this way any more.
export function agentLegParams(env: { from: string | null; voiceUrl: string }, to: string, callSid: string): Record<string, string | string[]> {
  const phone = !to.startsWith('client:')
  const cb = new URLSearchParams({ event: 'agent_leg', call: callSid, ...(phone ? { amd: '1' } : null) })
  return {
    From: env.from!, To: to, Label: 'agent', Beep: 'false', EndConferenceOnExit: 'false', Timeout: '25',
    ...(phone ? { MachineDetection: 'Enable', MachineDetectionTimeout: '10' } : null),
    StatusCallback: `${env.voiceUrl}?${cb}`, StatusCallbackMethod: 'POST',
    StatusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
  }
}

// ── Sending a check (the VA's Check agent and the agent's Setup test) ────────

async function sendCheck(store: Store, env: Env, c: Check) {
  const devices = await store.devices(c.agent_id)
  const seenUrl = `${env.voiceUrl}?${new URLSearchParams({ event: 'seen', check: c.id, t: c.seen_token })}`
  const out = devices.length ? await sendAll(env.senders, devices, checkPush(c, seenUrl)) : { reached: 0, dead: [], errors: ['no_device'] }
  if (out.dead.length) await store.dropDevices(out.dead)
  if (!out.reached) {
    const reason = !devices.length || out.dead.length === devices.length ? 'no_device' : out.errors.join('; ').slice(0, 300) || 'push_failed'
    return (await store.updateCheck(c.id, { status: 'failed', fail_reason: reason, devices: 0 }, ['sent'])) ?? c
  }
  return (await store.updateCheck(c.id, {
    status: 'sent', sent_at: iso(env), expires_at: iso(env, CHECK_SECS * 1000), devices: out.reached,
  }, ['sent'])) ?? c
}

async function check(store: Store, env: Env, userId: string, admin: boolean, body: any) {
  const callSid = String(body?.call_sid ?? '')
  if (!SID.test(callSid)) refuse('call_sid required', 400)
  const row = await store.helpCall(callSid)
  if (!row) refuse('Call not found', 404)
  if (!admin && row!.va_id !== userId) refuse(NOT_YOURS, 403)
  if (!(await store.voiceLive())) refuse('Calling in the portal isn\'t on yet.', 409, 'voice_off')
  if (row!.status !== 'live') refuse('The lead isn\'t on the line with you.', 409, 'not_live')

  const leadId = UUID.test(String(body?.lead_id ?? '')) ? String(body.lead_id) : row!.lead_id
  if (!leadId) refuse('Open the lead first.', 409, 'no_lead')
  const lead = await store.lead(leadId!)
  if (!lead) refuse('Lead not found', 404)
  if (!lead!.agent_id) return { ok: false, code: 'no_agent', message: 'This lead has no agent yet. Book it for admin.' }
  // P881 (N-C-22): never transfer into a state the agent isn't licensed in (or a state not yet confirmed).
  if (!(await store.licensed(lead!.agent_id, lead!.summary.state ?? null))) {
    return lead!.summary.state
      ? { ok: false, code: 'not_licensed', message: `The agent isn't licensed in ${lead!.summary.state}. Don't transfer or book; the team finds a licensed agent.` }
      : { ok: false, code: 'state_unknown', message: "Confirm the lead's state before checking the agent." }
  }

  const reach = await store.reach(lead!.agent_id)
  if (!reach.ready) return { ok: false, code: 'not_reachable', reason: reach.reason, message: 'Not reachable for live calls. Book them on the agent\'s calendar.' }

  if (!row!.lead_id) await store.updateHelpCall(callSid, { lead_id: leadId } as Partial<HelpCall>)
  const c = await store.insertCheck({ call_sid: callSid, va_id: row!.va_id, agent_id: lead!.agent_id, lead_id: leadId, summary: lead!.summary, status: 'sent' })
  if (!c) return { ok: false, code: 'agent_busy', message: 'Agent being checked by another VA. Book them.' }
  const sent = await sendCheck(store, env, c)
  return { ok: sent.status !== 'failed', check: view(sent, env), ...(sent.status === 'failed' ? { code: 'push_failed', message: 'Couldn\'t reach agent. Book them on the agent\'s calendar.' } : null) }
}

async function testPush(store: Store, env: Env, agentId: string) {
  await store.setReadiness(agentId, { last_test_at: iso(env) })
  const c = await store.insertCheck({ agent_id: agentId, summary: TEST_SUMMARY, status: 'sent', is_test: true })
  if (!c) refuse('A test is already running.', 409, 'busy')
  const sent = await sendCheck(store, env, c!)
  if (sent.status === 'failed') await store.setReadiness(agentId, { fail_reason: sent.fail_reason === 'no_device' ? 'no_device' : 'push_failed', booking_only: true })
  return { ok: sent.status !== 'failed', check: view(sent, env), ...(sent.status === 'failed' ? { code: sent.fail_reason === 'no_device' ? 'no_device' : 'push_failed' } : null) }
}

// ── The agent's answer ───────────────────────────────────────────────────────

async function answer(store: Store, twilio: Twilio, env: Env, agentId: string, body: any) {
  const c = await mine(store, agentId, body)
  const ans = body?.answer === 'yes' ? 'yes' : body?.answer === 'no' ? 'no' : refuse('answer must be yes or no', 400)
  const device = typeof body?.device === 'string' ? body.device.slice(0, 4096) : null
  const nowMs = clock(env)

  if (effective(c, nowMs) === 'sent' || effective(c, nowMs) === 'seen') {
    const won = await store.updateCheck(c.id, {
      status: ans, answer: ans, answered_at: iso(env), answered_device: device,
      response_secs: c.sent_at ? Math.round((nowMs - Date.parse(c.sent_at)) / 100) / 10 : null,
      seen_at: c.seen_at ?? iso(env),
    }, OPEN_CHECK)
    if (won) {
      env.waitUntil ? env.waitUntil(clearOthers(store, env, won, 'answered_elsewhere', device ? [device] : []))
        : await clearOthers(store, env, won, 'answered_elsewhere', device ? [device] : [])
      if (won.is_test) return testAnswered(store, twilio, env, won)
      return { ok: true, check: view(won, env) }
    }
  }
  // Someone (another phone, the timer, the VA) got there first.
  const now = (await store.check(c.id)) ?? c
  const st = effective(now, nowMs)
  if (now.answer === ans && ['yes', 'no', 'ringing', 'connected', 'late_yes'].includes(st)) return { ok: true, already: true, check: view(now, env) }
  if (ans === 'no') return { ok: true, late: true, check: view(now, env) }
  if (st === 'booked') return { ok: false, code: 'already_booked', booked_for: now.booked_for, check: view(now, env) }
  if (!now.is_test && (st === 'no_answer' || st === 'no') && now.call_sid) {
    const call = await store.helpCall(now.call_sid)
    if (call?.status === 'live') {
      const late = await store.updateCheck(now.id, { status: 'late_yes', answer: 'yes', answered_at: iso(env), answered_device: device },
        ['sent', 'seen', 'no_answer', 'no'])
      if (late) return { ok: true, late: true, check: view(late, env) }
    }
  }
  return { ok: false, code: 'gone', check: view(now, env) }
}

async function testAnswered(store: Store, twilio: Twilio, env: Env, c: Check) {
  if (c.status !== 'yes') {
    await store.setReadiness(c.agent_id, { fail_reason: 'answered_no' })
    return { ok: true, test: true, check: view(c, env), call: 'none' }
  }
  await store.setReadiness(c.agent_id, { push_ok_at: iso(env), fail_reason: null })
  // Step two: a real call to the agent's phone that must be answered (press 1) before live calls turn on.
  const voice = await store.voiceLive()
  const me = await store.caller(c.agent_id)
  const to = toE164(me?.phone)
  if (!voice || !env.configured || !env.from) {
    await store.setReadiness(c.agent_id, { fail_reason: 'voice_off' })
    return { ok: true, test: true, check: view(c, env), call: 'voice_off' }
  }
  if (!to) {
    await store.setReadiness(c.agent_id, { fail_reason: 'no_phone' })
    return { ok: true, test: true, check: view(c, env), call: 'no_phone' }
  }
  const res = await twilio('POST', '/Calls.json', agentCallParams(env, to, c.id)).catch(e => ({ status: 599, data: { message: (e as Error).message } }))
  if (res.status >= 400 || !res.data?.sid) {
    await store.setReadiness(c.agent_id, { fail_reason: 'call_failed' })
    return { ok: true, test: true, check: view(c, env), call: 'failed' }
  }
  const ringing = await store.updateCheck(c.id, { status: 'ringing', ring_started_at: iso(env), agent_call_sid: res.data.sid }, ['yes'])
  return { ok: true, test: true, check: view(ringing ?? c, env), call: 'ringing' }
}

async function mine(store: Store, agentId: string, body: any) {
  const id = String(body?.check_id ?? '')
  if (!UUID.test(id)) refuse('check_id required', 400)
  const c = await store.check(id)
  if (!c || c.agent_id !== agentId) refuse('Check not found', 404)
  return c!
}

async function withdraw(store: Store, twilio: Twilio, env: Env, agentId: string, body: any) {
  const c = await mine(store, agentId, body)
  if (c.status === 'connected') refuse('You\'re already connected.', 409, 'connected')
  const w = await store.updateCheck(c.id, { status: 'withdrawn', ended_reason: 'agent_withdrew' }, ['yes', 'late_yes', 'ringing'])
  if (!w) refuse('Nothing to take back.', 409, 'not_pending')
  if (c.status === 'ringing' && c.call_sid) {
    const row = await store.helpCall(c.call_sid)
    if (row) {
      await holdCaller(twilio, row, false, env)
      await store.updateHelpCall(row.call_sid, { status: 'live', agent_call_sid: null }, ['transferring'])
    }
    await hangUp(twilio, c.agent_call_sid)
  }
  return { ok: true, check: view(w!, env) }
}

async function seen(store: Store, env: Env, agentId: string, body: any) {
  const c = await mine(store, agentId, body)
  const s = await store.updateCheck(c.id, { status: 'seen', seen_at: iso(env) }, ['sent'])
  return { ok: true, check: view(s ?? c, env) }
}

// ── The VA's side after the answer ───────────────────────────────────────────

async function vaCheck(store: Store, userId: string, admin: boolean, body: any) {
  const id = String(body?.check_id ?? '')
  if (!UUID.test(id)) refuse('check_id required', 400)
  const c = await store.check(id)
  if (!c || c.is_test) refuse('Check not found', 404)
  if (!admin && c!.va_id !== userId) refuse(NOT_YOURS, 403)
  return c!
}

async function transfer(store: Store, twilio: Twilio, env: Env, userId: string, admin: boolean, body: any) {
  const c = await vaCheck(store, userId, admin, body)
  if (c.status !== 'yes' && c.status !== 'late_yes') refuse('The agent hasn\'t said Yes.', 409, 'no_yes')
  if (c.answered_at && clock(env) - Date.parse(c.answered_at) > YES_VALID_SECS * 1000) refuse('That Yes is too old. Check the agent again.', 409, 'stale')
  if (!(await store.voiceLive())) refuse('Calling in the portal isn\'t on yet.', 409, 'voice_off')
  if (!env.configured || !env.from) refuse('Calling isn\'t set up yet.', 503, 'not_configured')
  const row = await store.helpCall(c.call_sid ?? '')
  if (!row || row.status !== 'live') refuse('The lead isn\'t on the line with you.', 409, 'not_live')

  const ringing = await store.updateCheck(c.id, { status: 'ringing', ring_started_at: iso(env) }, ['yes', 'late_yes'])
  if (!ringing) refuse('This changed. Look again.', 409, 'busy')
  const claimed = await store.updateHelpCall(row!.call_sid,
    { status: 'transferring', transfer_agent_id: c.agent_id, agent_call_sid: null, transfer_started_at: iso(env) }, ['live'])
  if (!claimed) {
    await store.updateCheck(c.id, { status: c.status }, ['ringing'])
    refuse('The lead isn\'t on the line with you.', 409, 'not_live')
  }

  const agent = await store.caller(c.agent_id)
  const to = toE164(agent?.phone)
  // Hold first, so the lead hears music (never dead air) from the moment the VA says "connecting you".
  await holdCaller(twilio, claimed!, true, env)
  if (!to) return { ok: false, code: 'no_phone', check: view(await bounce(store, twilio, env, ringing!, 'no_phone') ?? ringing!, env) }
  const res = await twilio('POST', '/Calls.json', agentCallParams(env, to, c.id))
    .catch(e => ({ status: 599, data: { message: (e as Error).message } }))
  if (res.status >= 400 || !res.data?.sid) {
    const b = await bounce(store, twilio, env, ringing!, 'ring_failed')
    return { ok: false, code: 'ring_failed', check: view(b ?? ringing!, env) }
  }
  const saved = await store.updateCheck(c.id, { agent_call_sid: res.data.sid }, ['ringing', 'connected', 'bounced'])
  await store.updateHelpCall(row!.call_sid, { agent_call_sid: res.data.sid }, ['transferring', 'transferred'])
  return { ok: true, check: view(saved ?? ringing!, env) }
}

// Back to the VA: the agent didn't press 1 in time (or couldn't be rung). The lead is unheld with the VA,
// who is still on the conference, so the bounce-back is instant.
export async function bounce(store: Store, twilio: Twilio, env: Env, c: Check, reason: string) {
  const b = await store.updateCheck(c.id, { status: 'bounced', bounced_at: iso(env), ended_reason: reason }, ['ringing'])
  if (!b) return null
  if (b.is_test) {
    await store.setReadiness(b.agent_id, { fail_reason: 'call_no_answer', booking_only: true })
    return b
  }
  const row = b.call_sid ? await store.helpCall(b.call_sid) : null
  if (row && row.status !== 'ended') {
    await holdCaller(twilio, row, false, env)
    await store.updateHelpCall(row.call_sid, { status: 'live', agent_call_sid: null }, ['transferring'])
  }
  return b
}

async function cancel(store: Store, twilio: Twilio, env: Env, userId: string, admin: boolean, body: any) {
  const c = await vaCheck(store, userId, admin, body)
  const why = String(body?.why ?? 'va_left').slice(0, 40)
  const was = c.status
  const x = await store.updateCheck(c.id, { status: 'cancelled', ended_reason: why }, [...PENDING, 'ringing'])
  if (!x) return { ok: true, check: view(c, env) }
  if (was === 'ringing') await hangUp(twilio, c.agent_call_sid)
  await clearOthers(store, env, x, why === 'lead_dropped' ? 'lead_dropped' : 'gone')
  if (x.lead_id) await store.scheduleCallback(x.lead_id)
  return { ok: true, check: view(x, env) }
}

// The VA booked the lead (No, no answer, failed, withdrawn or bounced). The lead itself is saved by the desk;
// this closes the call row and remembers when, so a late Yes reads "Already booked for [time]".
async function book(store: Store, env: Env, userId: string, admin: boolean, body: any) {
  const bookedFor = body?.booked_for && !Number.isNaN(Date.parse(body.booked_for)) ? new Date(body.booked_for).toISOString() : null
  let c: Check | null = null
  if (body?.check_id) {
    c = await vaCheck(store, userId, admin, body)
    const was = c.status
    const b = await store.updateCheck(c.id, { status: 'booked', booked_for: bookedFor },
      ['sent', 'seen', 'no', 'no_answer', 'failed', 'withdrawn', 'bounced', 'late_yes', 'yes'])
    if (!b) refuse('This call was already handed to the agent.', 409, 'not_bookable')
    if (OPEN_CHECK.includes(was) || was === 'yes' || was === 'late_yes') await clearOthers(store, env, b!, 'booked')
    c = b
  }
  const callSid = String(body?.call_sid ?? c?.call_sid ?? '')
  if (SID.test(callSid)) {
    const row = await store.helpCall(callSid)
    if (row && !admin && row.va_id !== userId) refuse(NOT_YOURS, 403)
    const open: HelpStatus[] = ['live', 'no_answer', 'ended']
    if (row && open.includes(row.status) && row.outcome !== 'transferred') {
      await store.updateHelpCall(callSid, { outcome: 'booked', status: 'ended', end_reason: 'booked', ended_at: row.ended_at ?? iso(env) }, open)
    }
  }
  return { ok: true, ...(c ? { check: view(c, env) } : null) }
}

// ── Router ───────────────────────────────────────────────────────────────────

export async function act(store: Store, twilio: Twilio, env: Env, userId: string, body: any) {
  const me = await store.caller(userId)
  if (!me?.is_active) refuse('Your account isn\'t active.', 403)
  const action = body?.action
  const admin = me!.role === 'admin'

  if (me!.role === 'agent') {
    if (!AGENT_ACTIONS.includes(action)) refuse('Unknown action', 400)
    if (action === 'answer') return answer(store, twilio, env, userId, body)
    if (action === 'withdraw') return withdraw(store, twilio, env, userId, body)
    if (action === 'seen') return seen(store, env, userId, body)
    if (action === 'reach') return { ok: true, reach: await store.reach(userId), readiness: await store.readiness(userId) }
    if (action === 'test_push') return testPush(store, env, userId)
    return { ok: true, check: view(await mine(store, userId, body), env) }
  }

  if (me!.role !== 'fulfillment' && !admin) refuse(NOT_YOURS, 403)
  if (!VA_ACTIONS.includes(action)) refuse('Unknown action', 400)
  if (action === 'check') return check(store, env, userId, admin, body)
  if (action === 'transfer') return transfer(store, twilio, env, userId, admin, body)
  if (action === 'cancel') return cancel(store, twilio, env, userId, admin, body)
  if (action === 'book') return book(store, env, userId, admin, body)
  return { ok: true, check: view(await vaCheck(store, userId, admin, body), env) }
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

// ── transfer-voice: the Twilio side (hold, whisper, accept, agent_status) and the Android "seen" ping ──────
// Every Twilio request carries a valid X-Twilio-Signature (checked in transfer-voice/index.ts before this
// runs). The seen ping comes from the agent's phone with the check's seen_token instead.

const twiml = (inner = '') =>
  new Response(`<?xml version="1.0" encoding="UTF-8"?><Response>${inner}</Response>`, { headers: { 'Content-Type': 'text/xml' } })

export const HOLD_MUSIC = 'https://com.twilio.music.classical.s3.amazonaws.com/BusyStrings.mp3'
const FINAL = ['completed', 'busy', 'no-answer', 'failed', 'canceled']

export function whisperWords(s: Summary, test: boolean) {
  if (test) return 'This is your Ohvara test transfer. Press 1 to pass the test.'
  const bits = [s.name || 'A lead', s.age ? `${s.age}` : null, s.state ? `from ${s.state}` : null, s.need ? `looking for ${s.need}` : null].filter(Boolean)
  return `Ohvara live transfer${s.your_client ? ', your client' : ''}. ${bits.join(', ')}. Press 1 to take the call.`
}

async function holdTwiml() {
  return twiml(`<Say>Please hold while I connect you with your licensed agent.</Say><Play loop="0">${xmlEsc(HOLD_MUSIC)}</Play>`)
}

async function whisper(store: Store, env: Env, c: Check | null) {
  if (!c || c.status !== 'ringing') return twiml('<Say>This call is no longer available.</Say><Hangup/>')
  const accept = `${env.voiceUrl}?${new URLSearchParams({ event: 'accept', check: c.id })}`
  const words = xmlEsc(whisperWords(c.summary || {}, c.is_test))
  return twiml(`<Gather numDigits="1" timeout="6" action="${xmlEsc(accept)}" method="POST"><Say>${words}</Say><Pause length="1"/><Say>${words}</Say></Gather>` +
    '<Say>Missed. Sending them back.</Say><Hangup/>')
}

// The agent pressed a key. 1 = take it: delivered. The agent joins the lead's conference, and once Twilio
// shows them on it, the lead is unheld and the VA's leg is dropped (cold transfer: the VA never talks with them).
async function acceptCall(store: Store, twilio: Twilio | null, env: Env, c: Check | null, form: Record<string, string>) {
  if (!c) return twiml('<Hangup/>')
  if ((form.Digits || '') !== '1') return twiml('<Say>Okay.</Say><Hangup/>')
  const leg = form.CallSid || ''
  if (c.is_test) {
    const done = await store.updateCheck(c.id, { status: 'connected', connected_at: iso(env) }, ['ringing'])
    if (!done) return twiml('<Hangup/>')
    const r = await store.readiness(c.agent_id)
    await store.setReadiness(c.agent_id, { call_ok_at: iso(env), fail_reason: null, booking_only: !r?.push_ok_at })
    return twiml('<Say>Test passed. Live calls can come to you now. Goodbye.</Say><Hangup/>')
  }
  const row = c.call_sid ? await store.helpCall(c.call_sid) : null
  if (!row || row.status === 'ended') {
    await store.updateCheck(c.id, { status: 'cancelled', ended_reason: 'lead_dropped' }, ['ringing'])
    return twiml('<Say>Sorry, the caller hung up. The V A will call them back.</Say><Hangup/>')
  }
  const won = await store.updateCheck(c.id, { status: 'connected', connected_at: iso(env), delivered: true, agent_call_sid: SID.test(leg) ? leg : c.agent_call_sid }, ['ringing'])
  if (!won) return twiml('<Say>This call is no longer available.</Say><Hangup/>')
  const moved = await store.updateHelpCall(row.call_sid,
    { status: 'transferred', transferred_at: iso(env), outcome: 'transferred', end_reason: null, agent_call_sid: SID.test(leg) ? leg : row.agent_call_sid }, ['transferring'])
  if (moved?.lead_id) {
    try { await store.setLeadTransferStatus(moved.lead_id, 'connected') } catch (e) { console.error('lead connected failed:', (e as Error).message) }
  }
  if (twilio) {
    const work = handOff(twilio, env, moved ?? row, leg)
    env.waitUntil ? env.waitUntil(work) : await work
  }
  const name = helpConferenceName(row.call_sid)
  return twiml(`<Dial><Conference beep="false" participantLabel="agent" startConferenceOnEnter="true" endConferenceOnExit="false">${xmlEsc(name)}</Conference></Dial>`)
}

// Wait (up to about 8 s) until the agent's leg is on the conference, then unhold the lead and drop the VA.
// The VA leaves only after the agent is on, so help-voice never sees the lead alone and ends the call.
export async function handOff(twilio: Twilio, env: Env, row: HelpCall, agentLeg: string) {
  const sleep = env.sleep ?? (ms => new Promise(r => setTimeout(r, ms)))
  const conf = await conferenceOf(twilio, row)
  let on = false
  for (let i = 0; conf && i < 12 && !on; i++) {
    const res = await twilio('GET', `/Conferences/${conf}/Participants.json`).catch(() => null)
    const list = res && res.status < 400 ? res.data?.participants : null
    on = Array.isArray(list) && list.some((p: any) => p?.call_sid === agentLeg && p?.status === 'connected')
    if (!on) await sleep(700)
  }
  await holdCaller(twilio, row, false, env)
  if (on) await hangUp(twilio, row.va_call_sid)
  else console.error('hand-off: agent never showed on the conference, the VA stays on', row.call_sid)
  return on
}

async function agentStatus(store: Store, twilio: Twilio | null, env: Env, c: Check | null, form: Record<string, string>) {
  if (!c || !FINAL.includes(form.CallStatus || '')) return twiml()
  if (c.status !== 'ringing') return twiml()
  if (twilio) await bounce(store, twilio, env, c, form.CallStatus === 'completed' ? 'not_accepted' : form.CallStatus!)
  else await store.updateCheck(c.id, { status: 'bounced', bounced_at: iso(env), ended_reason: form.CallStatus }, ['ringing'])
  return twiml()
}

// Twilio webhooks (signature already checked) and the phone's seen ping (token checked here).
export async function handleVoice(event: string, q: URLSearchParams, form: Record<string, string>, store: Store, twilio: Twilio | null, env: Env, signed: boolean) {
  if (event === 'hold') return signed ? holdTwiml() : new Response('Bad signature', { status: 403 })
  const id = q.get('check') || ''
  const c = UUID.test(id) ? await store.check(id) : null
  if (event === 'seen') {
    if (!c || !q.get('t') || q.get('t') !== c.seen_token) return new Response('no', { status: 404 })
    await store.updateCheck(c.id, { status: 'seen', seen_at: iso(env) }, ['sent'])
    return new Response(null, { status: 204 })
  }
  if (!signed) return new Response('Bad signature', { status: 403 })
  if (event === 'whisper') return whisper(store, env, c)
  if (event === 'accept') return acceptCall(store, twilio, env, c, form)
  if (event === 'agent_status') return agentStatus(store, twilio, env, c, form)
  return twiml()
}
