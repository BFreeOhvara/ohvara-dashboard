import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

// Prompt 745 — the Fulfillment Overview's "calls made": every time a call was
// started (policy_events kind 'in_progress', migration 118) since `sinceIso`.
// `actorId` narrows to the rep who started them; null = everyone RLS allows
// (admin's whole-team view). Keyed under 'policies' so starting or ending a
// call (which invalidates that prefix) refreshes it too.
export function useRepCallEvents(sinceIso, actorId = null, { live = false } = {}) {
  return useQuery({
    queryKey: ['policies', 'rep-call-events', sinceIso, actorId ?? 'all'],
    enabled: !!sinceIso,
    refetchInterval: live ? 10e3 : 45e3,
    queryFn: async () => {
      let q = supabase
        .from('policy_events')
        .select('policy_id, kind, actor_id, at')
        .eq('kind', 'in_progress')
        .gte('at', sinceIso)
        .order('at', { ascending: true })
        .limit(5000)
      if (actorId) q = q.eq('actor_id', actorId)
      const { data, error } = await q
      if (error) throw error
      return data || []
    },
  })
}
