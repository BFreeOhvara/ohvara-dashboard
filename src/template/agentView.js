import { STAGES, needsOutcome, confirmedByText, agentCallTask, SAMPLE_NOW } from './leadLifecycle.js'

// P878 — what an agent sees of a lead (How Ohvara Works, "What each role sees of a lead"). Five statuses, Closed under a
// filter with its reason. Never call attempts, the text sequence or where a lead came from. The VA and admin portals
// keep every stage (leadLifecycle.js STAGES); this file only decides the agent's view of them. Pure, no React.

export const AGENT_STATUSES = [
  { key: 'on_it', label: 'Our team is on it', tone: 'violet', empty: 'Nothing waiting on the team.',
    explain: 'New, being reached, a callback or check-in set, a missed transfer or a no-show picking a new time. Nothing for you to do.' },
  { key: 'booked', label: 'Booked', tone: 'blue', empty: 'No appointments booked yet.', explain: 'On your calendar. Be there at the time.' },
  { key: 'needs_you', label: 'Needs you', tone: 'warn', empty: 'Nothing waiting on you.', explain: 'Mark how a call went, call someone back, or finish a sale’s servicing details.' },
  { key: 'follow', label: 'Follow up', tone: 'teal', empty: 'No follow-ups set.', explain: 'You set a day to call them back.' },
  { key: 'sold', label: 'Sold', tone: 'green', empty: 'Sales you mark show here.', explain: 'Sold and handed to the team for servicing.' },
]
export const CLOSED_STATUS = { key: 'closed', label: 'Closed', tone: 'mute', empty: 'Nothing closed out.', explain: 'No more calls or texts. The reason is on each lead.' }
export const ALL_AGENT_STATUSES = [...AGENT_STATUSES, CLOSED_STATUS]
export const agentStatus = key => ALL_AGENT_STATUSES.find(s => s.key === key) || AGENT_STATUSES[0]

const CLOSED_STAGES = ['not_interested', 'unreachable', 'opted_out']

// Which of the five (or Closed) a lead is in for its agent. servicing: the agent's plan includes servicing, so a sale
// isn't done until it's submitted ("Finish servicing details").
export function agentStatusOf(l, { now = SAMPLE_NOW, servicing = true } = {}) {
  if (CLOSED_STAGES.includes(l.stage) || l.reason === 'Wrong number') return 'closed'
  if (needsOutcome(l, now) || agentCallTask(l)) return 'needs_you'
  if (l.stage === 'sold') return servicing && !l.submitted ? 'needs_you' : 'sold'
  if (l.stage === 'follow_up') return 'follow'
  if (l.stage === 'booked') return 'booked'
  return 'on_it' // new, calling, ringing, missed, no_show, rebooking
}

// The one chip on a lead card and drawer: the status, plus a short plain reason where it helps.
export function agentChip(l, opts) {
  const key = agentStatusOf(l, opts)
  const s = agentStatus(key)
  if (key === 'closed') return [s.tone, closedReason(l)]
  if (key === 'needs_you') {
    if (needsOutcome(l, opts?.now || SAMPLE_NOW)) return [s.tone, 'Needs you: mark the outcome']
    if (agentCallTask(l)) return [s.tone, 'Needs you: call them back']
    return [s.tone, 'Needs you: finish servicing details']
  }
  if (key === 'booked' && confirmedByText(l)) return [s.tone, 'Booked · confirmed']
  if (l.stage === 'ringing') return ['warn', 'Live transfer for you']
  return [s.tone, s.label]
}

export function closedReason(l) {
  if (l.stage === 'opted_out') return 'Closed: opted out'
  if (l.stage === 'unreachable') return 'Closed: no answer after the check-ins'
  if (l.reason === 'Wrong number') return 'Closed: wrong number'
  return `Closed: ${(l.reason || 'not interested').toLowerCase()}`
}

// Counts per status for a set of leads (the board, the Overview mix, the head numbers).
export function countByStatus(leads, opts) {
  const out = Object.fromEntries(ALL_AGENT_STATUSES.map(s => [s.key, 0]))
  leads.forEach(l => { out[agentStatusOf(l, opts)] += 1 })
  return out
}

// The agent's timeline: what happened that matters to them. Call attempts and the chase texts are the team's work and
// stay off it; where the lead came from is never shown. Incoming texts, automatic replies and call tasks stay on.
const CHASE = /^not_reached/
const ATTEMPT = /^(Called, try|Calls again)/
export function agentEvents(l) {
  return (l.events || [])
    .filter(e => !(e.kind === 'va_call' && ATTEMPT.test(e.label)))
    .filter(e => !(e.kind === 'text_sent' && CHASE.test(e.step || '')))
    .map(e => {
      if (e.kind === 'came_in') return { ...e, label: 'New lead', by: 'Automatic', role: 'auto' }
      if (e.kind === 'va_call' && /^Called\. Reached them/.test(e.label)) return { ...e, label: 'Our team talked with them' }
      return e
    })
}

export { STAGES }
