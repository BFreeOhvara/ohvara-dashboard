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

export function useRepCredentials(profileId, enabled) {
  return useQuery({
    queryKey: ['rep_credentials', profileId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('rep_credentials')
        .select('username, password')
        .eq('profile_id', profileId)
        .maybeSingle()
      if (error) throw error
      return data
    },
    enabled: !!profileId && !!enabled,
    staleTime: Infinity,
  })
}

export function useCreateProfile() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ username, password, full_name, role, timezone }) => {
      const { data, error } = await supabase.functions.invoke('admin-create-user', {
        body: { username, password, full_name, role, timezone },
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

// Today's KPI counters for the rep dashboard — THE single source of truth.
// All headline "today" numbers (Calls Today, Booked Today, Booking Rate,
// Batch Total) come from the rep_today_metrics RPC (migration 026), which
// aggregates server-side against a UTC-calendar-day cutoff so My Leads,
// My Stats (Day) and the Goals widget can never diverge. No component
// recomputes these locally.
export function useTodayCallStats(repId) {
  return useQuery({
    queryKey: ['stats', repId, 'today'],
    staleTime: 0,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('rep_today_metrics', { p_rep_id: repId })
      if (error) throw error
      const m = data?.[0] || {}
      return {
        calls: m.calls ?? 0,
        booked: m.booked ?? 0,
        bookingRate: m.booking_rate ?? 0,
        batchTotal: m.batch_total ?? 0,
        dailyTarget: m.daily_target ?? DAILY_BATCH_TARGET,
      }
    },
    enabled: !!repId,
  })
}

// Rep's commission earned — 50% of the setup fee per closed deal (the UI
// shows the percentage framing, never the dollar math). Reads the
// commissions table (RLS: recipient sees own rows); voided commissions
// don't count. Returns totals plus the raw rows so the My Commissions
// page can chart daily earnings.
export function useMyCommission(repId) {
  return useQuery({
    queryKey: ['commissions', repId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('commissions')
        .select('amount, status, tier, commission_type, created_at')
        .eq('recipient_id', repId)
        .neq('status', 'voided')
        .order('created_at', { ascending: true })
      if (error) throw error
      const total = (data || []).reduce((sum, c) => sum + Number(c.amount || 0), 0)
      return { total, deals: data?.length || 0, rows: data || [] }
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
// Completed days — how many of the rep's assigned leads they actually worked
// each day, from the calls table (net: one row per lead per day, deleted on
// revert). A day is "complete" when the rep dialed the full daily batch.
export const DAILY_BATCH_TARGET = 150

export function useCompletedDays(repId, numDays = 21) {
  return useQuery({
    queryKey: ['stats', repId, 'completed-days', numDays],
    staleTime: 0,
    queryFn: async () => {
      // Single source: rep_completed_days RPC (migration 026) — distinct
      // leads dialed per UTC day vs the 150 target, computed server-side.
      const since = new Date()
      since.setDate(since.getDate() - numDays)
      const [rpc, calls] = await Promise.all([
        supabase.rpc('rep_completed_days', { p_rep_id: repId, p_days: numDays }),
        supabase
          .from('calls')
          .select('created_at')
          .eq('rep_id', repId)
          .eq('outcome', 'Appointment Booked')
          .gte('created_at', since.toISOString()),
      ])
      if (rpc.error) throw rpc.error
      const bookingsByDay = {}
      for (const c of calls.data || []) {
        const day = c.created_at.slice(0, 10)
        bookingsByDay[day] = (bookingsByDay[day] || 0) + 1
      }
      return (rpc.data || []).map(d => ({
        day: d.day,
        label: new Date(d.day).toLocaleDateString('en-US', {
          month: 'short', day: 'numeric', timeZone: 'UTC',
        }),
        dialed: d.dialed,
        completed: d.completed,
        bookings: bookingsByDay[d.day] || 0,
      }))
    },
    enabled: !!repId,
  })
}

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

// Lifetime call activity for milestone badges — streaks, day records and
// time-of-day achievements that period stats can't answer. Calls are net
// (one row per lead per rep per UTC day), so rows-per-day ≈ leads dialed.
export function useBadgeActivity(repId) {
  return useQuery({
    queryKey: ['stats', repId, 'badge-activity'],
    staleTime: 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('calls')
        .select('outcome, created_at')
        .eq('rep_id', repId)
        .order('created_at', { ascending: true })
      if (error) throw error

      const byDay = new Map()
      let earlyBird = false, nightOwl = false, backToBack = false, bookedRun = 0
      for (const c of data || []) {
        const d = new Date(c.created_at)
        const key = d.toDateString()
        const day = byDay.get(key) || { dials: 0, bookings: 0, ts: new Date(d).setHours(0, 0, 0, 0) }
        day.dials += 1
        const isBooked = BOOKED_OUTCOMES.includes(c.outcome)
        if (isBooked) day.bookings += 1
        byDay.set(key, day)
        if (d.getHours() < 9) earlyBird = true
        if (d.getHours() >= 20) nightOwl = true
        bookedRun = isBooked ? bookedRun + 1 : 0
        if (bookedRun >= 2) backToBack = true
      }

      const days = [...byDay.values()].sort((a, b) => a.ts - b.ts)

      // Completed day = 150+ dials (rounding absorbs DST shifts).
      const completedDaysArr = days.filter(d => d.dials >= DAILY_BATCH_TARGET)

      // Track 1 — longest run of consecutive WEEKDAY completed days (Mon–Fri).
      // Weekends are skipped, not breaks: Fri → Mon counts as consecutive, and a
      // completed Sat/Sun neither adds to the streak nor resets it. A streak
      // breaks only when a weekday between two completed days was missed.
      const isWeekendTs = ts => { const wd = new Date(ts).getDay(); return wd === 0 || wd === 6 }
      const nextWeekdayTs = ts => {
        const d = new Date(ts)
        d.setDate(d.getDate() + 1)
        while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1)
        return d.setHours(0, 0, 0, 0)
      }
      const weekdayCompleted = completedDaysArr.filter(d => !isWeekendTs(d.ts))
      let longestStreak = 0, run = 0, prevWd = null
      for (const day of weekdayCompleted) {
        run = prevWd !== null && nextWeekdayTs(prevWd) === day.ts ? run + 1 : 1
        longestStreak = Math.max(longestStreak, run)
        prevWd = day.ts
      }

      // Track 2 — lifetime cumulative completed days (weekends included,
      // consecutiveness not required). Never resets.
      const totalCompletedDays = completedDaysArr.length

      // Perfect day = 150+ dials AND 2+ bookings in a single day.
      const perfectDaysArr = days.filter(d => d.dials >= DAILY_BATCH_TARGET && d.bookings >= 2)
      const perfectDay = perfectDaysArr.length > 0

      // Track 3 — lifetime cumulative perfect days (never resets).
      const totalPerfectDays = perfectDaysArr.length

      // Track 4 — longest run of consecutive WEEKDAY perfect days. Same
      // weekday-skip logic as longestStreak, but only perfect days count.
      const weekdayPerfect = perfectDaysArr.filter(d => !isWeekendTs(d.ts))
      let perfectStreak = 0, pRun = 0, pPrevWd = null
      for (const day of weekdayPerfect) {
        pRun = pPrevWd !== null && nextWeekdayTs(pPrevWd) === day.ts ? pRun + 1 : 1
        perfectStreak = Math.max(perfectStreak, pRun)
        pPrevWd = day.ts
      }

      return {
        longestStreak,
        totalCompletedDays,
        perfectStreak,
        totalPerfectDays,
        bestDayDials: days.reduce((m, d) => Math.max(m, d.dials), 0),
        bestDayBookings: days.reduce((m, d) => Math.max(m, d.bookings), 0),
        earlyBird,
        nightOwl,
        backToBack,
        perfectDay,
      }
    },
    enabled: !!repId,
  })
}

function getPeriodCutoff(period) {
  // 'day' is the UTC calendar day, NOT a rolling 24h window — it must match
  // useTodayCallStats exactly so MyStats Day view equals the Calls Today KPI.
  if (period === 'day') return new Date().toISOString().split('T')[0] + 'T00:00:00Z'
  const d = new Date()
  if (period === 'week')  d.setDate(d.getDate() - 7)
  else if (period === 'month') d.setMonth(d.getMonth() - 1)
  return d.toISOString()
}
