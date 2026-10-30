import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'
import { isDutyMissing } from '../lib/duty'

// On duty for live transfers (migration 172). One agent_duty row per agent;
// no row means off duty. Only call these behind DUTY_LIVE (lib/duty.js).

const DUTY = ['agent-duty']
// A missing table won't appear on a retry.
const retry = (n, e) => !isDutyMissing(e) && n < 1

// The signed-in agent's own row, or null.
export function useMyDuty() {
  const { session } = useAuth()
  const id = session?.user?.id
  return useQuery({
    queryKey: [...DUTY, id],
    enabled: !!id,
    retry,
    queryFn: async () => {
      const { data, error } = await supabase.from('agent_duty').select('*').eq('agent_id', id).maybeSingle()
      if (error) throw error
      return data
    },
  })
}

// Writes only the signed-in agent's own row: agent_id is always the auth user
// id, never one passed in. Optimistic; a failed save rolls back.
export function useSetMyDuty() {
  const qc = useQueryClient()
  const { session } = useAuth()
  const id = session?.user?.id
  const key = [...DUTY, id]
  return useMutation({
    mutationFn: async on => {
      if (!id) throw new Error('Not signed in')
      const { error } = await supabase.from('agent_duty').upsert({ agent_id: id, on_duty: on }, { onConflict: 'agent_id' })
      if (error) throw error
    },
    onMutate: async on => {
      await qc.cancelQueries({ queryKey: key })
      const prev = qc.getQueryData(key)
      qc.setQueryData(key, row => ({ ...row, agent_id: id, on_duty: on }))
      return { prev }
    },
    onError: (_e, _on, ctx) => qc.setQueryData(key, ctx?.prev ?? null),
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  })
}

// Admin: on-duty active agents (agent_id, name, since). Every 30s, until the
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
