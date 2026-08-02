import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

// Prompt 392 — singleton company-wide settings row (migration 091). Today
// this is just the Daily.co Live Room link (Prompt 393, migration 097 —
// pivoted from the original Zoom plan); other integrations land in the same
// row as new columns later rather than a new table per integration.

export function useAppSettings() {
  return useQuery({
    queryKey: ['app-settings'],
    queryFn: async () => {
      const { data, error } = await supabase.from('app_settings').select('*').eq('id', 1).single()
      if (error) throw error
      return data
    },
  })
}

export function useUpdateAppSettings() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (updates) => {
      const { error } = await supabase.from('app_settings').update(updates).eq('id', 1)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['app-settings'] }),
  })
}
