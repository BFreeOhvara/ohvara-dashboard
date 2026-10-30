import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'

// The v2 Clients page's server reads (migration 180). Read only: nothing here writes.
//   useServicingTasks()   every servicing_tasks row on this agent's clients (RLS: agent_id = auth.uid()).
//   useClientPolicies(ids) the policies a sold inbound points at (leads.client_policy_id) plus the
//                         client's booked cancellations, with the fields the Policies card shows.
const TASK_COLS = 'id, agent_id, lead_id, policy_id, kind, status, due_at, done_at, note, created_at'
const POLICY_COLS = 'id, carrier_name, product_type, monthly_premium, effective_date, policy_sold_date, status, fulfillment_assigned, fulfillment_stage, created_at'

export function useServicingTasks() {
  const { profile } = useAuth()
  return useQuery({
    queryKey: ['servicing-tasks', profile?.id],
    enabled: !!profile?.id,
    refetchInterval: 60000,
    queryFn: async () => {
      const { data, error } = await supabase.from('servicing_tasks').select(TASK_COLS)
        .eq('agent_id', profile.id).neq('status', 'cancelled').order('due_at', { ascending: true, nullsFirst: false })
      if (error) throw error
      return data || []
    },
  })
}

export function useClientPolicies(ids) {
  const list = [...new Set((ids || []).filter(Boolean))].sort()
  return useQuery({
    queryKey: ['policies', 'client-policies', list.join(',')],
    enabled: list.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.from('policies').select(POLICY_COLS).in('id', list)
      if (error) throw error
      return new Map((data || []).map(p => [p.id, p]))
    },
  })
}

// ── Words ─────────────────────────────────────────────────────────────────────
export const TASK_LABEL = {
  packet_check: 'Policy packet check', review_call: 'Review call', chargeback_watch: 'Chargeback watch',
  beneficiary_change: 'Beneficiary change', address_change: 'Address change', payment_change: 'Payment change',
  draft_date_change: 'Draft date change', lapse_save: 'Lapse save', conversion: 'Conversion',
  annual_review: 'Annual review', claim_help: 'Claim help', carrier_call: 'Carrier call',
}
export const TASK_STATUS = {
  requested: { label: 'Requested', chip: 'req' },
  scheduled: { label: 'Scheduled', chip: 'sch' },
  done: { label: 'Done', chip: 'done' },
}

// The chargeback watch runs 12 months from when it was seeded; due_at is its end.
export function watchProgress(task, nowMs = Date.now()) {
  const start = new Date(task.created_at).getTime()
  const end = task.due_at ? new Date(task.due_at).getTime() : start + 365 * 864e5
  const months = 12
  const month = Math.min(months, Math.max(1, Math.ceil(((nowMs - start) / (end - start || 1)) * months)))
  return { month, months, end: task.due_at, done: task.status === 'done' || nowMs >= end }
}
