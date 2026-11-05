// P837 — the VA servicing desk's rules (migration 206). No React, no network.
// Rows come from va_servicing_queue(): task_id, policy_id, lead_id, kind, status,
// requested_by, due_at, best_time, outcome, client_name, client_state, carrier,
// agent_name, mine, claim_expires_at, client_phone, note, agent_reply_note (the last
// four only on your own live claim). A VA is unlicensed: outcomes are closed lists,
// and a coverage or advice question goes to the agent.

export const KIND_LABEL = {
  packet_check: 'Policy packet check', review_call: 'Review call', chargeback_watch: 'Chargeback watch',
  beneficiary_change: 'Beneficiary change', address_change: 'Address change', payment_change: 'Payment change',
  draft_date_change: 'Draft date change', lapse_save: 'Lapse save', conversion: 'Conversion',
  annual_review: 'Annual review', claim_help: 'Claim help', carrier_call: 'Carrier call', other: 'Other request',
}
export const kindLabel = k => KIND_LABEL[k] || 'Servicing step'

export const STATUS_LABEL = { requested: 'Requested', scheduled: 'Scheduled', in_progress: 'In progress' }

const CHANGE = [['completed', 'Done'], ['could_not_complete', "Couldn't finish"]]
const CALL = [['completed', 'Completed'], ['not_reached', 'Not reached']]
// One closed list per kind, the server's exact values (206's FRONTEND CONTRACT).
export const OUTCOMES = {
  lapse_save: [['saved', 'Saved'], ['lapsed', 'Lapsed'], ['client_cancelled', 'Client cancelled']],
  packet_check: [['delivered', 'Delivered'], ['not_delivered', 'Not delivered']],
  review_call: CALL, annual_review: CALL, conversion: CALL,
  chargeback_watch: [['on_time', 'Paid on time'], ['missed', 'Missed a payment']],
  beneficiary_change: CHANGE, address_change: CHANGE, payment_change: CHANGE, draft_date_change: CHANGE,
  claim_help: CHANGE, carrier_call: CHANGE, other: CHANGE,
}
export const outcomesOf = kind => OUTCOMES[kind] || CHANGE
export const outcomeLabel = (kind, v) => outcomesOf(kind).find(o => o[0] === v)?.[1] || null

export const SEND_REASONS = [['coverage', 'Coverage question'], ['advice', 'Needs advice'], ['other', 'Something else']]

// Stage tone per kind, the shell's small palette: needs-you work (lapse, chargeback) apricot,
// changes butter (the .is-teal class), calls sky, packets sage.
export function toneOf(kind) {
  if (kind === 'lapse_save' || kind === 'chargeback_watch') return 'warn'
  if (/_change$/.test(kind) || kind === 'claim_help' || kind === 'carrier_call' || kind === 'other') return 'teal'
  if (kind === 'packet_check') return 'green'
  return 'blue'
}

const ms = iso => (iso ? new Date(iso).getTime() : NaN)

// The queue in the order a VA works it: your own live claim first, then overdue, due today,
// later, and no date. Each keeps the server's order (soonest due first).
export function groupTasks(rows, now = Date.now(), endOfToday = now) {
  const out = { mine: [], overdue: [], today: [], later: [], none: [] }
  for (const r of rows || []) {
    const t = ms(r.due_at)
    if (r.mine && ms(r.claim_expires_at) > now) out.mine.push(r)
    else if (Number.isNaN(t)) out.none.push(r)
    else if (t < now) out.overdue.push(r)
    else if (t <= endOfToday) out.today.push(r)
    else out.later.push(r)
  }
  return out
}

export const GROUPS = [
  ['mine', 'Working now', 'Nothing held. Pick a step below to start.'],
  ['overdue', 'Overdue', 'Nothing overdue.'],
  ['today', 'Due today', 'Nothing else due today.'],
  ['later', 'Coming up', 'Nothing scheduled later.'],
  ['none', 'No date yet', 'Every step has a date.'],
]

// Any task held by me, live, at most one per page view.
export const heldTask = (rows, now = Date.now()) => (rows || []).find(r => r.mine && ms(r.claim_expires_at) > now) || null

// What the server's refusal means, in plain words (206's error codes).
export function servicingError(e) {
  const code = e?.code
  if (code === '55006') return 'Another VA is already working this step.'
  if (code === 'P0002') return 'That step is gone. It may have been finished or cancelled.'
  if (code === '42501') return 'Your hold on this step ran out. Take it again to keep going.'
  if (code === '22023') return e?.message || 'That step has moved on. Refresh and try again.'
  if (code === '22004') return 'Fill that in first.'
  return "Couldn't save. Nothing changed."
}

// "Due 3:30 PM", "Due Tue, Nov 10", "Overdue since Mon" in the VA's zone.
export function dueText(iso, now, tz) {
  const t = ms(iso)
  if (Number.isNaN(t)) return 'No date yet'
  const day = d => new Date(d).toLocaleDateString('en-CA', { timeZone: tz })
  const time = new Date(t).toLocaleTimeString('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' })
  if (day(t) === day(now)) return t < now ? `Overdue since ${time}` : `Due ${time}`
  const date = new Date(t).toLocaleDateString('en-US', { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric' })
  return t < now ? `Overdue since ${date}` : `Due ${date}`
}
