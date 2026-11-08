// P845 — the VA side's shared words and colours (no React, so component files only export components).
// Call status → word and card colour (flow.css .is-<tone>): to call = the Booked blue, cancelled = sage (done, paid),
// no answer = apricot (needs a retry), passed on = stone.
export const CALL_WORD = { booked: 'To call', cancelled: 'Cancelled', no_answer: 'No answer', passed: 'Passed on' }
export const CALL_TONE = { booked: 'blue', cancelled: 'green', no_answer: 'warn', passed: 'mute' }

// Queue buckets, in the order a VA works them.
export const BUCKETS = [
  { key: 'callback_due', label: 'Callback due', tone: 'warn', empty: 'No callbacks due.' },
  { key: 'new', label: 'New', tone: 'blue', empty: 'No one new right now.' },
  { key: 'not_reached', label: 'Not reached', tone: 'mute', empty: 'Everyone tried so far was reached.' },
]

// Servicing: what each kind is called, its colour (lib/vaServicing toneOf, same rule), and its closed outcome list.
export const KIND = {
  packet_check: 'Policy packet check', review_call: 'Review call', chargeback_watch: 'Chargeback watch', beneficiary_change: 'Beneficiary change',
  address_change: 'Address change', payment_change: 'Payment change', draft_date_change: 'Draft date change', lapse_save: 'Lapse save',
  annual_review: 'Annual review', claim_help: 'Claim help', carrier_call: 'Carrier call', other: 'Other request',
  welcome_call: 'Welcome call',
}
export function kindTone(kind) {
  if (kind === 'lapse_save' || kind === 'chargeback_watch') return 'warn'
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
}
export const outcomesOf = kind => OUTCOMES[kind] || CHANGE
export const outcomeLabel = (kind, v) => outcomesOf(kind).find(o => o[0] === v)?.[1] || (kind === 'lapse_save' && v === 'lapsed' ? 'Lapsed' : null)
export const SEND_REASONS = ['Coverage question', 'Needs advice', 'Something else']
export const TASK_GROUPS = [
  { key: 'overdue', label: 'Overdue', tone: 'warn', empty: 'Nothing overdue.' },
  { key: 'today', label: 'Due today', tone: 'blue', empty: 'Nothing else due today.' },
  { key: 'later', label: 'Coming up', tone: 'teal', empty: 'Nothing scheduled later.' },
  { key: 'none', label: 'No date yet', tone: 'mute', empty: 'Every step has a date.' },
]

// Pay status → word and colour.
export const PAY_WORD = { verified: ['Verified', 'green', 'Carrier confirmed on the call'], checking: ['Checking', 'blue', 'Being checked · a few minutes'], needs_listen: ['Needs a listen', 'warn', 'Not clear on the call · with the team'] }

// The VA's question checklist before booking (lib/vaQueue CHECKLIST_ITEMS).
export const QUESTION_TYPES = ['Billing or payment', 'Coverage question', 'Claim', 'Change beneficiary', 'Cancel or lapse', 'Other']
export const URGENCIES = ['Today', 'This week', 'Just asking']
export const checklistDone = c => [c.question_type, c.carrier?.trim(), /^[A-Z]{2}$/.test(c.state || '') ? c.state : '', c.urgency].filter(Boolean).length
