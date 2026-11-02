import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'
import { oneWatchPerPolicy, watchProgress } from '../lib/servicingWatch'

// The v2 Clients page's server reads (migrations 180, 193). Read only: nothing here writes.
//   useServicingTasks()   every servicing_tasks row on this agent's clients, steps and requests alike.
//   useClientPolicies(ids) the policies a sold inbound points at (leads.client_policy_id) plus the
//                         client's booked cancellations, with the fields the Policies card shows.
const TASK_COLS = 'id, agent_id, lead_id, policy_id, kind, status, due_at, done_at, note, created_at'
const POLICY_COLS = 'id, client_first_name, client_last_name, client_phone, state, client_city, client_timezone, policy_number, carrier_name, product_type, monthly_premium, effective_date, policy_sold_date, status, fulfillment_assigned, fulfillment_stage, created_at, sms_consent, sms_consent_at, sms_consent_by, sms_consent_version'

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
      return oneWatchPerPolicy(data || [])
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
  in_progress: { label: 'In progress', chip: 'sch' },
  done: { label: 'Done', chip: 'done' },
}

// watchProgress lives in src/lib/servicingWatch.js (testable without the supabase client); pages keep importing it from here.
export { watchProgress }
