// P901 — the real prices, locked: price book version 2 (final) in the migration and in src/lib/priceBook.js, number
// for number; three packages, no Scale; $299 setup, no minimum term; and Meta only at launch (call ads off).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, globSync } from 'node:fs'
import { BOOK, BOOK_V1, PRICES, bandText } from './lib/priceBook.js'
import { SPLIT_RULES, effectiveSplit, nextSplit } from './lib/leadSplit.js'
import { TIERS, SERVICING_ONLY, SETUP_FEE, tierOf, monthlyBill, expected } from './template/spendPlan.js'
import { PAID_PLANS } from './adminshell/p879.js'
import { PLANS } from './adminshell/data.js'

const SQL = readFileSync('supabase/migrations/p901_price_book_v2.sql', 'utf8')
const SQL_V1 = readFileSync('supabase/migrations/p884_billing_engine.sql', 'utf8')

test('the client price book is the migration\'s version 2, number for number, and final', () => {
  assert.equal(BOOK.version, 2)
  assert.equal(BOOK.status, 'final')
  for (const t of BOOK.tiers) {
    const re = new RegExp(`'key', '${t.key}',\\s*'label', '${t.label}',\\s*'from', ${t.from},\\s*'to', ${t.to ?? 'null'},\\s*'monthly_cents', ${t.monthly_cents}\\)`)
    assert.match(SQL, re, `tier ${t.key}`)
  }
  assert.equal((SQL.match(/'key', '/g) || []).length, BOOK.tiers.length, 'no other tier in version 2')
  assert.match(SQL, new RegExp(`'servicing_only_cents', ${BOOK.servicing_only_cents}`))
  assert.match(SQL, new RegExp(`'paid_min_daily_cents', ${BOOK.paid_min_daily_cents}`))
  assert.match(SQL, new RegExp(`'setup', jsonb_build_object\\('mode', '${BOOK.setup.mode}', 'fee_cents', ${BOOK.setup.fee_cents}, 'min_months', ${BOOK.setup.min_months}\\)`))
  assert.match(SQL, new RegExp(`'grace_days', ${BOOK.grace_days}`))
  assert.match(SQL, new RegExp(`'card_fee_rate', ${BOOK.card_fee_rate}`))
  assert.match(SQL, new RegExp(`'low_days', ${BOOK.low_days}\\)`))
  // Effective the day it's applied; version 1 is kept (append-only: no update or delete of the book).
  assert.match(SQL, /values \(2, billing_today\(\), 'final'/)
  assert.doesNotMatch(SQL, /(update|delete from)\s+public\.billing_price_book/i)
  assert.match(SQL_V1, /values \(1, date '2026-11-01', 'draft'/)
  assert.equal(BOOK_V1.version, 1)
})

test('Brayden\'s prices: three packages, servicing only $499, $299 setup once, month to month', () => {
  assert.deepEqual(TIERS.map(t => [t.key, t.from, t.to, t.monthly]), [['starter', 0, 50, 799], ['growth', 51, 200, 1699], ['pro', 201, null, 2999]])
  assert.deepEqual([50, 51, 200, 201, 500].map(d => tierOf(d).key), ['starter', 'growth', 'growth', 'pro', 'pro'])
  assert.equal(SERVICING_ONLY, 499)
  assert.equal(SETUP_FEE, 299)
  assert.equal(PRICES.setupMode, 'fee')
  assert.equal(PRICES.minMonths, 0)
  assert.equal(PRICES.paidMinDaily, 50)
  assert.equal(PRICES.draft, false)
  assert.equal(monthlyBill({ plan: 'paid', spend: { daily: 250 } }).membership, 2999)
  assert.equal(monthlyBill({ plan: 'paid', spend: { daily: 250 } }).total, Math.round(250 * 30.4) + 2999)
  assert.deepEqual(TIERS.map(bandText), ['up to $50 a day', '$51 to $200 a day', 'over $200 a day'])
})

test('admin plan pickers and plan labels read the price book', () => {
  assert.deepEqual(PAID_PLANS.map(p => p.value), ['Starter', 'Growth', 'Pro'])
  assert.equal(PAID_PLANS[1].label, 'Growth · $51 to $200 a day · $1,699 a month')
  assert.deepEqual(Object.keys(PLANS), ['starter', 'growth', 'pro', 'servicing'])
  assert.deepEqual(Object.values(PLANS).map(p => p.price), [799, 1699, 2999, 499])
})

test('no old price, Scale tier, draft price label or minimum term is left on a screen', () => {
  const files = globSync('src/**/*.{js,jsx}').map(p => p.replaceAll('\\', '/'))
    .filter(f => !f.endsWith('.test.js') && f !== 'src/lib/priceBook.js' && !f.startsWith('src/lib/carriers/'))
  const old = /\$\s?(997|697|1,?797|3,?497|497)\b|\b(997|1797|3497|497)\b(?!-)/
  for (const f of files) {
    const src = readFileSync(f, 'utf8')
    assert.doesNotMatch(src, old, `${f} has an old price`)
    assert.doesNotMatch(src, /'Scale'|Scale ·|key: 'scale'/, `${f} has the Scale tier`)
    assert.doesNotMatch(src, /[Dd]raft prices?\b/, `${f} labels prices as drafts`)
    assert.doesNotMatch(src, /3-month minimum|three-month minimum|3 month minimum|minimum term/i, `${f} has a minimum term`)
  }
})

test('Meta only at launch: call ads are off, so every agent runs all form ads and the Monday move waits', () => {
  assert.equal(SPLIT_RULES.callAdsOn, false)
  assert.deepEqual(effectiveSplit({ daily: 150, mode: 'both' }), { form: 150, call: 0, formPct: 100, reason: 'call_ads_off' })
  assert.deepEqual(effectiveSplit({ daily: 150, mode: 'appts' }), { form: 150, call: 0, formPct: 100, reason: 'appts_only' })
  const held = nextSplit({ formPct: 70, form: { spent: 1680, sales: 4 }, call: { spent: 720, sales: 2 } })
  assert.deepEqual([held.formPct, held.moved, held.reason], [70, 0, 'call_ads_off'])
  // The split code waits: switched on, it runs as P889 set it.
  assert.equal(effectiveSplit({ daily: 100, mode: 'both' }, { ...SPLIT_RULES, callAdsOn: true }).reason, 'split')
  // Live transfers still come from form leads; booking-only agents get none.
  const both = expected({ daily: 100 }, 'both')
  const appts = expected({ daily: 100 }, 'appts')
  assert.ok(both.live.delivered.mid > 0)
  assert.equal(both.live.calls.high, 0)
  assert.equal(appts.live.delivered.high, 0)
  assert.equal(both.appts.leads.mid, appts.appts.leads.mid, 'same form leads either way')
})

test('the migration adds the switch, off, and holds the split while it is off', () => {
  assert.match(SQL, /add column call_ads_on boolean not null default false/)
  assert.match(SQL, /if not coalesce\(r\.call_ads_on, false\) then\s+return jsonb_build_object\('form_cents', d, 'call_cents', 0, 'form_pct', 100, 'reason', 'call_ads_off'\)/)
  assert.match(SQL, /if not coalesce\(r\.call_ads_on, false\) then return 0; end if;/)
  assert.match(SQL, /call_ads_on = coalesce\(\(p_rules->>'call_ads_on'\)::boolean, call_ads_on\)/)
  assert.match(SQL, /'next', case when p\.mode = 'both' and r\.call_ads_on then/)
  assert.doesNotMatch(SQL, /^\s*\d{3}_/m)
})

test('agents never see where spend goes or that prices were drafts', () => {
  const agentText = ['src/template/PlanBuilder.jsx', 'src/template/screens/Billing.jsx', 'src/template/screens/Welcome.jsx', 'src/template/screens/Leads.jsx']
    .map(f => readFileSync(f, 'utf8').replace(/\/\/.*$/gm, '').replace(/className="[^"]*"/g, '')).join(' ')
  assert.doesNotMatch(agentText, /\b(Meta|Google|call ads|form ads)\b/i)
  assert.match(readFileSync('src/template/PlanBuilder.jsx', 'utf8'), /Month to month\. Cancel anytime\./)
})
