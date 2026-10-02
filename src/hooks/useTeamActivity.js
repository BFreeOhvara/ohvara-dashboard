import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

// Team tab (Prompt 671). Team-wide activity comes from the team_activity()
// RPC (migration 111), not from `policies` — RLS keeps an agent to their own
// clients, and that stays true. The RPC hands back only kind / when / which
// agent (first name + avatar); no client name, phone or carrier exists in
// the result, so there's nothing for this page to accidentally show.
export function useTeamActivity(since) {
  const sinceISO = since.toISOString()
  return useQuery({
    queryKey: ['team-activity', sinceISO],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('team_activity', { p_since: sinceISO })
      if (error) throw error
      return data || []
    },
    refetchInterval: 60e3,
  })
}
