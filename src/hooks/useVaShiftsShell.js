import { useFulShift, useFulActions, plugRealShift } from '../template/ful/data'
import { useVaShiftView, useRequestDayOff, useCancelDayOff, useDayOffAllowance } from './useVaShifts'
import { DAYS_OFF_DEFAULT, canBookDayOff, daysUsed } from '../lib/dayOff'

// P851 Phase 2 — the VA shell (src/template/ful) on real shifts. Imported by ../template/ful/Shift, which every VA
// page loads through FulFrame, so the plug below is in place before the first render. Until migration 231 is applied
// (or with no VA signed in) useVaShiftView has no data and the VA pages keep P846's sample rota.

plugRealShift(function useRealShift() {
  const { data } = useVaShiftView()
  if (!data) return null
  return { ...data, live: true, me: data.me || { id: 'me', name: 'You', me: true } }
})

// Ask for or take back a day off: the real request when live, the sample one otherwise. Both return promises.
// d / o = a day or day-off from useFulShift (both carry date = YYYY-MM-DD and day = day of the month).
// P915: VAs book their own days inside a monthly allowance (src/lib/dayOff.js, the same rule the admin page shows; the
// server enforces it too). check(d) says whether that day can still be booked and how many of that month are used.
export function useDayOffActions() {
  const { data: s } = useFulShift()
  const sample = useFulActions()
  const ask = useRequestDayOff()
  const take = useCancelDayOff()
  const { data: serverAllowance } = useDayOffAllowance()
  const allowance = (s.live ? serverAllowance : null) ?? s.daysOffPerMonth ?? DAYS_OFF_DEFAULT
  const check = d => {
    const month = String(d?.date || '').slice(0, 7)
    const rows = (s.dayOffs || []).filter(o => String(o.date || '').slice(0, 7) === month).map(o => ({ va_id: 'me', date: o.date, status: o.status }))
    return { ...canBookDayOff(rows, 'me', d?.date, allowance), used: daysUsed(rows, 'me'), allowance }
  }
  return {
    allowance, check,
    request: async (d, why) => {
      const c = check(d)
      if (!c.ok) throw new Error(c.why)
      return s.live ? ask.mutateAsync({ day: d.date, reason: why }) : sample.requestDayOff(d.day, why)
    },
    cancel: async o => (s.live ? take.mutateAsync({ day: o.date }) : sample.cancelDayOff(o.day)),
  }
}
