import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { EVENT_SELECT, fetchActivityFeed } from '../lib/activityFeedFallback'

// Activity tab (Prompts 690, 694): one day's status changes + call-time moves
// from policy_events, written by a trigger on policies (migration 118).
// RLS = whoever can read the policy. `day` is a local-midnight Date.
// `agentId` narrows to one agent; null = everything RLS allows (admin).

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

// The Activity page's feed: every kind of event on one day, from
// agent_activity_feed() (migration 185). Rows are { id, kind, at, lead_id, agent_id,
// title, meta }, newest first. If that function is missing or not callable the loader
// (lib/activityFeedFallback) falls back to policy_events in the same shape, so the page
// shows the day's rows or its empty state, never an error for a missing function.
export function useActivityFeed(day, agentId = null) {
  const start = new Date(day)
  start.setHours(0, 0, 0, 0)
  const end = new Date(start)
  end.setDate(end.getDate() + 1)
  const startISO = start.toISOString()
  const endISO = end.toISOString()
  return useQuery({
    queryKey: ['activity-feed', startISO, agentId ?? 'visible'],
    queryFn: () => fetchActivityFeed(supabase, startISO, endISO, agentId),
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
