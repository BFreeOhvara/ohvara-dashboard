import { useContext } from 'react'
import { QueryClient, QueryClientContext, useQuery, useMutation } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { askAgainUnlessMissing } from './useVaShiftsPolicy'
import {
  shiftKeys, companyDay, weekStart, toShiftView,
  readShiftsToday, readShiftWeek, readDayOffRequests, readVaTeam,
  requestDayOff, cancelDayOff, decideDayOff, saveShift, removeShift,
} from '../lib/vaShifts'

// VA shifts, the rota and day-off requests (Prompt 851, migration 231). The
// logic lives in ../lib/vaShifts (tested there); these are thin React Query
// wrappers. Not wired into any page yet: Phase 2 swaps the VA shell's sample
// useFulShift (P846) and the admin rota builder (P849) onto these. While 231 is
// not applied every read resolves to null, so a page can keep its sample data.
// Phase 2: the template previews (/template/...) render without the app's QueryClientProvider. There these hooks sit
// idle on a client of their own (nothing is fetched) and the pages keep the sample rota.
const idle = new QueryClient({ defaultOptions: { queries: { enabled: false, retry: false } } })
function useClient() {
  const qc = useContext(QueryClientContext)
  return qc ? [qc, true] : [idle, false]
}

// P915: the days off a month each VA may book (app_settings.va_days_off_per_month via day_off_allowance, migration
// 253). null until loaded or before 253 is applied (the drawer then uses the default and the server still decides).
export function useDayOffAllowance() {
  const [client, on] = useClient()
  return useQuery({
    enabled: on,
    queryKey: ['va-shifts', 'day-off-allowance'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('day_off_allowance')
      if (error) return null
      return Number.isFinite(Number(data)) ? Number(data) : null
    },
    staleTime: 10 * 60e3,
  }, client)
}

// Who is on shift that day (default today, Central).
export function useVaShiftsToday(day = null) {
  const [client, on] = useClient()
  return useQuery({
    enabled: on,
    queryKey: shiftKeys.today(day),
    ...askAgainUnlessMissing(5 * 60e3),
    queryFn: () => readShiftsToday(supabase, day),
  }, client)
}

// The rota for a run of days. va narrows it to one VA (a VA may only ask for themselves).
export function useVaShiftWeek({ from = null, days = 7, va = null, enabled = true } = {}) {
  const [client, on] = useClient()
  return useQuery({
    enabled: on && enabled,
    ...askAgainUnlessMissing(),
    queryKey: shiftKeys.week(from, days, va),
    queryFn: () => readShiftWeek(supabase, { from, days, va }),
  }, client)
}

// The signed-in VA's shift view: this week and next, in the shape the VA shell
// already renders. data is null until 231 is applied.
export function useVaShiftView({ weeks = 2 } = {}) {
  const today = companyDay()
  const from = weekStart(today)
  const [client, on] = useClient()
  return useQuery({
    enabled: on,
    ...askAgainUnlessMissing(5 * 60e3),
    queryKey: [...shiftKeys.week(from, weeks * 7, null), 'view'],
    queryFn: async () => {
      const rows = await readShiftWeek(supabase, { from, days: weeks * 7 })
      return rows === null ? null : toShiftView(rows, { today, from, weeks })
    },
  }, client)
}

// Admin: day-off requests from today on.
export function useDayOffRequests({ enabled = true } = {}) {
  const [client, on] = useClient()
  return useQuery({
    enabled: on && enabled,
    ...askAgainUnlessMissing(),
    queryKey: shiftKeys.requests(),
    queryFn: () => readDayOffRequests(supabase, companyDay()),
  }, client)
}

// Admin rota builder: every active VA (the pool to drag from), or null while 231 isn't applied.
export function useVaTeam({ enabled = true } = {}) {
  const [client, on] = useClient()
  return useQuery({
    enabled: on && enabled,
    ...askAgainUnlessMissing(),
    queryKey: [...shiftKeys.all, 'team'],
    queryFn: () => readVaTeam(supabase),
  }, client)
}

function useShiftMutation(fn) {
  const [client] = useClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: () => client.invalidateQueries({ queryKey: shiftKeys.all }),
  }, client)
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
