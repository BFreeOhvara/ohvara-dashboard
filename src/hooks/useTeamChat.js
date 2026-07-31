import { useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

// Team chat (Prompt 357) — one shared "Team chat" channel every closer/admin
// is implicitly in, plus arbitrary 1:1 DMs between any two team members.
// Schema: migration 084 (team_conversations, team_messages). Deliberately
// separate from useMessages.js's `messages` table, which is a fixed
// rep→brayden/nate directed inbox (at most one reply per row) and can't
// represent a shared channel or an arbitrary DM pair.

export function useTeamChannel() {
  return useQuery({
    queryKey: ['team-channel'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('team_conversations')
        .select('id')
        .eq('type', 'channel')
        .single()
      if (error) throw error
      return data
    },
  })
}

// Team members other than the caller — the DM target list.
export function useTeamMembers(excludeId) {
  return useQuery({
    queryKey: ['team-members', excludeId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, role')
        .in('role', ['closer', 'admin'])
        .order('full_name')
      if (error) throw error
      return (data || []).filter(p => p.id !== excludeId)
    },
    enabled: !!excludeId,
  })
}

// Get-or-create the DM conversation between the caller and `otherId`. The
// pair is always queried/inserted in sorted (a < b) order so migration 084's
// partial unique index guarantees exactly one row ever exists per pair, no
// matter who starts the thread.
export function useDmConversationId(myId, otherId) {
  return useQuery({
    queryKey: ['team-dm', myId, otherId],
    queryFn: async () => {
      const [a, b] = [myId, otherId].sort()

      const { data: existing, error: selErr } = await supabase
        .from('team_conversations')
        .select('id')
        .eq('type', 'dm')
        .eq('dm_participant_a', a)
        .eq('dm_participant_b', b)
        .maybeSingle()
      if (selErr) throw selErr
      if (existing) return existing.id

      const { data: created, error: insErr } = await supabase
        .from('team_conversations')
        .insert({ type: 'dm', dm_participant_a: a, dm_participant_b: b })
        .select('id')
        .single()
      if (insErr) throw insErr
      return created.id
    },
    enabled: !!myId && !!otherId,
  })
}

// My Calls Activity feed (Prompt 365) — most recent messages across every
// conversation this agent can see (RLS already scopes rows to the shared
// channel plus their own DMs), not one conversation's full history.
export function useRecentTeamMessages(limit = 15) {
  return useQuery({
    queryKey: ['team-messages', 'recent', limit],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('team_messages')
        .select('id, sender_id, sender_name, body, created_at, conversation_id, team_conversations(type)')
        .order('created_at', { ascending: false })
        .limit(limit)
      if (error) throw error
      return data || []
    },
  })
}

export function useTeamMessages(conversationId) {
  const qc = useQueryClient()

  const query = useQuery({
    queryKey: ['team-messages', conversationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('team_messages')
        .select('*')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true })
      if (error) throw error
      return data || []
    },
    enabled: !!conversationId,
  })

  // Realtime — new messages land instantly instead of waiting on a refetch
  // (migration 084 adds team_messages to the realtime publication, matching
  // migration 052's pattern for `calls`). DELETE included since Prompt 391 —
  // migration 092 sets REPLICA IDENTITY FULL so the old-record payload still
  // carries conversation_id for this filter even though it's not the PK.
  useEffect(() => {
    if (!conversationId) return
    const channel = supabase
      .channel(`team-messages-${conversationId}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'team_messages',
        filter: `conversation_id=eq.${conversationId}`,
      }, () => {
        qc.invalidateQueries({ queryKey: ['team-messages', conversationId] })
      })
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [conversationId, qc])

  return query
}

export function useSendTeamMessage() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ conversation_id, sender_id, sender_name, body }) => {
      const { error } = await supabase.from('team_messages').insert({
        conversation_id, sender_id, sender_name, body,
      })
      if (error) throw error
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['team-messages', vars.conversation_id] })
    },
  })
}

// Prompt 391 — migration 092's RLS (sender or admin) is the real gate; the
// frontend's canDelete check just keeps the button from appearing for a
// message nobody's allowed to remove.
export function useDeleteTeamMessage() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, conversation_id }) => {
      const { error } = await supabase.from('team_messages').delete().eq('id', id)
      if (error) throw error
      return { conversation_id }
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['team-messages', vars.conversation_id] })
    },
  })
}
