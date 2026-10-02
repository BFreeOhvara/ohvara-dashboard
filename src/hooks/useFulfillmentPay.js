import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

// Getting Paid (Prompt 681, migration 115) — tracking only, no payroll.
// fulfillment_pay holds each rep's hourly rate + scheduled shift (admin
// writes, rep reads their own); fulfillment_time_entries holds clock-in /
// clock-out pairs. RLS is the boundary: a rep only ever reads their own rows,
// admin reads everyone's. The server stamps clock times, so the client just
// says "in" or "out".

const KEY = ['fulfillment-pay']

// `profileId: null` = every row RLS allows (admin: all reps).
export function useFulfillmentPay(profileId = null, enabled = true) {
  return useQuery({
    queryKey: [...KEY, 'pay', profileId ?? 'all'],
    enabled,
    queryFn: async () => {
      let q = supabase.from('fulfillment_pay').select('*')
      if (profileId) q = q.eq('profile_id', profileId)
      const { data, error } = await q
      if (error) throw error
      return data || []
    },
  })
}

// Entries that overlap the window starting at `since` (plus any still open).
export function useTimeEntries(profileId = null, since) {
  return useQuery({
    queryKey: [...KEY, 'entries', profileId ?? 'all', since],
    enabled: !!since,
    queryFn: async () => {
      let q = supabase
        .from('fulfillment_time_entries')
        .select('id, profile_id, clock_in, clock_out')
        .or(`clock_out.is.null,clock_out.gte.${since}`)
        .order('clock_in', { ascending: false })
      if (profileId) q = q.eq('profile_id', profileId)
      const { data, error } = await q
      if (error) throw error
      return data || []
    },
  })
}

// Directory columns only (migration 112's grant) — enough to list the team.
export function useFulfillmentReps() {
  return useQuery({
    queryKey: [...KEY, 'reps'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, avatar_url, avatar_color, is_active')
        .eq('role', 'fulfillment')
        .order('full_name')
      if (error) throw error
      return data || []
    },
  })
}

export function useClockIn() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('fulfillment_time_entries').insert({})
      if (error) {
        if (error.code === '23505') throw new Error("You're already clocked in.")
        throw error
      }
    },
    onSettled: () => qc.invalidateQueries({ queryKey: KEY }),
  })
}

// The guard trigger replaces clock_out with the server's now(); the value
// sent only has to be non-null.
export function useClockOut() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (entryId) => {
      const { data, error } = await supabase
        .from('fulfillment_time_entries')
        .update({ clock_out: new Date().toISOString() })
        .eq('id', entryId)
        .is('clock_out', null)
        .select('id')
      if (error) throw error
      if (!data?.length) throw new Error('That shift was already closed.')
    },
    onSettled: () => qc.invalidateQueries({ queryKey: KEY }),
  })
}

// Admin only (RLS).
export function useSavePay() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ profileId, hourlyRateCents, shiftDays, shiftStart, shiftEnd }) => {
      const { error } = await supabase.from('fulfillment_pay').upsert({
        profile_id: profileId,
        hourly_rate_cents: hourlyRateCents,
        shift_days: shiftDays,
        shift_start: shiftStart || null,
        shift_end: shiftEnd || null,
      })
      if (error) throw error
    },
    onSettled: () => qc.invalidateQueries({ queryKey: KEY }),
  })
}

// Admin only (RLS) — close a shift a rep forgot to clock out of.
export function useAdminCloseEntry() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, clockOut }) => {
      const { error } = await supabase.from('fulfillment_time_entries').update({ clock_out: clockOut }).eq('id', id)
      if (error) throw error
    },
    onSettled: () => qc.invalidateQueries({ queryKey: KEY }),
  })
}
