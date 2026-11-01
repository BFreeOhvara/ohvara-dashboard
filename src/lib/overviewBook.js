import { DEFAULT_TIMEZONE, zonedDateStr, zonedTimeToUtcIso } from './timezones.js'

// Overview data layer: the pure rules behind useOverviewBook (src/hooks/useOverviewBook.js).
// No React, no Supabase: everything here takes rows and returns plain objects, so
// `npm run test:unit` covers it (src/lib/overviewBook.test.js).
//
// Read only. Nothing here decides a client's stage: agent_clients (migration 193) does,
// and this file only counts the key it returns.

// ── Missing sources ──────────────────────────────────────────────────────────
// Until migration 193 is applied the agent_clients view does not exist. Postgres says
// 42P01 (undefined_table), PostgREST says PGRST205 (not in the schema cache), and a bare
// HTTP 404 is the same thing from the gateway. 42703 is an undefined column (servicing_tasks.outcome).
export const MISSING_RELATION_CODES = ['42P01', 'PGRST205']
export const isMissingRelation = (error, status) =>
  !!error && (MISSING_RELATION_CODES.includes(error.code) || status === 404 || error.status === 404 || error.code === '404')
export const isMissingColumn = error => !!error && error.code === '42703'

// ── Days and weeks (agent's profile zone, Monday to Sunday) ───────────────────
// Same rules as src/pages/agent/Overview.jsx (Prompt 768): days are YYYY-MM-DD strings in the
// agent's zone, weeks start Monday. scheduling.js can't be imported by node:test (extensionless
// imports), so addDaysStr is mirrored here.
export function addDaysStr(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d + n))
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`
}
export const dowOf = day => (new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7 // Mon = 0
export const dayStartMs = (day, tz) => new Date(zonedTimeToUtcIso(`${day}T00:00`, tz)).getTime()

// { today, thisMonday, lastMonday, lastWeekDays[7] (Monday..Sunday), lastWeekStartMs, thisWeekStartMs }
export function weekBounds(nowMs, tz) {
  const zone = tz || DEFAULT_TIMEZONE
  const today = zonedDateStr(nowMs, zone)
  const thisMonday = addDaysStr(today, -dowOf(today))
  const lastMonday = addDaysStr(thisMonday, -7)
  return {
    tz: zone,
    today,
    thisMonday,
    lastMonday,
    lastWeekDays: Array.from({ length: 7 }, (_, i) => addDaysStr(lastMonday, i)),
    thisWeekStartMs: dayStartMs(thisMonday, zone),
    lastWeekStartMs: dayStartMs(lastMonday, zone),
  }
}

// ── Book (agent_clients) ─────────────────────────────────────────────────────
// One row per client, with a `stage` key: ended, needs_attention, setting_up, ongoing, protected.
// "Ongoing" (12 months past the anchor) counts UNDER Protected: those clients are still looked
// after and nothing is wrong, and the Overview has no fifth box for them. "Ended" counts nowhere.
// requestsOpen is the number of CLIENTS with at least one open request (open_requests > 0), the
// same thing the Clients page's "Requests open" chip lists, so the box and the click-through agree.
export const BOOK_COLS = 'stage, open_requests'

export const bookUnavailable = () => ({
  available: false, protected: null, settingUp: null, needsAttention: null, requestsOpen: null,
})

export function bookFromRows(rows) {
  const out = { available: true, protected: 0, settingUp: 0, needsAttention: 0, requestsOpen: 0 }
  for (const r of rows || []) {
    if (r.stage === 'protected' || r.stage === 'ongoing') out.protected++
    else if (r.stage === 'setting_up') out.settingUp++
    else if (r.stage === 'needs_attention') out.needsAttention++
    if (r.stage !== 'ended' && Number(r.open_requests) > 0) out.requestsOpen++
  }
  return out
}

// ── Submissions (agent_weekly_usage row) ─────────────────────────────────────
// cap is null for an uncapped agent. resetsAt is usage.week_end (an ISO timestamp, or null).
export function submissionsFromUsage(usage) {
  if (!usage) return { used: null, cap: null, resetsAt: null }
  return { used: usage.used ?? 0, cap: usage.weekly_cap ?? null, resetsAt: usage.week_end ?? null }
}

// ── Steps ────────────────────────────────────────────────────────────────────
// The kinds migration 193's agent_submit_service_request accepts are REQUESTS. Every other kind
// is a step Fulfillment or the system works. chargeback_watch is a step, but its due_at is the
// end of a 12 month watch, so it never reads as "due soon".
export const REQUEST_KINDS = [
  'beneficiary_change', 'address_change', 'payment_change', 'draft_date_change',
  'lapse_save', 'claim_help', 'carrier_call',
]
export const OPEN_STATUSES = ['requested', 'scheduled', 'in_progress']
const isStep = t => !REQUEST_KINDS.includes(t.kind) && t.kind !== 'chargeback_watch'

const fullName = p => [p?.client_first_name, p?.client_last_name].filter(Boolean).join(' ')

// Name for a task: its policy's client, else its lead's contact name, else "Client".
// `policies` is Map(policy id -> row with client_first_name / client_last_name),
// `leads` is Map(lead id -> row with contact_name).
export function clientNameOf(task, { policies, leads } = {}) {
  const fromPolicy = task.policy_id ? fullName(policies?.get(task.policy_id)) : ''
  if (fromPolicy) return fromPolicy
  const fromLead = task.lead_id ? (leads?.get(task.lead_id)?.contact_name || '').trim() : ''
  return fromLead || 'Client'
}

// Open steps that have a due_at, soonest first (overdue ones lead). Cancelled and done tasks,
// requests, chargeback_watch and tasks with no due_at are left out.
// -> [{ id, kind, label, dueAt, overdue, status, clientName, policyId, leadId }]
export function dueSoonSteps(tasks, { policies, leads, labels = {}, nowMs = Date.now(), limit = 10 } = {}) {
  return (tasks || [])
    .filter(t => t.due_at && OPEN_STATUSES.includes(t.status) && isStep(t))
    .sort((a, b) => new Date(a.due_at) - new Date(b.due_at))
    .slice(0, limit)
    .map(t => ({
      id: t.id,
      kind: t.kind,
      label: labels[t.kind] || t.kind,
      dueAt: t.due_at,
      overdue: new Date(t.due_at).getTime() < nowMs,
      status: t.status,
      clientName: clientNameOf(t, { policies, leads }),
      policyId: t.policy_id || null,
      leadId: t.lead_id || null,
    }))
}

// Last Monday to Sunday, always 7 entries: { date: 'YYYY-MM-DD', packet_check, review_call,
// cancellation, save, total }.
//   packet_check, review_call  servicing_tasks with status done and a done_at on that day
//   cancellation               policy rows the old policy was confirmed cancelled on
//                              (isCancelled(p) and fulfillment_completed_at), as Overview.jsx counts
//   save                       lapse_save tasks with outcome = 'saved' (`saves`: [{ done_at }]);
//                              pass null when the outcome column can't be read (counts as 0)
// Cancelled tasks never count. `tasks` and `policies` null (a failed source) gives null counts,
// never zeros.
export function doneByDay({ tasks, policies, saves, nowMs = Date.now(), tz, isCancelled }) {
  const { lastWeekDays } = weekBounds(nowMs, tz)
  const zone = tz || DEFAULT_TIMEZONE
  const dayOf = iso => (iso ? zonedDateStr(new Date(iso).getTime(), zone) : null)
  const countTasks = (kind, day) => (tasks == null ? null : tasks.filter(t =>
    t.kind === kind && t.status === 'done' && dayOf(t.done_at) === day).length)
  return lastWeekDays.map(date => {
    const packet_check = countTasks('packet_check', date)
    const review_call = countTasks('review_call', date)
    const cancellation = policies == null ? null : policies.filter(p =>
      isCancelled(p) && p.fulfillment_completed_at && dayOf(p.fulfillment_completed_at) === date).length
    const save = (saves || []).filter(s => dayOf(s.done_at) === date).length
    const parts = [packet_check, review_call, cancellation]
    return {
      date, packet_check, review_call, cancellation, save,
      total: parts.some(n => n == null) ? null : parts.reduce((a, b) => a + b, 0) + save,
    }
  })
}

// ── Plan flags ───────────────────────────────────────────────────────────────
// hasLeads: the agent pays for Leads (profiles.leads_weekly_cents > 0, migration 190) or has any
// inbound already, so a paused Leads buyer keeps today's appointments. get_my_profile() is
// `select * from profiles`, so the column comes back once 190 is applied; before that it is
// undefined, which means unknown: fall back to the inbounds check alone.
export function hasLeadsOf(profile, inbounds) {
  if (Number(profile?.leads_weekly_cents) > 0) return true
  return (inbounds || []).length > 0
}
// Same pattern as Submit.jsx: only an explicit false turns Servicing off.
export const hasServicingOf = profile => profile?.has_servicing !== false
