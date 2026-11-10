// P942 — the leads trend behind the Overview area chart (src/template/AreaTrend.jsx), the same for agent and admin.
// Rows are one per day: { date: 'YYYY-MM-DD', name, full, later?, today?, [series]: number }. "This week" is Monday to
// Sunday (days still to come are faint, no value); the other ranges end today.
export const TREND_RANGES = [
  { value: 'week', label: 'This week' },
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 3 months' },
]
export const TREND_DAYS = 91

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const at = iso => new Date(`${iso}T12:00:00Z`)
export const addDays = (iso, n) => new Date(at(iso).getTime() + n * 864e5).toISOString().slice(0, 10)
export const mondayOf = iso => addDays(iso, -((at(iso).getUTCDay() + 6) % 7))
const short = iso => { const d = at(iso); return `${MON[d.getUTCMonth()]} ${d.getUTCDate()}` }
const full = iso => { const d = at(iso); return `${DOW[d.getUTCDay()]}, ${MON[d.getUTCMonth()]} ${d.getUTCDate()}` }

// Count dates (ISO strings, only the first 10 characters are read) per day for the last TREND_DAYS days.
export function dailyCounts(todayIso, series) {
  const from = addDays(todayIso, -(TREND_DAYS - 1))
  const rows = Array.from({ length: TREND_DAYS }, (_, i) => ({ date: addDays(from, i) }))
  const idx = new Map(rows.map((r, i) => [r.date, i]))
  Object.entries(series).forEach(([key, dates]) => {
    rows.forEach(r => { r[key] = 0 })
    ;(dates || []).forEach(d => { const i = idx.get(String(d || '').slice(0, 10)); if (i != null) rows[i][key] += 1 })
  })
  return rows
}

// A believable sample history: a gentle wave with weekday/weekend rhythm, the same every load. The last days of the
// current week are replaced by `week` (the counts the page already shows), so the chart and the numbers agree.
export function sampleTrend(todayIso, { base = 14, ratio = { sold: 0.16 }, week = null, seed = 7 } = {}) {
  const from = addDays(todayIso, -(TREND_DAYS - 1))
  const rows = Array.from({ length: TREND_DAYS }, (_, i) => {
    const date = addDays(from, i)
    const dow = at(date).getUTCDay()
    const noise = Math.sin((i + seed) * 12.9898) * 43758.5453
    const jitter = (noise - Math.floor(noise)) - 0.5
    const wave = 1 + 0.28 * Math.sin((i + seed) / 9) + 0.12 * Math.sin((i + seed) / 3.3)
    const grow = 0.75 + 0.35 * (i / TREND_DAYS)
    const wk = dow === 0 || dow === 6 ? 0.8 : 1
    const came = Math.max(1, Math.round(base * wave * grow * wk * (1 + jitter * 0.18)))
    const row = { date, in: came }
    Object.entries(ratio).forEach(([k, r]) => { row[k] = Math.min(came, Math.max(0, Math.round(came * r * (1 + jitter * 0.6)))) })
    return row
  })
  if (week) {
    const mon = mondayOf(todayIso)
    week.forEach(w => { const r = rows.find(x => x.date === addDays(mon, w.offset)); if (r) Object.assign(r, w.values) })
  }
  return rows
}

// The rows for one range, labelled for the axis and tooltip.
export function trendRows(rows, range, todayIso, keys) {
  const label = r => ({ ...r, name: short(r.date), full: full(r.date), today: r.date === todayIso })
  if (range === 'week') {
    const mon = mondayOf(todayIso)
    return Array.from({ length: 7 }, (_, i) => {
      const date = addDays(mon, i)
      const r = rows.find(x => x.date === date)
      const later = date > todayIso
      const row = { date, later }
      keys.forEach(k => { row[k] = later ? null : (r?.[k] ?? 0) })
      return { ...label(row), name: DOW[at(date).getUTCDay()] }
    })
  }
  const n = range === '30d' ? 30 : 90
  const from = addDays(todayIso, -(n - 1))
  return rows.filter(r => r.date >= from && r.date <= todayIso).map(label)
}
