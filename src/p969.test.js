// P969 — Billing without the "Your products" box (products live in the plan card), "Delivered", no desktop More page.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { stateOf, costOf, canRemove } from './template/productsView.js'

const read = f => readFileSync(f, 'utf8').replace(/\/\/.*$/gm, '')

test('Billing has no "Your products" box; the plan card carries the product lines and actions', () => {
  const b = read('src/template/screens/Billing.jsx')
  const p = read('src/template/Products955.jsx')
  assert.doesNotMatch(b, /ProductsCard/)
  assert.doesNotMatch(p, /Your products|aria-label="Your products"/)
  // P990: one plan card for every state
  assert.equal((b.match(/<PlanProductRows/g) || []).length, 1, 'the plan card shows the product lines')
  assert.equal((b.match(/<PlanProductActions/g) || []).length, 1)
  assert.match(b, /<ProductDrawers panel=\{prod\}/)
})

test('the product rules are untouched: servicing on, ending, removal', () => {
  const b = { picked: ['leads', 'servicing'], next: ['leads'], nextFrom: '2026-12-01', clients: { total: 12 } }
  assert.deepEqual(stateOf(b, 'servicing'), { kind: 'ending', on: '2026-12-01' })
  assert.equal(canRemove({ picked: ['leads', 'servicing'] }, 'servicing'), true)
  assert.equal(canRemove({ picked: ['reactivation'] }, 'reactivation'), false)
  assert.match(costOf(b, 'servicing').sub, /clients/)
})

test('Overview says Delivered, capital D', () => {
  assert.match(read('src/template/screens/Overview.jsx'), /<b>Delivered<\/b>/)
})

test('the desktop More page redirects to Overview, and the avatar menu has no More item', () => {
  assert.match(read('src/template/screens/More.jsx'), /<Navigate to=\{paths\.home\(\)\} replace \/>/)
  const f = read('src/template/TemplateFrame.jsx')
  assert.doesNotMatch(f, /paths\.more/)
  for (const w of ['Billing', 'Settings', 'Activity', 'Help', 'Get the phone app', 'Sign out']) assert.ok(f.includes(w), w)
})

test('Delete my account stays reachable from Settings', () => {
  assert.match(read('src/template/screens/Settings.jsx'), /Delete my account/)
})
