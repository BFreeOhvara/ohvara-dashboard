import { useFulShift } from './data'
import { useDayOffActions } from '../../hooks/useVaShiftsShell'
import { companyDay } from '../../lib/vaShifts'

// P946 — time off at a glance (the Overview and Pay boxes): days left this month inside the allowance (P915/P945),
// and the next day off booked. The same count the Schedule's Time off tile shows.
export function useTimeOff() {
  const { data: s } = useFulShift()
  const { check } = useDayOffActions()
  const todayIso = s.live ? companyDay() : s.days?.flat().find(d => d.today)?.date || ''
  const room = check({ date: todayIso })
  const next = (s.dayOffs || []).filter(o => String(o.date) > todayIso).sort((a, b) => String(a.date).localeCompare(String(b.date)))[0] || null
  return { left: Math.max(0, room.allowance - room.used), used: room.used, allowance: room.allowance, next, notSet: !!s.notSet }
}
