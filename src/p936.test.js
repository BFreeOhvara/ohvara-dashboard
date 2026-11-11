import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { freeVa, vaSlots, instantOf } from './lib/callSlots.js'
import { canTakeCalls, TRAIN_FIRST } from './lib/trainingGate.js'
import { admPageOf, ADM, ADM_OLD, ADM_GONE, ADM_LABELS } from './adminshell/paths.js'

const src = p => readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const CT = 'America/Chicago'

// P936 (Brayden, Nov 10): the bar chart component looked lacklustre everywhere; one chart replaces it in every role.
test('one chart component (Recharts, the shadcn way) in admin, agent and VA', () => {
  const c = src('./template/Chart.jsx')
  assert.match(c, /from 'recharts'/)
  for (const w of ['linearGradient', 'Tooltip', 'CartesianGrid', 'ResponsiveContainer', 'ChartKey', 'later', 'prefers-reduced-motion']) assert.ok(c.includes(w), w)
  const css = src('./template/chart936.css')
  assert.match(css, /\.ox-tick\.is-later \{ opacity/)
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b/, 'tokens only, no hex')
  // P942: the agent Overview's Delivered chart is the shadcn interactive area chart (AreaTrend) instead
  // P943: Revenue › By week is the stock-style line (adminshell/RevenueStock.jsx) instead
  for (const f of ['./adminshell/screens/Overview.jsx', './adminshell/screens/Numbers916.jsx', './template/ful/screens/Overview.jsx']) {
    assert.match(src(f), /<Chart\b/, f)
  }
  // P949: the agent Overview went back to its P936 chart (the area chart is admin-only)
  assert.match(src('./template/screens/Overview.jsx'), /<Chart\b/)
  assert.doesNotMatch(src('./template/screens/Overview.jsx'), /AreaTrend/)
  // the old hand-made bars are gone
  assert.doesNotMatch(src('./adminshell/screens/Overview.jsx'), /function WeekGrid|adm-wg-bar/)
  assert.doesNotMatch(src('./adminshell/screens/Billing.jsx'), /adm-rev-chart|adm-wg-bar/)
  assert.doesNotMatch(src('./template/ful/screens/Overview.jsx'), /fs-minibars/)
  assert.doesNotMatch(src('./template/screens/Overview.jsx'), /fx-wchart-y|className=\{`fx-bar/)
  // stacked where it means something
  assert.match(src('./adminshell/screens/Overview.jsx'), /label: 'Came in'[\s\S]*label: 'Sold'/) // P942: back to front
  assert.match(src('./adminshell/screens/Billing.jsx'), /<RevenueStock roll=/)
  // P945: the tooltip is Revenue · Costs (the gap) · Kept only
  assert.match(src('./adminshell/RevenueStock.jsx'), /<span>Revenue<\/span>[\s\S]*<span>Costs \(the gap\)<\/span>[\s\S]*<span>Kept<\/span>/)
  assert.doesNotMatch(src('./adminshell/RevenueStock.jsx'), /Plan fees|deskAdminLabel|Setup fees/)
})

test('a button on a coloured to-do row is neutral, with hover and pressed, in every role', () => {
  const css = src('./template/rowbtn936.css')
  for (const s of ['.adm-todo', '.fx-ncard', '.lc-row']) assert.ok(css.includes(s), s)
  assert.match(css, /:hover/)
  assert.match(css, /:active/)
  assert.match(css, /background: var\(--sh-surface\)/)
  for (const f of ['./template/NeedsNow.jsx', './adminshell/screens/Overview.jsx', './template/ful/screens/Overview.jsx']) assert.match(src(f), /rowbtn936\.css/, f)
})

test('admin Clients cards: no monthly premium; carrier, city, draft day, sold, where it stands, the agent', () => {
  const s = src('./adminshell/screens/Clients.jsx')
  const card = s.slice(s.indexOf('className={`fx-card fx-ccard ck-card adm-ccard'), s.indexOf('</article>', s.indexOf('adm-ccard')))
  assert.doesNotMatch(card, /premium|\/mo/)
  for (const w of ['whereOf(c)', 'Drafts the', 'Sold {c.sold}', 'ck-stand', 'adm-cagent']) assert.ok(card.includes(w), w)
  assert.doesNotMatch(s, /a month in premium/)
  assert.match(s, /c\.premium > 0 \?/) // the drawer shows premium only if it was entered
})

test('the admin rail drops Training, Wording to approve and Carrier playbook; old addresses land on Overview', () => {
  const f = src('./adminshell/AdminFrame.jsx')
  for (const k of ['training', 'wording', 'playbook']) {
    assert.ok(!f.includes(`ap('${k}')`), k)
    assert.ok(!(k in ADM), k)
    assert.ok(!(k in ADM_LABELS), k)
    assert.ok(ADM_GONE.includes(k), k)
    assert.equal(admPageOf(ADM_OLD[k]), 'overview', k)
  }
  assert.ok(f.includes("ap('numbers')"))
  assert.match(src('./adminshell/routes.jsx'), /GONE\.map/)
  // the playbook data and the VA call panel stay
  assert.match(src('./template/ful/CallPanel.jsx') + src('./template/ful/BeforeCall.jsx'), /playbook|Playbook/i)
})

test('training gate: a VA still in training is never picked or offered a slot', () => {
  assert.equal(TRAIN_FIRST, 'Finish training to start taking calls')
  assert.equal(canTakeCalls({ id: 'a' }), true)
  assert.equal(canTakeCalls({ id: 'a', trained: false }), false)
  const iso = instantOf('2026-11-10', '10:00 AM', CT)
  const team = [{ id: 'new', name: 'Rosa Diaz', tz: CT, trained: false }, { id: 'old', name: 'Maya Brooks', tz: CT, trained: true }]
  assert.equal(freeVa({ iso, team, prefer: 'new' }).id, 'old')
  assert.equal(freeVa({ iso, team: [team[0]] }), null)
  const slots = vaSlots({ date: '2026-11-10', clocks: ['10:00 AM'], clientTz: CT, team: [team[0]] })
  assert.equal(slots[0].open, false)
  // the VA sees why on Overview, and admin's Give pickers hold back a VA in training
  assert.match(src('./template/ful/screens/Overview.jsx'), /!tr\.complete && <TrainingCard/) // P947: the card sits above Today's calls
  assert.match(src('./adminshell/screens/Team.jsx'), /canTakeCalls\(v\)/)
  assert.match(src('./adminshell/screens/Clients.jsx'), /canTakeCalls\(v\)/)
  assert.match(src('./template/ful/data.js'), /trained: isTrained\(v\.name\)/)
})

test('Lines & pods: one card per number, details in a slide-in, settings in their own slide-ins', () => {
  const n = src('./adminshell/screens/Numbers916.jsx')
  const card = n.slice(n.indexOf('<li key={n.id} className={`dn-card'), n.indexOf('</li>', n.indexOf('dn-card')))
  for (const w of ['dn-num', '<Avatar', 'calls today', 'Change VAs']) assert.ok(card.includes(w), w)
  for (const w of ['<Switch', 'dn-meter', 'Chip', 'caller_name']) assert.ok(!card.includes(w), w)
  assert.equal((n.match(/<Drawer\b/g) || []).length, 3)
  assert.match(n, /<HoldLineSettings \/>/)
  assert.match(src('./adminshell/screens/Work934.jsx'), /NumbersPage = \(\) => <Page label="Deedstone numbers"><DeedstoneNumbers \/><\/Page>/)
})
