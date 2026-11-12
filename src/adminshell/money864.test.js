import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { moneyFor, admSnapshot, PERIODS, OWNERS } from './data.js'
import { ADM_TABS, ADM_LABELS, admTitleOf } from './paths.js'
import { engineState } from './engine.js'

// P864: Connect left the top tabs for the rail; Billing became Money (P866: Revenue) (totals, costs, profit, the owners' split);
// the clock shows on Overview only; Get the app is on both the agent and VA rails.
const src = p => readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

test('Connect is a rail page, not a top tab; Billing reads Revenue (P866)', () => {
  assert.ok(!ADM_TABS.some(([k]) => k === 'connect'))
  assert.deepEqual(ADM_TABS.find(([k]) => k === 'billing'), ['billing', 'Revenue'])
  assert.equal(ADM_LABELS.connect, 'Connect')
  assert.equal(admTitleOf('billing')[1], 'Revenue')
  const frame = src('./AdminFrame.jsx')
  assert.match(frame, /<NavLink to=\{ap\('connect'\)\} className="fx-ri tp-wig" aria-label="Connect"/)
  assert.doesNotMatch(frame, /ADM_TABS\.find\(/) // the phone bar names rail pages through ADM_LABELS
})

test('the Engine-slot state: not connected until GoHighLevel is on and synced', () => {
  assert.equal(engineState(null).on, false)
  assert.equal(engineState(null).line, 'Powered by GoHighLevel · not connected yet')
  assert.equal(engineState({ location_id: 'loc123', enabled: false, last_sync_at: '2026-11-06T12:00:00Z' }).on, false)
  assert.equal(engineState({ location_id: 'loc123', enabled: true, last_sync_status: 'ok', last_sync_at: new Date().toISOString() }).on, true)
})

test('Money adds up for every period: brought in minus costs is profit, and the split sums to profit', () => {
  const s = admSnapshot()
  for (const [period] of PERIODS) {
    const p = moneyFor(s, period)
    // P913: lead spend is the agents' money passed to Meta, never in revenue, profit or totals.
    assert.equal(p.inTotal, p.leadFee + p.servicing + p.setup, period)
    assert.equal(p.leadSpend, p.budgets, period)
    assert.equal(p.leadFee, Math.round(p.budgets * 0.12), `${period}: 12% of lead spend, apart from the plan fees (P909)`)
    // Profit = revenue minus VA pay, AI minutes and card fees.
    assert.equal(p.costTotal, p.vaPay + p.ai + p.fees, period)
    assert.equal(p.profit, p.inTotal - p.costTotal, period)
    assert.ok(p.profit > 0, `${period} profit is believable`)
    assert.equal(p.split.reduce((t, o) => t + o.amount, 0), p.profit, period)
    assert.equal(p.split.reduce((t, o) => t + o.pct, 0), 100, period)
    assert.deepEqual(p.split.map(o => o.name), OWNERS.map(o => o.name))
    for (const o of p.split) assert.equal(o.owed, Math.max(0, o.amount - o.paid))
  }
  // P934: 50/50, fixed; the two shares still sum to the profit
  assert.deepEqual(moneyFor(s, 'week').split.map(o => o.pct), [50, 50])
  const p = moneyFor(s, 'last')
  assert.equal(p.split[0].amount + p.split[1].amount, p.profit)
})

test('P934: the split is fixed at 50/50 (no admin can change it), and each owner sees their own payouts (P945)', () => {
  const d = src('./data.js')
  assert.match(d, /export const OWNER_SPLIT = 50/)
  assert.doesNotMatch(d, /setSplit/)
  assert.doesNotMatch(src('../hooks/admRealData.js'), /setSplit/)
  const b = src('./screens/Billing.jsx')
  assert.doesNotMatch(b, /Change split|setSplit|Save split/)
  assert.match(b, /Split 50 \/ 50/)
  assert.match(b, /function YourPayouts\(\)/)
  assert.doesNotMatch(b, /function OwnerPayouts\(\)/)
  assert.match(b, /\['week', 'This week'|PERIODS/)
  assert.match(b, /Agent lead spend \(passed to Meta\)/) // P913: shown apart, in no total
})

test('the clock shows on Overview only in all three portals (P964: admin on the Live status line)', () => {
  for (const p of ['../template/TemplateFrame.jsx', '../template/ful/FulFrame.jsx']) {
    const s = src(p)
    assert.match(s, /layout === 'overview' && <LiveClock tz=/, p)
    assert.equal(s.match(/<LiveClock/g).length, 1, p)
  }
  assert.equal(src('./screens/Overview.jsx').match(/<LiveClock/g).length, 1)
  assert.doesNotMatch(src('./AdminFrame.jsx'), /<LiveClock/)
})

test('Get the app is on the agent rail and the VA rail, same icon, next to Help', () => {
  for (const p of ['../template/TemplateFrame.jsx', '../template/ful/FulFrame.jsx']) {
    const s = src(p)
    const rail = s.slice(s.indexOf('<aside className="tp-rail'), s.indexOf('</aside>', s.indexOf('<aside className="tp-rail')))
    assert.match(rail, /aria-label="Get the phone app"[^\n]*<Smartphone size=\{18\} \/><\/button>\n\s*<button[^\n]*aria-label="Help and support"/, p)
    assert.match(s, /<GetApp open=\{panel === 'app'\} onClose=\{close\} \/>/, p)
  }
})
