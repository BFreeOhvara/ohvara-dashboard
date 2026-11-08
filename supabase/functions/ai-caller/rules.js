// P892 — AI speed to lead: the rules, in one place. Plain JS with no imports so the edge function (Deno), the portal
// (src/lib/aiCaller.js re-exports it) and node --test all run the same code. Migration p892_ai_caller.sql has the SQL
// side (who calls a new lead, the retry, the hand-off timer); src/p892.test.js checks the two agree.
//
// The AI calls ONLY fresh form leads, within 10 seconds. It never takes inbound calls (call ads and live-transfer calls
// still ring a VA), never calls clients, never does servicing. It qualifies with the VA questions, then Check agent →
// cold transfer, or books. It hands to a VA (warm, top of the queue) when the lead asks for a person, asks about coverage
// or price, is confused or upset, or the AI fails. Off until Brayden switches ai_caller_live on.

export const AI_RULES = {
  firstCallSecs: 10, // a fresh form lead is dialled within 10 s of arriving
  checkSecs: 30, // Check agent: Yes / No / no answer in 30 s (P880's timer)
  ringSecs: 20, // the agent's phone rings about 20 s, then the lead comes back to the AI to book
  handoffWaitSecs: 60, // a hand-off nobody takes in 60 s becomes a callback task
  retryAfterSecs: 120, // no answer: one more try 2 minutes later
  maxAttempts: 2,
  maxCallSecs: 300, // admin setting (60-900)
}

// Why a call goes to a person. Agent screens never show these.
export const HANDOFF_REASONS = {
  asked_person: 'Asked for a person',
  coverage_or_price: 'Asked about coverage or price',
  confused_upset: 'Confused or upset',
  ai_failed: 'The call had a problem',
}

// The results on a call. reached = talked, but not booked or transferred (not interested, hung up, wrong number).
export const OUTCOMES = ['reached', 'booked', 'transferred', 'handed_to_va', 'no_answer', 'opt_out']

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
// act: what the function must do next: dial | check_agent | transfer_agent | book | handoff | callback_task |
//      retry | va_no_answer | dnc | end | log. ctx: { agent, nowMs, vaFree }.
export const startState = (attempt = 1) => ({ phase: 'dialing', attempt, outcome: null, reason: null, routed: null })

const done = (s, outcome, extra = {}) => ({ ...s, phase: 'done', outcome, ...extra })

export function aiStep(s, ev, ctx = {}) {
  const t = ev?.type
  // "Stop calling" wins over everything, at any point of the call.
  if (t === 'stop') return { s: done(s, 'opt_out'), act: ['dnc', 'end', 'log'] }
  if (t === 'signal' && HANDOFF_REASONS[ev.reason] && !['done', 'handing_off'].includes(s.phase)) {
    return { s: { ...s, phase: 'handing_off', reason: ev.reason, waited: 0 }, act: ['handoff'] }
  }
  if (t === 'error' && !['done', 'dialing'].includes(s.phase) && s.phase !== 'handing_off') {
    return { s: { ...s, phase: 'handing_off', reason: 'ai_failed', waited: 0 }, act: ['handoff'] }
  }
  switch (s.phase) {
    case 'dialing':
      if (t === 'answered') return { s: { ...s, phase: 'talking' }, act: [] }
      if (t === 'no_answer' || t === 'voicemail' || t === 'busy' || t === 'error') {
        // No voicemail from the AI. Try once more in 2 minutes, then the no-answer texts and VA call tasks take over.
        if (s.attempt < AI_RULES.maxAttempts) return { s: done(s, 'no_answer', { retryInSecs: AI_RULES.retryAfterSecs }), act: ['retry', 'log'] }
        return { s: done(s, 'no_answer'), act: ['va_no_answer', 'log'] }
      }
      break
    case 'talking':
      if (t === 'qualified') {
        const r = aiRoute(ctx.agent, ctx.nowMs ?? Date.now())
        return r.route === 'check'
          ? { s: { ...s, phase: 'checking', routed: r.key }, act: ['check_agent'] }
          : { s: { ...s, phase: 'booking', routed: r.key }, act: ['book'] }
      }
      if (t === 'ended') return { s: done(s, 'reached'), act: ['log'] }
      break
    case 'checking':
      if (t === 'check_answer') {
        return ev.answer === 'yes'
          ? { s: { ...s, phase: 'transferring' }, act: ['transfer_agent'] }
          : { s: { ...s, phase: 'booking', checked: ev.answer || 'none' }, act: ['book'] } // No, no answer in 30 s, failed push
      }
      if (t === 'ended') return { s: done(s, 'reached'), act: ['log'] }
      break
    case 'transferring':
      if (t === 'transfer_ok') return { s: done(s, 'transferred'), act: ['log'] }
      if (t === 'transfer_bounced') return { s: { ...s, phase: 'booking', checked: 'bounced' }, act: ['book'] }
      if (t === 'ended') return { s: done(s, 'reached'), act: ['log'] }
      break
    case 'booking':
      if (t === 'booked') return { s: done(s, 'booked', { bookedFor: ev.at }), act: ['end', 'log'] }
      if (t === 'ended') return { s: done(s, 'reached'), act: ['log'] }
      break
    case 'handing_off':
      if (t === 'va_taken') return { s: done(s, 'handed_to_va'), act: ['log'] }
      if (t === 'va_wait') {
        const waited = ev.secs ?? 0
        if (waited >= AI_RULES.handoffWaitSecs) return { s: done(s, 'handed_to_va', { callbackTask: true }), act: ['callback_task', 'end', 'log'] }
        return { s: { ...s, waited }, act: [] }
      }
      if (t === 'ended') return { s: done(s, 'handed_to_va', { callbackTask: true }), act: ['callback_task', 'log'] }
      break
    default:
  }
  return { s, act: [] }
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

// ── Lines on the lead's timeline ──────────────────────────────────────────────────────────────────────────────────
// Agents see the speed and what happened, never "AI" (their words come from here, and src/p892.test.js checks it).
const secsWord = n => `${n} second${n === 1 ? '' : 's'}`
const AGENT_RESULT = {
  reached: 'Reached them',
  booked: 'Reached them. Booked',
  transferred: 'Reached them. Live transfer to you',
  handed_to_va: 'Reached them. Our team is on it',
  no_answer: 'No answer',
  opt_out: 'Asked not to be called',
}
export function agentLine({ secs, outcome }) {
  const head = secs == null ? 'Called' : `Called in ${secsWord(Math.max(0, Math.round(secs)))}`
  return `${head}. ${AGENT_RESULT[outcome] || 'Reached them'}`
}
const STAFF_RESULT = {
  reached: 'Reached, not booked', booked: 'Booked', transferred: 'Transferred to the agent', handed_to_va: 'Handed to a VA',
  no_answer: 'No answer', opt_out: 'Opted out',
}
export const staffLine = ({ secs, outcome, attempt }) =>
  `AI called in ${Math.round(secs ?? 0)} s${attempt > 1 ? ` (try ${attempt})` : ''} · ${STAFF_RESULT[outcome] || outcome}`

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
    booked: n('booked'), transferred: n('transferred'), handed: n('handed_to_va'), noAnswer: n('no_answer'), optOut: n('opt_out'),
    avgSecs: secs.length ? Math.round((secs.reduce((a, b) => a + b, 0) / secs.length) * 10) / 10 : null,
    minutes, costCents: cost,
  }
}
