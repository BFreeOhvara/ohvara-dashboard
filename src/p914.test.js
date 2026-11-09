// P914 — last polish before Jordan connects: the same header and drawer feel in every shell, admin Setup colours,
// Revenue box, read-only lead status, To-dos, the Billing spend slider, and no pilot anywhere.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { adminTodos, shortCover } from './adminshell/todos.js'
import { SETUP_STAGES } from './adminshell/setup.js'
import { admSnapshot, agentResults, moneyFor } from './adminshell/data.js'
import { nightlyFor, spendOk, monthlyBill, tierOf, PAID_MIN_DAILY, MAX_DAILY } from './template/spendPlan.js'

const read = p => readFileSync(new URL(p, import.meta.url), 'utf8')
const ap = (k, id) => `/admin/${k}${id ? `/${id}` : ''}`

test('every shell shares one avatar, Messages icon and drawer motion', () => {
  for (const f of ['./template/TemplateFrame.jsx', './template/ful/FulFrame.jsx', './adminshell/AdminFrame.jsx']) {
    const s = read(f)
    assert.match(s, /shell914\.css'/, f)
    assert.match(s, /useMessagesToggle\(/, f)
    assert.match(s, /aria-expanded=\{menuOn\}|aria-expanded=\{open\}|aria-expanded=\{menu/, f)
  }
  const css = read('./template/shell914.css')
  assert.match(css, /\.fx \.fx-me\[aria-expanded="true"\]/) // pressed while open
  assert.match(css, /\.fx \.fx-ib\.active \{/) // Messages highlighted while open
  assert.match(css, /@keyframes dr-in[\s\S]*@keyframes dr-out/) // one slide in and out
  const kit = read('./template/kit.jsx')
  assert.match(kit, /const shut = useCallback/) // X, Escape and the scrim play the way out first
  assert.match(read('./template/motion.js'), /export const useKeep/)
})

test('admin Setup colours: no purple; grey, blue, yellow, green', () => {
  assert.deepEqual(SETUP_STAGES.map(s => s.tone), ['mute', 'blue', 'teal', 'green'])
  assert.ok(!SETUP_STAGES.some(s => s.tone === 'violet'))
})

test('Revenue: Agent results replaces Pilot results, the box grows and never scrolls inside', () => {
  const b = read('./adminshell/screens/Billing.jsx')
  assert.match(b, /\['results', 'Agent results'\]/)
  assert.doesNotMatch(b, /Pilot results'/)
  assert.match(b, /<Grow>/)
  assert.doesNotMatch(read('./adminshell/p913.css'), /\.adm-rev-body \{[^}]*overflow(-y)?: auto/)
  const s = admSnapshot()
  for (const period of ['week', 'month', 'last']) {
    const r = agentResults(s, period)
    const p = moneyFor(s, period)
    for (const a of r.rows) assert.equal(a.kept, a.paid - a.va - a.ai - a.fees, `${period} ${a.name}`)
    assert.ok(Math.abs(r.total.paid - (p.servicing + p.leadFee + p.setup)) <= r.rows.length, period)
  }
})

test('admin Leads: status is shown, never changed', () => {
  const l = read('./adminshell/screens/Leads.jsx')
  assert.doesNotMatch(l, /setLeadStage|Stepper/)
  assert.match(l, /className="adm-lstatus"/)
  assert.doesNotMatch(read('./adminshell/data.js'), /setLeadStage/)
})

test('To-dos: empty is All caught up; full lists real admin jobs, one action each, money and leads first', () => {
  assert.deepEqual(adminTodos({ ap }), [])
  assert.match(read('./adminshell/screens/Overview.jsx'), /All caught up\./)
  const cover = shortCover({ rota: { 14: ['va-maya', 'va-omar'], 15: ['va-maya', 'va-keisha'] }, dayOff: [{ date: 14, va_id: 'va-omar', status: 'approved' }], days: [14, 15], min: 2, nameOf: id => id.slice(3) })
  assert.deepEqual(cover, [{ day: 14, on: 1, min: 2, off: ['omar'] }])
  const rows = adminTodos({
    ap,
    unassigned: [{ id: 'l1', name: 'Ana Ruiz', city: 'Austin', state: 'TX', came: '9:12 AM' }],
    failed: [{ id: 'ag-ben', name: 'Ben Carter', billing: { failed: { what: 'Monthly plan', amount: 699 } } }],
    pipeline: [{ id: 't1', name: 'Owen Fisher', stage: 'checks', checks: { passed: 4, list: [1, 2, 3, 4, 5] } }, { id: 't2', name: 'Hana', stage: 'campaign' }],
    cover,
    ads: [{ agent: 'ag-james', kind: 'rejected', text: 'Ad rejected: wording' }],
  })
  assert.deepEqual(rows.map(r => r.kind), ['lead', 'card', 'launch', 'cover', 'ad'])
  assert.deepEqual(rows.map(r => r.action), ['Assign', 'See bill', 'Open ticket', 'Open rota', 'Open agent'])
  for (const r of rows) assert.ok(r.to.startsWith('/admin/'), r.id)
})

test('agent Billing: the plan section has a $50 to $500 spend slider; plan and charges follow it live', () => {
  const b = read('./template/screens/Billing.jsx')
  assert.match(b, /function PlanSpend\(/)
  assert.match(b, /type="range" min=\{LO\} max=\{MAX\}/)
  assert.match(b, /Applies from the next charge/)
  assert.equal(PAID_MIN_DAILY, 50); assert.equal(MAX_DAILY, 500)
  assert.equal(nightlyFor('paid', 120).total, 134.4) // spend + 12%
  assert.equal(tierOf(50).key, 'starter'); assert.equal(tierOf(150).key, 'growth'); assert.equal(tierOf(500).key, 'pro')
  assert.equal(monthlyBill({ plan: 'paid', spend: { daily: 150 } }).membership, 1499)
})

test('no pilot: every agent pays from day one; no pilot wording or team-time line on any screen', () => {
  assert.equal(nightlyFor('pilot', 100).total, 112) // an old 'pilot' value still pays the 12%
  assert.equal(spendOk('pilot', { daily: 20 }), false) // and the $50 floor
  assert.ok(monthlyBill({ plan: 'pilot', spend: { daily: 100 } }).membership > 0)
  const root = fileURLToPath(new URL('.', import.meta.url))
  const walk = d => readdirSync(d).flatMap(n => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : [p] })
  const screens = walk(root).filter(p => /\.(jsx|css)$/.test(p) && !/[\\/]lib[\\/]carriers[\\/]/.test(p))
  for (const p of screens) {
    const s = readFileSync(p, 'utf8')
    assert.doesNotMatch(s, /'pilot'|Pilot ·|During the pilot|PilotBlock|PilotResults|Team time on your leads/, p)
  }
  assert.doesNotMatch(read('./lib/leadSpend.js'), /admin_billing_pilot_set|admin_billing_va_cost_set|admin_billing_to_paid/)
  const sql = read('../supabase/migrations/252_no_pilot.sql')
  assert.match(sql, /set plan = 'paid'/)
  assert.match(sql, /check \(plan = 'paid'\)/)
  assert.match(sql, /check \(not va_cost_on\)/)
  for (const fn of ['admin_billing_pilot_set', 'admin_billing_va_cost_set', 'admin_billing_to_paid']) {
    assert.match(sql, new RegExp(`function public\\.${fn}\\([\\s\\S]*?No pilot`), fn)
  }
})
