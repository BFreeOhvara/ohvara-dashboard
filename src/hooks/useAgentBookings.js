import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

// Agent portal (Prompt 665). Reads the same `policies` rows the Fulfillment
// desk works (fulfillment_assigned = true), plus the fulfillment-side columns
// migration 106 added, so an agent can see where each booked client stands.
// RLS (policies_select → can_view_agent) is the boundary: an agent reads
// their own rows (+ downline), admin reads everything. `agentId` narrows on
// top of that; null = everything RLS allows.
const SELECT = `
  id, agent_id, client_first_name, client_last_name, client_phone,
  state, client_city, client_timezone, carrier_id, carrier_name,
  scheduled_call_at, fulfillment_stage, assigned_fulfillment_id,
  fulfillment_claimed_at, fulfillment_started_at, fulfillment_completed_at,
  cancellation_substatus, cancellation_confirmation,
  call_live_since, last_call_outcome, call_attempts, last_call_at,
  recovery_step, recovery_retry_at, recovery_am_sent_at, recovery_pm_sent_at,
  created_at, updated_at,
  agent:profiles!policies_agent_id_fkey ( id, full_name ),
  assigned:profiles!policies_assigned_fulfillment_id_fkey ( id, full_name ),
  details:policy_fulfillment_details ( current_carrier )
`

// Prompt 689 — a live call should show up without a refresh, so the list
// re-polls every 10s while any call is live and every 45s otherwise.
export const livePollMs = rows => (rows?.some(p => p.call_live_since) ? 10e3 : 45e3)

// `opts` passes straight to useQuery (Prompt 722: the sidebar badge and the
// header search only switch it on where they need it).
export function useAgentBookings(agentId = null, opts = {}) {
  return useQuery({
    ...opts,
    queryKey: ['policies', 'agent-bookings', agentId ?? 'visible'],
    refetchInterval: q => livePollMs(q.state.data),
    queryFn: async () => {
      let q = supabase
        .from('policies')
        .select(SELECT)
        .eq('fulfillment_assigned', true)
        .order('scheduled_call_at', { ascending: true, nullsFirst: false })
      if (agentId) q = q.eq('agent_id', agentId)
      const { data, error } = await q
      if (error) throw error
      // details is a 1:1 embed — PostgREST returns it as an object or array
      // depending on how it resolves the FK; normalize to a flat field.
      return (data || []).map(p => {
        const d = Array.isArray(p.details) ? p.details[0] : p.details
        return { ...p, current_carrier: d?.current_carrier || null }
      })
    },
  })
}

// Count of an agent's pre-pivot rows (not bookings) — only so My Clients can
// say honestly that they exist and aren't shown.
export function useLegacyPolicyCount(agentId) {
  return useQuery({
    queryKey: ['policies', 'legacy-count', agentId ?? 'visible'],
    queryFn: async () => {
      let q = supabase.from('policies').select('id', { count: 'exact', head: true }).eq('fulfillment_assigned', false)
      if (agentId) q = q.eq('agent_id', agentId)
      const { count, error } = await q
      if (error) throw error
      return count || 0
    },
  })
}

// Book a call = hand a client to Fulfillment. Same contract Fulfillment has
// always read (fulfillment_assigned, stage 'Pending', scheduled_call_at), just
// without the old 25-field intake. A minimal intake row carries the carrier
// being replaced (if the agent knows it) because that's where Fulfillment's
// work view reads "Cancel with <carrier>" from — and having the row at all
// keeps its "No intake details found" warning from firing on a clean booking.
// Two inserts, not a transaction (same as the old form): if the second fails
// the booking still exists and the error surfaces to the agent.
export function useBookCall() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ agentId, firstName, lastName, phone, city, state, timezone, carrierId, currentCarrier, scheduledAt }) => {
      const { data: policy, error } = await supabase
        .from('policies')
        .insert({
          agent_id: agentId,
          status: 'Submitted',
          client_first_name: firstName,
          client_last_name: lastName,
          client_phone: phone || null,
          // Prompt 724 — where the client lives; call times are their local time.
          client_city: city || null,
          state: state || null,
          client_timezone: timezone || null,
          // Prompt 728 — the carrier they're leaving, whose hours set the time.
          carrier_id: carrierId || null,
          carrier_name: currentCarrier || null,
          pending_underwriting: false,
          fulfillment_assigned: true,
          fulfillment_stage: 'Pending',
          scheduled_call_at: scheduledAt,
        })
        .select('id')
        .single()
      if (error) throw error

      const { error: dErr } = await supabase
        .from('policy_fulfillment_details')
        .insert({
          policy_id: policy.id,
          full_legal_name: `${firstName} ${lastName}`,
          current_carrier: currentCarrier || null,
        })
      if (dErr) throw new Error(`Booked, but the carrier note didn't save: ${dErr.message}`)
      return policy
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['policies'] }),
  })
}

// Prompt 695 — put a No answer lead back on Booked at a new time. An RPC (migration
// 121) because the agent can't write the outcome columns directly: it sets the
// time, clears the last outcome and returns the lead to Pending, so the rep is
// re-picked for the new slot exactly like a first booking.
export function useRebookCall() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, scheduledAt }) => {
      const { error } = await supabase.rpc('agent_rebook_call', { p_policy: id, p_at: scheduledAt })
      if (error) throw error
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['policies'] }),
  })
}

// Prompt 730 — Change a booking: fix a client's details and/or move the call,
// in place (migration 134). One update on the same row, so it never uses a
// weekly booking. `scheduledAt` null keeps the time; a No answer lead needs
// one (it's a re-book). The function returns the updated row.
export function useChangeBooking() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, firstName, lastName, phone, city, state, timezone, carrierId, scheduledAt }) => {
      const { data, error } = await supabase.rpc('agent_change_booking', {
        p_policy: id, p_first: firstName, p_last: lastName, p_phone: phone || null,
        p_city: city || null, p_state: state || null, p_timezone: timezone || null,
        p_carrier: carrierId, p_at: scheduledAt || null,
      })
      if (error) throw error
      return data
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['policies'] })
      qc.invalidateQueries({ queryKey: ['policy-events'] })
      qc.invalidateQueries({ queryKey: ['policy-story'] })
    },
  })
}

// Prompt 696 — the agent confirms (and optionally corrects) the client's number
// after two unanswered calls; the next calendar day the follow-up texts start.
export function useConfirmRecoveryNumber() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, phone }) => {
      const { error } = await supabase.rpc('agent_confirm_recovery_number', { p_policy: id, p_phone: phone || null })
      if (error) throw error
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['policies'] }),
  })
}
