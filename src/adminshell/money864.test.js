import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { moneyFor, admSnapshot, PERIODS, OWNERS } from './data.js'
import { ADM_TABS, ADM_LABELS, admTitleOf } from './paths.js'
import { engineState } from './engine.js'

// P864: Connect left the top tabs for the rail; Billing became Money (totals, costs, profit, the owners' split);
// the clock shows on Overview only; Get the app is on both the agent and VA rails.
const src = p => readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

test('Connect is a rail page, not a top tab; Billing reads Money', () => {
  assert.ok(!ADM_TABS.some(([k]) => k === 'connect'))
  assert.deepEqual(ADM_TABS.find(([k]) => k === 'billing'), ['billing', 'Money'])
  assert.equal(ADM_LABELS.connect, 'Connect')
  assert.equal(admTitleOf('billing')[1], 'Money')
  const frame = src('./AdminFrame.jsx')
  assert.match(frame, /<NavLink to=\{ap\('connect'\)\} className="fx-ri tp-wig" aria-label="Connect"/)
  assert.doesNotMatch(frame, /ADM_TABS\.find\(/) // the phone bar names rail pages through ADM_LABELS
})

test('Connect has Setup and Connect tabs; Setup is empty until GoHighLevel is connected', () => {
  const s = src('./screens/Connect.jsx')
  assert.match(s, /\{ key: 'setup', label: 'Setup' \}, \{ key: 'connect', label: 'Connect' \}/)
  assert.match(s, /Nothing connected yet/)
  assert.match(s, /Jordan connects GoHighLevel here/)
  assert.match(s, /connected \|\| peek \? <SetupView/)
  assert.equal(engineState(null).on, false)
  assert.equal(engineState(null).line, 'Powered by GoHighLevel · not connected yet')
  assert.equal(engineState({ location_id: 'loc123', enabled: false, last_sync_at: '2026-11-06T12:00:00Z' }).on, false)
  assert.equal(engineState({ location_id: 'loc123', enabled: true, last_sync_status: 'ok', last_sync_at: new Date().toISOString() }).on, true)
})

test('Money adds up for every period: brought in minus costs is profit, and the split sums to profit', () => {
  const s = admSnapshot()
  for (const [period] of PERIODS) {
    const p = moneyFor(s, period)
    assert.equal(p.inTotal, p.budgets + p.servicing + p.setup, period)
    assert.equal(p.costTotal, p.ads + p.vaPay + p.fees + p.tools, period)
    assert.equal(p.profit, p.inTotal - p.costTotal, period)
    assert.ok(p.profit > 0, `${period} profit is believable`)
    assert.equal(p.split.reduce((t, o) => t + o.amount, 0), p.profit, period)
    assert.equal(p.split.reduce((t, o) => t + o.pct, 0), 100, period)
    assert.deepEqual(p.split.map(o => o.name), OWNERS.map(o => o.name))
    for (const o of p.split) assert.equal(o.owed, Math.max(0, o.amount - o.paid))
  }
  // 50/50 by default; a different split still sums to the profit
  assert.deepEqual(moneyFor(s, 'week').split.map(o => o.pct), [50, 50])
  const t = { ...s, settings: { ...s.settings, split: { brayden: 63, changed: null } } }
  const p = moneyFor(t, 'last')
  assert.deepEqual(p.split.map(o => o.pct), [63, 37])
  assert.equal(p.split[0].amount + p.split[1].amount, p.profit)
})

test('the split is a setting written to the audit log, and both owners show as payees', () => {
  const d = src('./data.js')
  assert.match(d, /setSplit: brayden => set\(s => \{[\s\S]*?audit\(s, 'Changed the profit split'/)
  const b = src('./screens/Billing.jsx')
  assert.match(b, /function OwnerPayouts\(\)/)
  assert.match(b, /\['week', 'This week'|PERIODS/)
  assert.match(b, /<EngineSlot/) // ad spend is an engine slot until GoHighLevel is connected
})

test('the clock shows on Overview only in all three portals', () => {
  for (const p of ['../template/TemplateFrame.jsx', '../template/ful/FulFrame.jsx', './AdminFrame.jsx']) {
    const s = src(p)
    assert.match(s, /layout === 'overview' && <LiveClock tz=/, p)
    assert.equal(s.match(/<LiveClock/g).length, 1, p)
  }
})

test('Get the app is on the agent rail and the VA rail, same icon, next to Help', () => {
  for (const p of ['../template/TemplateFrame.jsx', '../template/ful/FulFrame.jsx']) {
    const s = src(p)
    const rail = s.slice(s.indexOf('<aside className="tp-rail'), s.indexOf('</aside>', s.indexOf('<aside className="tp-rail')))
    assert.match(rail, /aria-label="Get the phone app"[^\n]*<Smartphone size=\{18\} \/><\/button>\n\s*<button[^\n]*aria-label="Help and support"/, p)
    assert.match(s, /<GetApp open=\{panel === 'app'\} onClose=\{close\} \/>/, p)
  }
})
