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
]

export const CANCELLATION_STATUSES = [
  'Cancellation Pending',
  'Cancellation Complete',
]

// Pre-submission outcomes have no data source until live-call handling is
// wired in (North Star "Pipeline Status Model") — the filter chips still
// offer them so the day that lands, nothing needs rebuilding.
export const PRE_SUBMISSION_STATUSES = ['Follow-up', 'Not Interested']

const SELECT = `
  id, agent_id, policy_sold_date, policy_number,
  client_first_name, client_last_name, client_phone,
  carrier_id, carrier_name, product_type, insurance_type, state,
  effective_date, monthly_premium, annual_premium,
  status, cancellation_status, cancellation_call_at,
  effectuation_answered_at, notes, created_at, updated_at,
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

// Rows the effective-date prompt should fire on: submitted, effective date
// has arrived, and the agent hasn't answered "did this go into effect?" yet
// (Round 46). Answering stamps effectuation_answered_at so it never re-asks.
export function pendingEffectuation(policies, today = new Date()) {
  const cutoff = today.toISOString().slice(0, 10)
  return (policies || []).filter(p =>
    p.status === 'Submitted' &&
    p.effective_date &&
    p.effective_date <= cutoff &&
    !p.effectuation_answered_at
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
