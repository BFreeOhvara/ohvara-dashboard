import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

// Activity tab (Prompt 690). Two sources, merged on the page:
//   policy_events   status changes + call-time moves, written by a trigger on
//                   policies (migration 118). RLS = whoever can read the policy.
//   policy_messages Fulfillment's messages, read in place (not copied) and
//                   linked back into the thread.
// `agentId` narrows to one agent; null = everything RLS allows (admin).

export function usePolicyEvents(since, agentId = null) {
  const sinceISO = since.toISOString()
  return useQuery({
    queryKey: ['policy-events', sinceISO, agentId ?? 'visible'],
    queryFn: async () => {
      let q = supabase
        .from('policy_events')
        .select(`
          id, policy_id, agent_id, kind, from_status, actor_name, actor_role, detail, at,
          policy:policies ( client_first_name, client_last_name ),
          agent:profiles!policy_events_agent_id_fkey ( full_name )
        `)
        .gte('at', sinceISO)
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

// Messages Fulfillment sent. An agent's RLS already limits this to their own
// clients' threads; dropping their own messages leaves what they received.
// Admin sees the Fulfillment side of every thread.
export function useReceivedMessages(since, viewerId, isAdmin) {
  const sinceISO = since.toISOString()
  return useQuery({
    queryKey: ['policy-messages-received', sinceISO, viewerId, isAdmin],
    enabled: !!viewerId,
    queryFn: async () => {
      let q = supabase
        .from('policy_messages')
        .select(`
          id, policy_id, sender_id, sender_name, sender_role, body, created_at,
          policy:policies ( agent_id, client_first_name, client_last_name, agent:profiles!policies_agent_id_fkey ( full_name ) )
        `)
        .gte('created_at', sinceISO)
        .order('created_at', { ascending: false })
        .limit(500)
      q = isAdmin ? q.eq('sender_role', 'fulfillment') : q.neq('sender_id', viewerId)
      const { data, error } = await q
      if (error) throw error
      return data || []
    },
    refetchInterval: 30e3,
  })
}
