// P892 — the AI caller's logic, with the database, the provider and push injected (index.ts wires the real ones;
// core.test.ts runs it with in-memory fakes). No Deno APIs here, so node --test loads it.
//
// Actions (index.ts checks who may call each):
//   start            {call_id}          the new-lead trigger / the sweep (cron secret): dial within 10 s, or hand to a VA
//   event            provider webhook   answered, ended, and the AI's tool calls (check agent, times, book, hand off, stop)
//   bridge           {call_id, line_id} a VA took the hand-off: transfer the lead into that VA's line (cron secret)
//   handoff_timeout  {call_id}          nobody took it in 60 s: tell the lead someone will call back, end (cron secret)
//   twiml            ?line=…            the bridge number's answer: join the VA's line (Twilio)
import { aiStep, AI_RULES, HANDOFF_REASONS, WAIT_QUESTIONS, WAIT_RULE, transferSay } from './rules.js'
import type { Ev, Provider } from './providers.ts'
import { whisperWords } from '../help-transfer/core.ts'

export type Phase = 'queued' | 'dialing' | 'talking' | 'checking' | 'transferring' | 'booking' | 'handing_off' | 'done' | 'to_va'
export type Call = {
  id: string; lead_id: string; agent_id: string | null; attempt: number; status: Phase
  provider_call_id: string | null; control_url?: string | null; check_id: string | null; routed: string | null; summary: string | null
  booked_for: string | null
}
export type Lead = { id: string; first: string; phone: string; state: string | null; tz: string | null; need: string | null; age: string | null }
export type Agent = { id: string; first: string; phone: string | null; mode: 'appts' | 'both'; hours: Record<string, unknown>; tz: string; reachable: boolean }
export type CheckRow = { id: string; status: string; answer: 'yes' | 'no' | null; expires_at: string | null
  summary?: { name?: string | null; age?: string | null; state?: string | null; need?: string | null } }

export interface Store {
  live(): Promise<{ on: boolean; maxSecs: number }>
  call(id: string): Promise<Call | null>
  callByProvider(providerCallId: string): Promise<Call | null>
  lead(id: string): Promise<Lead | null>
  agent(id: string): Promise<Agent | null>
  takes(leadId: string): Promise<{ by: 'ai' | 'va'; reason: string | null }>
  toVa(callId: string, reason: string): Promise<void>
  status(callId: string, status: Phase, patch?: Record<string, unknown>): Promise<Call | null>
  result(callId: string, outcome: string, patch?: Record<string, unknown>): Promise<unknown>
  handoff(callId: string, reason: string, summary: string): Promise<string | null>
  slots(callId: string): Promise<string[]>
  book(callId: string, at: string): Promise<{ ok: boolean; code?: string }>
  insertCheck(row: { agent_id: string; lead_id: string; ai_call_id: string; summary: Record<string, unknown> }): Promise<CheckRow | null>
  check(id: string): Promise<CheckRow | null>
  sendCheck(check: CheckRow, agentId: string): Promise<boolean>
  // P903: the check row follows the AI's call (ringing → connected + delivered, or bounced / no_answer), and a
  // check that ran out is replaced on the agent's phones ("Missed. We're booking them on your calendar").
  markCheck(id: string, patch: Record<string, unknown>, whenStatus?: string[]): Promise<void>
  clearCheck(check: CheckRow, agentId: string, why: 'booking' | 'gone'): Promise<void>
  lineConference(lineId: string): Promise<string | null>
}
export type Env = { now(): number; from: string | null; bridgeNumber: string | null; words: Record<string, string> }

const refuse = (code: string, status = 400) => Object.assign(new Error(code), { status, code })

// The machine's phase for a stored call.
const phaseOf = (c: Call) => (c.status === 'queued' ? 'dialing' : c.status)
const step = (c: Call, ev: Record<string, unknown>, ctx: Record<string, unknown> = {}) =>
  aiStep({ phase: phaseOf(c), attempt: c.attempt, outcome: null, reason: null, routed: c.routed }, ev, ctx)

// ── start ───────────────────────────────────────────────────────────────────────────────────────────────────────
export async function start(store: Store, provider: Provider, env: Env, callId: string) {
  const c = await store.call(callId)
  if (!c || c.status !== 'queued') return { ok: false, code: 'gone' }
  const live = await store.live()
  if (!live.on) { await store.toVa(c.id, 'switch_off'); return { ok: false, code: 'switch_off' } }
  if (!provider.ready || !env.from) { await store.toVa(c.id, 'not_connected'); return { ok: false, code: 'not_connected' } }
  // The rules again at the moment of the dial (an opt-out or the window may have changed since the lead came in).
  const w = await store.takes(c.lead_id)
  if (w.by !== 'ai') { await store.toVa(c.id, w.reason || 'rules'); return { ok: false, code: w.reason } }
  const lead = await store.lead(c.lead_id)
  const agent = c.agent_id ? await store.agent(c.agent_id) : null
  if (!lead || !agent) { await store.toVa(c.id, 'no_lead_or_agent'); return { ok: false, code: 'no_lead_or_agent' } }
  try {
    const r = await provider.start({
      callId: c.id, to: lead.phone, from: env.from, maxSecs: Math.min(live.maxSecs || AI_RULES.maxCallSecs, 900),
      vars: { first_name: lead.first, agent_first_name: agent.first, state: lead.state ?? '', lead_tz: lead.tz ?? '', opening: env.words.opening.replace('{first}', lead.first) },
    })
    await store.status(c.id, 'dialing', { provider_call_id: r.providerCallId })
    return { ok: true, provider_call_id: r.providerCallId }
  } catch (e) {
    await store.toVa(c.id, `start_failed: ${String((e as Error).message).slice(0, 80)}`)
    return { ok: false, code: 'start_failed' }
  }
}

// ── provider events ─────────────────────────────────────────────────────────────────────────────────────────────
const END_TO_EVENT: Record<string, string> = { no_answer: 'no_answer', voicemail: 'voicemail', busy: 'busy', failed: 'error' }

export async function onEvent(store: Store, provider: Provider, env: Env, ev: Ev) {
  const c = (ev.callId && (await store.call(ev.callId))) || (await store.callByProvider(ev.providerCallId))
  if (!c) return { ok: false, code: 'unknown_call' }
  if (c.status === 'done' || c.status === 'to_va') return ev.type === 'tool' ? provider.toolReply(ev.toolCallId, { end: true }) : { ok: true, already: true }

  if (ev.type === 'answered') {
    await store.status(c.id, 'talking', { control_url: ev.controlUrl ?? null })
    return { ok: true }
  }
  if (ev.type === 'ended') {
    const patch = { duration_secs: ev.durationSecs ?? 0, cost_cents: ev.costCents, summary: ev.summary, transcript_ref: ev.transcriptRef }
    const ph = phaseOf(c)
    if (ph === 'dialing') {
      const r = step(c, { type: END_TO_EVENT[ev.reason] ?? 'no_answer' })
      await store.result(c.id, r.s.outcome ?? 'no_answer', patch) // the SQL schedules try 2, or hands to the no-answer path
      return { ok: true, outcome: r.s.outcome }
    }
    if (ph === 'handing_off') { await store.result(c.id, 'handed_to_va', { ...patch, callback_task: ev.reason !== 'transferred' }); return { ok: true } }
    if (ph === 'transferring' && ev.reason === 'transferred') {
      if (c.check_id) await store.markCheck(c.check_id, { status: 'connected', connected_at: new Date(env.now()).toISOString(), delivered: true }, ['ringing'])
      await store.result(c.id, 'transferred', patch)
      return { ok: true }
    }
    if (c.booked_for) { await store.result(c.id, 'booked', patch); return { ok: true } }
    await store.result(c.id, 'reached', patch)
    return { ok: true }
  }
  // Tool calls: the AI asks us what to do next.
  return provider.toolReply(ev.toolCallId, await tool(store, provider, env, c, ev.name, ev.args))
}

// Beat 3: no dead air while the agent decides. A provider that can talk while a tool call is pending keeps the caller
// company with light, useful questions (never coverage or price); one that can't plays a short hold line instead.
const checkSay = (p: Provider) => (p.talksWhileWaiting ? transferSay('check') : `${transferSay('check')} ${transferSay('holdOnly')}`)
function waiting(p: Provider, first: boolean) {
  if (!p.talksWhileWaiting) return { hold: true }
  return first ? { keep_talking: true, ask: WAIT_QUESTIONS, rule: WAIT_RULE } : { keep_talking: true }
}

async function slotsReply(store: Store, env: Env, c: Call, say?: string) {
  const slots = await store.slots(c.id)
  if (!slots.length) {
    // No time open in the next 3 days: a VA books it with the agent.
    await store.handoff(c.id, 'ai_failed', 'No open time in the agent’s calendar in the next 3 days.')
    return { say: [say, env.words.toPerson].filter(Boolean).join(' '), hold: true }
  }
  return { say, slots, next: 'book' }
}

export async function tool(store: Store, provider: Provider, env: Env, c: Call, name: string, args: Record<string, unknown>) {
  const agent = c.agent_id ? await store.agent(c.agent_id) : null
  const nowMs = env.now()
  switch (name) {
    case 'stop': { // "Stop calling" / "don't call me": honoured at once, everywhere.
      await store.result(c.id, 'opt_out')
      return { end: true }
    }
    case 'handoff': {
      const reason = String(args.reason ?? '')
      const why = (reason in HANDOFF_REASONS ? reason : 'ai_failed') as keyof typeof HANDOFF_REASONS
      const q = await store.handoff(c.id, why, String(args.summary ?? '').slice(0, 1200))
      return q ? { say: env.words.toPerson, hold: true } : { say: env.words.noPerson, end: true }
    }
    case 'qualified': {
      if (!agent) return slotsReply(store, env, c)
      const r = step(c, { type: 'qualified' }, { agent, nowMs })
      if (!r.act.includes('check_agent')) {
        await store.status(c.id, 'booking', { routed: r.s.routed, summary: args.summary ?? null })
        return slotsReply(store, env, c)
      }
      const lead = await store.lead(c.lead_id)
      const chk = await store.insertCheck({ agent_id: agent.id, lead_id: c.lead_id, ai_call_id: c.id,
        summary: { name: lead?.first ?? null, age: lead?.age ?? null, state: lead?.state ?? null, need: lead?.need ?? null, your_client: false } })
      if (!chk || !(await store.sendCheck(chk, agent.id))) {
        await store.status(c.id, 'booking', { routed: r.s.routed, summary: args.summary ?? null })
        return slotsReply(store, env, c) // agent being checked by a VA, or the push failed: book
      }
      await store.status(c.id, 'checking', { routed: r.s.routed, check_id: chk.id, summary: args.summary ?? null })
      return { say: checkSay(provider), next: 'check_status', wait_secs: 3, ...waiting(provider, true) }
    }
    case 'check_status': {
      if (c.status !== 'checking') return c.status === 'booking' ? slotsReply(store, env, c) : { ok: false, code: 'not_checking' }
      const chk = c.check_id ? await store.check(c.check_id) : null
      const expired = !!chk?.expires_at && Date.parse(chk.expires_at) <= nowMs
      const answer = chk?.answer === 'yes' ? 'yes' : chk?.answer === 'no' || chk?.status === 'failed' || expired ? (chk?.answer ?? 'none') : null
      if (!answer) return { next: 'check_status', wait_secs: 3, ...waiting(provider, false) }
      const r = step(c, { type: 'check_answer', answer })
      if (r.act.includes('transfer_agent') && agent?.phone) {
        // Beat 4: "connecting you with {Agent}", the agent's phone rings, they hear the whisper alone, the caller is
        // connected and the AI leaves (cold). Not answered in about 20 s → transfer_failed below.
        const say = transferSay('connecting', agent.first)
        const whisper = whisperWords({ ...(chk?.summary ?? {}) }, false, 'ai')
        const bounceSay = transferSay('bounce', agent.first)
        await store.status(c.id, 'transferring')
        if (chk) await store.markCheck(chk.id, { status: 'ringing', ring_started_at: new Date(nowMs).toISOString() }, ['yes', 'seen', 'sent'])
        await provider.transfer(c.provider_call_id ?? '', agent.phone, c.control_url, { say, whisper, ringSecs: AI_RULES.ringSecs, bounceSay })
        return { say, transfer_to: agent.phone, cold: true, whisper, ring_secs: AI_RULES.ringSecs, if_not_answered: 'transfer_failed' }
      }
      // Beat 5: No, no answer to the push in 30 s, or a failed push → back to the AI, who books.
      if (chk && answer === 'none') {
        await store.markCheck(chk.id, { status: 'no_answer' }, ['sent', 'seen'])
        await store.clearCheck(chk, agent?.id ?? '', 'booking')
      }
      await store.status(c.id, 'booking')
      return slotsReply(store, env, c, transferSay('bounce', agent?.first))
    }
    case 'transfer_failed': { // the agent's phone wasn't answered in about 20 s: the caller is back with the AI, who books
      if (c.status !== 'transferring') return c.status === 'booking' ? slotsReply(store, env, c) : { ok: false, code: 'not_transferring' }
      const r = step(c, { type: 'transfer_bounced' })
      await store.status(c.id, r.s.phase as Phase)
      if (c.check_id) {
        await store.markCheck(c.check_id, { status: 'bounced', bounced_at: new Date(nowMs).toISOString(), ended_reason: 'ai_not_answered' }, ['ringing'])
        const chk = await store.check(c.check_id)
        if (chk) await store.clearCheck(chk, agent?.id ?? '', 'booking')
      }
      return slotsReply(store, env, c, transferSay('bounce', agent?.first))
    }
    case 'slots': return slotsReply(store, env, c)
    case 'book': {
      const at = String(args.at ?? '')
      if (!Number.isFinite(Date.parse(at))) return { ok: false, code: 'bad_time' }
      const r = await store.book(c.id, at)
      if (!r.ok) return { ok: false, ...(await slotsReply(store, env, c)) }
      return { ok: true, booked_for: at, end_after: true }
    }
    default:
      return { ok: false, code: 'unknown_tool' }
  }
}

// ── bridge / timeout / twiml ────────────────────────────────────────────────────────────────────────────────────
export async function bridge(store: Store, provider: Provider, env: Env, callId: string, lineId: string) {
  const c = await store.call(callId)
  if (!c || c.status !== 'handing_off') return { ok: false, code: 'gone' }
  if (!env.bridgeNumber) { await store.result(c.id, 'handed_to_va', { callback_task: true }); return { ok: false, code: 'no_bridge' } }
  await provider.transfer(c.provider_call_id ?? '', `${env.bridgeNumber}`, c.control_url) // the bridge number answers with twiml(line)
  await store.status(c.id, 'handing_off', { line_id: lineId })
  return { ok: true }
}

export async function handoffTimeout(store: Store, provider: Provider, env: Env, callId: string) {
  const c = await store.call(callId)
  if (!c || c.status !== 'handing_off') return { ok: false, code: 'gone' }
  try { await provider.say(c.provider_call_id ?? '', env.words.noPerson, true, c.control_url) } catch { /* the call may already be over */ }
  await store.result(c.id, 'handed_to_va', { callback_task: true })
  return { ok: true }
}

const xml = (s: string) => s.replace(/[<>&"']/g, ch => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[ch]!))
export async function twiml(store: Store, lineId: string) {
  const conf = /^[0-9a-f-]{36}$/i.test(lineId) ? await store.lineConference(lineId) : null
  if (!conf) return '<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>'
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Dial><Conference startConferenceOnEnter="true" endConferenceOnExit="false" beep="false">${xml(conf)}</Conference></Dial></Response>`
}

// ── one entry point ─────────────────────────────────────────────────────────────────────────────────────────────
export async function handle(action: string, body: any, d: { store: Store; provider: Provider; env: Env }) {
  const id = String(body?.call_id ?? '')
  const uuid = /^[0-9a-f-]{36}$/i
  switch (action) {
    case 'start': if (!uuid.test(id)) throw refuse('call_id'); return start(d.store, d.provider, d.env, id)
    case 'bridge': if (!uuid.test(id)) throw refuse('call_id'); return bridge(d.store, d.provider, d.env, id, String(body?.line_id ?? ''))
    case 'handoff_timeout': if (!uuid.test(id)) throw refuse('call_id'); return handoffTimeout(d.store, d.provider, d.env, id)
    case 'event': {
      const ev = d.provider.parse(body)
      if (!ev) return { ok: true, ignored: true }
      return onEvent(d.store, d.provider, d.env, ev)
    }
    default: throw refuse('unknown action')
  }
}
