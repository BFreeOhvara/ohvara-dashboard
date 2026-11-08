import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { isDutyMissing } from '../lib/duty'

// A missing function won't appear on a retry.
const retry = (n, e) => !isDutyMissing(e) && n < 1

// Admin: agents inside their live-call hours right now (agent_id, full_name, since). Every 30s,
// until the function turns out not to exist.
export function useOnDutyAgents() {
  return useQuery({
    queryKey: ['on-duty-agents'],
    refetchInterval: q => (isDutyMissing(q.state.error) ? false : 30e3),
    retry,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('on_duty_agents')
      if (error) throw error
      return data || []
    },
  })
}
