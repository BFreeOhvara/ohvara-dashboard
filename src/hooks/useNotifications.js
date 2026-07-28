import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

// ── Admin notifications ──────────────────────────────────────────────────────
// Prompt 379 Bug B: these used to have no profile_id filter at all, relying
// on the "Admins manage notifications" RLS policy's broad ALL/SELECT access
// to return literally every user's rows — every admin's own bell showed
// everyone's notifications, not just theirs (e.g. all 4 team-channel
// fan-out rows on one message, instead of just their own). Explicit
// `.eq('profile_id', profileId)` here is belt-and-suspenders on top of the
// migration 087 RLS narrowing — this component must never regress into
// showing another user's notifications again regardless of what RLS allows.

export function useNotifications(profileId, limit = 20) {
  return useQuery({
    queryKey: ['notifications', profileId, limit],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .eq('profile_id', profileId)
        .order('created_at', { ascending: false })
        .limit(limit)
      if (error) throw error
      return data || []
    },
    enabled: !!profileId,
    refetchInterval: 15000,
  })
}

export function useUnreadCount(profileId) {
  return useQuery({
    queryKey: ['notifications-unread-count', profileId],
    queryFn: async () => {
      const { count, error } = await supabase
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('profile_id', profileId)
        .eq('read', false)
      if (error) throw error
      return count ?? 0
    },
    enabled: !!profileId,
    refetchInterval: 15000,
  })
}

export function useMarkNotificationRead(profileId) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id) => {
      const { error } = await supabase
        .from('notifications')
        .update({ read: true })
        .eq('id', id)
        .eq('profile_id', profileId)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notifications', profileId] })
      qc.invalidateQueries({ queryKey: ['notifications-unread-count', profileId] })
    },
  })
}

export function useMarkAllRead(profileId) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('notifications')
        .update({ read: true })
        .eq('profile_id', profileId)
        .eq('read', false)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notifications', profileId] })
      qc.invalidateQueries({ queryKey: ['notifications-unread-count', profileId] })
    },
  })
}

// ── Rep notifications (scoped by profile_id) ────────────────────────────────

export function useRepNotifications(profileId, limit = 20) {
  return useQuery({
    queryKey: ['rep-notifications', profileId, limit],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .eq('profile_id', profileId)
        .order('created_at', { ascending: false })
        .limit(limit)
      if (error) throw error
      return data || []
    },
    enabled: !!profileId,
    refetchInterval: 15000,
  })
}

export function useRepUnreadCount(profileId) {
  return useQuery({
    queryKey: ['rep-notifications-unread', profileId],
    queryFn: async () => {
      const { count, error } = await supabase
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('profile_id', profileId)
        .eq('read', false)
      if (error) throw error
      return count ?? 0
    },
    enabled: !!profileId,
    refetchInterval: 15000,
  })
}

export function useRepMarkNotificationRead(profileId) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id) => {
      const { error } = await supabase
        .from('notifications')
        .update({ read: true })
        .eq('id', id)
        .eq('profile_id', profileId)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['rep-notifications', profileId] })
      qc.invalidateQueries({ queryKey: ['rep-notifications-unread', profileId] })
    },
  })
}

export function useRepMarkAllRead(profileId) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('notifications')
        .update({ read: true })
        .eq('profile_id', profileId)
        .eq('read', false)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['rep-notifications', profileId] })
      qc.invalidateQueries({ queryKey: ['rep-notifications-unread', profileId] })
    },
  })
}
