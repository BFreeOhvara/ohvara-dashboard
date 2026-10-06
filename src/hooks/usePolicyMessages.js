import { useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useStandingThreads, DM_THREADS_KEY } from './useDirectMessages'

// Agent <-> Fulfillment messages (Prompt 679, migration 114). One thread per
// booked client (policy). What each role may read or write is decided by RLS
// on policy_messages (can_message_policy), not here: an agent only ever gets
// their own clients' threads back, fulfillment gets the whole booked pool,
// admin gets everything.

const THREADS_KEY = ['policy-message-threads']

// One row per thread with last message + this reader's unread count
// (my_message_threads RPC).
export function useMessageThreads(enabled = true) {
  return useQuery({
    queryKey: THREADS_KEY,
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('my_message_threads')
      if (error) throw error
      return data || []
    },
    refetchInterval: 30e3,
  })
}

// Sidebar badge. Same query key as the threads list, so it costs nothing extra.
export function useUnreadMessageCount(enabled = true) {
  const { data: threads = [] } = useMessageThreads(enabled)
  const { data: standing = [] } = useStandingThreads(enabled)
  return threads.reduce((n, t) => n + (t.unread_count || 0), 0)
    + standing.reduce((n, t) => n + (t.unread_count || 0), 0)
}

// The thread header for a client — needed when a thread is opened from a
// Clients / Fulfillment row before anyone has written to it, so it isn't in
// the threads list yet. policies RLS applies.
export function useThreadPolicy(policyId) {
  return useQuery({
    queryKey: ['policy-message-policy', policyId],
    enabled: !!policyId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('policies')
        .select(`
          id, agent_id, client_first_name, client_last_name, assigned_fulfillment_id, fulfillment_assigned,
          agent:profiles!policies_agent_id_fkey ( full_name ),
          assigned:profiles!policies_assigned_fulfillment_id_fkey ( full_name )
        `)
        .eq('id', policyId)
        .maybeSingle()
      if (error) throw error
      return data
    },
  })
}

export function useThreadMessages(policyId) {
  return useQuery({
    queryKey: ['policy-messages', policyId],
    enabled: !!policyId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('policy_messages')
        .select('id, sender_id, sender_name, sender_role, body, created_at')
        .eq('policy_id', policyId)
        .order('created_at', { ascending: true })
      if (error) throw error
      return data || []
    },
    refetchInterval: 30e3,
  })
}

export function useSendMessage(policyId, senderId) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async body => {
      const { error } = await supabase
        .from('policy_messages')
        .insert({ policy_id: policyId, sender_id: senderId, body })
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['policy-messages', policyId] })
      qc.invalidateQueries({ queryKey: THREADS_KEY })
    },
  })
}

// Stamp the thread read for the signed-in user. Called when a thread is open
// and again whenever a new message lands in it.
export function useMarkThreadRead(profileId) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async policyId => {
      const { error } = await supabase
        .from('policy_message_reads')
        .upsert(
          { policy_id: policyId, profile_id: profileId, last_read_at: new Date().toISOString() },
          { onConflict: 'policy_id,profile_id' },
        )
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: THREADS_KEY }),
  })
}

// One live subscription for the whole signed-in shell (mounted from the
// Sidebar): any new message the user can see refreshes the badge, the threads
// list and, if open, that thread. Realtime honours the same RLS as a select.
export function useMessagesRealtime(profileId) {
  const qc = useQueryClient()
  useEffect(() => {
    if (!profileId) return undefined
    const channel = supabase
      .channel(`policy-messages-${profileId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'policy_messages' }, payload => {
        qc.invalidateQueries({ queryKey: THREADS_KEY })
        const pid = payload.new?.policy_id
        if (pid) qc.invalidateQueries({ queryKey: ['policy-messages', pid] })
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'direct_messages' }, payload => {
        qc.invalidateQueries({ queryKey: DM_THREADS_KEY })
        const { agent_id: a, peer_key: k } = payload.new || {}
        if (a && k) qc.invalidateQueries({ queryKey: ['dm-messages', a, k] })
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [profileId, qc])
}
