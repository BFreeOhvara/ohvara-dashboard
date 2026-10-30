import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'
import { isDutyMissing, dutyKey, readMyDuty, dutyMutation, dutyState } from '../lib/duty'

// Active for live transfers (migration 174). One agent_duty row per agent; no row means not
// active. Today, Settings and the transfer alert all read this one hook, so they agree.

// A missing table won't appear on a retry.
const retry = (n, e) => !isDutyMissing(e) && n < 1

// The signed-in agent's own switch: { on, since, soon, loading, failed, saving, saveFailed,
// toggle(next, { onSuccess }) }. soon = agent_duty isn't in the database yet (Coming soon).
export function useAgentDuty() {
  const qc = useQueryClient()
  const { session } = useAuth()
  const id = session?.user?.id
  const query = useQuery({
    queryKey: dutyKey(id),
    enabled: !!id,
    retry,
    queryFn: () => readMyDuty(supabase, id),
  })
  const save = useMutation(dutyMutation({ db: supabase, qc, id }))
  const state = dutyState(query, save)
  return {
    ...state,
    saving: save.isPending,
    saveFailed: save.isError && !state.soon,
    toggle: (next, opts) => save.mutate(next, opts),
  }
}

// Admin: active agents (agent_id, full_name, since). Every 30s, until the
// function turns out not to exist.
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
