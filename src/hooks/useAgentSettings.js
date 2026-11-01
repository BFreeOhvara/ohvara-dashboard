import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'
import { settingsKey, isSettingsNotReady, readMyAgentSettings, saveMyAgentSettings } from '../lib/agentSettings'

// The signed-in agent's own working hours, live-transfer phone and on-duty default
// (migration 197: my_agent_settings / save_my_agent_settings). Read only for an agent,
// because the function refuses everyone else. A missing function is `soon`, not an error.

// A missing function won't appear on a retry, and a refusal won't change.
const retry = (n, e) => !isSettingsNotReady(e) && e?.code !== '42501' && n < 1

// { data: { timezone, week, phone, dutyDefault } | undefined, soon, loading, failed }
export function useAgentSettings() {
  const { profile } = useAuth()
  const id = profile?.id
  const query = useQuery({
    queryKey: settingsKey(id),
    enabled: !!id && profile?.role === 'agent',
    retry,
    queryFn: () => readMyAgentSettings(supabase),
  })
  const soon = isSettingsNotReady(query.error)
  return {
    data: query.data,
    soon,
    loading: query.isLoading,
    failed: !soon && !!query.error,
  }
}

// One card's save. Each card calls this for itself, so its saving and error state stay its own.
// `save(payload)` sends exactly the one key the card gives it; the server's answer replaces the cache.
export function useSaveAgentSettings() {
  const qc = useQueryClient()
  const { profile } = useAuth()
  const key = settingsKey(profile?.id)
  const m = useMutation({
    mutationFn: payload => saveMyAgentSettings(supabase, payload),
    onSuccess: next => qc.setQueryData(key, next),
  })
  return {
    save: (payload, opts) => m.mutate(payload, opts),
    saving: m.isPending,
    error: m.error,
    pending: m.variables,
    reset: m.reset,
  }
}
