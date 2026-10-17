import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

// Prompt 775 — Delete my account (Apple guideline 5.1.1(v)) and the Phone
// alerts switch. Both are server-side: delete-account (edge function) does
// the work; the switch is set_push_enabled / my_push_settings.

export function useDeleteAccount() {
  return useMutation({
    mutationFn: async confirm => {
      const { data, error } = await supabase.functions.invoke('delete-account', { body: { confirm } })
      if (error) {
        let msg = 'Couldn’t delete your account. Try again in a minute.'
        try { msg = (await error.context?.json())?.error || msg } catch { /* keep the default */ }
        throw new Error(msg)
      }
      return data
    },
  })
}

const PUSH = ['push', 'settings']

export function usePushSettings(profileId) {
  return useQuery({
    queryKey: [...PUSH, profileId],
    enabled: !!profileId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('my_push_settings')
      if (error) throw error
      return Array.isArray(data) ? data[0] : data
    },
  })
}

export function useSetPush(profileId) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async on => {
      const { error } = await supabase.rpc('set_push_enabled', { p_on: on })
      if (error) throw error
    },
    onMutate: on => { qc.setQueryData([...PUSH, profileId], s => (s ? { ...s, push_on: on } : s)) },
    onSettled: () => qc.invalidateQueries({ queryKey: [...PUSH, profileId] }),
  })
}
