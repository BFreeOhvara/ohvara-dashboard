import { NEW_OUTCOMES } from './bookings.js'
// P845 — the VA side's shared words and colours (no React, so component files only export components).
// Call status → word and card colour (flow.css .is-<tone>): to call = the Booked blue, cancelled = sage (done, paid),
// no answer = apricot (needs a retry), passed on = stone.
export const CALL_WORD = { booked: 'To call', cancelled: 'Cancelled', no_answer: 'No answer', passed: 'Passed on' }
export const CALL_TONE = { booked: 'blue', cancelled: 'green', no_answer: 'warn', passed: 'mute' }


// Servicing: what each kind is called, its colour (lib/vaServicing toneOf, same rule), and its closed outcome list.
export const KIND = {
  packet_check: 'Policy packet check', review_call: 'Review call', chargeback_watch: 'Chargeback watch', beneficiary_change: 'Beneficiary change',
  address_change: 'Address change', payment_change: 'Payment change', draft_date_change: 'Draft date change', lapse_save: 'Lapse save',
  annual_review: 'Annual review', claim_help: 'Claim help', carrier_call: 'Carrier call', other: 'Other request',
  welcome_call: 'Welcome call',
  // P907: the booked call kinds added with "everything moves in bookings".
  handoff_call: 'Hand-off call', name_change: 'Name change', change_request: 'Change request', cancel_request: 'Cancel request', callback: 'Callback',
}
export function kindTone(kind) {
  if (kind === 'lapse_save' || kind === 'chargeback_watch' || kind === 'cancel_request') return 'warn'
  if (kind === 'handoff_call' || kind === 'callback') return 'blue'
  if (kind === 'welcome_call' || kind === 'annual_review' || kind === 'review_call') return 'green'
  if (/_change$/.test(kind) || kind === 'claim_help' || kind === 'carrier_call' || kind === 'other') return 'teal'
  if (kind === 'packet_check') return 'green'
  return 'blue'
}
const CHANGE = [['completed', 'Done'], ['could_not_complete', "Couldn't finish"]]
const CALL = [['completed', 'Completed'], ['not_reached', 'Not reached']]
const OUTCOMES = {
  // P888: the four things a VA hears on a save call (p888 va_servicing_outcome). 'lapsed' is history only.
  lapse_save: [['saved', 'Saved'], ['fixing', 'Fixing it'], ['client_cancelled', 'Wants to cancel'], ['no_answer', 'No answer']],
  packet_check: [['delivered', 'Delivered'], ['not_delivered', 'Not delivered']],
  // P891: a client the agent added (p891 servicing_tasks_outcome_check).
  welcome_call: [['welcomed', 'Welcomed'], ['details_fixed', 'Details fixed'], ['problem', 'Problem → agent'], ['no_answer', 'No answer']],
  review_call: CALL, annual_review: CALL, chargeback_watch: [['on_time', 'Paid on time'], ['missed', 'Missed a payment']],
  ...NEW_OUTCOMES,
}
export const outcomesOf = kind => OUTCOMES[kind] || CHANGE
export const outcomeLabel = (kind, v) => outcomesOf(kind).find(o => o[0] === v)?.[1] || (kind === 'lapse_save' && v === 'lapsed' ? 'Lapsed' : null)
export const SEND_REASONS = ['Coverage question', 'Needs advice', 'Something else']
// P907: every call is booked, so a call step is always Today or Coming up; Overdue and No date are the steps that
// aren't calls (a packet check, a chargeback watch).
export const TASK_GROUPS = [
  { key: 'overdue', label: 'Overdue', tone: 'warn', empty: 'Nothing overdue.' },
  { key: 'today', label: 'Booked today', tone: 'blue', empty: 'Nothing else booked today.' },
  { key: 'later', label: 'Booked later', tone: 'teal', empty: 'Nothing booked later.' },
  { key: 'none', label: 'Not a call', tone: 'mute', empty: 'Every step is a booked call.' },
]

// Pay status → word and colour.
export const PAY_WORD = { verified: ['Verified', 'green', 'Carrier confirmed on the call'], checking: ['Checking', 'blue', 'Being checked · a few minutes'], needs_listen: ['Needs a listen', 'warn', 'Not clear on the call · with the team'] }


