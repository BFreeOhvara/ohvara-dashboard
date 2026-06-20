import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

// Category the rep picks → fixed recipient. One place so rep compose, history
// labels, and the inboxes never drift.
export const MESSAGE_CATEGORIES = [
  { value: 'brayden', label: 'Dashboard Question', to: 'Brayden', hint: 'Account, leads, stats, anything about the portal' },
  { value: 'nate',    label: 'Sales Question',     to: 'Nate',    hint: 'Pitching, objections, closing, the script' },
]

// Rep: send a message to brayden/nate
export function useSendMessage() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ sender_id, sender_name, recipient, body }) => {
      const { error } = await supabase.from('messages').insert({
        sender_id, sender_name, recipient, body,
      })
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['messages'] }),
  })
}

// Rep: their own sent messages (with any reply on the row)
export function useMyMessages(senderId) {
  return useQuery({
    queryKey: ['messages', 'mine', senderId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('sender_id', senderId)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data || []
    },
    enabled: !!senderId,
    refetchInterval: 15000, // poll for replies (same cadence as notifications)
  })
}

// Recipient inbox (recipient = 'brayden' | 'nate'); RLS gates visibility
export function useInbox(recipient) {
  return useQuery({
    queryKey: ['messages', 'inbox', recipient],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('recipient', recipient)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data || []
    },
    enabled: !!recipient,
    refetchInterval: 15000,
  })
}

// Recipient: reply (also marks read)
export function useReplyMessage() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, reply_body }) => {
      const { error } = await supabase
        .from('messages')
        .update({ reply_body, replied_at: new Date().toISOString(), read: true })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['messages'] }),
  })
}

// Recipient: mark a message read (on open)
export function useMarkMessageRead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id) => {
      const { error } = await supabase.from('messages').update({ read: true }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['messages'] }),
  })
}
