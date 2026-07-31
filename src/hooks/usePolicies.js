import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

// The pipeline behind My Policies / Submissions (Prompt 326, migration 072).
//
// Scope is enforced by RLS (policies_select → can_view_agent), not by these
// queries: an agent always reads their own book plus their downline's, admin
// reads everything. `agentId` here narrows to ONE agent's rows on top of that
// — it's a filter, not the security boundary.

export const POLICY_STATUSES = [
  'Follow-up',
  'Not Interested',
  'Submitted',
  'In Effect',
  'Undrafted',
  'Not Approved',
  'Lapsed',
]

export const CANCELLATION_STATUSES = [
  'Cancellation Pending',
  'Cancellation Complete',
]

// Pre-submission outcomes have no data source until live-call handling is
// wired in (North Star "Pipeline Status Model") — the filter chips still
// offer them so the day that lands, nothing needs rebuilding.
export const PRE_SUBMISSION_STATUSES = ['Follow-up', 'Not Interested']

// Statuses that represent a real policy record (Prompt 345). Follow-up and
// Not Interested are pre-submission call outcomes, not policies — they live
// on My Calls → Schedule / nowhere, respectively — so My Policies and its
// edit controls restrict to these three everywhere they touch status.
export const LIVE_POLICY_STATUSES = POLICY_STATUSES.filter(s => !PRE_SUBMISSION_STATUSES.includes(s))

// Terminal "something went wrong, agent needs to follow up" outcomes (Prompt
// 369) — held out of My Policies' main list into the new Needs Follow-up
// tab, same three-way split as PRE_SUBMISSION_STATUSES above.
export const NEEDS_FOLLOWUP_STATUSES = ['Undrafted', 'Not Approved', 'Lapsed']

// What actually shows in My Policies' default list: a real, still-live
// policy that hasn't fallen into Needs Follow-up.
export const ACTIVE_LIST_STATUSES = LIVE_POLICY_STATUSES.filter(s => !NEEDS_FOLLOWUP_STATUSES.includes(s))

const SELECT = `
  id, agent_id, policy_sold_date, policy_number,
  client_first_name, client_last_name, client_phone,
  carrier_id, carrier_name, product_type, product_name, insurance_type, state,
  effective_date, monthly_premium, annual_premium,
  status, cancellation_status, cancellation_call_at,
  effectuation_answered_at, pending_underwriting, next_lapse_check_at, archived_at,
  notes, created_at, updated_at,
  agent:profiles!policies_agent_id_fkey ( id, full_name )
`

// `agentId: null` means "everything RLS lets me see" — used by the admin
// company-wide view and by an agent looking at their team's book.
export function usePolicies(agentId = null) {
  return useQuery({
    queryKey: ['policies', agentId ?? 'visible'],
    queryFn: async () => {
      let q = supabase.from('policies').select(SELECT).order('created_at', { ascending: false })
      if (agentId) q = q.eq('agent_id', agentId)
      const { data, error } = await q
      if (error) throw error
      return data || []
    },
  })
}

// Company-wide, non-PII policy rows for Performance's Team scope + Leaderboard
// (Prompt 396, migration 093). RLS's policies_select correctly limits
// usePolicies(null) to self + downline for a closer (everything for admin
// only) — Team/Leaderboard need the same company-wide view for every role,
// so they read from this SECURITY DEFINER RPC instead. It returns only the
// fields those two features aggregate (no client name/phone/policy number/
// carrier/product), so opening it to every authenticated user can't leak
// individual client PII the way loosening policies_select would.
export function useTeamPerformancePolicies() {
  return useQuery({
    queryKey: ['policies', 'team-performance'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('team_performance_policies')
      if (error) throw error
      return data || []
    },
  })
}

export function useCreatePolicy() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (fields) => {
      // annual_premium is a generated column — never sent from the client
      // (Round 33: auto-computed, not manually entered).
      const { annual_premium, ...insertable } = fields
      const { data, error } = await supabase.from('policies').insert(insertable).select().single()
      if (error) throw error
      return data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['policies'] }),
  })
}

export function useUpdatePolicy() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...fields }) => {
      const { annual_premium, agent, ...updatable } = fields
      const { data, error } = await supabase.from('policies').update(updatable).eq('id', id).select().single()
      if (error) throw error
      return data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['policies'] }),
  })
}

export function useDeletePolicy() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id) => {
      const { error } = await supabase.from('policies').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['policies'] }),
  })
}

// "Still on the book" (lapse check-in, Yes): advances next_lapse_check_at by
// one calendar month, same day-of-month as effective_date. Day-of-month
// clamping for short months lives in the DB function (migration 085), not
// duplicated here in JS.
export function useAdvanceLapseCheck() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id) => {
      const { error } = await supabase.rpc('advance_policy_lapse_check', { p_id: id })
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['policies'] }),
  })
}

// "Back on the books" for a Lapsed row (Needs Follow-up tab): reinstates to
// In Effect and resets the check-in to the next future occurrence from
// today (migration 085's reactivate_lapsed_policy).
export function useReactivateLapsedPolicy() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id) => {
      const { error } = await supabase.rpc('reactivate_lapsed_policy', { p_id: id })
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['policies'] }),
  })
}

// Rows the effective-date prompt should fire on: submitted, effective date
// has arrived, and the agent hasn't answered "did this go into effect?" yet
// (Round 46). Answering stamps effectuation_answered_at so it never re-asks.
// Excludes pending_underwriting rows (Prompt 369) — a policy still awaiting
// a carrier decision shouldn't also be asked whether it went into effect.
export function pendingEffectuation(policies, today = new Date()) {
  const cutoff = today.toISOString().slice(0, 10)
  return (policies || []).filter(p =>
    p.status === 'Submitted' &&
    !p.pending_underwriting &&
    p.effective_date &&
    p.effective_date <= cutoff &&
    !p.effectuation_answered_at
  )
}

// Ongoing (non-date-gated) underwriting-decision banner (Prompt 369): fires
// for any Submitted policy still waiting on a carrier decision, no matter
// how far off its effective date is.
export function pendingUnderwriting(policies) {
  return (policies || []).filter(p => p.status === 'Submitted' && p.pending_underwriting)
}

// Recurring monthly lapse check-in (Prompt 369): In Effect policies whose
// next_lapse_check_at has arrived.
export function pendingLapseCheck(policies, today = new Date()) {
  const cutoff = today.toISOString().slice(0, 10)
  return (policies || []).filter(p =>
    p.status === 'In Effect' &&
    p.next_lapse_check_at &&
    p.next_lapse_check_at.slice(0, 10) <= cutoff
  )
}

// ── Derived book-of-business numbers (Overview + Stats) ──────────────────────
// Annualized Premium is the industry's unit of account here, not raw revenue.
// Active AP counts only policies actually in force; Submitted AP counts what
// went in, regardless of outcome. Kept as one function so Overview and any
// later Stats build can never drift apart.
export function bookMetrics(policies, { month } = {}) {
  const rows = policies || []
  const inMonth = (d) => {
    if (!month || !d) return true
    return d.slice(0, 7) === month
  }

  const active = rows.filter(p => p.status === 'In Effect')
  const submittedThisMonth = rows.filter(p => inMonth(p.policy_sold_date || p.created_at?.slice(0, 10)))

  const ap = list => list.reduce((s, p) => s + Number(p.annual_premium || 0), 0)
  const submittedCount = submittedThisMonth.length
  const inEffectCount = submittedThisMonth.filter(p => p.status === 'In Effect').length

  return {
    activeAP: ap(active),
    submittedAP: ap(submittedThisMonth),
    policiesActive: active.length,
    averagePremium: active.length
      ? active.reduce((s, p) => s + Number(p.monthly_premium || 0), 0) / active.length
      : 0,
    // Placed rate: of what was submitted in the window, how much actually
    // went into force. Undrafted rows are the denominator's failures.
    placedRate: submittedCount ? (inEffectCount / submittedCount) * 100 : 0,
    pendingCancellations: rows.filter(p => p.cancellation_status === 'Cancellation Pending').length,
  }
}

// ── Performance · Production tab metrics (Prompt 348) ────────────────────────
// Snapshot metrics read the book "as of" a date — a cumulative state, not an
// activity count inside a window. Flow metrics aggregate real activity that
// happened between periodStart and periodEnd. Split confirmed with Brayden
// 2026-07-26: Active AP, Policies Active and Fall-off Rate are snapshot;
// Submitted AP, Issued AP and Average Premium are flow. Early Cancellation
// Rate (Prompt 389, replacing the old flow-based Approval Rate) is snapshot
// too — its own formula has no window/submitted-in-period term at all, it's
// a ratio over the whole book as of a date, same shape as Fall-off Rate.
//
// There's no status-history table — the schema only has each policy's
// CURRENT status/cancellation_status, not when it changed. "As of a past
// date" is approximated by gating on effective_date <= asOf against those
// current fields (a policy already issued by that date, read with today's
// status). That can't detect a policy that was active on asOf and has since
// lapsed as of a LATER asOf query, or vice versa mid-window — acceptable
// given the book is small and young; flagged here rather than silently
// treated as exact.
export function productionSnapshot(policies, asOf) {
  const rows = (policies || []).filter(p => p.effective_date && p.effective_date <= asOf)
  const active = rows.filter(p => p.status === 'In Effect')
  // Prompt 369: a policy stops being active either via the 3-way-call
  // cancellation flow OR by lapsing (non-payment, no call involved) — both
  // count as fall-off.
  const cancelled = rows.filter(p => p.cancellation_status === 'Cancellation Complete' || p.status === 'Lapsed')
  const ap = list => list.reduce((s, p) => s + Number(p.annual_premium || 0), 0)

  const withBothDates = rows.filter(p => p.policy_sold_date && p.effective_date)
  const avgDaysToIssue = withBothDates.length
    ? withBothDates.reduce((s, p) => s + daysBetween(p.policy_sold_date, p.effective_date), 0) / withBothDates.length
    : null

  // Prompt 385: of policies that cleared underwriting (migration 085's
  // Undrafted status only exists for a policy that got that far), what
  // fraction actually got a first premium draft to succeed. In Effect and
  // Lapsed both had a successful first draft at some point (Lapsed just
  // stopped paying later, which is fall-off, not a draft failure) — only
  // Undrafted represents a draft that never went through. Excludes anything
  // that never reached "approved" (Submitted, Not Approved, etc.) since
  // those never attempted a draft at all — same snapshot scope as
  // fallOffRate above, not a window-based flow metric.
  const draftEligible = rows.filter(p => p.status === 'In Effect' || p.status === 'Lapsed' || p.status === 'Undrafted')
  const draftedOk = draftEligible.filter(p => p.status === 'In Effect' || p.status === 'Lapsed')

  // Prompt 389: replaces Approval Rate in the bottom stat row. ~90% of
  // policies get an instant approve/decline at point of sale — Not Approved
  // is too small a sample to be a meaningful metric on a real book.
  // Cancellations are reliably tracked (the whole Cancellation Calendar
  // workflow exists for this), so this reads "of policies either in force or
  // that ever entered the cancellation flow, how many cancelled within
  // roughly a free-look window of going into effect" — a quality-of-sale
  // signal instead. Flat 30-day cutoff is a stated approximation: real
  // free-look periods run 10-30 days and vary by state, and there's no
  // per-state table in this schema to look that up precisely.
  const cancellationEligible = rows.filter(p => p.status === 'In Effect' || p.cancellation_status)
  const earlyCancelled = rows.filter(p => {
    if (!p.cancellation_status || !p.cancellation_call_at || !p.effective_date) return false
    return daysBetween(p.effective_date, p.cancellation_call_at.slice(0, 10)) <= 30
  })

  return {
    activeAP: ap(active),
    policiesActive: active.length,
    // Ratio against the whole issued book up to this date, not a count within
    // a window — Brayden's own framing for why this sits on the snapshot side.
    fallOffRate: rows.length ? (cancelled.length / rows.length) * 100 : null,
    avgDaysToIssue,
    firstPremiumAppliedRate: draftEligible.length ? (draftedOk.length / draftEligible.length) * 100 : null,
    earlyCancellationRate: cancellationEligible.length ? (earlyCancelled.length / cancellationEligible.length) * 100 : null,
  }
}

function daysBetween(a, b) {
  return Math.round((new Date(`${b}T00:00:00`) - new Date(`${a}T00:00:00`)) / 86400000)
}

export function productionFlow(policies, periodStart, periodEnd) {
  const rows = policies || []
  const inPeriod = d => !!d && d >= periodStart && d <= periodEnd
  const submitted = rows.filter(p => inPeriod(p.policy_sold_date || p.created_at?.slice(0, 10)))
  const issued = rows.filter(p => p.status === 'In Effect' && inPeriod(p.effective_date))
  const ap = list => list.reduce((s, p) => s + Number(p.annual_premium || 0), 0)

  return {
    submittedAP: ap(submitted),
    submittedCount: submitted.length,
    issuedAP: ap(issued),
    issuedCount: issued.length,
    avgMonthlyPremium: submitted.length
      ? submitted.reduce((s, p) => s + Number(p.monthly_premium || 0), 0) / submitted.length
      : 0,
  }
}

// ── Persistency (Prompt 348) ─────────────────────────────────────────────────
// Cohort persistency: for a reporting month `mk` and a window of N months,
// the cohort is every policy that went into effect N months before `mk` — old
// enough to have crossed that window by the reporting month. Persistency is
// what fraction of that cohort is still in force (not cancelled) today, read
// off the same current-status fields productionSnapshot uses (same caveat:
// no history table, so this is "still in force now," not "was in force
// exactly N months after issue").
const PERSISTENCY_WINDOWS = [
  { window: '30-day', months: 1 },
  { window: '3-month', months: 3 },
  { window: '6-month', months: 6 },
  { window: '12-month', months: 12 },
]

function shiftMonth(mk, n) {
  const [y, m] = mk.split('-').map(Number)
  const d = new Date(y, m - 1 - n, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function cohortPersistency(policies, cohortMonth) {
  const rows = (policies || []).filter(p => (p.effective_date || '').slice(0, 7) === cohortMonth)
  if (!rows.length) return null
  return (rows.filter(p => p.status === 'In Effect').length / rows.length) * 100
}

function avg(vals) {
  return vals.length ? Math.round(vals.reduce((s, v) => s + v, 0) / vals.length) : null
}

// `months`: the selected reporting month(s) — an array of 'YYYY-MM' (This
// Month / Last Month are single-element, Custom Range can span several).
// `todayMonth`: 'YYYY-MM' for the real current month, so "all-time" can't
// reach into cohorts that haven't crossed the window yet.
export function persistencyWindows(policies, months, todayMonth) {
  const cohortMonthsWithData = [...new Set(
    (policies || []).map(p => (p.effective_date || '').slice(0, 7)).filter(Boolean)
  )]

  return PERSISTENCY_WINDOWS.map(({ window, months: n }) => {
    const rolling = avg(
      months.map(mk => cohortPersistency(policies, shiftMonth(mk, n))).filter(v => v !== null)
    )
    const cutoff = shiftMonth(todayMonth, n)
    const allTime = avg(
      cohortMonthsWithData
        .filter(cm => cm <= cutoff)
        .map(cm => cohortPersistency(policies, cm))
        .filter(v => v !== null)
    )
    return { window, rolling, allTime }
  })
}
