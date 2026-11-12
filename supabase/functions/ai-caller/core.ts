// P892 — the AI caller's logic, with the database, the provider and push injected (index.ts wires the real ones;
// core.test.ts runs it with in-memory fakes). No Deno APIs here, so node --test loads it.
//
// Actions (index.ts checks who may call each):
//   start            {call_id}          the new-lead trigger / the sweep (cron secret): dial within 10 s
//   event            provider webhook   answered, ended, and the AI's tool calls (check agent, times, book, outcome, stop)
// P902: no hand-off to a VA (the bridge, hand-off timeout and twiml actions are gone). Asks for a person, or about
// coverage or price → "Your agent will go over that with you" → Check agent → transfer, or book. A call that fails
// counts as no answer. Every call ends in one first-call outcome (../_shared/leadFlows.js), which decides the texts.
import { aiStep, AI_RULES, ASK_AGENT_REASONS, SAID_OUTCOMES, WAIT_QUESTIONS, WAIT_RULE, transferSay, AI_CALL_WORDS } from './rules.js'
import type { Ev, Provider } from './providers.ts'
import { whisperWords } from '../help-transfer/core.ts'
import { reactOpener, TEXT_ASK } from './reactivation.js'
import { CALLER_SPLIT, pickVoice, aiNameOf } from './retellSpec.js'

export type Phase = 'queued' | 'dialing' | 'talking' | 'checking' | 'transferring' | 'booking' | 'done' | 'to_va'
export type Call = {
  id: string; lead_id: string; agent_id: string | null; attempt: number; status: Phase
  provider_call_id: string | null; control_url?: string | null; check_id: string | null; routed: string | null; summary: string | null
  booked_for: string | null
}
export type Lead = { id: string; first: string; phone: string; state: string | null; tz: string | null; need: string | null; age: string | null
  homeowner?: boolean | null; mortgage?: string | null // P940: the form's answers
  // P952: a person on an agent's reactivation list (an aged lead): its own opener, voicemail only once.
  reactivation?: { voicemailLeft: boolean } | null
  // P926: an admin test call (a sample lead): the switch and the lead rules are skipped, the agent's check is answered
  // for them (check), and transfer_to stands in for the agent's phone. Never set on a real lead.
  test?: { check?: 'yes' | 'no' | 'none'; transferTo?: string | null; voice?: string | null } | null }
export type Agent = { id: string; first: string; phone: string | null; mode: 'appts' | 'both'; hours: Record<string, unknown>; tz: string; reachable: boolean }
export type CheckRow = { id: string; status: string; answer: 'yes' | 'no' | null; expires_at: string | null
  summary?: { name?: string | null; age?: string | null; state?: string | null; need?: string | null } }

export interface Store {
  // P976: the voice split. voiceAgents: the Retell agent per voice (null = not set up: the one old agent calls);
  // voiceCounts: first calls per voice so far (tests and real leads counted apart); leadVoice: the voice a lead's
  // earlier try used; setVoice: saved on the call row.
  voiceAgents?(): Promise<Record<string, { agent_id: string }> | null>
  voiceCounts?(tests: boolean): Promise<Record<string, number>>
  leadVoice?(leadId: string, callId: string): Promise<string | null>
  setVoice?(callId: string, voice: string): Promise<void>
  live(): Promise<{ on: boolean; maxSecs: number }>
  call(id: string): Promise<Call | null>
  callByProvider(providerCallId: string): Promise<Call | null>
  lead(id: string): Promise<Lead | null>
  agent(id: string): Promise<Agent | null>
  takes(leadId: string): Promise<{ by: 'ai' | 'va'; reason: string | null }>
  toVa(callId: string, reason: string): Promise<void>
  status(callId: string, status: Phase, patch?: Record<string, unknown>): Promise<Call | null>
  result(callId: string, outcome: string, patch?: Record<string, unknown>): Promise<unknown>
  slots(callId: string): Promise<string[]>
  book(callId: string, at: string): Promise<{ ok: boolean; code?: string }>
  insertCheck(row: { agent_id: string; lead_id: string; ai_call_id: string; summary: Record<string, unknown> }): Promise<CheckRow | null>
  check(id: string): Promise<CheckRow | null>
  sendCheck(check: CheckRow, agentId: string): Promise<boolean>
  // P903: the check row follows the AI's call (ringing → connected + delivered, or bounced / no_answer), and a
  // check that ran out is replaced on the agent's phones ("Missed. We're booking them on your calendar").
  markCheck(id: string, patch: Record<string, unknown>, whenStatus?: string[]): Promise<void>
  clearCheck(check: CheckRow, agentId: string, why: 'booking' | 'gone'): Promise<void>
  // P916: the agent's Deedstone number (logs one call on it), so the AI's first call shows the number the lead will
  // see from their agent ever after. null = AI_FROM_NUMBER.
  endStats?(callId: string, patch: Record<string, unknown>): Promise<void>
  deedstoneFrom?(agentId: string, callId: string): Promise<{ phone: string; providerId: string | null; pool?: string } | null>
  // P957 (reactivation): a live transfer's connected seconds (under 30 s is free), and the yes/no to booking texts.
  transferSecs?(callId: string, secs: number): Promise<void>
  textOk?(callId: string, yes: boolean): Promise<unknown>
}
export type Env = { now(): number; from: string | null; words: Record<string, string> ; pauseMs?: number }

const refuse = (code: string, status = 400) => Object.assign(new Error(code), { status, code })

// P926: on a test call the agent takes live calls all day and their phone is the test transfer number.
const ALL_DAY = Object.fromEntries(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => [d, { on: true, start: '12:00 AM', end: '11:59 PM' }]))
export function testAgent(agent: Agent | null, lead: Lead | null): Agent | null {
  if (!agent || !lead?.test) return agent
  const t = lead.test
  if (t.check !== 'yes' && t.check !== 'no' && t.check !== 'none') return { ...agent, mode: 'appts' } // books
  return { ...agent, mode: 'both', hours: ALL_DAY, reachable: true, phone: t.transferTo || agent.phone }
}

// The machine's phase for a stored call.
// P940: +17373383859 → "737-338-3859" (read aloud digit by digit in the voicemail message).
export const spokenNumber = (e164: string | null | undefined) => {
  const d = String(e164 ?? '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '')
  return d.length === 10 ? `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}` : String(e164 ?? '')
}
const phaseOf = (c: Call) => (c.status === 'queued' ? 'dialing' : c.status)
const step = (c: Call, ev: Record<string, unknown>, ctx: Record<string, unknown> = {}) =>
  aiStep({ phase: phaseOf(c), attempt: c.attempt, outcome: null, reason: null, routed: c.routed }, ev, ctx)

// ── start ───────────────────────────────────────────────────────────────────────────────────────────────────────
export async function start(store: Store, provider: Provider, env: Env, callId: string) {
  const c = await store.call(callId)
  if (!c || c.status !== 'queued') return { ok: false, code: 'gone' }
  const lead = await store.lead(c.lead_id)
  const live = await store.live()
  if (lead?.test) {
    // P926: a test call skips the switch and the lead rules (it only ever dials the number the admin gave), and is
    // never tried twice and never reaches a VA.
    if (c.attempt > 1) { await store.result(c.id, 'no_answer', { summary: 'Test call: no second try.' }); return { ok: false, code: 'test_no_retry' } }
    if (!provider.ready) { await store.result(c.id, 'no_answer', { summary: 'Test call: provider not connected.' }); return { ok: false, code: 'not_connected' } }
  } else {
    // P952: a reactivation call runs on its own switch (reactivation_live, checked in takes()), not the fresh-lead one.
    if (!live.on && !lead?.reactivation) { await store.toVa(c.id, 'switch_off'); return { ok: false, code: 'switch_off' } }
    if (!provider.ready) { await store.toVa(c.id, 'not_connected'); return { ok: false, code: 'not_connected' } }
    // The rules again at the moment of the dial (an opt-out or the window may have changed since the lead came in).
    const w = await store.takes(c.lead_id)
    if (w.by !== 'ai') { await store.toVa(c.id, w.reason || 'rules'); return { ok: false, code: w.reason } }
  }
  const agent = c.agent_id ? testAgent(await store.agent(c.agent_id), lead) : null
  if (!lead || !agent) { await store.toVa(c.id, 'no_lead_or_agent'); return { ok: false, code: 'no_lead_or_agent' } }
  const ds = await store.deedstoneFrom?.(agent.id, c.id).catch(() => null)
  // P952: a reactivation call only ever shows a reactivation number (never the fresh-lead fallback).
  const from = ds?.phone || (lead.reactivation ? null : env.from)
  if (!from) { await store.toVa(c.id, 'not_connected'); return { ok: false, code: 'not_connected' } }
  const v = await chooseVoice(store, provider, c, lead).catch(() => null)
  const name = aiNameOf(v?.voice)
  try {
    const r = await provider.start({
      callId: c.id, to: lead.phone, from, fromId: ds?.phone ? ds.providerId : null, agentId: v?.agentId ?? null, maxSecs: Math.min(live.maxSecs || AI_RULES.maxCallSecs, 900),
      // P940: what the form already told us, so the AI confirms it instead of asking ('' = not on the form, ask it).
      vars: { first_name: lead.first, state: lead.state ?? '', lead_tz: lead.tz ?? '', opening: (lead.reactivation ? reactOpener(lead.first) : env.words.opening.replace('{first}', lead.first)).replace(/\bMax\b/, name), ai_name: name,
        reactivation: lead.reactivation ? 'yes' : '', leave_voicemail: lead.reactivation?.voicemailLeft ? 'no' : 'yes',
        form_state: lead.state ?? '', form_homeowner: lead.homeowner == null ? '' : lead.homeowner ? 'yes' : 'no', form_mortgage: lead.mortgage ?? '', form_age: lead.age ?? '', ...formLines(lead),
        callback_number: spokenNumber(from) }, // P940: the voicemail message gives the number that called them
    })
    if (v) await store.setVoice?.(c.id, v.voice)
    await store.status(c.id, 'dialing', { provider_call_id: r.providerCallId })
    return { ok: true, provider_call_id: r.providerCallId, voice: v?.voice ?? null }
  } catch (e) {
    // P902: a failed AI call counts as no answer (try 2 in 2 minutes, then the no-answer texts), never a VA hand-off.
    await store.result(c.id, 'no_answer', { summary: `start_failed: ${String((e as Error).message).slice(0, 80)}` })
    return { ok: false, code: 'start_failed' }
  }
}

// P976: which voice this call uses. Only on Retell with every split voice set up; a test call may ask for one
// (lead.test.voice); a lead's second try keeps the first try's voice; otherwise the fewest first calls so far.
export async function chooseVoice(store: Store, provider: Provider, c: Call, lead: Lead): Promise<{ voice: string; agentId: string } | null> {
  if (provider.key !== 'retell' || !store.voiceAgents) return null
  const agents = await store.voiceAgents()
  if (!agents || !CALLER_SPLIT.every(k => agents[k]?.agent_id)) return null
  const asked = lead.test?.voice && CALLER_SPLIT.includes(lead.test.voice) ? lead.test.voice : null
  const earlier = !asked && c.attempt > 1 ? await store.leadVoice?.(c.lead_id, c.id) : null
  const voice = asked || (earlier && CALLER_SPLIT.includes(earlier) ? earlier : pickVoice(await store.voiceCounts?.(!!lead.test) ?? {}))
  return { voice, agentId: agents[voice].agent_id }
}

// ── provider events ─────────────────────────────────────────────────────────────────────────────────────────────
const END_TO_EVENT: Record<string, string> = { no_answer: 'no_answer', voicemail: 'voicemail', busy: 'busy', failed: 'error' }

export async function onEvent(store: Store, provider: Provider, env: Env, ev: Ev) {
  const c = (ev.callId && (await store.call(ev.callId))) || (await store.callByProvider(ev.providerCallId))
  if (!c) return { ok: false, code: 'unknown_call' }
  if (ev.type === 'transfer_ended') { await store.transferSecs?.(c.id, ev.transferSecs); return { ok: true } } // P957
  if (c.status === 'done' || c.status === 'to_va') {
    // P940: a call that got its result mid-call (not now, opt-out, no times) still gets its minutes and cost at the end.
    if (ev.type === 'ended' && c.status === 'done') await store.endStats?.(c.id, { duration_secs: ev.durationSecs ?? 0, cost_cents: ev.costCents, summary: ev.summary, transcript_ref: ev.transcriptRef })
    if (ev.type === 'ended' && ev.transferSecs != null) await store.transferSecs?.(c.id, ev.transferSecs)
    return ev.type === 'tool' ? provider.toolReply(ev.toolCallId, { end: true }) : { ok: true, already: true }
  }

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
    if (ph === 'transferring' && ev.reason === 'transferred') {
      if (c.check_id) await store.markCheck(c.check_id, { status: 'connected', connected_at: new Date(env.now()).toISOString(), delivered: true }, ['ringing'])
      await store.result(c.id, 'transferred', patch)
      if (ev.transferSecs != null) await store.transferSecs?.(c.id, ev.transferSecs)
      return { ok: true }
    }
    if (c.booked_for) { await store.result(c.id, 'booked', patch); return { ok: true } }
    // Hung up, or the line dropped, before any result: counts as no answer (the texts send them the booking link).
    await store.result(c.id, 'no_answer', patch)
    return { ok: true, outcome: 'no_answer' }
  }
  // Tool calls: the AI asks us what to do next.
  return provider.toolReply(ev.toolCallId, await tool(store, provider, env, c, ev.name, ev.args))
}

// Beat 3: no dead air while the agent decides. A provider that can talk while a tool call is pending keeps the caller
// company with light, useful questions (never coverage or price); one that can't plays a short hold line instead.
// P940: the AI says Brayden's check line out loud, then pauses while the agent is checked.
const checkSay = (p: Provider) => (p.talksWhileWaiting ? AI_CALL_WORDS.check : `${AI_CALL_WORDS.check} ${transferSay('holdOnly')}`)
function waiting(p: Provider, first: boolean) {
  if (!p.talksWhileWaiting) return { hold: true }
  return first ? { keep_talking: true, ask: WAIT_QUESTIONS, rule: WAIT_RULE } : { keep_talking: true }
}

// P940: the form answers as ready-to-say lines (Retell's LLM skipped lines that depended on empty-or-not variables).
const STATES: Record<string, string> = Object.fromEntries('AL Alabama|AK Alaska|AZ Arizona|AR Arkansas|CA California|CO Colorado|CT Connecticut|DE Delaware|DC Washington D.C.|FL Florida|GA Georgia|HI Hawaii|ID Idaho|IL Illinois|IN Indiana|IA Iowa|KS Kansas|KY Kentucky|LA Louisiana|ME Maine|MD Maryland|MA Massachusetts|MI Michigan|MN Minnesota|MS Mississippi|MO Missouri|MT Montana|NE Nebraska|NV Nevada|NH New Hampshire|NJ New Jersey|NM New Mexico|NY New York|NC North Carolina|ND North Dakota|OH Ohio|OK Oklahoma|OR Oregon|PA Pennsylvania|RI Rhode Island|SC South Carolina|SD South Dakota|TN Tennessee|TX Texas|UT Utah|VT Vermont|VA Virginia|WA Washington|WV West Virginia|WI Wisconsin|WY Wyoming'
  .split('|').map(x => [x.slice(0, 2), x.slice(3)]))
// "200-300k" → "about 250", "500k+" → "over 500", "under-100k" → "under 100".
export function spokenBalance(band: string | null | undefined) {
  const b = String(band ?? '').toLowerCase(), n = (b.match(/\d+/g) ?? []).map(Number)
  if (!n.length) return ''
  if (/under|less|</.test(b)) return `under ${n[0]}`
  if (n.length >= 2) return `about ${Math.round((n[0] + n[1]) / 2)}`
  return /\+|over|more/.test(b) ? `over ${n[0]}` : `about ${n[0]}`
}
export function formLines(lead: { state?: string | null; homeowner?: boolean | null; mortgage?: string | null; age?: string | null }) {
  const st = STATES[String(lead.state ?? '').toUpperCase()] ?? '', bal = spokenBalance(lead.mortgage)
  const lines = [st && `You’re in ${st}, right?`, lead.homeowner === true && 'And you own the home?', bal && `Still ${bal} left on the mortgage?`].filter(Boolean)
  const ask = [!st && 'What state is the home in?', lead.homeowner == null && 'And do you own the home?', !bal && 'Roughly how much is left on the mortgage?',
    !lead.age && 'And roughly what age range are you in?'].filter(Boolean)
  return { form_lines: lines.join(' | ') || 'none', form_ask: ask.join(' | ') || 'none' }
}

// P940: an open time in plain words for the lead's own state: "3:30 this afternoon", "10 tomorrow morning",
// "Thursday at 9 in the morning".
export function spokenSlot(iso: string, tz: string | null, nowMs: number) {
  const zone = tz || 'America/Chicago'
  const day = (ms: number) => new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms))
  const at = Date.parse(iso)
  const h = Number(new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: 'numeric', hourCycle: 'h23' }).format(new Date(at)))
  const part = h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening'
  const t = new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: 'numeric', minute: '2-digit' }).format(new Date(at)).replace(/:00/, '').replace(/\s?[AP]M$/i, '')
  if (day(at) === day(nowMs)) return `${t} this ${part}`
  if (day(at) === day(nowMs + 86400000)) return `${t} tomorrow ${part}`
  return `${new Intl.DateTimeFormat('en-US', { timeZone: zone, weekday: 'long' }).format(new Date(at))} at ${t} in the ${part}`
}
// Two times as one phrase: "3:30 this afternoon, or 5 this evening".
export function twoTimes(spoken: string[]) {
  const [a, b] = spoken
  return b ? `${a}, or ${b}` : (a ?? '')
}

async function slotsReply(store: Store, env: Env, c: Call, say?: string, _agentFirst?: string) {
  const slots = await store.slots(c.id)
  if (say?.includes('{times}') && !slots.length) say = undefined // "all with clients" needs times; noTimes says the rest
  if (!slots.length) {
    // No time open in the next 3 days: "{agent} will call you to find a time" → not now, no time (the agent's Follow
    // up, no texts). Never a VA.
    await store.result(c.id, 'not_now', { summary: 'No open time in the agent’s calendar in the next 3 days.' })
    return { say: [say, AI_CALL_WORDS.noTimes].filter(Boolean).join(' '), end: true } // P940: never the agent's name
  }
  const tz = (await store.lead(c.lead_id))?.tz ?? null
  const spoken = slots.map(s => spokenSlot(s, tz, env.now()))
  return { say: say?.replace('{times}', twoTimes(spoken)), slots, spoken, next: 'book' }
}

export async function tool(store: Store, provider: Provider, env: Env, c: Call, name: string, args: Record<string, unknown>) {
  const lead0 = await store.lead(c.lead_id)
  const agent = c.agent_id ? testAgent(await store.agent(c.agent_id), lead0) : null
  const nowMs = env.now()
  switch (name) {
    case 'stop': { // "Stop calling" / "don't call me": honoured at once, everywhere.
      await store.result(c.id, 'opt_out')
      return { end: true }
    }
    case 'outcome': { // what the caller said: not now (with or without a time), hard no, wrong number
      const result = String(args.result ?? '')
      if (!SAID_OUTCOMES.includes(result)) return { ok: false, code: 'unknown_outcome' }
      const at = result === 'not_now' && Number.isFinite(Date.parse(String(args.at ?? ''))) ? new Date(String(args.at)).toISOString() : null
      await store.result(c.id, result, { callback_at: at, summary: args.summary ?? null })
      return { ok: true, end: true }
    }
    case 'ask_agent': // asked for a person, or about coverage or price: the agent goes over it (Check agent → transfer, or book)
    case 'qualified': {
      const askedAgent = name === 'ask_agent' && String(args.reason ?? '') in ASK_AGENT_REASONS
      const pre = askedAgent ? transferSay('agentWill') : undefined
      if (c.status !== 'talking') return c.status === 'booking' ? slotsReply(store, env, c, pre, agent?.first) : { ok: false, code: 'not_talking' }
      if (!agent) return slotsReply(store, env, c, pre)
      const r = step(c, { type: 'qualified' }, { agent, nowMs })
      // P940: the AI asks "Are you free right now?" first; a No books a time without checking the agent.
      const notNow = args.free_now === false || String(args.free_now ?? '').toLowerCase() === 'no'
      if (notNow || !r.act.includes('check_agent')) {
        await store.status(c.id, 'booking', { routed: r.s.routed, /* ai_calls_routed_check allows only the agent's routing; "not free" is in the summary */ summary: args.summary ?? null })
        // P940: they said they're free but no specialist can take it (out of hours, appointments only): the check out
        // loud, a real pause (check_status waits), then "all with clients" and two times.
        if (notNow) return slotsReply(store, env, c, pre, agent.first)
        return { say: pre, next: 'check_status', wait_secs: 0 } // check_status says "Let me check real quick..." itself
      }
      const lead = lead0
      const chk = await store.insertCheck({ agent_id: agent.id, lead_id: c.lead_id, ai_call_id: c.id,
        // P957: a reactivation person's name shows only once their $20 is paid, so the agent's alert and whisper say
        // "a reactivated lead" instead.
        summary: { name: lead?.reactivation ? 'a reactivated lead' : (lead?.first ?? null), age: lead?.age ?? null, state: lead?.state ?? null, need: lead?.need ?? null, your_client: false } })
      // P926: a test call's check is answered for the agent (Yes / No at once; none runs out after 30 s like a real one).
      const t = lead?.test?.check
      const sent = chk && (t
        ? (await store.markCheck(chk.id, t === 'none'
            ? { sent_at: new Date(nowMs).toISOString(), expires_at: new Date(nowMs + AI_RULES.checkSecs * 1000).toISOString(), is_test: true }
            : { status: t, answer: t, sent_at: new Date(nowMs).toISOString(), answered_at: new Date(nowMs).toISOString(), expires_at: new Date(nowMs + AI_RULES.checkSecs * 1000).toISOString(), is_test: true }), true)
        : await store.sendCheck(chk, agent.id))
      if (!chk || !sent) {
        await store.status(c.id, 'booking', { routed: r.s.routed, summary: args.summary ?? null })
        return slotsReply(store, env, c, pre, agent.first) // agent being checked by a VA, or the push failed: book
      }
      await store.status(c.id, 'checking', { routed: r.s.routed, check_id: chk.id, summary: args.summary ?? null })
      return { say: pre, next: 'check_status', wait_secs: 0, ...waiting(provider, true) } // check_status says the check line (P940)
    }
    case 'check_status': {
      if (env.pauseMs) await new Promise(r => setTimeout(r, env.pauseMs)) // P940: a real 2-3 s pause while "checking"
      if (c.status !== 'checking') return c.status === 'booking' ? slotsReply(store, env, c, c.check_id ? undefined : AI_CALL_WORDS.bounce, agent?.first) : { ok: false, code: 'not_checking' }
      const chk = c.check_id ? await store.check(c.check_id) : null
      const expired = !!chk?.expires_at && Date.parse(chk.expires_at) <= nowMs
      const answer = chk?.answer === 'yes' ? 'yes' : chk?.answer === 'no' || chk?.status === 'failed' || expired ? (chk?.answer ?? 'none') : null
      if (!answer) return { next: 'check_status', wait_secs: 3, ...waiting(provider, false) }
      const r = step(c, { type: 'check_answer', answer })
      if (r.act.includes('transfer_agent') && agent?.phone) {
        // Beat 4: "connecting you with {Agent}", the agent's phone rings, they hear the whisper alone, the caller is
        // connected and the AI leaves (cold). Not answered in about 20 s → transfer_failed below.
        const say = AI_CALL_WORDS.connecting
        const whisper = whisperWords({ ...(chk?.summary ?? {}) }, false, 'ai')
        const bounceSay = AI_CALL_WORDS.bounce
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
      return slotsReply(store, env, c, AI_CALL_WORDS.bounce, agent?.first)
    }
    case 'transfer_failed': { // the agent's phone wasn't answered in about 20 s: the caller is back with the AI, who books
      if (c.status !== 'transferring') return c.status === 'booking' ? slotsReply(store, env, c, undefined, agent?.first) : { ok: false, code: 'not_transferring' }
      const r = step(c, { type: 'transfer_bounced' })
      await store.status(c.id, r.s.phase as Phase)
      if (c.check_id) {
        await store.markCheck(c.check_id, { status: 'bounced', bounced_at: new Date(nowMs).toISOString(), ended_reason: 'ai_not_answered' }, ['ringing'])
        const chk = await store.check(c.check_id)
        if (chk) await store.clearCheck(chk, agent?.id ?? '', 'booking')
      }
      return slotsReply(store, env, c, AI_CALL_WORDS.bounce, agent?.first)
    }
    case 'slots': return slotsReply(store, env, c, undefined, agent?.first)
    case 'book': {
      const at = String(args.at ?? '')
      if (!Number.isFinite(Date.parse(at))) return { ok: false, code: 'bad_time' }
      const r = await store.book(c.id, at)
      if (!r.ok) return { ok: false, ...(await slotsReply(store, env, c, undefined, agent?.first)) }
      const bl = await store.lead(c.lead_id)
      // P957: a reactivation person is asked before any text (no cold texts to an imported list).
      if (bl?.reactivation) return { ok: true, booked_for: at, spoken: spokenSlot(at, bl.tz ?? null, nowMs), ask_text: TEXT_ASK, next: 'text_ok' }
      return { ok: true, booked_for: at, spoken: spokenSlot(at, bl?.tz ?? null, nowMs), end_after: true }
    }
    case 'text_ok': { // P957: their answer to "Can I text you the confirmation?" (reactivation only)
      const a = String(args.answer ?? args.yes ?? '').toLowerCase()
      const yes = a === 'yes' || a === 'true'
      if (!lead0?.reactivation) return { ok: true, end_after: true }
      await store.textOk?.(c.id, yes)
      return { ok: true, texts: yes, end_after: true }
    }
    case 'hang_up_pause': { // P940: after the goodbye, 2-3 s for them to hang up first; then the AI ends the call
      if (env.pauseMs) await new Promise(r => setTimeout(r, env.pauseMs))
      return { next: 'end_call' }
    }
    default:
      return { ok: false, code: 'unknown_tool' }
  }
}

// ── one entry point ─────────────────────────────────────────────────────────────────────────────────────────────
export async function handle(action: string, body: any, d: { store: Store; provider: Provider; env: Env }) {
  const id = String(body?.call_id ?? '')
  const uuid = /^[0-9a-f-]{36}$/i
  switch (action) {
    case 'start': if (!uuid.test(id)) throw refuse('call_id'); return start(d.store, d.provider, d.env, id)
    case 'event': {
      const ev = d.provider.parse(body)
      if (!ev) return { ok: true, ignored: true }
      return onEvent(d.store, d.provider, d.env, ev)
    }
    default: throw refuse('unknown action')
  }
}
