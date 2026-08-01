import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

// Month-scoped per-agent AP goals (Prompt 404, migration 095) — replaces
// the old standing `profiles.monthly_ap_goal`. One row per agent per month,
// created only when they actually set it; no carryover between months, by
// design (a new month with no row is a genuine "not set yet", not a stale
// number to fall back to).

export function useMonthlyGoal(profileId, month) {
  return useQuery({
    queryKey: ['monthly-goal', profileId, month],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('agent_monthly_goals')
        .select('goal')
        .eq('profile_id', profileId)
        .eq('month', month)
        .maybeSingle()
      if (error) throw error
      return data
    },
    enabled: !!profileId && !!month,
  })
}

export function useSetMonthlyGoal() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ profileId, month, goal }) => {
      const { error } = await supabase
        .from('agent_monthly_goals')
        .upsert({ profile_id: profileId, month, goal, updated_at: new Date().toISOString() })
      if (error) throw error
    },
    onSuccess: (_data, { profileId, month }) => {
      qc.invalidateQueries({ queryKey: ['monthly-goal', profileId, month] })
      qc.invalidateQueries({ queryKey: ['team-monthly-goals', month] })
    },
  })
}

// Every agent's goal for a month — feeds Overview's "Everyone" team-goal
// sum (Prompt 404). RLS limits this to admin/upline accounts reading
// everyone's row; a regular closer querying this only ever gets their own
// row back, same as `useMonthlyGoal` above.
export function useTeamMonthlyGoals(month) {
  return useQuery({
    queryKey: ['team-monthly-goals', month],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('agent_monthly_goals')
        .select('profile_id, goal')
        .eq('month', month)
      if (error) throw error
      return data || []
    },
    enabled: !!month,
  })
}
