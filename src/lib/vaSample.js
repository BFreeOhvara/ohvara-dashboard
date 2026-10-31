// Dev-only sample data for /fulfillment/leads?sample=1 (see leadsPage.js and
// useVaDesk.js). Made-up people, 555 numbers. Kept in memory: nothing is ever
// written. The first lead comes back already held by you, so the page opens the
// checklist the same way a reload does (heldRow). Loaded only from an
// import.meta.env.DEV branch, so production drops it.
const mins = m => new Date(Date.now() + m * 60e3).toISOString()

const lead = (id, contact_name, phone, state, bucket, arrivedMinsAgo, more = {}) => ({
  lead_id: id, lead_type: 'policy_help', contact_name, phone, city: null, state, bucket,
  va_checklist: null, va_attempts: 0, va_callback_at: null, claimed_by_me: false, claim_expires_at: null,
  created_at: mins(-arrivedMinsAgo), ...more,
})

let rows = [
  lead('sample-qualify', 'Jordan Placeholder', '+15550100123', 'TX', 'new', 42, {
    claimed_by_me: true, claim_expires_at: mins(15), va_checklist: { question_type: 'Billing or payment' },
  }),
  lead('sample-2', 'Sam Example', '+15550100124', 'FL', 'callback_due', 300, { va_attempts: 1, va_callback_at: mins(-25) }),
  lead('sample-3', 'Riley Sample', '+15550100125', 'OH', 'new', 6, { lead_type: 'mortgage_protection' }),
  lead('sample-4', 'Casey Madeup', '+15550100126', 'GA', 'not_reached', 540, { va_attempts: 2 }),
]

const ROSTER = [
  { id: 'sample-agent-1', full_name: 'Avery Placeholder' },
  { id: 'sample-agent-2', full_name: 'Morgan Example' },
]

const open = { open: '08:00', close: '20:00' }
const CARRIERS = ['Sample Life', 'Example Mutual'].map((name, i) => ({
  id: `sample-carrier-${i + 1}`, name, aliases: [], sort_rank: i + 1, is_active: true,
  hours: { mon: open, tue: open, wed: open, thu: open, fri: open, sat: open, sun: open },
  hours_tz: 'America/New_York', hours_checked_at: mins(0), hours_status: 'verified',
}))

export const sampleQueue = () => rows.map(r => ({ ...r }))
export const sampleRoster = () => ROSTER.map(a => ({ ...a }))
export const sampleCarriers = () => CARRIERS.map(c => ({ ...c }))

export function sampleClaim(leadId) {
  const expiresAt = mins(15)
  rows = rows.map(r => (r.lead_id === leadId ? { ...r, claimed_by_me: true, claim_expires_at: expiresAt } : r))
  return expiresAt
}

export function sampleRelease(leadId) {
  rows = rows.map(r => (r.lead_id === leadId ? { ...r, claimed_by_me: false, claim_expires_at: null } : r))
}

// Any outcome takes the lead off the sample queue.
export function sampleRecord(leadId) {
  rows = rows.filter(r => r.lead_id !== leadId)
}
