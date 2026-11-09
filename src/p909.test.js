// P909 — final pricing (model B): plans by daily spend band + 12% of lead spend, $500 a day max, a nightly card charge,
// servicing by book size, the founding lock. Price book version 3 lives in the migration and in src/lib/priceBook.js,
// number for number; the screens read it and nothing else.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, globSync } from 'node:fs'
import { BOOK, BILLING_SETTINGS, PRICES, SETTINGS, bandText, nightlyCharge, servicingOnlyPrice } from './lib/priceBook.js'
import { tierOf, monthlyBill, spendOk, nightlyFor, addedQuote, MAX_DAILY, SLIDER, INCLUDED_ADDED } from './template/spendPlan.js'
import { PLANS, moneyFor, admSnapshot, PERIODS } from './adminshell/data.js'
import { pilotTotals, PILOT_ROWS } from './adminshell/p879.js'

const SQL = readFileSync('supabase/migrations/249_final_pricing.sql', 'utf8')

test('the client price book is the migration\'s version 3, number for number, and final', () => {
  assert.equal(BOOK.version, 3)
  assert.equal(BOOK.status, 'final')
  for (const t of BOOK.tiers) {
    const re = new RegExp(`'key', '${t.key}',\\s*'label', '${t.label}',\\s*'from', ${t.from},\\s*'to', ${t.to},\\s*'monthly_cents', ${t.monthly_cents}\\)`)
    assert.match(SQL, re, `tier ${t.key}`)
  }
  const v3 = SQL.slice(SQL.indexOf('values (3, billing_today()'), SQL.indexOf('P909: final prices, model B'))
  assert.equal((v3.match(/jsonb_build_object\('key', '/g) || []).length, BOOK.tiers.length, 'no other tier in version 3')
  for (const k of ['lead_fee_rate', 'servicing_only_cents', 'servicing_base_clients', 'servicing_step_clients', 'servicing_step_cents',
    'included_added_clients', 'paid_min_daily_cents', 'grace_days', 'card_fee_rate', 'low_days']) {
    assert.match(SQL, new RegExp(`'${k}', ${BOOK[k]}[,)]`), k)
  }
  const s = BOOK.setup
  assert.match(SQL, new RegExp(`'setup', jsonb_build_object\\('mode', '${s.mode}', 'fee_cents', ${s.fee_cents}, 'min_months', ${s.min_months}, 'refundable', ${s.refundable}\\)`))
  assert.match(SQL, /values \(3, billing_today\(\), 'final'/)
  assert.doesNotMatch(SQL, /(update|delete from)\s+public\.billing_price_book/i, 'the book stays append-only')
  // The settings row seeds the same defaults the screens show.
  assert.match(SQL, new RegExp(`max_daily_cents\\s+int not null default ${BILLING_SETTINGS.max_daily_cents}`))
  assert.match(SQL, new RegExp(`charge_hour\\s+int not null default ${BILLING_SETTINGS.charge_hour}`))
  assert.match(SQL, new RegExp(`retry_hour\\s+int not null default ${BILLING_SETTINGS.retry_hour}`))
  assert.match(SQL, new RegExp(`founding_count\\s+int not null default ${BILLING_SETTINGS.founding_count}`))
  assert.match(SQL, new RegExp(`founding_months\\s+int not null default ${BILLING_SETTINGS.founding_months}`))
  assert.match(SQL, new RegExp(`charge_mode\\s+text not null default '${BILLING_SETTINGS.charge_mode}'`))
})

test('the plan follows the daily spend band: $50/75/76/100/200/201/500', () => {
  assert.deepEqual([50, 75, 76, 100, 200, 201, 500].map(d => tierOf(d).key), ['starter', 'starter', 'growth', 'growth', 'growth', 'pro', 'pro'])
  assert.deepEqual(PRICES.tiers.map(t => [t.label, t.monthly, bandText(t)]),
    [['Starter', 699, '$50 to $75 a day'], ['Growth', 1499, '$76 to $200 a day'], ['Pro', 2999, '$201 to $500 a day']])
  assert.deepEqual(Object.values(PLANS).map(p => p.price), [699, 1499, 2999, 499])
  assert.equal(PRICES.leadFee, 0.12)
  assert.equal(PRICES.setupFee, 299)
  assert.equal(PRICES.setupRefundable, false)
})

test('spend is $50 to $500 a day; an admin can raise one agent', () => {
  assert.equal(MAX_DAILY, 500)
  assert.equal(SLIDER.max, 500)
  assert.equal(SETTINGS.maxDaily, 500)
  assert.equal(spendOk('paid', { daily: 49 }), false)
  assert.equal(spendOk('paid', { daily: 50 }), true)
  assert.equal(spendOk('paid', { daily: 500 }), true)
  assert.equal(spendOk('paid', { daily: 505 }), false)
  assert.equal(spendOk('pilot', { daily: 505 }), false, 'the max holds in the pilot too')
  assert.equal(spendOk('paid', { daily: 700 }, 750), true, 'admin override')
  // The server holds the same line: a trigger on agent_lead_spend, raised by hand per agent.
  assert.match(SQL, /create constraint trigger lead_spend_max_guard/)
  assert.match(SQL, /Daily lead spend can be up to/)
  assert.match(SQL, /create or replace function public\.admin_billing_max_daily_set/)
})

test('each night the card is charged tomorrow\'s spend x 1.12; what wasn\'t spent comes off with its 12%', () => {
  assert.deepEqual(nightlyCharge({ daily: 100 }), { spend: 100, credit: 0, net: 100, fee: 12, total: 112, rate: 0.12 })
  assert.equal(nightlyFor('paid', 100).total, 112)
  assert.equal(nightlyFor('pilot', 100).total, 100, 'pilot agents pay lead spend only')
  // True-up: $10 not spent yesterday → tonight is $90 + 12% = $100.80.
  assert.equal(nightlyFor('paid', 100, 10).total, 100.8)
  assert.equal(nightlyFor('paid', 50, 60).total, 0, 'credit covers the night')
  // The server: decline → off next day → morning retry; a cleared failure for a passed day is never owed.
  assert.match(SQL, /create or replace function public\.lead_spend_nightly\(/)
  assert.match(SQL, /create or replace function public\.lead_spend_morning_retry\(/)
  assert.match(readFileSync('supabase/functions/lead-spend/core.ts', 'utf8'), /DESCRIPTOR_SUFFIX = 'LEADS'/)
})

test('servicing only: $499 up to 100 clients, +$200 for each extra 100', () => {
  assert.deepEqual([80, 100, 101, 200, 201, 250].map(n => servicingOnlyPrice(n)), [499, 499, 699, 699, 899, 899])
  assert.equal(monthlyBill({ plan: 'paid', spend: { daily: 0 }, products: 'servicing', clients: { total: 250 } }).total, 899)
  assert.equal(monthlyBill({ plan: 'paid', spend: { daily: 0 }, products: 'servicing', clients: { total: 80 } }).total, 499)
})

test('lead plans include every policy sold plus 50 added clients; Add clients shows the cost first', () => {
  assert.equal(INCLUDED_ADDED, 50)
  const b = { plan: 'paid', products: 'both', clients: { total: 70, sold: 30, added: 40 } }
  assert.deepEqual([addedQuote(b, 10).change, addedQuote(b, 11).change, addedQuote(b, 110).change], [0, 200, 200])
  assert.equal(addedQuote(b, 111).change, 400)
  assert.equal(addedQuote({ ...b, products: 'servicing', clients: { total: 95 } }, 10).change, 200)
  assert.equal(addedQuote({ ...b, plan: 'pilot' }, 500), null, 'nothing changes in the pilot')
  const bill = monthlyBill({ plan: 'paid', spend: { daily: 100 }, clients: { added: 120 } })
  assert.deepEqual([bill.over, bill.extra], [70, 200])
  assert.match(readFileSync('src/template/AddClients891.jsx', 'utf8'), /<AddedCost billing=\{billing\} adding=\{ready\} \/>/)
})

test('the founding lock: the first 20 paying agents keep these prices for 12 months, and it ends', () => {
  assert.deepEqual([SETTINGS.foundingCount, SETTINGS.foundingMonths], [20, 12])
  assert.match(SQL, /create or replace function public\.billing_book_for\(/)
  assert.match(SQL, /founding_until > d/)
  const billing = readFileSync('src/template/screens/Billing.jsx', 'utf8')
  assert.match(billing, /\['Founding price lock', `Until \$\{b\.founding\.until\}`/) // P910 Billing rebuild
})

test('admin revenue and the pilot results keep the plan fee and the 12% apart', () => {
  const s = admSnapshot()
  for (const [period] of PERIODS) {
    const p = moneyFor(s, period)
    assert.equal(p.leadFee, Math.round(p.budgets * 0.12), period)
    assert.equal(p.inTotal, p.leadFee + p.servicing + p.setup, period) // P913: lead spend passes to Meta, in no total
  }
  const t = pilotTotals(PILOT_ROWS, { membership: 1800 })
  assert.equal(t.planFee, 1800)
  assert.equal(t.leadFee, Math.round(t.spend * 0.12 * 100) / 100)
  assert.equal(t.revenue, t.planFee + t.leadFee)
  assert.equal(pilotTotals(PILOT_ROWS).leadFee, 0, 'pilot agents pay no 12%')
  assert.match(SQL, /create or replace function public\.admin_billing_revenue\(/)
})

test('no old price, weekly prepay, rollover or bank transfer is left on a screen', () => {
  const files = globSync('src/**/*.{js,jsx}').map(p => p.replaceAll('\\', '/'))
    .filter(f => !f.endsWith('.test.js') && f !== 'src/lib/priceBook.js' && !f.startsWith('src/lib/carriers/'))
  const old = /\$\s?(799|1,?699|997|1,?797|3,?497)\b|Pro\+|over \$200/
  for (const f of files) {
    const src = readFileSync(f, 'utf8').replace(/\/\/.*$/gm, '')
    assert.doesNotMatch(src, old, `${f} has an old price`)
  }
  const agent = ['src/template/PlanBuilder.jsx', 'src/template/screens/Billing.jsx', 'src/template/screens/Welcome.jsx', 'src/template/screens/Signup.jsx',
    'src/template/screens/More.jsx', 'src/template/Results.jsx'].map(f => readFileSync(f, 'utf8').replace(/\/\/.*$/gm, '')).join(' ')
  assert.doesNotMatch(agent, /rolls? (over|into)|prepaid each week|Prepaid each week|bank transfer(?!s: cards only)|\bACH\b|card fee/i)
  assert.match(agent, /OHVARA LEADS/)
  assert.match(agent, /Cancel anytime: unspent/)
  assert.match(agent, /setup fee isn/)
})

test('the migration is one file, numbered 249 by P904', () => {
  assert.equal(globSync('supabase/migrations/*_final_pricing*').length, 1)
  assert.match(globSync('supabase/migrations/*_final_pricing*')[0].replaceAll('\\', '/'), /migrations\/249_final_pricing\.sql$/)
})
