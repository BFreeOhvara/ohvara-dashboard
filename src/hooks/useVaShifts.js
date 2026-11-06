import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import {
  shiftKeys, companyDay, weekStart, toShiftView,
  readShiftsToday, readShiftWeek, readDayOffRequests,
  requestDayOff, cancelDayOff, decideDayOff, saveShift, removeShift,
} from '../lib/vaShifts'

// VA shifts, the rota and day-off requests (Prompt 851, migration 231). The
// logic lives in ../lib/vaShifts (tested there); these are thin React Query
// wrappers. Not wired into any page yet: Phase 2 swaps the VA shell's sample
// useFulShift (P846) and the admin rota builder (P849) onto these. While 231 is
// not applied every read resolves to null, so a page can keep its sample data.

// Who is on shift that day (default today, Central).
export function useVaShiftsToday(day = null) {
  return useQuery({
    queryKey: shiftKeys.today(day),
    refetchInterval: 5 * 60e3,
    queryFn: () => readShiftsToday(supabase, day),
  })
}

// The rota for a run of days. va narrows it to one VA (a VA may only ask for themselves).
export function useVaShiftWeek({ from = null, days = 7, va = null } = {}) {
  return useQuery({
    queryKey: shiftKeys.week(from, days, va),
    queryFn: () => readShiftWeek(supabase, { from, days, va }),
  })
}

// The signed-in VA's shift view: this week and next, in the shape the VA shell
// already renders. data is null until 231 is applied.
export function useVaShiftView({ weeks = 2 } = {}) {
  const today = companyDay()
  const from = weekStart(today)
  return useQuery({
    queryKey: [...shiftKeys.week(from, weeks * 7, null), 'view'],
    refetchInterval: 5 * 60e3,
    queryFn: async () => {
      const rows = await readShiftWeek(supabase, { from, days: weeks * 7 })
      return rows === null ? null : toShiftView(rows, { today, from, weeks })
    },
  })
}

// Admin: day-off requests from today on.
export function useDayOffRequests() {
  return useQuery({
    queryKey: shiftKeys.requests(),
    queryFn: () => readDayOffRequests(supabase, companyDay()),
  })
}

function useShiftMutation(fn) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: () => qc.invalidateQueries({ queryKey: shiftKeys.all }),
  })
}

// VA: mutate({ day: 'YYYY-MM-DD', reason })
export const useRequestDayOff = () => useShiftMutation(({ day, reason }) => requestDayOff(supabase, day, reason))
// VA: mutate({ day })
export const useCancelDayOff = () => useShiftMutation(({ day }) => cancelDayOff(supabase, day))
// Admin: mutate({ requestId, approve })
export const useDecideDayOff = () => useShiftMutation(({ requestId, approve }) => decideDayOff(supabase, requestId, approve))
// Admin rota builder: mutate({ vaId, day, starts, ends, tz })
export const useSaveShift = () => useShiftMutation(shift => saveShift(supabase, shift))
// Admin rota builder: mutate({ vaId, day })
export const useRemoveShift = () => useShiftMutation(shift => removeShift(supabase, shift))
