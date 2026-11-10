import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { monoAt, monoSlopes } from './adminshell/revTrend.js'
import { missedStage, nextVa, escalateCall, NUDGE_AFTER, HANDOFF_AFTER } from './lib/callEscalation.js'
import { adminTodos } from './adminshell/todos.js'
import { DAYS_OFF_DEFAULT, canBookDayOff } from './lib/dayOff.js'
import { TREND_RANGES } from './template/leadTrend.js'

const src = p => readFileSync(new URL(p, import.meta.url), 'utf8')

test('P945: the hover reads values off the same smooth curve, through every day and never overshooting', () => {
  const ys = [100, 140, 130, 130, 220]
  ys.forEach((y, i) => assert.equal(monoAt(ys, i), y))
  const s = monoSlopes(ys)
  for (let f = 0; f <= 4; f += 0.05) {
    const v = monoAt(ys, f, s)
    const i = Math.min(3, Math.floor(f))
    assert.ok(v >= Math.min(ys[i], ys[i + 1]) - 1e-9 && v <= Math.max(ys[i], ys[i + 1]) + 1e-9, `monotone between days at ${f}`)
  }
  assert.equal(monoAt(ys, 2.5), 130, 'flat between equal days')
  assert.equal(monoAt([10, 20], 0.5), 15, 'two days: a straight line')
})

test('P945: the Revenue tooltip is Revenue · Costs · Kept, the line thicker, the gap the portal yellow', () => {
  const rs = src('./adminshell/RevenueStock.jsx')
  assert.match(rs, /strokeWidth=\{3\.25\}/)
  assert.doesNotMatch(rs, /<Tooltip/, 'the gliding overlay replaces the jumping tooltip')
  assert.match(rs, /requestAnimationFrame/)
  assert.match(src('./adminshell/p943.css'), /--rs-gap: var\(--sh-f-butter/)
})

test('P945: Overview chart = Last 7 days (always full), Sold as thick as the blue with its own gradient', () => {
  assert.equal(TREND_RANGES[0].value, '7d')
  const at = src('./template/AreaTrend.jsx')
  assert.match(at, /initial = '7d'/)
  assert.match(at, /strokeWidth=\{i === 0 && series\.length > 2 \? 2 : 3\.25\}/)
})

test('P945: a booked call nobody starts: ping at +5, next free VA at +10 (pod first), else the AI rebooks', () => {
  assert.equal(missedStage({ bookedMin: 600, nowMin: 598 }), 'ahead')
  assert.equal(missedStage({ bookedMin: 600, nowMin: 600 + NUDGE_AFTER - 1 }), 'wait')
  assert.equal(missedStage({ bookedMin: 600, nowMin: 600 + NUDGE_AFTER }), 'nudge')
  assert.equal(missedStage({ bookedMin: 600, nowMin: 600 + HANDOFF_AFTER }), 'handoff')
  assert.equal(missedStage({ bookedMin: 600, nowMin: 700, started: true }), 'started')
  const vas = [{ id: 'a', onShift: true }, { id: 'b', onShift: true }, { id: 'c', onShift: true }, { id: 'd', onShift: false }, { id: 'e', onShift: true, onCall: true }]
  const call = { id: 'x', va_id: 'a', min: 600 }
  assert.equal(nextVa({ call, vas, atMin: 610 }), 'b', 'anyone free, in order, never the VA who has it')
  assert.equal(nextVa({ call, vas, pod: ['c'], atMin: 610 }), 'c', 'the pod first')
  assert.equal(nextVa({ call, vas, calls: [{ id: 'y', va_id: 'b', min: 630, open: true }], atMin: 610 }), 'c', 'a VA with a call within 30 min is not free')
  assert.equal(nextVa({ call, vas, pod: ['d', 'e'], atMin: 610 }), 'b', 'off shift and on a call are skipped')
  const r = escalateCall({ call, nowMin: 612, vas })
  assert.deepEqual(r.steps.map(s => s.kind), ['nudge', 'handoff'])
  assert.equal(r.to, 'b')
  const none = escalateCall({ call, nowMin: 612, vas: [vas[0]] })
  assert.equal(none.rebook, true)
  assert.deepEqual(none.steps.map(s => s.kind), ['nudge', 'rebook'])
})

test('P945: no "Call past its time · Give it" to-do; the Overview has a Calendar shortcut', () => {
  const rows = adminTodos({ late: [{ id: 'c1', client: 'A', time: '1 PM' }], ap: () => '/x' })
  assert.equal(rows.length, 0)
  assert.doesNotMatch(src('./adminshell/todos.js'), /action: 'Give it'/)
  assert.match(src('./adminshell/screens/Overview.jsx'), /\?tab=calendar`\} className="fx-pillbtn adm-cal-go"/)
})

test('P945: agent rows are one click target; the Fulfillment calendar has no shift lines and is screen tall', () => {
  assert.match(src('./adminshell/screens/Agents.jsx'), /className="adm-tr is-click"[^>]*onClick=/)
  const team = src('./adminshell/screens/Team.jsx')
  assert.doesNotMatch(team, /adm-shiftbar/)
  assert.match(team, /adm-cal945/)
  assert.match(src('./adminshell/p913.css'), /\.adm-cal945 > \.fx-week \{ height: calc\(100dvh/)
  assert.match(src('./template/MoreBelow.jsx'), /scrollHeight - window\.innerHeight > 24/)
})

test('P945: time off is 3 days, booked at once, "No days left" when used up', () => {
  assert.equal(DAYS_OFF_DEFAULT, 3)
  const rows = ['2026-12-01', '2026-12-02', '2026-12-03'].map(date => ({ va_id: 'me', date, status: 'approved' }))
  const c = canBookDayOff(rows, 'me', '2026-12-09')
  assert.equal(c.ok, false)
  assert.match(c.why, /^No days left/)
  assert.doesNotMatch(src('./adminshell/screens/Team.jsx'), /Asked off/)
})

test('P945: correction requests are gone everywhere; pay is scheduled hours minus days off', () => {
  for (const f of ['./adminshell/screens/Team879.jsx', './template/ful/Clock879.jsx', './adminshell/p879.js', './template/ful/screens/Pay.jsx']) {
    assert.doesNotMatch(src(f), /CORRECTIONS|Ask for a correction|Correction requests|correction asked|Ask for a fix/, f)
  }
  assert.match(src('./adminshell/screens/Team879.jsx'), /scheduled hours minus days off/)
})

test('P945: owner payouts: own card, Stripe bank, off until the Go live switch; migration 265 holds the server side', () => {
  const b = src('./adminshell/screens/Billing.jsx')
  assert.match(b, /function YourPayouts\(\)/)
  assert.match(b, /ownerOf\(profile\?\.full_name\)/)
  assert.match(src('./adminshell/screens/Launch906.jsx'), /key: 'owner_payouts_live'/)
  assert.match(src('./lib/admReal.js'), /owner_payouts_live: \['recovery_config', 'owner_payouts_live'\]/)
  const m = src('../supabase/migrations/265_admin_last_pass.sql')
  assert.match(m, /owner_payouts_live boolean not null default false/)
  assert.match(m, /function public\.booked_call_escalation_sweep\(\)/)
  assert.match(m, /interval '10 minutes'/)
  assert.match(m, /va_days_off_per_month set default 3/)
})
