import { zonedTimeToUtcIso, DEFAULT_TIMEZONE } from './timezones.js'
import { hasServicingOf } from './overviewBook.js'
import { dateText, timeText, firstName, phoneDisplay } from './inbounds.js'

// What the lead page needs to record Follow up, Not interested and Sold (migration 210
// lead_outcomes, not applied yet). No React, no Supabase: `node --test src/lib/leadOutcomes.test.js`.
//
//   rpc set_inbound_outcome(p_lead, p_outcome, p_note, p_follow_up_at, p_reason)
//   agent_inbounds() also returns follow_up_at, outcome_reason, follow_up_due
//
// Until 210 is applied the old three-argument function is the one in the database: Sold keeps
// working because it sends only the old arguments, and the other two come back "function not
// found", which the page turns into a plain note.

export const REASON_MAX = 500

// The function (or the new arguments) isn't in the database yet. PostgREST says PGRST202,
// Postgres says 42883.
export const isOutcomeMissing = e => !!e && ['PGRST202', '42883', 'PGRST205', '42P01'].includes(e.code)

// The database's own 22023 messages are written for the agent ("Pick a follow up date in the
// future"); anything else gets the generic line.
export const outcomeErrorText = e =>
  e?.code === '22023' && e.message ? e.message : null

// The arguments for one save. Sold sends only what the old function knows, so it works before
// and after the migration; Follow up and Not interested add their one extra argument.
export function outcomeArgs(leadId, { outcome, note, followUpAt, reason }) {
  const args = { p_lead: leadId, p_outcome: outcome, p_note: note ?? null }
  if (outcome === 'follow_up') args.p_follow_up_at = followUpAt
  if (outcome === 'not_interested') args.p_reason = String(reason ?? '').trim()
  return args
}

// ── Follow up date ───────────────────────────────────────────────────────────
// The picker is a datetime-local in the agent's own zone. Returns { iso } or { error }.
export function checkFollowUp(local, tz, nowMs = Date.now()) {
  if (!local) return { error: 'Pick a date and time for the follow up.' }
  const iso = zonedTimeToUtcIso(local, tz || DEFAULT_TIMEZONE)
  if (!iso || Number.isNaN(new Date(iso).getTime())) return { error: 'Pick a date and time for the follow up.' }
  if (new Date(iso).getTime() <= nowMs) return { error: 'Pick a follow up time in the future.' }
  return { iso }
}

// "Follow up Nov 4 at 2:00 PM"
export const followUpLine = (iso, tz) => (iso ? `Follow up ${dateText(iso, tz)} at ${timeText(iso, tz)}` : '')

export const isFollowUpDue = l => l?.follow_up_due === true

// ── Not interested reason ────────────────────────────────────────────────────
export function checkReason(text) {
  const t = String(text ?? '').trim()
  if (!t) return { error: 'Say why they are not interested.' }
  if (t.length > REASON_MAX) return { error: `Keep the reason to ${REASON_MAX} characters.` }
  return { reason: t }
}

// The line shown after a save, or for an outcome the lead already has.
export function savedLine(outcome, { at, followUpAt, reason } = {}, tz) {
  if (outcome === 'follow_up') return followUpAt ? followUpLine(followUpAt, tz) : 'Marked Follow up'
  if (outcome === 'not_interested') return reason ? `Not interested: ${reason}` : 'Marked Not interested'
  if (outcome === 'sold') return `Marked Sold${at ? ` at ${timeText(at, tz)}` : ''}`
  return ''
}

// ── Sold, then Submit for servicing ──────────────────────────────────────────
// The button shows only for an agent whose account has Servicing (the rule the Overview and
// Submit use: has_servicing is off only when it is exactly false) or one that is comped.
export const canSubmitForServicing = profile => !!profile && (profile.billing_exempt === true || hasServicingOf(profile))

// Only the lead id travels in the URL: no name, phone or state.
export const submitForServicingPath = leadId => `/agent/submit?kind=deal&lead=${encodeURIComponent(leadId)}`

// The agent's own lead for an id, or null. The list is agent_inbounds(), which the database
// limits to the signed-in agent, so another agent's id (or a made-up one) finds nothing.
export const leadById = (list, id) => (id && Array.isArray(list) ? list.find(l => l?.lead_id === id) || null : null)

// Client fields for the deal form from a lead. Still editable on the form. Phone comes
// formatted like the form's own field, state as a two-letter code.
export function dealPrefill(lead) {
  if (!lead) return null
  const full = String(lead.contact_name || '').trim().replace(/\s+/g, ' ')
  const first = firstName(full)
  const last = full.slice(first.length).trim()
  const phone = phoneDisplay(lead.phone) || ''
  const state = /^[A-Za-z]{2}$/.test(lead.state || '') ? lead.state.toUpperCase() : ''
  return { first, last, phone, city: String(lead.city || '').trim(), state }
}
