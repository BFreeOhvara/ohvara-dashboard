import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

// VA call-qualify desk (Prompt 797, migration 170). A Fulfillment rep answers an
// inbound policy-help call, runs the checklist, and saves the lead, books it on
// an agent's calendar (useBookCall) or marks a live transfer. A transfer is
// only a record — the chosen agent and a status. Nothing here calls or texts.

// The active agents a VA can pick (id + name only).
export function useAgentRoster() {
  return useQuery({
    queryKey: ['va-agent-roster'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('va_agent_roster')
      if (error) throw error
      return data || []
    },
    staleTime: 60e3,
  })
}

// Creates the policy_help lead (lead_source 'google', checklist in
// qualifier_answers). outcome 'transfer' also records the agent and status.
export function useSaveQualifiedCall() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ first, last, phone, city, state, answers, outcome = 'saved', agentId = null }) => {
      const { data, error } = await supabase.rpc('va_save_policy_help_lead', {
        p_first: first, p_last: last, p_phone: phone || null, p_city: city || null, p_state: state || null,
        p_answers: answers, p_outcome: outcome, p_agent: agentId,
      })
      if (error) throw error
      return data
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['leads'] }),
  })
}

// After a booking lands on the agent's calendar, put the lead with that agent.
export function useMarkLeadBooked() {
  return useMutation({
    mutationFn: async ({ leadId, agentId }) => {
      const { error } = await supabase.rpc('va_set_lead_outcome', { p_lead: leadId, p_agent: agentId })
      if (error) throw error
    },
  })
}
