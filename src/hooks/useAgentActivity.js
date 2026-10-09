import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

// Activity tab (Prompts 690, 694): one day's status changes + call-time moves
// from policy_events, written by a trigger on policies (migration 118).
// RLS = whoever can read the policy. `day` is a local-midnight Date.
// `agentId` narrows to one agent; null = everything RLS allows (admin).

const EVENT_SELECT = `
  id, policy_id, agent_id, kind, from_status, actor_name, actor_role, detail, at,
  policy:policies ( client_first_name, client_last_name, state, client_city, client_timezone ),
  agent:profiles!policy_events_agent_id_fkey ( full_name )
`

export function usePolicyEvents(day, agentId = null) {
  const start = new Date(day)
  start.setHours(0, 0, 0, 0)
  const end = new Date(start)
  end.setDate(end.getDate() + 1)
  const startISO = start.toISOString()
  const endISO = end.toISOString()
  return useQuery({
    queryKey: ['policy-events', startISO, agentId ?? 'visible'],
    queryFn: async () => {
      let q = supabase
        .from('policy_events')
        .select(EVENT_SELECT)
        .gte('at', startISO)
        .lt('at', endISO)
        .order('at', { ascending: false })
        .limit(1000)
      if (agentId) q = q.eq('agent_id', agentId)
      const { data, error } = await q
      if (error) throw error
      return data || []
    },
    refetchInterval: 30e3,
  })
}

// Prompt 718 — one client's whole event history, oldest first, for the
// Activity page's client story. Same select and RLS as above.
export function usePolicyStory(policyId) {
  return useQuery({
    queryKey: ['policy-story', policyId],
    enabled: !!policyId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('policy_events')
        .select(EVENT_SELECT)
        .eq('policy_id', policyId)
        .order('at', { ascending: true })
        .limit(200)
      if (error) throw error
      return data || []
    },
    refetchInterval: 30e3,
  })
}
