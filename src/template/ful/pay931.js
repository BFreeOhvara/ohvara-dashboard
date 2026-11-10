// P931 — Pay: this week's hours as a clean grid, days of the week × the hours of the day, with each day's total and
// the week's. Plain rules (no React) so node --test runs them. A cell is how much of that hour was on the clock (0..1).
import { minOf, hoursOf } from './p879.js'

export const GRID_FROM = 7 // 7 AM
export const GRID_TO = 19 // to 7 PM
export const WEEK_DAYS = [[2, 'Mon'], [3, 'Tue'], [4, 'Wed'], [5, 'Thu'], [6, 'Fri'], [7, 'Sat'], [1, 'Sun']]
export const hourLabel = h => `${((h + 11) % 12) + 1} ${h < 12 ? 'AM' : 'PM'}`

export function hourGrid(sheet, nowMin = 14 * 60, from = GRID_FROM, to = GRID_TO) {
  const hours = Array.from({ length: to - from }, (_, i) => from + i)
  const rows = WEEK_DAYS.map(([day, name]) => {
    const r = sheet.find(x => x.day === day)
    const a = r ? minOf(r.in) : null
    const b = r ? (r.out ? minOf(r.out) : nowMin) : null
    const cells = hours.map(h => {
      if (a == null || b == null) return 0
      const lo = Math.max(a, h * 60)
      const hi = Math.min(b, (h + 1) * 60)
      return Math.max(0, Math.round(((hi - lo) / 60) * 100) / 100)
    })
    return { day, name, cells, hours: r ? hoursOf(r, nowMin) : 0, breakM: r?.breakM || 0, live: !!r?.live, flag: r?.flag || null, in: r?.in || null, out: r?.out || null, off: !r }
  })
  const total = Math.round(rows.reduce((t, r) => t + r.hours, 0) * 100) / 100
  const breaks = rows.reduce((t, r) => t + r.breakM, 0)
  return { hours, rows, total, breaks }
}
