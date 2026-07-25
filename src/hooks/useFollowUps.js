import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

// Follow-ups on My Calls → Schedule (Prompt 329, migration 076) — a closer
// manually logging "call this client at this time" onto their own calendar.
// Simple CRUD, no downline visibility (unlike policies): a follow-up is a
// personal reminder, not book-of-business data.
export function useFollowUps(agentId) {
  return useQuery({
    queryKey: ['followups', agentId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('closer_followups')
        .select('*')
        .eq('agent_id', agentId)
        .order('scheduled_at', { ascending: true })
      if (error) throw error
      return data || []
    },
    enabled: !!agentId,
  })
}

export function useCreateFollowUp() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (fields) => {
      const { data, error } = await supabase.from('closer_followups').insert(fields).select().single()
      if (error) throw error
      return data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['followups'] }),
  })
}

export function useDeleteFollowUp() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id) => {
      const { error } = await supabase.from('closer_followups').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['followups'] }),
  })
}
