import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'

// The logged-in client's own row — self-RLS (migration 033) scopes this to
// exactly one row via clients.profile_id = auth.uid().
export function useMyClient() {
  const { profile } = useAuth()
  return useQuery({
    queryKey: ['clients', 'my', profile?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('clients')
        .select('*')
        .eq('profile_id', profile.id)
        .single()
      if (error) throw error
      return data
    },
    enabled: !!profile?.id,
  })
}

export function useMyOnboarding(clientId) {
  return useQuery({
    queryKey: ['onboarding', 'my', clientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('onboarding')
        .select('*')
        .eq('client_id', clientId)
        .single()
      if (error) throw error
      return data
    },
    enabled: !!clientId,
  })
}

export function useSubmitOnboarding() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ clientId, answers }) => {
      const { error } = await supabase
        .from('onboarding')
        .update({ status: 'completed', answers, completed_at: new Date().toISOString() })
        .eq('client_id', clientId)
      if (error) throw error
      await supabase.functions.invoke('build-agent', { body: { clientId, answers } })
    },
    onSuccess: (_, { clientId }) => {
      qc.invalidateQueries({ queryKey: ['onboarding', 'my', clientId] })
    },
  })
}
