// P955 — pick what you need: the shared product rules (src/lib/products.js) and Billing → Your products' pure part
// (src/template/productsView.js): nav per purchase, removal, the suggestion, the quote lines and the sample quote.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PRODUCTS, ORDER, norm, has, monthly, label, navFor, suggestion, afterRemove, signupNeeds } from './lib/products.js'
import { PRICES } from './lib/priceBook.js'
import { REACT_DEFAULTS } from './lib/reactivation.js'
import { pickedOf, productsWord, stateOf, canRemove, removeWords, quoteLines, sampleQuote, tabsFor, failWords, addResultWords, clampDaily, bandRange, dayWords, costOf } from './template/productsView.js'

const keys = s => [...s].sort()

test('norm keeps one order, no repeats, only known products', () => {
  assert.deepEqual(norm(['reactivation', 'leads', 'leads', 'nope', 'servicing']), ['leads', 'servicing', 'reactivation'])
  assert.deepEqual(norm(null), [])
  assert.deepEqual(ORDER, ['leads', 'servicing', 'reactivation'])
  assert.ok(has(['servicing'], 'servicing') && !has(['servicing'], 'leads'))
  assert.equal(label(['reactivation', 'leads']), 'Leads + Reactivation')
  assert.equal(label([]), 'Nothing yet')
})

test('monthly: Leads or Servicing; Reactivation alone is nothing monthly', () => {
  assert.equal(monthly(['leads']), true)
  assert.equal(monthly(['servicing', 'reactivation']), true)
  assert.equal(monthly(['reactivation']), false)
  assert.deepEqual(signupNeeds(['reactivation']), { plan: false, details: false, clientsAfter: false, charge: false })
  assert.deepEqual(signupNeeds(['leads', 'servicing']), { plan: true, details: true, clientsAfter: true, charge: true })
})

test('navFor: tabs for what they bought', () => {
  const always = ['activity', 'billing', 'calendar', 'overview']
  assert.deepEqual(keys(navFor(['leads'])), keys([...always, 'leads', 'clients']))
  assert.deepEqual(keys(navFor(['reactivation'])), keys([...always, 'leads']))
  assert.deepEqual(keys(navFor(['reactivation'], { clients: 2 })), keys([...always, 'leads', 'clients']))
  assert.deepEqual(keys(navFor(['servicing'])), keys([...always, 'clients']))
  assert.deepEqual(keys(navFor([])), keys(always))
  const TABS = [{ key: 'overview' }, { key: 'leads' }, { key: 'clients' }, { key: 'calendar' }, { label: 'More' }]
  assert.deepEqual(tabsFor(TABS, ['servicing']).map(t => t.key || t.label), ['overview', 'clients', 'calendar', 'More'])
  assert.deepEqual(tabsFor(TABS, ['reactivation']).map(t => t.key || t.label), ['overview', 'leads', 'calendar', 'More'])
})

test('suggestion: Add Leads for anyone without it, nothing otherwise', () => {
  assert.equal(suggestion(['reactivation']), 'leads')
  assert.equal(suggestion(['servicing']), 'leads')
  assert.equal(suggestion(['leads']), null)
  assert.equal(suggestion(['leads', 'servicing', 'reactivation']), null)
})

test('afterRemove: removing the last monthly product leaves Reactivation', () => {
  assert.deepEqual(afterRemove(['leads', 'servicing'], 'leads'), ['servicing'])
  assert.deepEqual(afterRemove(['leads'], 'leads'), ['reactivation'])
  assert.deepEqual(afterRemove(['servicing', 'reactivation'], 'servicing'), ['reactivation'])
  assert.deepEqual(afterRemove(['leads', 'reactivation'], 'reactivation'), ['leads'])
})

test('the products words carry the price book prices', () => {
  const m = n => `$${Number(n).toLocaleString('en-US')}`
  assert.equal(PRODUCTS.leads.price, `from ${m(PRICES.tiers[0].monthly)} a month`)
  assert.match(PRODUCTS.leads.sub, new RegExp(`\\${m(PRICES.setupFee)} setup`))
  assert.equal(PRODUCTS.servicing.price, `${m(PRICES.servicingOnly)} a month`)
  assert.match(PRODUCTS.servicing.sub, new RegExp(`up to ${PRICES.servicingBase} clients`))
  assert.equal(PRODUCTS.reactivation.price, `${m(REACT_DEFAULTS.priceCents / 100)} a lead`)
  assert.match(PRODUCTS.reactivation.sub, new RegExp(`at least ${REACT_DEFAULTS.minLeads}`))
  // The decided prices (P955): $299 setup, Servicing $499 up to 100 clients, $2 a callable lead, min 100.
  assert.equal(PRICES.setupFee, 299)
  assert.equal(PRICES.servicingOnly, 499)
  assert.equal(PRICES.servicingBase, 100)
  assert.equal(PRICES.servicingStepPrice, 200)
  assert.equal(REACT_DEFAULTS.priceCents, 200)
  assert.equal(REACT_DEFAULTS.minLeads, 100)
})

test('pickedOf: picked, or the old one-word products', () => {
  assert.deepEqual(pickedOf({ picked: ['reactivation', 'leads'] }), ['leads', 'reactivation'])
  assert.deepEqual(pickedOf({ products: 'servicing' }), ['servicing'])
  assert.deepEqual(pickedOf({ products: 'both' }), ['leads'])
  assert.equal(productsWord(['servicing', 'reactivation']), 'servicing')
  assert.equal(productsWord(['leads']), 'both')
})

test('stateOf: on, off, ending (a removal waits), starting', () => {
  const b = { picked: ['leads', 'reactivation'], next: null }
  assert.equal(stateOf(b, 'leads').kind, 'on')
  assert.equal(stateOf(b, 'servicing').kind, 'off')
  const r = { picked: ['leads'], next: ['reactivation'], nextFrom: '2026-12-01' }
  assert.deepEqual(stateOf(r, 'leads'), { kind: 'ending', on: '2026-12-01' })
  assert.deepEqual(stateOf(r, 'reactivation'), { kind: 'starting', on: '2026-12-01' })
  assert.equal(canRemove(r, 'leads'), false) // already ending: Keep instead
  assert.equal(canRemove({ picked: ['reactivation'] }, 'reactivation'), false) // never the last product
  assert.equal(canRemove({ picked: ['leads', 'reactivation'] }, 'reactivation'), true)
})

test('removeWords: next bill date for monthly products, at once for Reactivation', () => {
  const b = { picked: ['leads'], planMonth: { today: '2026-11-02', start: '2026-11-01', next: '2026-12-01' } }
  const w = removeWords(b, 'leads')
  assert.equal(w.lines[0], `Ends on ${dayWords('2026-12-01')}. You keep it until then.`)
  assert.match(w.lines.join(' '), /keep your portal and Reactivation/)
  const two = removeWords({ ...b, picked: ['leads', 'servicing'] }, 'servicing')
  assert.doesNotMatch(two.lines.join(' '), /portal and Reactivation/)
  assert.deepEqual(removeWords(b, 'reactivation').lines[0], 'Lists already paid keep calling.')
})

test('sampleQuote: prorated in a running month, full month otherwise; setup once', () => {
  const m = { today: '2026-11-02', start: '2026-11-01', next: '2026-12-01' }
  const sv = sampleQuote({ picked: ['leads'], planMonth: m, setupPaid: 'Mon, Sep 28', leadsSetupPaid: true }, { product: 'servicing' })
  assert.equal(sv.setup_cents, 0)
  assert.equal(sv.prorated, true)
  assert.equal(sv.days_left, 29)
  assert.equal(sv.plan_cents, Math.round(49900 * 29 / 30))
  assert.equal(sv.total_cents, sv.plan_cents)
  const rx = { picked: ['reactivation'], planMonth: m, setupPaid: null, leadsSetupPaid: false }
  const sv2 = sampleQuote(rx, { product: 'servicing' })
  assert.equal(sv2.setup_cents, 29900)
  assert.equal(sv2.prorated, false)
  assert.equal(sv2.plan_cents, 49900)
  const ld = sampleQuote(rx, { product: 'leads', tier: 'growth', daily: 100 })
  assert.equal(ld.setup_cents, 29900)
  assert.equal(ld.plan_cents, 149900)
  assert.equal(ld.days.length, 2)
  assert.equal(ld.spend_cents, 20000)
  assert.equal(ld.fee_cents, 2400)
  assert.equal(ld.total_cents, 29900 + 149900 + 20000 + 2400)
  assert.equal(sampleQuote(rx, { product: 'reactivation' }).total_cents, 0)
})

test('quoteLines: setup, the plan (days left or first month), first days of leads, total', () => {
  const q = { label: 'Growth', setup_cents: 29900, plan_cents: 144900, monthly_cents: 149900, prorated: true, days_left: 29, bill_to: '2026-12-01', days: ['a', 'b'], spend_cents: 20000, fee_cents: 2400, total_cents: 197200 }
  const rows = quoteLines(q)
  assert.deepEqual(rows.map(r => r.key), ['setup', 'plan', 'leads', 'total'])
  assert.equal(rows[1].label, 'Growth, 29 days left this month')
  assert.equal(rows[2].cents, 22400)
  assert.equal(rows[3].cents, 197200)
  assert.equal(quoteLines({ ...q, prorated: false, setup_cents: 0, days: [] })[0].label, 'Growth, first month')
  assert.deepEqual(quoteLines({ total_cents: 0, days: [], setup_cents: 0, plan_cents: 0, monthly_cents: 0 }).map(r => r.key), ['total'])
})

test('failure words always say nothing was charged', () => {
  for (const code of ['details_missing', 'already_have', 'pending_removal', 'no_card']) assert.match(failWords({ code }), /Nothing was charged/)
  assert.match(failWords({ hint: 'no_card' }), /Add a card/)
  assert.match(failWords({ code: 'test_account' }), /never charged/)
  assert.match(failWords(new Error('Boom')), /^Boom\. Nothing was charged\.$/)
  assert.equal(addResultWords({ status: 'paid' }, 'Servicing').ok, true)
  assert.match(addResultWords({ status: 'failed' }, 'Leads').text, /Nothing was charged/)
  assert.match(addResultWords({ status: 'due', skipped: true }, 'Leads').text, /aren’t switched on/)
})

test('the daily spend stays inside the band, never under the paid minimum', () => {
  const growth = PRICES.tiers.find(t => t.key === 'growth')
  assert.deepEqual(bandRange(growth), { lo: 76, hi: 200 })
  assert.equal(clampDaily(growth, 500), 200)
  assert.equal(clampDaily(growth, 10), 76)
  assert.equal(clampDaily(PRICES.tiers[0], 20), Math.max(PRICES.tiers[0].from, PRICES.paidMinDaily))
  assert.equal(costOf({ tier: 'pro' }, 'leads').big, '$2,999 a month')
  assert.equal(costOf({ clients: { total: 250 } }, 'servicing').big, `$${PRICES.servicingOnly + 2 * PRICES.servicingStepPrice} a month`)
})

test('agent screens for products never name the ad side or the vendors', () => {
  const text = ['src/template/Products955.jsx', 'src/template/productsView.js', 'src/lib/products.js']
    .map(f => readFileSync(f, 'utf8').replace(/\/\/.*$/gm, '').replace(/className="[^"]*"/g, '').replace(/import .*$/gm, '')).join(' ')
  assert.doesNotMatch(text, /\b(Meta|Google|GoHighLevel|ads?)\b/i)
})
