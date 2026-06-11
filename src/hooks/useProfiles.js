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
        .order('created_at', { ascending: true })
      if (error) throw error
      return data
    },
  })
}

export function useCreateProfile() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ username, password, full_name, role }) => {
      const { data, error } = await supabase.functions.invoke('admin-create-user', {
        body: { username, password, full_name, role },
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

export function useDeleteUser() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ userId }) => {
      const { data, error } = await supabase.functions.invoke('admin-delete-user', {
        body: { user_id: userId },
      })
      if (error) throw error
      return data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['profiles'] })
    },
  })
}

const BOOKED_OUTCOMES = ['Booked', 'Appointment Booked']

// Today's KPI counters for the rep dashboard — sourced from the calls
// table with a UTC-midnight cutoff, so all three (calls, bookings,
// booking rate) reset at 00:00 UTC alongside the daily batch cron.
export function useTodayCallStats(repId) {
  return useQuery({
    queryKey: ['stats', repId, 'today'],
    staleTime: 0,
    queryFn: async () => {
      const utcMidnight = new Date().toISOString().split('T')[0] + 'T00:00:00Z'
      const { data, error } = await supabase
        .from('calls')
        .select('id, outcome')
        .eq('rep_id', repId)
        .gte('created_at', utcMidnight)
      if (error) throw error
      const calls  = data?.length || 0
      const booked = (data || []).filter(c => BOOKED_OUTCOMES.includes(c.outcome)).length
      return {
        calls,
        booked,
        bookingRate: calls ? Math.round((booked / calls) * 100) : 0,
      }
    },
    enabled: !!repId,
  })
}

export function useRepStats(repId, period = 'week') {
  return useQuery({
    queryKey: ['stats', repId, period],
    // Stats refetch on every invalidation (CallModal invalidates ['stats']
    // whenever an outcome is logged) — keep them fresh, never cached stale.
    staleTime: 0,
    queryFn: async () => {
      const cutoff = getPeriodCutoff(period)

      const [callsRes, totalRes] = await Promise.all([
        supabase
          .from('calls')
          .select('id, duration_seconds, outcome, created_at')
          .eq('rep_id', repId)
          .gte('created_at', cutoff),
        supabase
          .from('leads')
          .select('id')
          .eq('assigned_rep_id', repId),
      ])

      const calls  = callsRes.data || []
      // Bookings come from call outcomes — the rep flow logs a calls row
      // per outcome; appointments are created later by closers.
      const booked = calls.filter(c => BOOKED_OUTCOMES.includes(c.outcome)).length
      return {
        totalCalls: calls.length,
        totalDials: calls.length,
        bookedCount: booked,
        totalLeads: totalRes.data?.length || 0,
        avgCallDuration: calls.length
          ? Math.round(calls.reduce((s, c) => s + (c.duration_seconds || 0), 0) / calls.length)
          : 0,
        bookingRate: calls.length
          ? (booked / calls.length * 100).toFixed(1)
          : '0',
      }
    },
    enabled: !!repId,
  })
}

// Daily dials + bookings for the past 7 days — feeds the My Stats bar chart
export function useRepDailyActivity(repId) {
  return useQuery({
    queryKey: ['stats', repId, 'daily7'],
    staleTime: 0,
    queryFn: async () => {
      const since = new Date()
      since.setDate(since.getDate() - 6)
      since.setHours(0, 0, 0, 0)

      const { data, error } = await supabase
        .from('calls')
        .select('id, outcome, created_at')
        .eq('rep_id', repId)
        .gte('created_at', since.toISOString())
      if (error) throw error

      // Build a 7-day series ending today (local days)
      const days = []
      for (let i = 6; i >= 0; i--) {
        const d = new Date()
        d.setDate(d.getDate() - i)
        d.setHours(0, 0, 0, 0)
        days.push({
          key: d.toDateString(),
          label: d.toLocaleDateString('en-US', { weekday: 'short' }),
          calls: 0,
          bookings: 0,
        })
      }
      const byKey = Object.fromEntries(days.map(d => [d.key, d]))
      for (const c of data || []) {
        const k = new Date(c.created_at).toDateString()
        const day = byKey[k]
        if (!day) continue
        day.calls += 1
        if (BOOKED_OUTCOMES.includes(c.outcome)) day.bookings += 1
      }
      return days
    },
    enabled: !!repId,
  })
}

function getPeriodCutoff(period) {
  const d = new Date()
  if (period === 'day')   d.setDate(d.getDate() - 1)
  else if (period === 'week')  d.setDate(d.getDate() - 7)
  else if (period === 'month') d.setMonth(d.getMonth() - 1)
  return d.toISOString()
}
