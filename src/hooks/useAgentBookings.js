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
  scheduled_call_at, fulfillment_stage, assigned_fulfillment_id,
  fulfillment_claimed_at, fulfillment_started_at, fulfillment_completed_at,
  cancellation_substatus, cancellation_confirmation,
  created_at, updated_at,
  agent:profiles!policies_agent_id_fkey ( id, full_name ),
  assigned:profiles!policies_assigned_fulfillment_id_fkey ( id, full_name ),
  details:policy_fulfillment_details ( current_carrier )
`

export function useAgentBookings(agentId = null) {
  return useQuery({
    queryKey: ['policies', 'agent-bookings', agentId ?? 'visible'],
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
    mutationFn: async ({ agentId, firstName, lastName, phone, currentCarrier, scheduledAt }) => {
      const { data: policy, error } = await supabase
        .from('policies')
        .insert({
          agent_id: agentId,
          status: 'Submitted',
          client_first_name: firstName,
          client_last_name: lastName,
          client_phone: phone || null,
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

// Move a booking the rep hasn't started yet. Guarded on stage Pending (every
// booking has a rep from the start since Prompt 684, so "unassigned" no
// longer works as the guard) so an agent can't shift a call out from under a
// rep who's already working it. The database re-checks which rep is free at
// the new time (migration 116).
export function useRescheduleBooking() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, scheduledAt }) => {
      const { data, error } = await supabase
        .from('policies')
        .update({ scheduled_call_at: scheduledAt })
        .eq('id', id)
        .eq('fulfillment_stage', 'Pending')
        .select('id')
      if (error) throw error
      if (!data?.length) throw new Error('Fulfillment has already started this one — message them to move it.')
      return data[0]
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['policies'] }),
  })
}
