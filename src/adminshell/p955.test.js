// P955 — the admin side of "pick what you need": products on the agent rows, Setup tickets only for Leads, Revenue
// split by product, and product_add charges in Revenue › Charges.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { admSnapshot, pipelineOf, moneyFor, productSplitFor, reactivationFor, PLANS } from './data.js'
import { isPaid, hasTicket, signupOf } from './setup.js'
import {
  pickedOf, productChips, chipsText, endingLines, shortDay, needsTicket, withProducts, planPriceOf, planLineOf,
  productCounts, sampleSplit, realSplit, splitRows, periodRange, chargeWhat,
} from './products955.js'
import { PRICES } from '../lib/priceBook.js'

const src = p => readFileSync(new URL(p, import.meta.url), 'utf8')

test('the sample agents cover every mix: Leads, Leads + Reactivation, Servicing, Servicing + Reactivation, Reactivation', () => {
  const sets = admSnapshot().agents.map(a => pickedOf(a).join('+'))
  for (const want of ['leads', 'leads+reactivation', 'servicing', 'servicing+reactivation', 'reactivation']) assert.ok(sets.includes(want), want)
  assert.ok(sets.filter(x => x.startsWith('leads')).length > sets.length / 2, 'mostly Leads')
})

test('the products chip text: one order, known products only, a waiting removal says when it ends', () => {
  assert.equal(chipsText({ picked: ['reactivation', 'leads'] }), 'Leads · Reactivation')
  assert.equal(chipsText({ picked: ['servicing', 'nope', 'servicing'] }), 'Servicing')
  assert.equal(chipsText({ plan: 'servicing' }), 'Servicing') // not migrated yet: servicing-only stays servicing
  assert.equal(chipsText({ plan: 'growth' }), 'Leads') // everyone else has Leads
  const tasha = { picked: ['servicing', 'reactivation'], pickedNext: ['reactivation'], pickedNextFrom: '2026-12-09' }
  assert.deepEqual(productChips(tasha).map(c => [c.label, c.tone, c.ends]), [['Servicing', 'teal', 'Dec 9'], ['Reactivation', 'violet', null]])
  assert.deepEqual(endingLines(tasha), ['Servicing ends Dec 9'])
  assert.deepEqual(endingLines({ picked: ['leads'] }), [])
  assert.equal(shortDay('2026-01-31'), 'Jan 31')
  const sample = admSnapshot().agents.find(a => a.id === 'ag-tasha')
  assert.deepEqual(endingLines(sample), ['Servicing ends Dec 9'])
  // the row and the pop-up show them
  const ui = src('./screens/Agents.jsx')
  assert.match(ui, /<ProductChips a=\{a\} \/><\/span><\/Link>/)
  assert.match(ui, /<ProductsBlock a=\{a\} \/>/)
})

test('no Setup ticket without Leads; adding Leads later opens one once that charge is paid', () => {
  const paid = c => ({ done: ['paid'], ...c })
  assert.equal(needsTicket(paid({ picked: ['servicing'] }), isPaid), false)
  assert.equal(needsTicket(paid({ picked: ['reactivation'] }), isPaid), false)
  assert.equal(needsTicket(paid({ picked: ['servicing', 'reactivation'] }), isPaid), false)
  assert.equal(needsTicket(paid({ picked: ['leads'] }), isPaid), true)
  assert.equal(needsTicket({ picked: ['leads'], done: [] }, isPaid), false) // not paid yet
  assert.equal(needsTicket(paid({ picked: ['leads', 'servicing'], leadsPaid: false }), isPaid), false) // Leads added, charge not paid
  assert.equal(needsTicket(paid({ picked: ['leads', 'servicing'], leadsPaid: true }), isPaid), true)
  assert.equal(hasTicket(paid({ picked: ['servicing'] })), false)

  const snap = admSnapshot()
  const list = pipelineOf(snap)
  for (const id of ['ob-keith', 'ob-joan']) {
    assert.ok(isPaid(snap.onboard.find(c => c.id === id)), `${id} is paid`)
    assert.ok(!list.some(c => c.id === id), `${id} has no Leads, so no ticket`)
  }
  assert.ok(list.every(c => pickedOf(c).includes('leads')))
  const tom = list.find(c => c.id === 'ob-tom')
  assert.ok(tom, 'Leads added in Billing and paid: a ticket')
  const s = signupOf(tom, { plans: PLANS })
  assert.deepEqual(s.products.map(x => x.label), ['Leads', 'Servicing'])
  assert.equal(s.via, 'Added Leads in Billing on Nov 4')
  assert.match(src('./screens/Setup.jsx'), /data-testid="adm-signup-products"/)
})

test('real rows: agent_billing_plans merged onto agents and tickets', () => {
  const state = {
    agents: [{ id: 'a1', plan: 'growth' }, { id: 'a2', plan: 'servicing' }, { id: 'a3', plan: 'starter' }],
    onboard: [{ id: 'a1', done: ['paid'] }, { id: 'a2', done: ['paid'] }, { id: 'a3', done: ['paid'] }],
  }
  assert.equal(withProducts(state, null), state) // not migrated / not loaded: nothing changes
  const out = withProducts(state, [
    { agent_id: 'a1', picked: ['leads'], leads_setup_at: '2026-11-01T10:00:00Z', setup_paid_at: '2026-11-01T10:00:00Z' },
    { agent_id: 'a2', picked: ['servicing', 'reactivation'], picked_next: ['reactivation'], picked_next_from: '2026-12-09', setup_paid_at: '2026-10-01T10:00:00Z' },
    { agent_id: 'a3', picked: ['servicing', 'leads'], setup_paid_at: '2026-10-01T10:00:00Z', leads_setup_at: null },
  ])
  assert.equal(chipsText(out.agents[1]), 'Servicing · Reactivation')
  assert.deepEqual(endingLines(out.agents[1]), ['Servicing ends Dec 9'])
  assert.deepEqual(pipelineOf({ ...out, setupLog: {} }).map(c => c.id), ['a1']) // a2 no Leads; a3 Leads added, not paid yet
  const paidLater = withProducts(state, [{ agent_id: 'a3', picked: ['leads', 'servicing'], setup_paid_at: '2026-10-01T10:00:00Z', leads_setup_at: '2026-11-04T15:00:00Z' }])
  assert.deepEqual(paidLater.onboard.find(c => c.id === 'a3').leadsAdded, { on: 'Nov 4' })
  assert.ok(pipelineOf({ ...paidLater, setupLog: {} }).some(c => c.id === 'a3'))
})

test('plan fees by product: Leads by band, Servicing its own price, Reactivation nothing monthly', () => {
  assert.equal(planPriceOf({ picked: ['leads'], plan: 'growth' }, PLANS), PLANS.growth.price)
  assert.equal(planPriceOf({ picked: ['leads', 'servicing'], plan: 'growth' }, PLANS), PLANS.growth.price + PRICES.servicingOnly)
  assert.equal(planPriceOf({ picked: ['servicing'], plan: 'servicing' }, PLANS), PRICES.servicingOnly)
  assert.equal(planPriceOf({ picked: ['reactivation'], plan: null }, PLANS), 0)
  assert.equal(planLineOf({ picked: ['reactivation'], plan: null }, PLANS).label, 'No monthly plan')
})

test('the revenue split sums: sample Leads + Servicing + Setup = the period revenue, plus Reactivation lists', () => {
  const s = admSnapshot()
  for (const period of ['week', 'month', 'last']) {
    const p = moneyFor(s, period)
    const sp = productSplitFor(s, period)
    const { rows, total } = splitRows(sp)
    assert.deepEqual(rows.map(r => r.label), ['Leads', 'Servicing', 'Reactivation', 'Setup fees'])
    assert.equal(sp.amounts.leads + sp.amounts.servicing + sp.amounts.setup, p.inTotal, period)
    assert.equal(sp.amounts.reactivation, reactivationFor(period), period)
    assert.equal(total, p.inTotal + reactivationFor(period), period)
    assert.ok(sp.amounts.servicing > 0 && sp.amounts.leads > 0, period)
  }
  assert.deepEqual(productCounts(s.agents), { leads: 7, servicing: 2, reactivation: 4 })
  // the split never invents money: a store with only lead plans puts all plan fees on Leads
  const only = sampleSplit({ p: { servicing: 1000, leadFee: 120, setup: 299 }, agents: [{ picked: ['leads'], plan: 'growth', billing: {} }], plans: PLANS })
  assert.deepEqual(only.amounts, { leads: 1120, servicing: 0, reactivation: 0, setup: 299 })
})

test('real split: admin_billing_revenue by_product (cents) and counts', () => {
  const r = realSplit({ by_product: { leads: 150000, servicing: 49900, reactivation: 40200, setup: 29900 }, counts: { leads: 5, servicing: 2, reactivation: 3 } })
  assert.deepEqual(r.amounts, { leads: 1500, servicing: 499, reactivation: 402, setup: 299 })
  assert.equal(splitRows(r).total, 2700)
  assert.deepEqual(splitRows(r).rows.map(x => x.agents), [5, 2, 3, null])
  assert.equal(realSplit({ agents: [] }), null) // the old function (no by_product): not shown
  const clock = { todayIso: '2026-11-11', weekStartIso: '2026-11-09', monthStartIso: '2026-11-01' }
  assert.deepEqual(periodRange('week', clock), { from: '2026-11-09', to: '2026-11-11' })
  assert.deepEqual(periodRange('month', clock), { from: '2026-11-01', to: '2026-11-11' })
  assert.deepEqual(periodRange('last', clock), { from: '2026-10-01', to: '2026-10-31' })
  assert.deepEqual(periodRange('last', { ...clock, monthStartIso: '2027-01-01' }), { from: '2026-12-01', to: '2026-12-31' })
})

test('Revenue › Charges: a product added in Billing reads "Added Servicing"', () => {
  assert.equal(chargeWhat({ kind: 'product_add', products: ['servicing'], note: 'Added Servicing · first month $499.00' }), 'Added Servicing')
  assert.equal(chargeWhat({ kind: 'product_add', note: 'Added Growth plan · setup $299.00' }), 'Added Leads') // old rows: from the note
  assert.equal(chargeWhat({ kind: 'product_add', note: 'Added Reactivation' }), 'Added Reactivation')
  assert.equal(chargeWhat({ kind: 'nightly' }), 'Lead spend')
  assert.equal(chargeWhat({ kind: 'reactivation' }), 'Reactivation list')
  assert.match(src('./screens/Billing933.jsx'), /\{chargeWhat\(c\)\}/)
})
