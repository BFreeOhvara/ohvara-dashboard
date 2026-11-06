import { useFulShift, useFulActions, plugRealShift } from '../template/ful/data'
import { useVaShiftView, useRequestDayOff, useCancelDayOff } from './useVaShifts'

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
export function useDayOffActions() {
  const { data: s } = useFulShift()
  const sample = useFulActions()
  const ask = useRequestDayOff()
  const take = useCancelDayOff()
  return {
    request: async (d, why) => (s.live ? ask.mutateAsync({ day: d.date, reason: why }) : sample.requestDayOff(d.day, why)),
    cancel: async o => (s.live ? take.mutateAsync({ day: o.date }) : sample.cancelDayOff(o.day)),
  }
}
