// P892 — AI speed to lead: the rules, in one place. Plain JS with no imports so the edge function (Deno), the portal
// (src/lib/aiCaller.js re-exports it) and node --test all run the same code. Migration p892_ai_caller.sql has the SQL
// side (who calls a new lead, the retry, the hand-off timer); src/p892.test.js checks the two agree.
//
// The AI calls ONLY fresh form leads, within 10 seconds. It never takes inbound calls (call ads and live-transfer calls
// still ring a VA), never calls clients, never does servicing. It qualifies with the VA questions, then Check agent →
// cold transfer, or books. P902: it never hands a new lead to a VA. Asks for a person, or about coverage or price ->
// "Your agent will go over that with you" -> Check agent -> transfer, or book if the agent can't. A failed call counts
// as no answer. Every call ends in one outcome (supabase/functions/_shared/leadFlows.js FIRST_CALL_OUTCOMES), which
// decides the texts. Off until Brayden switches ai_caller_live on.
import { FIRST_CALL_OUTCOMES, AGENT_OUTCOME, OUTCOME_LABEL } from '../_shared/leadFlows.js'

export const AI_RULES = {
  firstCallSecs: 10, // a fresh form lead is dialled within 10 s of arriving
  checkSecs: 30, // Check agent: Yes / No / no answer in 30 s (P880's timer)
  ringSecs: 20, // the agent's phone rings about 20 s, then the lead comes back to the AI to book
  retryAfterSecs: 120, // no answer: one more try 2 minutes later
  maxAttempts: 2,
  maxCallSecs: 300, // admin setting (60-900)
}

// P903 — the live transfer, beat by beat. DRAFT words (Brayden approves them with the opening line). {agent} is the
// agent's first name.
export const TRANSFER_WORDS = {
  check: 'Great, let me see who on our team is free to talk with you right now.',
  connecting: 'Perfect, I’m connecting you with {agent} now. They’ll take great care of you.',
  bounce: 'Our specialists are all with clients right now, so let’s get you on {agent}’s calendar.',
  holdOnly: 'One moment while I check.', // only when the provider can't talk while it waits
  // P902: asks for a person, or about coverage or price. Then Check agent -> transfer, or book.
  agentWill: 'Your agent will go over that with you.',
  // P902: no open time in the agent's calendar in the next 3 days. The lead goes to the agent's Follow up.
  noTimes: '{agent} will call you to find a time that works. Thanks so much for your time today.',
}
// P940 — what the AI caller says (Brayden, Nov 10): never the agent's name, always "a licensed specialist".
export const AI_CALL_WORDS = {
  check: 'Give me one second, let me see if one of our licensed specialists is free right now.',
  connecting: 'Good news, I’ve got one. I’ll bring them on now.',
  bounce: 'Looks like they’re all with clients at the moment. No worries, let’s get you a time.',
  noTimes: 'A licensed specialist will reach out to find a time that works for you. Thanks so much for your time today.',
}
// While the agent decides (up to 30 s): light, useful questions, one at a time. Never coverage or price.
export const WAIT_QUESTIONS = [
  'Just to confirm, what city are you in?',
  'Is this the best number to reach you on if we get cut off?',
  'Is this for you or for a loved one?',
]
export const WAIT_RULE = 'Ask these one at a time and wait for each answer. Never talk about coverage, prices or carriers while you wait.'
export const transferSay = (key, agentFirst) => TRANSFER_WORDS[key].replace('{agent}', agentFirst || 'your agent')

// P902: what turns the call to the agent (the AI says TRANSFER_WORDS.agentWill, then Check agent -> transfer or book).
export const ASK_AGENT_REASONS = {
  asked_person: 'Asked for a person',
  coverage_or_price: 'Asked about coverage or price',
}
// What the caller can tell the AI that ends the call with an outcome of its own (the `outcome` tool).
export const SAID_OUTCOMES = ['not_now', 'hard_no', 'wrong_number']

// The results on a call: the first-call outcomes (P902). booked / transferred / no_answer come from the call itself;
// not_now (with or without a time), hard_no and wrong_number from what the caller says; opt_out from "stop calling".
export const OUTCOMES = FIRST_CALL_OUTCOMES

// ── Who calls a new lead ─────────────────────────────────────────────────────────────────────────────────────────
// lead: { source: 'form' | 'call_in' | 'live_call' | 'client', consent_version, agent_id }
// settings: { live, agents: 'all' | [agent ids] }
// consentVersions: { [version]: covers_ai }   (ai_consent_versions; only Brayden-approved wording covers AI calls)
// predial: P882's pre-dial result { ok, reason, next_at } for this lead now.
export const aiConsentOk = (lead, consentVersions = {}) => !!lead?.consent_version && consentVersions[lead.consent_version] === true

export function agentOn(settings, agentId) {
  if (!agentId) return false
  return settings?.agents === 'all' || (Array.isArray(settings?.agents) && settings.agents.includes(agentId))
}

export function whoCalls({ settings, lead, consentVersions, predial }) {
  if (lead?.source !== 'form') return { by: 'va', reason: 'not_form' } // inbound calls and clients: never the AI
  if (!settings?.live) return { by: 'va', reason: 'switch_off' }
  if (!agentOn(settings, lead.agent_id)) return { by: 'va', reason: 'agent_not_on' }
  if (!aiConsentOk(lead, consentVersions)) return { by: 'va', reason: 'no_ai_consent' }
  // Blocked or outside the calling window: the VA path (P882 route_enqueue) holds or cancels it exactly as today.
  if (predial && !predial.ok) return { by: 'va', reason: predial.reason || 'predial' }
  return { by: 'ai', reason: null }
}

// ── Transfer or book (same rule as the VA desk, P889 freshLeadRoute) ──────────────────────────────────────────────
const DAY_KEYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
export function clockMin(c) {
  const m = /^(\d{1,2}):(\d{2})\s*([AP]M)$/i.exec(String(c || '').trim())
  if (!m) return null
  return ((Number(m[1]) % 12) + (m[3].toUpperCase() === 'PM' ? 12 : 0)) * 60 + Number(m[2])
}
export function localNow(tz, nowMs) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz || 'America/Chicago', weekday: 'short', hour: 'numeric', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(nowMs)).map(x => [x.type, x.value]))
  return { day: p.weekday, min: (Number(p.hour) % 24) * 60 + Number(p.minute) }
}
export function inLiveHours(hours, tz, nowMs) {
  const { day, min } = localNow(tz, nowMs)
  const h = hours?.[day]
  if (!h?.on) return false
  const a = clockMin(h.start), b = clockMin(h.end)
  return a != null && b != null && min >= a && min < b
}
// agent: { mode: 'appts' | 'both', hours, tz, reachable }
export function aiRoute(agent, nowMs) {
  if (agent?.mode !== 'both') return { route: 'book', key: 'appts_only' }
  if (!inLiveHours(agent.hours, agent.tz, nowMs)) return { route: 'book', key: 'out_of_hours' }
  if (agent.reachable === false) return { route: 'book', key: 'not_reachable' }
  return { route: 'check', key: 'in_hours' }
}
export { DAY_KEYS }

// ── The call, step by step ────────────────────────────────────────────────────────────────────────────────────────
// A small state machine the edge function drives from provider events. aiStep(state, event, ctx) → { s, act }.
// act: what the function must do next: dial | check_agent | transfer_agent | book | retry | no_answer_flow | dnc |
//      end | log. ctx: { agent, nowMs }. P902: no hand-off to a VA anywhere.
export const startState = (attempt = 1) => ({ phase: 'dialing', attempt, outcome: null, reason: null, routed: null })

const done = (s, outcome, extra = {}) => ({ ...s, phase: 'done', outcome, ...extra })

export function aiStep(s, ev, ctx = {}) {
  const t = ev?.type
  // "Stop calling" wins over everything, at any point of the call.
  if (t === 'stop') return { s: done(s, 'opt_out'), act: ['dnc', 'end', 'log'] }
  if (s.phase === 'done') return { s, act: [] }
  // What the caller says ends the call with its own outcome: not now (with or without a time), hard no, wrong number.
  if (t === 'said' && SAID_OUTCOMES.includes(ev.outcome) && s.phase !== 'dialing') {
    return { s: done(s, ev.outcome, ev.outcome === 'not_now' && ev.at ? { callbackAt: ev.at } : {}), act: ['end', 'log'] }
  }
  // Asks for a person, or about coverage or price: "Your agent will go over that with you", then the same route as a
  // qualified lead (Check agent → transfer, or book). Never a VA.
  if (t === 'signal' && ASK_AGENT_REASONS[ev.reason] && s.phase === 'talking') return aiStep(s, { type: 'qualified' }, ctx)
  // A call that fails counts as no answer (tried once more in 2 minutes, then the no-answer texts).
  if (t === 'error' && s.phase !== 'dialing') return noAnswer(s)
  switch (s.phase) {
    case 'dialing':
      if (t === 'answered') return { s: { ...s, phase: 'talking' }, act: [] }
      // No voicemail from the AI. Try once more in 2 minutes, then the no-answer flow (texts by GoHighLevel).
      if (t === 'no_answer' || t === 'voicemail' || t === 'busy' || t === 'error') return noAnswer(s)
      break
    case 'talking':
      if (t === 'qualified') {
        const r = aiRoute(ctx.agent, ctx.nowMs ?? Date.now())
        return r.route === 'check'
          ? { s: { ...s, phase: 'checking', routed: r.key }, act: ['check_agent'] }
          : { s: { ...s, phase: 'booking', routed: r.key }, act: ['book'] }
      }
      if (t === 'ended') return noAnswer(s) // hung up before any result: the no-answer texts send them the link
      break
    case 'checking':
      if (t === 'check_answer') {
        return ev.answer === 'yes'
          ? { s: { ...s, phase: 'transferring' }, act: ['transfer_agent'] }
          : { s: { ...s, phase: 'booking', checked: ev.answer || 'none' }, act: ['book'] } // No, no answer in 30 s, failed push
      }
      if (t === 'ended') return noAnswer(s)
      break
    case 'transferring':
      if (t === 'transfer_ok') return { s: done(s, 'transferred'), act: ['log'] }
      if (t === 'transfer_bounced') return { s: { ...s, phase: 'booking', checked: 'bounced' }, act: ['book'] }
      if (t === 'ended') return noAnswer(s)
      break
    case 'booking':
      if (t === 'booked') return { s: done(s, 'booked', { bookedFor: ev.at }), act: ['end', 'log'] }
      // No open time in the next 3 days: "{agent} will call you to find a time" → the agent's Follow up, no texts.
      if (t === 'no_times') return { s: done(s, 'not_now', { noTimes: true }), act: ['end', 'log'] }
      if (t === 'ended') return noAnswer(s)
      break
    default:
  }
  return { s, act: [] }
}

function noAnswer(s) {
  if (s.attempt < AI_RULES.maxAttempts) return { s: done(s, 'no_answer', { retryInSecs: AI_RULES.retryAfterSecs }), act: ['retry', 'log'] }
  return { s: done(s, 'no_answer'), act: ['no_answer_flow', 'log'] }
}

// Run a list of events through the machine (tests, sample data).
export function runCall(events, ctx = {}, attempt = 1) {
  let s = startState(attempt)
  const acts = []
  for (const ev of events) {
    const r = aiStep(s, ev, ctx)
    s = r.s
    acts.push(...r.act)
  }
  return { s, acts }
}

// ── P903: a transfer call's beats, for staff timelines (admin AI calls, sample) ────────────────────────────────────
// t: { agent, check: 'yes' | 'no' | 'none', answerSecs, phone: 'answered' | 'no_answer' (after a Yes), bookedFor }
// (P902: after a bounce or a No the AI always books; there is no hand-off to a VA.)
export function transferBeats(t) {
  const out = ['Qualified', `Checked ${t.agent}: “Live caller ready” push sent · kept the caller talking`]
  if (t.check === 'none') out.push(`No answer to the push in ${AI_RULES.checkSecs} s`)
  else out.push(`${t.agent} tapped ${t.check === 'yes' ? 'Yes' : 'No'}${t.answerSecs != null ? ` in ${t.answerSecs} s` : ''}`)
  if (t.check === 'yes') {
    if (t.phone === 'answered') {
      out.push(`${t.agent}’s phone rang · whisper played · caller connected · AI left the call`)
      return out
    }
    out.push(`${t.agent}’s phone not answered in ${AI_RULES.ringSecs} s · caller back with the AI`)
  } else out.push('Back with the AI')
  out.push(`Booked ${t.bookedFor || 'the next open time'}`)
  return out
}

// ── Lines on the lead's timeline ──────────────────────────────────────────────────────────────────────────────────
// Agents see the speed and what happened, never "AI" (their words come from here, and src/p892.test.js checks it).
const secsWord = n => `${n} second${n === 1 ? '' : 's'}`
export function agentLine({ secs, outcome, callbackAt }) {
  const head = secs == null ? 'Called' : `Called in ${secsWord(Math.max(0, Math.round(secs)))}`
  const word = outcome === 'not_now' && callbackAt ? AGENT_OUTCOME.not_now_time : AGENT_OUTCOME[outcome] || 'Reached them'
  return `${head}. ${word}`
}
export const staffLine = ({ secs, outcome, attempt }) =>
  `AI called in ${Math.round(secs ?? 0)} s${attempt > 1 ? ` (try ${attempt})` : ''} · ${OUTCOME_LABEL[outcome] || outcome}`

// ── Admin numbers ─────────────────────────────────────────────────────────────────────────────────────────────────
// calls: [{ outcome, attempt, secs (seconds from lead in to first dial, first attempt), duration (s), cost_cents }]
export function aiStats(calls = [], centsPerMin = null) {
  const first = calls.filter(c => (c.attempt ?? 1) === 1)
  const n = o => calls.filter(c => c.outcome === o).length
  const leads = first.length
  const reachedLeads = new Set(calls.filter(c => c.outcome && c.outcome !== 'no_answer').map(c => c.lead_id ?? c.id)).size
  const secs = first.map(c => c.secs).filter(x => typeof x === 'number')
  const seconds = calls.reduce((t, c) => t + (c.duration || 0), 0)
  const minutes = Math.round((seconds / 60) * 10) / 10
  const billedMin = calls.reduce((t, c) => t + Math.ceil((c.duration || 0) / 60), 0)
  const cost = calls.some(c => typeof c.cost_cents === 'number')
    ? calls.reduce((t, c) => t + (c.cost_cents || 0), 0)
    : centsPerMin == null ? null : Math.round(billedMin * centsPerMin)
  return {
    calls: calls.length, leads, reached: reachedLeads, reachedPct: leads ? Math.round((reachedLeads / leads) * 100) : 0,
    booked: n('booked'), transferred: n('transferred'), notNow: n('not_now'), hardNo: n('hard_no'), wrongNumber: n('wrong_number'),
    noAnswer: n('no_answer'), optOut: n('opt_out'),
    avgSecs: secs.length ? Math.round((secs.reduce((a, b) => a + b, 0) / secs.length) * 10) / 10 : null,
    minutes, costCents: cost,
  }
}
