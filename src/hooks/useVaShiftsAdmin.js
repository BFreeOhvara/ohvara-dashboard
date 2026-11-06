import { useAdmRota, useAdmVas, useAdmActions, WEEK, NEXT_WEEK, TODAY, dayName as sampleDayName, dateText as sampleDateText } from '../adminshell/data'
import { useVaShiftWeek, useDayOffRequests, useVaTeam, useSaveShift, useRemoveShift, useDecideDayOff } from './useVaShifts'
import { isAdminPreviewPath } from '../adminshell/paths'
import { companyDay, weekStart, dayName, dateLabel, monthDay, rangeText, toAdminRota, toDayOffRows } from '../lib/vaShifts'

// P851 Phase 2 — the admin rota builder and Day off tab (P849, src/adminshell/screens/Team.jsx) on real shifts.
// Once migration 231 is applied and the signed-in person is an admin, this reads va_shift_week (this week and next),
// the day-off requests and the real VA list, and writes through va_shifts / va_decide_day_off. Until then (231 not
// applied, or a preview with no admin session) it hands back P849's sample rota unchanged, so the page looks the same.
// One shape either way; day keys are November day numbers on the sample and YYYY-MM-DD when live.
//   { live, today, weeks: [this, next], weekLabels, rota, dayOff, team, answeredSub,
//     dayName(d), dateText(d), short(d), addShift, removeShift, moveShift, decideDayOff }  (actions return promises)
export function useAdmShifts() {
  const sampleRota = useAdmRota().data
  const sampleVas = useAdmVas().data
  const sample = useAdmActions()
  const today = companyDay()
  const from = weekStart(today)
  // The sample preview (/preview/admin, nobody signed in) asks the backend nothing.
  const enabled = typeof window === 'undefined' || !isAdminPreviewPath(window.location.pathname)
  const week = useVaShiftWeek({ from, days: 14, enabled })
  const requests = useDayOffRequests({ enabled })
  const reps = useVaTeam({ enabled })
  const save = useSaveShift()
  const drop = useRemoveShift()
  const decide = useDecideDayOff()

  const live = Array.isArray(week.data) && Array.isArray(requests.data)
  if (!live) {
    return {
      live: false, today: TODAY, weeks: [WEEK, NEXT_WEEK], weekLabels: ['Nov 2 to 8', 'Nov 9 to 15'],
      rota: sampleRota.rota, dayOff: sampleRota.dayOff, team: sampleVas, answeredSub: 'This month',
      dayName: sampleDayName, dateText: sampleDateText, short: d => `Nov ${d}`,
      addShift: async (d, va) => sample.addShift(d, va),
      removeShift: async (d, va) => sample.removeShift(d, va),
      moveShift: async (a, b, va) => sample.moveShift(a, b, va),
      decideDayOff: async (id, ok) => sample.decideDayOff(id, ok),
    }
  }
  const r = toAdminRota(week.data, { today, from, weeks: 2 })
  const fromRows = new Map(week.data.map(x => [x.va_id, x.full_name]))
  const team = [...(reps.data || [])]
  for (const [id, name] of fromRows) if (!team.some(t => t.id === id)) team.push({ id, name: name || 'VA' })
  return {
    live: true, today, weeks: r.weeks, weekLabels: r.weeks.map(w => rangeText(w[0], w[6])),
    rota: r.rota, dayOff: toDayOffRows(requests.data), team, answeredSub: 'From today on',
    dayName, dateText: dateLabel, short: monthDay,
    addShift: (d, va) => save.mutateAsync({ vaId: va, day: d }),
    removeShift: (d, va) => drop.mutateAsync({ vaId: va, day: d }),
    // Put them on the new day first, so a failed write never leaves them off both.
    moveShift: async (a, b, va) => { await save.mutateAsync({ vaId: va, day: b }); await drop.mutateAsync({ vaId: va, day: a }) },
    decideDayOff: (id, ok) => decide.mutateAsync({ requestId: id, approve: ok }),
  }
}
