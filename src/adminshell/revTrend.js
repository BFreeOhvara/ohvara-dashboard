// P943 — the Revenue page's stock-style chart: one row per day of what Ohvara earned (plan fees, the booking desk fee,
// setup fees) and what it cost (VA pay, AI minutes, card fees), then a rolling 7-day sum so the line moves like a
// stock price. The same rules as the cards above (moneyFor in data.js): plan fees accrue a seventh of the week's share
// a day, the booking desk is PRICES.leadFee of that day's lead spend, setup fees land the day paid, VA pay lands on the
// Monday the run is paid, card fees are CARD_FEE of everything charged that day (revenue + the lead spend passing
// through). Agent lead spend rides along only for the card fee; it's never in revenue, costs or kept.
// No React, no Supabase.

const DAY = 864e5
const at = iso => new Date(`${iso}T12:00:00Z`)
export const addDays = (iso, n) => new Date(at(iso).getTime() + n * DAY).toISOString().slice(0, 10)
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
export const shortOf = iso => { const d = at(iso); return `${MON[d.getUTCMonth()]} ${d.getUTCDate()}` }
export const fullOf = iso => { const d = at(iso); return `${DOW[d.getUTCDay()]}, ${MON[d.getUTCMonth()]} ${d.getUTCDate()}` }
export const monthOf = iso => { const d = at(iso); return `${MON[d.getUTCMonth()]} ’${String(d.getUTCFullYear()).slice(2)}` }
export const dowOf = iso => DOW[at(iso).getUTCDay()]

export const RANGES = [
  { key: '1w', label: '1W', days: 7, text: 'the last week' },
  { key: '1m', label: '1M', days: 30, text: 'the last month' },
  { key: '3m', label: '3M', days: 91, text: 'the last 3 months' },
  { key: '1y', label: '1Y', days: 365, text: 'the last year' },
  { key: 'all', label: 'All', days: null, text: 'all time' },
]
export const WINDOW = 7
const PARTS = ['plans', 'fee', 'setup', 'leadSpend', 'va', 'ai', 'card']
const blank = date => ({ date, plans: 0, fee: 0, setup: 0, leadSpend: 0, va: 0, ai: 0, card: 0 })

// Lead spend falls more on weekdays than weekends; the weights add up to 7, so a week's total stays the week's total.
const WEIGHT = [0.62, 1.16, 1.14, 1.12, 1.1, 1.08, 0.78] // Sun..Sat
const WSUM = WEIGHT.reduce((t, w) => t + w, 0)

// Spread one week's totals over its 7 days (Monday first). Exact: the 7 days add up to the week.
// `wobble` (0-1) varies the days a little (the same every load) and still adds up to the week, so a rolling line
// built from spread weeks moves like a price instead of straight ramps.
export function spreadWeek(startIso, { plans = 0, leads = 0, setup = 0 }, { feeRate, aiRate = 0, wobble = 0 } = {}) {
  const raw = Array.from({ length: 7 }, (_, i) => {
    const date = addDays(startIso, i)
    const n = Math.sin((at(date).getTime() / DAY) * 12.9898) * 43758.5453
    return WEIGHT[at(date).getUTCDay()] * (1 + wobble * ((n - Math.floor(n)) - 0.5) * 2)
  })
  const sum = raw.reduce((t, w) => t + w, 0) || WSUM
  // Plan fees land on billing days, so they wobble too (no weekday rhythm).
  const pr = Array.from({ length: 7 }, (_, i) => { const n = Math.sin((at(addDays(startIso, i)).getTime() / DAY) * 78.233) * 12543.17; return 1 + wobble * 1.4 * ((n - Math.floor(n)) - 0.5) * 2 })
  const psum = pr.reduce((t, w) => t + w, 0)
  return Array.from({ length: 7 }, (_, i) => {
    const date = addDays(startIso, i)
    const w = raw[i] / sum
    const leadSpend = leads * w
    return { ...blank(date), plans: plans * (pr[i] / psum), leadSpend, fee: leadSpend * feeRate, setup: i === 0 ? setup : 0, ai: leadSpend * aiRate }
  })
}

// Merge day rows into one map keyed by date (later sources add to earlier ones), then fill every day from the first
// to `todayIso` (missing days are zero) and add card fees and pay runs.
export function buildDays({ todayIso, parts = [], runs = [], cardRate = 0 }) {
  const map = new Map()
  for (const r of parts.flat()) {
    if (!r?.date || r.date > todayIso) continue
    const row = map.get(r.date) || blank(r.date)
    for (const k of PARTS) if (k !== 'card' && Number.isFinite(r[k])) row[k] += r[k]
    map.set(r.date, row)
  }
  for (const run of runs) {
    if (!run?.date || run.date > todayIso || !(run.amount > 0)) continue
    const row = map.get(run.date) || blank(run.date)
    row.va += run.amount
    map.set(run.date, row)
  }
  if (!map.size) return []
  const first = [...map.keys()].sort()[0]
  const out = []
  for (let d = first; d <= todayIso; d = addDays(d, 1)) {
    const r = map.get(d) || blank(d)
    r.card = (r.plans + r.fee + r.setup + r.leadSpend) * cardRate
    out.push(r)
  }
  return out
}

const tot = r => ({ revenue: r.plans + r.fee + r.setup, costs: r.va + r.ai + r.card })

// Rolling sums over the last `win` days for every day. Each row: revenue, kept, costs and their parts, all rounded.
export function rolling(days, win = WINDOW) {
  const acc = blank('')
  return days.map((d, i) => {
    for (const k of PARTS) acc[k] += d[k]
    if (i >= win) for (const k of PARTS) acc[k] -= days[i - win][k]
    const t = tot(acc)
    const r = {}
    for (const k of PARTS) r[k] = Math.max(0, Math.round(acc[k]))
    const revenue = Math.round(t.revenue)
    const costs = Math.round(t.costs)
    return { ...r, date: d.date, revenue, costs, kept: revenue - costs, gap: [revenue - costs, revenue], partial: i < win - 1 }
  })
}

// The rows a range shows (ending today). 'all' starts at the first day with a full 7-day window (or the first day
// if there isn't one yet). A range longer than the history starts where the history does.
export function rangeRows(roll, key) {
  if (!roll.length) return []
  const r = RANGES.find(x => x.key === key) || RANGES[1]
  if (!r.days) { const i = roll.findIndex(x => !x.partial); return roll.slice(i < 0 ? 0 : i) }
  return roll.slice(Math.max(0, roll.length - r.days))
}

// The header: the last 7 days against the 7 days before.
export function headline(roll) {
  const now = roll[roll.length - 1] || { revenue: 0, kept: 0, costs: 0 }
  const prev = roll.length > WINDOW ? roll[roll.length - 1 - WINDOW] : null
  const pct = prev && prev.revenue > 0 ? Math.round(((now.revenue - prev.revenue) / prev.revenue) * 100) : null
  return { revenue: now.revenue, kept: now.kept, costs: now.costs, prev: prev ? prev.revenue : null, pct }
}

// A believable year of sample weeks before the seeded ones: the business starting small and growing into the first
// seeded week, with a little week-to-week wobble. The same every load.
export function sampleHistory(firstIso, first, weeks = 58) {
  return Array.from({ length: weeks }, (_, k) => {
    const i = weeks - k // weeks before the first seeded week
    const g = Math.max(0.06, 1 - i / (weeks + 6)) ** 1.6
    const n = Math.sin((i + 3) * 12.9898) * 43758.5453
    const j = (n - Math.floor(n)) - 0.5
    return {
      startIso: addDays(firstIso, -7 * i),
      plans: Math.round(first.plans * g * (1 + j * 0.05)),
      leads: Math.round(first.leads * g * (1 + j * 0.22)),
      setup: i % 4 === 1 ? 1 : 0,
    }
  })
}

// "Mon, Nov 2" (sample run dates) → ISO in the given year.
export function isoFromText(text, year) {
  const m = /([A-Z][a-z]{2}) (\d{1,2})/.exec(String(text || ''))
  if (!m) return null
  const mi = MON.indexOf(m[1])
  return mi < 0 ? null : `${year}-${String(mi + 1).padStart(2, '0')}-${String(Number(m[2])).padStart(2, '0')}`
}

// P945 — the value of a series between two days, on the same smooth curve the chart draws (recharts type="monotone"
// is d3's curveMonotoneX, Steffen's method), so a hover between days lands on the line. `ys` = one number a day,
// `f` = a fractional day index (0 … ys.length - 1).
const sgn = x => (x < 0 ? -1 : 1)
function monoSlopes(ys) {
  const n = ys.length
  const t = new Array(n).fill(0)
  if (n < 2) return t
  if (n === 2) { t[0] = t[1] = ys[1] - ys[0]; return t }
  for (let i = 1; i < n - 1; i++) {
    const s0 = ys[i] - ys[i - 1]
    const s1 = ys[i + 1] - ys[i]
    const p = (s0 + s1) / 2
    t[i] = (sgn(s0) + sgn(s1)) * Math.min(Math.abs(s0), Math.abs(s1), 0.5 * Math.abs(p)) || 0
  }
  t[0] = (3 * (ys[1] - ys[0]) - t[1]) / 2
  t[n - 1] = (3 * (ys[n - 1] - ys[n - 2]) - t[n - 2]) / 2
  return t
}
export function monoAt(ys, f, slopes = monoSlopes(ys)) {
  const n = ys.length
  if (!n) return 0
  if (n === 1 || f <= 0) return ys[0]
  if (f >= n - 1) return ys[n - 1]
  const i = Math.floor(f)
  const u = f - i
  const p0 = ys[i]
  const p3 = ys[i + 1]
  if (n === 2) return p0 + (p3 - p0) * u
  const p1 = p0 + slopes[i] / 3
  const p2 = p3 - slopes[i + 1] / 3
  const v = 1 - u
  return v * v * v * p0 + 3 * v * v * u * p1 + 3 * v * u * u * p2 + u * u * u * p3
}
export { monoSlopes }
