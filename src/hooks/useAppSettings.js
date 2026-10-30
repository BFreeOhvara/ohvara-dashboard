import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

// Prompt 392 — singleton company-wide settings row (migration 091). Started
// as just the Daily.co Live Room link (Prompt 393, migration 097 — pivoted
// from the original Zoom plan); Prompt 415 (migration 099) added the shared
// Training Center script doc here too, same "one row, new columns" pattern
// rather than a new table per feature.

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

// Migration 187 — the Submit page's master switch. Only a loaded `true` turns it
// on: undefined (the column isn't there yet), false, loading and a failed load
// all read as off, so today's booking flow is what an agent sees.
export function useSubmitLive() {
  const { data, isLoading } = useAppSettings()
  return { live: data?.submit_live === true, loading: isLoading }
}
