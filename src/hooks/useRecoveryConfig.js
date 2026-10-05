import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

// Prompt 696 — the single row of no-answer recovery settings (migration 122):
// whether texting is switched on, and the morning / evening send times. Any
// signed-in user can read it; only an admin can write.
export function useRecoveryConfig() {
  return useQuery({
    queryKey: ['recovery-config'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('recovery_config')
        .select('sms_live, reminder_time, evening_time')
        .limit(1)
        .maybeSingle()
      if (error) throw error
      return data
    },
  })
}

export function useUpdateRecoveryConfig() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async updates => {
      const { error } = await supabase
        .from('recovery_config')
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq('id', true)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['recovery-config'] }),
  })
}
