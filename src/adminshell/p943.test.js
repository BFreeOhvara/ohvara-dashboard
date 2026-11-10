import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { addDays, buildDays, rolling, rangeRows, headline, spreadWeek, sampleHistory, isoFromText, RANGES } from './revTrend.js'
import { leadSpendTrendOf, realClock } from '../lib/admReal.js'

const src = p => readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

test('a spread week adds up to the week (P943)', () => {
  const days = spreadWeek('2026-10-26', { plans: 1891, leads: 3105, setup: 297 }, { feeRate: 0.12, aiRate: 0.02 })
  const sum = k => days.reduce((t, d) => t + d[k], 0)
  assert.equal(days.length, 7)
  assert.equal(days[0].date, '2026-10-26')
  assert.ok(Math.abs(sum('plans') - 1891) < 1e-6)
  assert.ok(Math.abs(sum('leadSpend') - 3105) < 1e-6)
  assert.ok(Math.abs(sum('fee') - 3105 * 0.12) < 1e-6)
  assert.equal(sum('setup'), 297)
  assert.ok(days[1].leadSpend > days[6].leadSpend, 'weekdays carry more lead spend than Sunday')
})

test('rolling 7 days: revenue, costs, kept and the gold gap (P943)', () => {
  const parts = [Array.from({ length: 14 }, (_, i) => ({ date: addDays('2026-10-01', i), plans: 10, fee: 5, setup: i === 9 ? 297 : 0, leadSpend: 40 }))]
  const runs = [{ date: '2026-10-05', amount: 70 }, { date: '2026-10-12', amount: 140 }]
  const days = buildDays({ todayIso: '2026-10-14', parts, runs, cardRate: 0.03 })
  assert.equal(days.length, 14)
  const roll = rolling(days)
  const last = roll[13] // Oct 8..14: 7 x 15 + 297 revenue; run of Oct 12; card 3% of (revenue + lead spend)
  assert.equal(last.revenue, 7 * 15 + 297)
  assert.equal(last.costs, Math.round(140 + (7 * 15 + 297 + 7 * 40) * 0.03))
  assert.equal(last.kept, last.revenue - last.costs)
  assert.deepEqual(last.gap, [last.kept, last.revenue])
  assert.equal(last.plans, 70); assert.equal(last.fee, 35); assert.equal(last.setup, 297)
  assert.ok(roll[0].partial && !roll[6].partial)
  const h = headline(roll)
  assert.equal(h.revenue, last.revenue)
  assert.equal(h.prev, roll[6].revenue)
  assert.equal(h.pct, Math.round(((last.revenue - roll[6].revenue) / roll[6].revenue) * 100))
})

test('every range ends today; All starts at the first full 7 days (P943)', () => {
  const days = buildDays({ todayIso: '2026-11-05', parts: [[{ date: '2025-08-01', plans: 1 }, { date: '2026-11-05', plans: 1 }]] })
  const roll = rolling(days)
  assert.deepEqual(RANGES.map(r => r.label), ['1W', '1M', '3M', '1Y', 'All'])
  for (const r of RANGES) assert.equal(rangeRows(roll, r.key).at(-1).date, '2026-11-05')
  assert.equal(rangeRows(roll, '1w').length, 7)
  assert.equal(rangeRows(roll, '1m').length, 30)
  assert.equal(rangeRows(roll, '3m').length, 91)
  assert.equal(rangeRows(roll, '1y').length, 365)
  assert.equal(rangeRows(roll, 'all')[0].date, '2025-08-07')
  assert.deepEqual(rangeRows([], '1m'), [])
})

test('sample: a year of weeks grows into the seeded first week; run dates parse (P943)', () => {
  const h = sampleHistory('2026-09-28', { plans: 1294, leads: 2210 })
  assert.equal(h.at(-1).startIso, '2026-09-21')
  assert.ok(h[0].startIso < '2025-09-01')
  assert.ok(h[0].plans < h.at(-1).plans)
  assert.equal(isoFromText('Mon, Nov 2', 2026), '2026-11-02')
  assert.equal(isoFromText('Oct 12', 2026), '2026-10-12')
})

test('real: lead history priced by kind, test and sample leads out (P943)', () => {
  const clock = realClock(Date.parse('2026-11-05T18:00:00Z'))
  const rows = leadSpendTrendOf([
    { created_at: '2026-11-04T16:00:00Z', assigned_rep_id: 'a1', inbound_product: 'live_call' },
    { created_at: '2026-11-04T17:00:00Z', assigned_rep_id: 'a1', inbound_product: 'appointment' },
    { created_at: '2026-11-04T17:00:00Z', assigned_rep_id: null },
    { created_at: '2026-11-04T17:00:00Z', assigned_rep_id: 'a1', is_sample: true },
    { created_at: '2026-11-04T17:00:00Z', assigned_rep_id: 'tst' },
  ], clock, id => id !== 'tst')
  const d = rows.find(r => r.date === '2026-11-04')
  assert.equal(d.live, 1)
  assert.equal(d.appointment, 1)
})

test('Revenue › By week is the stock chart; lead spend stays out (P943)', () => {
  const b = src('./screens/Billing.jsx')
  assert.match(b, /<RevenueStock roll=\{t\.roll\} \/>/)
  assert.doesNotMatch(b, /<Chart stacked/)
  assert.match(b, /Agent lead spend \(passed to Meta\)/)
  const c = src('./RevenueStock.jsx')
  assert.match(c, /vs the 7 days before/)
  assert.match(c, /kept after costs/)
  assert.match(c, /Revenue \(last 7 days\)/)
  assert.match(c, /Costs \(the gap\)/)
  assert.match(c, /useState\('1m'\)/)
  const r = src('./revTrend.js')
  assert.doesNotMatch(r.replace(/\/\/.*$/gm, ''), /revenue: t\.revenue \+ .*leadSpend/)
})

test('real store: 91 days of leads priced, plan fees from each agent\'s join day, pay runs on their date (P943)', async () => {
  const { revTrendOf } = await import('./data.js')
  const { buildAdmState } = await import('../lib/admReal.js')
  const now = Date.parse('2026-11-05T18:00:00Z')
  const s = buildAdmState({
    profiles: [{ id: 'ag1', role: 'agent', full_name: 'Real Agent', billing_tier: 'starter', created_at: '2026-10-20T15:00:00Z' }],
    history: [{ id: 'l1', created_at: '2026-10-22T16:00:00Z', assigned_rep_id: 'ag1', inbound_product: 'appointment', lead_type: 'mortgage_protection' }],
    runs: [{ id: 'r1', pay_date: '2026-10-26', paid_cents: 12000, paid_reps: 1, status: 'paid' }],
  }, { now })
  const t = revTrendOf(s, { days: [] })
  assert.equal(t.real, true)
  assert.equal(t.days.at(-1).date, '2026-11-05', 'the days run to today')
  const d22 = t.days.find(d => d.date === '2026-10-22')
  assert.equal(d22.leadSpend, 45)
  assert.ok(Math.abs(d22.fee - 45 * 0.12) < 1e-6)
  assert.equal(t.days.find(d => d.date === '2026-10-26').va, 120)
  const before = t.days.find(d => d.date === '2026-10-19')
  assert.ok(!before || before.plans === 0, 'no plan fee before the agent joined')
  assert.ok(t.days.find(d => d.date === '2026-10-21').plans > 0)
  assert.equal(t.days.reduce((x, d) => x + d.ai + d.setup, 0), 0, 'real AI minutes and setup fees aren\'t recorded yet')
})
