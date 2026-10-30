import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

// Agents who can take a live transfer right now. on_duty_agents() returns
// agent_id, full_name, since. Refreshed every 30s.
export function useOnDutyAgents() {
  return useQuery({
    queryKey: ['on-duty-agents'],
    refetchInterval: 30e3,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('on_duty_agents')
      if (error) throw error
      return data || []
    },
  })
}

// The function isn't deployed: PostgREST PGRST202, Postgres 42883.
export function isDutyMissing(error) {
  return error?.code === 'PGRST202' || error?.code === '42883'
}
