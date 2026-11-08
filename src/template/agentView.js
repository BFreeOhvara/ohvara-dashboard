import { STAGES, needsOutcome, confirmedByText, applyMove, clockNow, dayLabel } from './leadLifecycle.js'

// P878 — what an agent sees of a lead (How Ohvara Works, "What each role sees of a lead"). Five statuses, Closed under a
// filter with its reason. Never call attempts, the text sequence or where a lead came from. The VA and admin portals
// keep every stage (leadLifecycle.js STAGES); this file only decides the agent's view of them. Pure, no React.

// P894 — the agent's five statuses, left to right, built around the two ways a lead reaches them: a live transfer or a
// booked appointment. Leads the team is still calling aren't a column: they're one line above the board ("Our team is
// calling 6 new leads"), read-only. "Needs you" is gone as a status: a lead that needs the agent says so on its own
// card ("Mark result" on Booked once the time has passed, the result prompt on Live transfer).
export const AGENT_STATUSES = [
  { key: 'live', label: 'Live transfer', tone: 'warn', empty: 'No live calls right now.', explain: 'You took a live call. Pick how it went.' },
  { key: 'booked', label: 'Booked', tone: 'blue', empty: 'No appointments booked yet.', explain: 'On your calendar. Be there at the time; once it has passed, mark the result.' },
  { key: 'no_show', label: 'No show', tone: 'mute', empty: 'No missed appointments.', explain: 'They didn’t pick up at the booked time. We send them a one-tap link to rebook; when they do, they go back to Booked.' },
  { key: 'follow', label: 'Follow up', tone: 'teal', empty: 'No follow-ups set.', explain: 'You picked a day to try again. We remind you that day.' },
  { key: 'sold', label: 'Sold', tone: 'green', empty: 'Sales you mark show here.', explain: 'Sold. Each one is on Clients as Setting up.' },
]
export const CLOSED_STATUS = { key: 'closed', label: 'Closed', tone: 'mute', empty: 'Nothing closed out.', explain: 'Not interested, or our team couldn’t reach them after the day 30, 60 and 90 check-ins. No more calls or texts.' }
// Not a column: the leads our team is still calling (new, being called, a missed transfer, a rebook after you moved a time).
export const TEAM_STATUS = { key: 'team', label: 'Our team is calling', tone: 'violet', empty: 'No one being called.', explain: 'New leads our team is calling. Nothing for you to do: they land on Live transfer or Booked.' }
export const ALL_AGENT_STATUSES = [...AGENT_STATUSES, CLOSED_STATUS, TEAM_STATUS]
export const agentStatus = key => ALL_AGENT_STATUSES.find(s => s.key === key) || TEAM_STATUS

const CLOSED_STAGES = ['not_interested', 'unreachable', 'opted_out']

// Which of the five (or Closed, or the team's line) a lead is in for its agent. A live call the agent answered
// ('showed' with no appointment) stays on Live transfer until they pick a result; an appointment whose time has passed
// stays on Booked with "Mark result". A sale is Sold whether or not its policy details are in yet.
export function agentStatusOf(l) {
  if (CLOSED_STAGES.includes(l.stage) || l.reason === 'Wrong number') return 'closed'
  if (l.stage === 'ringing' || (l.stage === 'showed' && !l.apptAt)) return 'live'
  if (l.stage === 'booked' || l.stage === 'showed') return 'booked'
  if (l.stage === 'no_show') return 'no_show'
  if (l.stage === 'follow_up') return 'follow'
  if (l.stage === 'sold') return 'sold'
  return 'team' // new, calling, missed, rebooking
}

// ── Results ────────────────────────────────────────────────────────────────────────────────────────────────────
// The results an agent can pick, by status (P894). A no-show goes back to Booked on its own when they rebook
// (leadLifecycle.js rebookLead), never by the agent. Sold and Closed are the end. Answering a ringing live call
// ('showed') is taking the call, not a result.
export const AGENT_RESULTS = {
  live: ['sold', 'follow_up', 'not_interested'],
  booked: ['sold', 'no_show', 'follow_up', 'not_interested'],
  no_show: ['not_interested'],
  follow: ['sold', 'booked', 'not_interested'],
  sold: [], closed: [], team: [],
}
export const RESULT_LABEL = { sold: 'Sold', no_show: 'No show', follow_up: 'Follow up', not_interested: 'Not interested', booked: 'Booked' }
export const resultsFor = l => AGENT_RESULTS[agentStatusOf(l)] || []
export const canMove = (l, stage) => (stage === 'showed' ? l.stage === 'ringing' : resultsFor(l).includes(stage))
// The one way the agent's screens move a lead: refused (throws) unless the move is allowed from its status.
export function agentMove(l, stage, extra = {}, now = clockNow()) {
  if (!canMove(l, stage)) throw new Error(`A lead on ${agentStatus(agentStatusOf(l)).label} can’t be moved to ${RESULT_LABEL[stage] || stage}`)
  return applyMove(l, stage, extra, now)
}
// The lead needs a result from the agent now: a live call they took, or a booked time that has passed.
export const needsResult = (l, now = clockNow()) => (l.stage === 'showed' && !l.apptAt) || needsOutcome(l, now)

// The one chip on a lead card and drawer: the status, plus a short plain reason where it helps.
export function agentChip(l, opts) {
  const key = agentStatusOf(l)
  const s = agentStatus(key)
  if (key === 'closed') return [s.tone, closedReason(l)]
  if (key === 'live') return [s.tone, l.stage === 'ringing' ? 'Live transfer · ringing now' : 'Live transfer · pick the result']
  if (key === 'booked' && needsResult(l, opts?.now || clockNow())) return [s.tone, 'Booked · mark result']
  if (key === 'booked' && confirmedByText(l)) return [s.tone, 'Booked · confirmed']
  if (key === 'sold' && !l.submitted) return [s.tone, 'Sold · add the policy details']
  return [s.tone, s.label]
}

export function closedReason(l) {
  if (l.stage === 'opted_out') return 'Closed: opted out'
  if (l.stage === 'unreachable') return 'Closed: couldn’t reach'
  if (l.reason === 'Wrong number') return 'Closed: wrong number'
  return `Closed: ${(l.reason || 'not interested').toLowerCase()}`
}

// Counts per status for a set of leads (the board, the Overview mix, the team line).
export function countByStatus(leads) {
  const out = Object.fromEntries(ALL_AGENT_STATUSES.map(s => [s.key, 0]))
  leads.forEach(l => { out[agentStatusOf(l)] += 1 })
  return out
}
// The line above the board: "Our team is calling 6 new leads" (null when there are none).
export const teamLine = n => (n ? `Our team is calling ${n} new lead${n === 1 ? '' : 's'}` : null)

// P894: every sold lead is on Clients as Setting up. A sale with no client row yet (its policy details aren't in, or
// the row hasn't synced) shows as a Setting up client made from the lead, its next step "Add the policy details".
const digits10 = p => String(p || '').replace(/\D/g, '').slice(-10)
export function soldLeadClients(leads = [], clients = []) {
  const have = new Set(clients.flatMap(c => [c.id, c.lead_id, digits10(c.client_phone)]).filter(Boolean))
  return leads.filter(l => l.stage === 'sold' && !have.has(l.clientId) && !have.has(l.id) && !have.has(digits10(l.phone))).map(l => {
    const soldAt = [...(l.events || [])].reverse().find(e => e.kind === 'outcome' && /Sold/.test(e.label))?.at || clockNow()
    const sold = dayLabel(soldAt)
    return {
      id: `sold-${l.id}`, lead_id: l.id, fromLead: true, client_first_name: l.first_name, client_last_name: l.last_name, client_phone: l.phone, city: l.city, state: l.state,
      carrier_name: 'To be added', product_name: 'Mortgage protection', product_type: 'mortgage_protection', policy_number: 'To be added', monthly_premium: 0, annual_premium: 0,
      status: 'booked', stage: 'setting_up', note: 'Sold. Add the policy details on Submit and our team takes it from there.', next_step: 'Add the policy details', attention: null, submitted: sold,
      steps: [{ label: 'Sold', at: sold, done: true }, { label: 'Policy details', at: 'Waiting on you', done: false }, { label: 'Packet check', at: 'To be set', done: false }, { label: 'Review call', at: 'To be set', done: false }],
      calls: [], is_sample: !l.real,
    }
  })
}
export const withSoldLeads = (clients = [], leads = []) => [...soldLeadClients(leads, clients), ...clients]

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
