// P959 — "Your own leads": the name, sold leads without Servicing, Billing with $0s, no founding price.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PRODUCTS, canServe, navFor } from './lib/products.js'

const read = f => readFileSync(f, 'utf8')

test('the product is "Your own leads" with its one line', () => {
  assert.equal(PRODUCTS.reactivation.label, 'Your own leads')
  assert.equal(PRODUCTS.reactivation.line, "Got your own leads? Import them and we'll call every one.")
})

test('only Your own leads = no servicing: sold leads stay on the board, Clients hidden', () => {
  assert.equal(canServe(['reactivation']), false)
  assert.equal(canServe(['leads']), true)
  assert.equal(canServe(['servicing', 'reactivation']), true)
  assert.equal(canServe(undefined), true)
  assert.equal(navFor(['reactivation']).has('clients'), false)
  assert.equal(navFor(['reactivation']).has('leads'), true)
})

test('no reactivate wording on the agent screens', () => {
  for (const f of ['src/template/screens/Leads.jsx', 'src/template/Reactivate.jsx', 'src/template/Products955.jsx', 'src/components/agent/SignupCheckout.jsx', 'src/components/agent/LockedWelcome.jsx']) {
    const s = read(f).split('\n').filter(l => !/^\s*(\/\/|\*|\{\/\*)/.test(l)).join('\n')
    assert.doesNotMatch(s.replace(/import .*\n/g, '').replace(/[A-Za-z_.']*[Rr]eactivat[A-Za-z_']*/g, ''), /[Rr]eactivat/, f)
  }
  assert.match(read('src/template/screens/Leads.jsx'), />Import leads<\/button>/)
})

test('Billing keeps its full layout for an agent without Leads: $0 tiles with a quiet Add link', () => {
  const b = read('src/template/screens/Billing.jsx')
  assert.match(b, /\{!leads && <section[^>]*aria-label="Your plan"/)
  for (const w of ['aria-label="Paid ahead"', 'aria-label="Booking desk"', 'aria-label="Results"', 'Not on your plan']) assert.ok(b.includes(w), w)
})

test('a sold lead without Servicing has no Submit and no to-do', () => {
  const o = read('src/template/LeadOutcome.jsx')
  assert.match(o, /sold && !serve/)
  const l = read('src/template/screens/Leads.jsx')
  assert.match(l, /serve && lead\.stage === 'sold' && !lead\.submitted/)
})

test('no founding price anywhere in the portal source', () => {
  for (const f of ['src/template/screens/Billing.jsx', 'src/components/agent/SignupCheckout.jsx', 'src/adminshell/screens/Settings.jsx', 'src/adminshell/screens/Agents.jsx', 'src/lib/priceBook.js', 'src/lib/leadSpend.js']) {
    const s = read(f).split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n')
    assert.doesNotMatch(s, /founding/i, f)
  }
})
