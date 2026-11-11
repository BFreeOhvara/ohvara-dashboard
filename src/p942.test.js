import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dailyCounts, sampleTrend, trendRows, TREND_DAYS, TREND_RANGES } from './template/leadTrend.js'
import { leadTrendOf, realClock } from './lib/admReal.js'
import { LEAD_LANES } from './adminshell/words.js'

const src = p => readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

// P942 (Brayden, Nov 10): the Overview leads chart is shadcn's "Area Chart - Interactive" with three ranges.
test('the leads trend: 91 days, three ranges, Last 7 days ends today (P945)', () => {
  assert.deepEqual(TREND_RANGES.map(r => r.label), ['Last 7 days', 'Last 30 days', 'Last 3 months'])
  const rows = dailyCounts('2026-11-05', { in: ['2026-11-05T10:00', '2026-11-05T11:00', '2026-11-02', '2026-08-01'], sold: ['2026-11-05'] })
  assert.equal(rows.length, TREND_DAYS)
  assert.equal(rows.at(-1).date, '2026-11-05')
  assert.equal(rows.at(-1).in, 2)
  assert.equal(rows.at(-1).sold, 1)
  assert.equal(rows.reduce((t, r) => t + r.in, 0), 3, 'a date older than 91 days is left out')
  const wk = trendRows(rows, '7d', '2026-11-05', ['in', 'sold'])
  assert.deepEqual(wk.map(r => r.name), ['Fri', 'Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu'])
  assert.equal(wk.at(-1).date, '2026-11-05', 'always full: the last 7 days end today')
  assert.ok(wk.every(r => !r.later))
  assert.equal(trendRows(rows, '30d', '2026-11-05', ['in']).length, 30)
  assert.equal(trendRows(rows, '90d', '2026-11-05', ['in']).length, 90)
})

test('the sample history keeps this week as the page shows it, and sold never beats came in', () => {
  const rows = sampleTrend('2026-11-05', { ratio: { delivered: 0.6, sold: 0.15 }, week: [{ offset: 0, values: { in: 9, delivered: 7, sold: 2 } }] })
  assert.deepEqual(rows.find(r => r.date === '2026-11-02'), { date: '2026-11-02', in: 9, delivered: 7, sold: 2 })
  assert.ok(rows.every(r => r.sold <= r.in && r.delivered <= r.in))
})

test('real admin trend: came in, delivered (reached an agent) and sold, by the Central day it came in', () => {
  const clock = realClock(Date.parse('2026-11-05T18:00:00Z'))
  const rows = leadTrendOf([
    { created_at: '2026-11-05T15:00:00Z', assigned_rep_id: 'a1' },
    { created_at: '2026-11-05T16:00:00Z', assigned_rep_id: 'a1', outcome: 'sold' },
    { created_at: '2026-11-05T17:00:00Z', assigned_rep_id: 'a1', va_outcome: 'not_reached' },
    { created_at: '2026-11-05T17:30:00Z', assigned_rep_id: null },
    { created_at: '2026-11-05T17:40:00Z', assigned_rep_id: 'a1', is_sample: true },
    { created_at: '2026-11-06T03:00:00Z', assigned_rep_id: 'a1' }, // 9 PM Thursday in Central
  ], clock)
  const today = rows.at(-1)
  assert.equal(today.date, '2026-11-05')
  assert.deepEqual([today.in, today.delivered, today.sold], [5, 3, 1])
})

test('Leads board: Delivered column, search first, Showing range, no status list or type switch', () => {
  assert.equal(LEAD_LANES[0].label, 'Delivered')
  const s = src('./adminshell/screens/Leads.jsx')
  const tools = s.slice(s.indexOf('adm-leads-tools'))
  assert.ok(tools.indexOf('fx-find') < tools.indexOf('adm-showing'), 'search first')
  assert.match(s, /\{ key: 'today', label: 'Today' \}, \{ key: 'week', label: 'This week' \}, \{ key: 'all', label: 'All' \}/)
  assert.doesNotMatch(s, /label="Status"|label="Type"|'Live calls'/)
  assert.doesNotMatch(s, /l\.day === 5/, 'Today follows the real clock')
})

test('AI calls: stat cards and outcome-coloured call cards with a transcript slide-in', () => {
  const s = src('./adminshell/screens/AiCalls892.jsx')
  for (const w of ['Calls today', 'To first call', 'Reached', 'Delivered', 'Cost today', 'Transcript', '<CallSheet']) assert.ok(s.includes(w), w)
  for (const g of ['delivered', 'not_now', 'no_answer', 'not_interested']) assert.ok(s.includes(`${g}:`) || s.includes(`'${g}'`), g)
  assert.doesNotMatch(src('./adminshell/ai942.css'), /#[0-9a-fA-F]{3,8}\b/, 'tokens only')
})

test('the three calendars share the agent week switch and day headers', () => {
  const team = src('./adminshell/screens/Team.jsx')
  assert.match(team, /cal910\.css/)
  assert.match(team, /fx-week cal910 adm-week/)
  assert.doesNotMatch(team, /className=\{`adm-dayhead/)
  // P947: one top row for all three, from one file (CalBar: the week switch, the clock line, Today)
  assert.match(src('./template/CalBar.jsx'), /<Seg label="Week" className="cal-wk"/)
  for (const f of ['./template/screens/Calendar.jsx', './template/ful/screens/Calendar.jsx', './adminshell/screens/Team.jsx']) {
    assert.match(src(f), /<CalBar /)
    assert.doesNotMatch(src(f), /<Seg label="Week" className="cal-wk"/)
  }
})
