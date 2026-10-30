import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

// Prompt 692 (migration 119). Tiers are rows, so a third plan shows up
// everywhere without a code change.
export function useBillingTiers() {
  return useQuery({
    queryKey: ['billing-tiers'],
    staleTime: 5 * 60e3,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('agent_billing_tiers').select('*').eq('is_active', true).order('sort_order')
      if (error) throw error
      return data || []
    },
  })
}

// This week's submissions against the agent's cap, counted in the database
// (agent_weekly_usage) so what's shown is exactly what the booking trigger
// enforces. Keyed under 'policies' so booking a call refreshes it.
export function useWeeklyUsage(agentId) {
  return useQuery({
    queryKey: ['policies', 'weekly-usage', agentId],
    enabled: !!agentId,
    refetchInterval: 60e3,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('agent_weekly_usage', { p_agent: agentId })
      if (error) throw error
      return Array.isArray(data) ? data[0] || null : data
    },
  })
}
