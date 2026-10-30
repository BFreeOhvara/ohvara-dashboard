import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

// Getting Paid (Prompt 681, migration 115) — tracking only, no payroll.
// fulfillment_pay holds each rep's hourly rate + scheduled shift (admin
// writes, rep reads their own). Hours are computed from that shift (Prompt
// 685); nothing here reads or writes fulfillment_time_entries any more.

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
