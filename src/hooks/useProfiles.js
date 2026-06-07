import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

export function useReps() {
  return useQuery({
    queryKey: ['profiles', 'reps'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('role', 'rep')
        .order('full_name')
      if (error) throw error
      return data
    },
  })
}

export function useAllProfiles() {
  return useQuery({
    queryKey: ['profiles', 'all'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .order('role')
      if (error) throw error
      return data
    },
  })
}

export function useCreateProfile() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ email, password, full_name, role, phone }) => {
      // Create auth user via admin API (requires service role — call via Edge Function)
      const { data, error } = await supabase.functions.invoke('admin-create-user', {
        body: { email, password, full_name, role, phone },
      })
      if (error) throw error
      return data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['profiles'] })
    },
  })
}

export function useToggleUserActive() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ userId, isActive }) => {
      const { data, error } = await supabase.functions.invoke('admin-toggle-user', {
        body: { user_id: userId, is_active: isActive },
      })
      if (error) throw error
      return data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['profiles'] })
    },
  })
}

export function useRepStats(repId, period = 'week') {
  return useQuery({
    queryKey: ['stats', repId, period],
    queryFn: async () => {
      const cutoff = getPeriodCutoff(period)

      const [callsRes, bookedRes, totalRes] = await Promise.all([
        supabase
          .from('calls')
          .select('id, duration_seconds, outcome, created_at')
          .eq('rep_id', repId)
          .gte('created_at', cutoff),
        supabase
          .from('appointments')
          .select('id')
          .eq('rep_id', repId)
          .gte('created_at', cutoff),
        supabase
          .from('leads')
          .select('id')
          .eq('assigned_rep_id', repId),
      ])

      const calls = callsRes.data || []
      return {
        totalCalls: calls.length,
        totalDials: calls.length,
        bookedCount: bookedRes.data?.length || 0,
        totalLeads: totalRes.data?.length || 0,
        avgCallDuration: calls.length
          ? Math.round(calls.reduce((s, c) => s + (c.duration_seconds || 0), 0) / calls.length)
          : 0,
        bookingRate: calls.length
          ? ((bookedRes.data?.length || 0) / calls.length * 100).toFixed(1)
          : '0',
      }
    },
    enabled: !!repId,
  })
}

function getPeriodCutoff(period) {
  const d = new Date()
  if (period === 'day') d.setDate(d.getDate() - 1)
  else if (period === 'week') d.setDate(d.getDate() - 7)
  else if (period === 'month') d.setMonth(d.getMonth() - 1)
  return d.toISOString()
}
