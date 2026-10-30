import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

// Standing Messages threads (Prompt 701, migration 123): agent <-> each
// Fulfillment rep, and agent <-> Admin. Not tied to a client. A thread is the
// pair (agentId, peerKey) where peerKey is the rep's profile id or 'admin'.
// The empty ones are synthesized by my_standing_threads(); messages only exist
// once someone writes. Access is enforced by RLS (can_dm_thread).

export const DM_THREADS_KEY = ['dm-threads']

// URL form: <agent id>.<peer key>
export const dmId = (agentId, peerKey) => `${agentId}.${peerKey}`
export function parseDmId(id) {
  if (!id) return null
  const i = id.indexOf('.')
  if (i < 1) return null
  return { agentId: id.slice(0, i), peerKey: id.slice(i + 1) }
}

export function useStandingThreads(enabled = true) {
  return useQuery({
    queryKey: DM_THREADS_KEY,
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('my_standing_threads')
      if (error) throw error
      return data || []
    },
    refetchInterval: 30e3,
  })
}

export function useDmMessages(agentId, peerKey) {
  return useQuery({
    queryKey: ['dm-messages', agentId, peerKey],
    enabled: !!agentId && !!peerKey,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('direct_messages')
        .select('id, sender_id, sender_name, sender_role, body, created_at')
        .eq('agent_id', agentId)
        .eq('peer_key', peerKey)
        .order('created_at', { ascending: true })
      if (error) throw error
      return data || []
    },
    refetchInterval: 30e3,
  })
}

export function useSendDm(agentId, peerKey, senderId) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async body => {
      const { error } = await supabase.from('direct_messages').insert({
        agent_id: agentId,
        peer_id: peerKey === 'admin' ? null : peerKey,
        sender_id: senderId,
        body,
      })
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['dm-messages', agentId, peerKey] })
      qc.invalidateQueries({ queryKey: DM_THREADS_KEY })
    },
  })
}

export function useMarkDmRead(profileId) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ agentId, peerKey }) => {
      const { error } = await supabase
        .from('direct_message_reads')
        .upsert(
          { agent_id: agentId, peer_key: peerKey, profile_id: profileId, last_read_at: new Date().toISOString() },
          { onConflict: 'agent_id,peer_key,profile_id' },
        )
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: DM_THREADS_KEY }),
  })
}
