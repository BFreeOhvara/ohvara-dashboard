import { STAGES, needsOutcome, confirmedByText, applyMove, clockNow, dayLabel } from './leadLifecycle.js'
import { followUpSlot, instantOf, zoneOf, minuteOf, dateOf } from '../lib/callSlots.js'

// P878 — what an agent sees of a lead (How Ohvara Works, "What each role sees of a lead"). Five statuses, Closed under a
// filter with its reason. Never call attempts, the text sequence or where a lead came from. The VA and admin portals
// keep every stage (leadLifecycle.js STAGES); this file only decides the agent's view of them. Pure, no React.

// P898 — the agent's five statuses, left to right: Booked · No show · Follow up · Not interested · Sold. Closed
// (Couldn't reach, opted out, wrong number) is never on the agent's side (P924). Leads the team is still calling aren't shown on
// the board at all. A lead that needs the agent says so on its own card ("Mark result").
// P910 — a live call isn't a column either: while it rings and once it connects it's pinned at the top of Leads and
// the Overview (status 'live', liveCalls) with everything the AI collected, until the agent picks Sold, Follow up or
// Not interested. Unmarked after its day, it's also a to-do (leadLifecycle.js needsYouNow).
export const AGENT_STATUSES = [
  { key: 'booked', label: 'Booked', tone: 'blue', empty: 'No appointments booked yet.', explain: 'On your calendar, plus live calls waiting for a result. Once the time has passed, mark the result.' },
  { key: 'no_show', label: 'No show', tone: 'mute', empty: 'No missed appointments.', explain: 'They didn’t pick up at the booked time. We text them a one-tap link to rebook and our team calls to book them again; when they rebook, they go back to Booked.' },
  { key: 'follow', label: 'Follow up', tone: 'teal', empty: 'No follow-ups set.', explain: 'Not sold yet. Your follow-up call is on your calendar; they get a reminder text the day before and that morning.' },
  { key: 'not_interested', label: 'Not interested', tone: 'warn', empty: 'No one said no.', explain: 'They said no. Calls and texts stop. If they change their mind, move them to Follow up.' },
  { key: 'sold', label: 'Sold', tone: 'green', empty: 'Sales you mark show here.', explain: 'Sold. Each one is on Clients as Setting up.' },
]
// P913: No show is grey, Not interested took its apricot, Closed is coral, a live call is Booked's blue (P920: it is a booking that happened right now).
export const CLOSED_STATUS = { key: 'closed', label: 'Closed', tone: 'rose', empty: 'Nothing closed out.', explain: 'Our team couldn’t reach them after the day 30, 60 and 90 check-ins, they opted out, or the number was wrong. No more calls or texts.' }
// P910: pinned above the board, never a column: a transfer ringing now, or one the agent took and hasn't marked.
export const LIVE_STATUS = { key: 'live', label: 'Live call', tone: 'blue', empty: 'No live call right now.', explain: 'A live transfer: tap it during or after the call to pick how it went.' }
// Not on the board: the leads our team is still calling (new, being called, a missed transfer, a rebook after you moved a time).
export const TEAM_STATUS = { key: 'team', label: 'Our team is calling', tone: 'violet', empty: 'No one being called.', explain: 'New leads our team is calling. Nothing for you to do: they land on Booked.' }
export const ALL_AGENT_STATUSES = [...AGENT_STATUSES, CLOSED_STATUS, LIVE_STATUS, TEAM_STATUS]
export const agentStatus = key => ALL_AGENT_STATUSES.find(s => s.key === key) || TEAM_STATUS

const CLOSED_STAGES = ['unreachable', 'opted_out']
// A live transfer the agent took ('showed' with no appointment): pinned until they pick how it went.
export const isLiveCall = l => l.stage === 'showed' && !l.apptAt
// When the live call connected (its transfer row), else when the lead came in.
export const liveAt = l => [...(l.events || [])].reverse().find(e => e.kind === 'transferred')?.at || l.liveAt || l.came || ''
// The pinned live calls: ringing first, then the ones taken and not marked, newest first.
export const liveCalls = (leads = []) => leads.filter(l => l.stage === 'ringing' || isLiveCall(l))
  .sort((a, b) => (b.stage === 'ringing') - (a.stage === 'ringing') || liveAt(b).localeCompare(liveAt(a)))
// What the AI collected on the call, for the live-call card: [label, value] rows with something in them.
export const liveFacts = l => [['Phone', l.phone], ['Age', l.age_band], ['Lives in', [l.city, l.state].filter(Boolean).join(', ')], ['Wants', l.wants], ['Notes', l.note]]
  .filter(([, v]) => v != null && String(v).trim())

// Which of the five (or Closed, Live, or the team's) a lead is in for its agent. A ringing transfer and a live call the
// agent took are Live (pinned, P910); an appointment whose time has passed stays on Booked with "Mark result". A sale
// is Sold whether or not its policy details are in yet. A wrong number is Closed, not Not interested.
export function agentStatusOf(l) {
  if (CLOSED_STAGES.includes(l.stage) || l.reason === 'Wrong number') return 'closed'
  if (l.stage === 'not_interested') return 'not_interested'
  if (l.stage === 'ringing' || isLiveCall(l)) return 'live'
  if (l.stage === 'booked' || l.stage === 'showed') return 'booked'
  if (l.stage === 'no_show') return 'no_show'
  // P913: a follow-up our team owns (the AI or the no-answer cadence) is never on the agent's board.
  if (l.stage === 'follow_up') return l.owner === 'team' ? 'team' : 'follow'
  if (l.stage === 'sold') return 'sold'
  return 'team' // new, calling, missed, rebooking
}

// ── Results ────────────────────────────────────────────────────────────────────────────────────────────────────
// The results an agent can pick (P898). By status; `live` is a live call they took (P910: pinned, not a column; "No
// show" makes no sense for a call that happened). A no-show goes back to Booked on its own when they
// rebook (leadLifecycle.js rebookLead), never by the agent. Not interested can come back to Follow up if they change
// their mind. Sold and Closed are the end. Answering a ringing transfer ('showed') is taking the call, not a result.
export const AGENT_RESULTS = {
  booked: ['sold', 'no_show', 'follow_up', 'not_interested'],
  live: ['sold', 'follow_up', 'not_interested'],
  no_show: ['not_interested'],
  follow: ['sold', 'booked', 'not_interested'],
  not_interested: ['follow_up'],
  sold: [], closed: [], team: [],
}
export const RESULT_LABEL = { sold: 'Sold', no_show: 'No show', follow_up: 'Follow up', not_interested: 'Not interested', booked: 'Booked' }
// The one-line meaning under each choice in the status picker.
export const RESULT_MEANING = {
  sold: 'They bought a policy.',
  no_show: 'They didn’t pick up at the booked time. We text them a link to rebook and our team calls them.',
  follow_up: 'Not sold yet. A follow-up call goes on your calendar.',
  not_interested: 'They don’t want it. Calls and texts stop.',
  booked: 'Back on your calendar for a set time.',
}
// The status each result lands on (its colour in the picker).
export const RESULT_STATUS = { sold: 'sold', no_show: 'no_show', follow_up: 'follow', not_interested: 'not_interested', booked: 'booked' }
// P917: a ringing transfer takes the same results as a taken live call (the agent answers on their phone; the card is
// only for the result).
export const resultsFor = l => (l.stage === 'ringing' || isLiveCall(l) ? AGENT_RESULTS.live : AGENT_RESULTS[agentStatusOf(l)] || [])
export const canMove = (l, stage) => (stage === 'showed' ? l.stage === 'ringing' : resultsFor(l).includes(stage))
// The one way the agent's screens move a lead: refused (throws) unless the move is allowed from its status.
export function agentMove(l, stage, extra = {}, now = clockNow()) {
  if (!canMove(l, stage)) throw new Error(`A lead on ${agentStatus(agentStatusOf(l)).label} can’t be moved to ${RESULT_LABEL[stage] || stage}`)
  return applyMove(l, stage, extra, now)
}
// The lead needs a result from the agent now: a live call they took, or a booked time that has passed.
export const needsResult = (l, now = clockNow()) => isLiveCall(l) || needsOutcome(l, now)

// P898: the follow-up day, picked inline: the next ten weekdays from today on the agent's clock (P910: optional; with
// none the system picks, followUpPick).
export function followDays(now = clockNow(), n = 10) {
  const out = []
  let d = new Date(`${now.slice(0, 10)}T12:00:00Z`)
  while (out.length < n) {
    d = new Date(d.getTime() + 86400000)
    if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue
    const at = `${d.toISOString().slice(0, 10)}T09:00`
    out.push({ at, label: dayLabel(at) })
  }
  return out
}

// The one chip on a lead card and drawer: the status, plus a short plain reason where it helps.
export function agentChip(l, opts) {
  const key = agentStatusOf(l)
  const s = agentStatus(key)
  if (key === 'closed') return [s.tone, closedReason(l)]
  if (l.stage === 'ringing') return [s.tone, 'Live call · ringing now']
  if (isLiveCall(l)) return [s.tone, 'Live call · pick the result']
  if (key === 'booked' && needsResult(l, opts?.now || clockNow())) return [s.tone, 'Booked · mark result']
  if (key === 'booked' && confirmedByText(l)) return [s.tone, 'Booked · confirmed']
  if (key === 'not_interested') return [s.tone, notInterestedLine(l)]
  if (key === 'sold' && !l.submitted) return [s.tone, 'Sold · add the policy details']
  return [s.tone, s.label]
}

export function closedReason(l) {
  if (l.stage === 'opted_out') return 'Closed: opted out'
  if (l.stage === 'unreachable') return 'Closed: couldn’t reach'
  if (l.reason === 'Wrong number') return 'Closed: wrong number'
  return `Closed: ${(l.reason || 'not interested').toLowerCase()}`
}

// Counts per status for a set of leads (the board, the Overview mix).
export function countByStatus(leads) {
  const out = Object.fromEntries(ALL_AGENT_STATUSES.map(s => [s.key, 0]))
  leads.forEach(l => { out[agentStatusOf(l)] += 1 })
  return out
}

// P918: a client always has a draft date. A sold lead not yet submitted (no client row with a draft date) isn't a
// client card: it's a to-do, "Finish submitting {name}'s policy" (leadLifecycle.js needsYouNow), until Submit is done.
const digits10 = p => String(p || '').replace(/\D/g, '').slice(-10)
export const hasDraftDay = c => c.draft_day != null && c.draft_day !== ''
export function unsubmittedSales(leads = [], clients = []) {
  const have = new Set(clients.filter(hasDraftDay).flatMap(c => [c.id, c.lead_id, digits10(c.client_phone)]).filter(Boolean))
  return leads.filter(l => l.stage === 'sold' && !have.has(l.clientId) && !have.has(l.id) && !have.has(digits10(l.phone)))
}
export const clientCards = (clients = []) => clients.filter(hasDraftDay)

// The agent's timeline: what happened that matters to them. Call attempts and the chase texts are the team's work and
// stay off it; where the lead came from is never shown. Incoming texts, automatic replies and call tasks stay on.
const CHASE = /^(not_reached|na_)/ // P902: the no-answer flow's texts (leadFlows.js na_*)
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

// P929 — no reason for Not interested: the card and the drawer say "Not interested · {date}" (the day it was marked).
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export function notInterestedOn(l) {
  const at = l.niAt || [...(l.events || [])].reverse().find(e => /not interested/i.test(`${e.label || ''} ${e.stage || ''}`) || e.stage === 'not_interested')?.at || l.updated_at || ''
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(at)
  return m ? `${MON[Number(m[2]) - 1]} ${Number(m[3])}` : null
}
export const notInterestedLine = l => { const d = notInterestedOn(l); return d ? `Not interested · ${d}` : 'Not interested' }

// P929 — the lead's Messages: only the texts actually sent to and received from them, oldest first. No planned
// reminders ("morning of"), nothing skipped, no status changes or call tasks.
export function leadMessages(l, now = clockNow()) {
  const t = v => { const d = Date.parse(v || ''); return Number.isNaN(d) ? null : d }
  const at = t(now)
  return (l.events || []).filter(e => (e.kind === 'text_sent' || e.kind === 'text_received')
    && e.text && e.state !== 'scheduled' && e.state !== 'skipped' && e.state !== 'cancelled'
    && (at == null || t(e.at) == null || t(e.at) <= at))
}

export { STAGES }

// ── Follow up (P910) ───────────────────────────────────────────────────────────────────────────────────────────
// The follow-up is the agent's own call, on their calendar: the day and time they picked, or the system's pick (the
// lead's best window on the lead's clock, else afternoon; inside the agent's hours; 30 minutes clear of every other
// booked call). appts = the agent's calendar ([{ id, iso }]); settings = { timeZone, week }. Returns callSlots
// followUpSlot's { iso, clock, date, window, inWindow, picked? } plus `at`, the slot on the agent's clock.
const pad2 = n => String(n).padStart(2, '0')
const wallClock = w => { const [h, m] = w.slice(11, 16).split(':').map(Number); return `${h % 12 || 12}:${pad2(m)} ${h < 12 ? 'AM' : 'PM'}` }
export function followUpPick(lead, { appts = [], settings = {}, date = null, time = null, now = clockNow() } = {}) {
  const tz = settings.timeZone || 'America/Chicago'
  // A picked time is on the agent's clock; the system's pick reads the lead's window on the lead's clock.
  const slot = followUpSlot({ from: instantOf(now.slice(0, 10), wallClock(now), tz), window: lead.best_time, date, exact: date && time ? time : null,
    leadTz: date && time ? tz : zoneOf(lead.state, lead.city), agentTz: tz, week: settings.week || null, appts: appts.filter(a => a.iso && !(a.ref === lead.id && /follow/i.test(a.label || ''))) })
  if (!slot) return null
  const [hh, mm] = [Math.floor(minuteOf(slot.iso, tz) / 60), minuteOf(slot.iso, tz) % 60]
  return { ...slot, at: `${dateOf(slot.iso, tz)}T${pad2(hh)}:${pad2(mm)}` }
}
