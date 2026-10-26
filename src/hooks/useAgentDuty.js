import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'

// On duty for live transfers (migration 162). One row per agent; no row means
// off duty. Table and column names live here so a rename is a one-line fix.
const TABLE = 'agent_duty'
const KEY_COL = 'agent_id'
const DUTY_COL = 'on_duty'

// True when the table isn't in the database yet (PostgREST PGRST205 / 404, or
// Postgres 42P01), so the card can say "not set up" instead of a raw error.
export const isMissingDutyTable = e =>
  !!e && (e.code === 'PGRST205' || e.code === '42P01' || e.status === 404)

export function useMyDuty() {
  const { profile } = useAuth()
  const id = profile?.id
  return useQuery({
    queryKey: ['agent-duty', id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from(TABLE)
        .select(DUTY_COL)
        .eq(KEY_COL, id)
        .maybeSingle()
      if (error) throw error
      return !!data?.[DUTY_COL]
    },
  })
}

export function useSetMyDuty() {
  const qc = useQueryClient()
  const { profile } = useAuth()
  const id = profile?.id
  return useMutation({
    mutationFn: async onDuty => {
      const { error } = await supabase
        .from(TABLE)
        .upsert({ [KEY_COL]: id, [DUTY_COL]: onDuty }, { onConflict: KEY_COL })
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['agent-duty', id] }),
  })
}
