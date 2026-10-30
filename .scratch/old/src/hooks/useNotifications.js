import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

// Prompt 767 — one bell for every role. Rows come only from the database
// (migration 146, notify()); the client reads its own (RLS), marks them read
// through notifications_mark_read and never writes them. Old-shape rows (no
// title) and email/push-only rows (in_bell false) are not shown.

const FEED = ['notifications', 'feed']
const BANNER = ['notifications', 'banner']
const SETTINGS = ['notifications', 'settings']

export function useNotificationFeed(profileId, limit = 100) {
  return useQuery({
    queryKey: [...FEED, profileId, limit],
    enabled: !!profileId,
    refetchInterval: 15000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('notifications')
        .select('id, type, title, detail, link, created_at, read, needs_action')
        .eq('profile_id', profileId)
        .eq('in_bell', true)
        .not('title', 'is', null)
        .order('created_at', { ascending: false })
        .limit(limit)
      if (error) throw error
      return data || []
    },
  })
}

// The red money banner: { kind, title, sub, btn, link } or null.
export function useMoneyBanner(profileId) {
  return useQuery({
    queryKey: [...BANNER, profileId],
    enabled: !!profileId,
    refetchInterval: 60000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('my_money_banner')
      if (error) throw error
      return data || null
    },
  })
}

// ids = null marks everything read.
export function useMarkRead(profileId) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (ids = null) => {
      const { error } = await supabase.rpc('notifications_mark_read', { p_ids: ids })
      if (error) throw error
    },
    onMutate: async (ids = null) => {
      // Mark them read on screen right away; the refetch confirms it.
      await qc.cancelQueries({ queryKey: [...FEED, profileId] })
      qc.setQueriesData({ queryKey: [...FEED, profileId] }, rows =>
        rows?.map(n => (ids === null || ids.includes(n.id) ? { ...n, read: true } : n)))
    },
    onSettled: () => qc.invalidateQueries({ queryKey: [...FEED, profileId] }),
  })
}

export function useNotificationSettings(profileId) {
  return useQuery({
    queryKey: [...SETTINGS, profileId],
    enabled: !!profileId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('my_notification_settings')
      if (error) throw error
      return data || []
    },
  })
}

export function useSetNotificationEmail(profileId) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ type, on }) => {
      const { error } = await supabase.rpc('set_notification_email', { p_type: type, p_on: on })
      if (error) throw error
    },
    onMutate: ({ type, on }) => {
      qc.setQueryData([...SETTINGS, profileId], rows => rows?.map(r => (r.type === type ? { ...r, email_on: on } : r)))
    },
    onSettled: () => qc.invalidateQueries({ queryKey: [...SETTINGS, profileId] }),
  })
}
