// P884 — one price source, and the real billing client the agent and admin sides wire (P848, P858).
// The money rules themselves are tested in supabase/tests/p884_billing_engine.sql (pgTAP) and
// supabase/functions/lead-spend/core.test.ts (Stripe, test mode only).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, globSync } from 'node:fs'
import { BOOK_V1 as DRAFT_BOOK, BOOK, PRICES, pricesOf, tiersOf } from './lib/priceBook.js'
import { TIERS, SERVICING_ONLY, PAID_MIN_DAILY, tierOf, monthlyBill } from './template/spendPlan.js'
import { SETUP_FEE, CARD_FEE } from './adminshell/data.js'
import { toSampleBilling, setSpend, loadBilling, pilotSet, adjustBalance } from './lib/leadSpend.js'

const SQL = readFileSync('supabase/migrations/237_billing_engine.sql', 'utf8')

test('the client price book is the migration\'s version 1, number for number', () => {
  for (const t of DRAFT_BOOK.tiers) {
    const re = new RegExp(`'key', '${t.key}',\\s*'label', '${t.label}',\\s*'from', ${t.from},\\s*'to', ${t.to ?? 'null'},\\s*'monthly_cents', ${t.monthly_cents ?? 'null'}\\)`)
    assert.match(SQL, re, `tier ${t.key}`)
  }
  assert.match(SQL, new RegExp(`'servicing_only_cents', ${DRAFT_BOOK.servicing_only_cents}`))
  assert.match(SQL, new RegExp(`'paid_min_daily_cents', ${DRAFT_BOOK.paid_min_daily_cents}`))
  assert.match(SQL, new RegExp(`'setup', jsonb_build_object\\('mode', '${DRAFT_BOOK.setup.mode}', 'fee_cents', ${DRAFT_BOOK.setup.fee_cents}, 'min_months', ${DRAFT_BOOK.setup.min_months}\\)`))
  assert.match(SQL, new RegExp(`'grace_days', ${DRAFT_BOOK.grace_days}`))
  assert.match(SQL, new RegExp(`'card_fee_rate', ${DRAFT_BOOK.card_fee_rate}`))
  assert.match(SQL, /values \(1, date '2026-11-01', 'draft'/)
})

test('every old price set now reads the one source (P909: version 3)', () => {
  assert.deepEqual(TIERS, tiersOf(BOOK))
  assert.equal(SERVICING_ONLY, 499)
  assert.equal(PAID_MIN_DAILY, 50)
  assert.equal(SETUP_FEE, PRICES.setupFee)
  assert.equal(CARD_FEE, PRICES.cardFee)
  assert.equal(tierOf(75).key, 'starter')
  assert.equal(monthlyBill({ plan: 'paid', spend: { appts: 100, live: 50 } }).membership, 1499)
  assert.equal(monthlyBill({ plan: 'pilot', spend: { appts: 100, live: 50 } }).membership, 0)
})

test('no component carries a membership price of its own', () => {
  const prices = [...DRAFT_BOOK.tiers, ...BOOK.tiers].filter(t => t.monthly_cents).map(t => String(t.monthly_cents / 100))
  const allowed = ['src/lib/priceBook.js']
  for (const f of globSync('src/**/*.{js,jsx}').map(p => p.replaceAll('\\', '/'))) {
    if (allowed.includes(f) || f.endsWith('.test.js')) continue
    const src = readFileSync(f, 'utf8')
    for (const p of prices) {
      const comma = Number(p).toLocaleString('en-US')
      assert.ok(!new RegExp(`(?:\\$|monthly\\s*:\\s*|price\\s*:\\s*)(?:${p}|${comma})\\b`).test(src), `${f} has ${p}`)
    }
  }
})

test('a price book from the database shapes the same way', () => {
  const p = pricesOf({ ...BOOK, version: 4 })
  assert.equal(p.draft, false)
  assert.equal(p.tiers[0].monthly, 699)
  assert.equal(p.tiers.length, 3)
  assert.equal(pricesOf(DRAFT_BOOK).draft, true)
  assert.equal(pricesOf(DRAFT_BOOK).tiers[3].monthly, null)
})

test('toSampleBilling maps the server view onto the Billing page shape (dollars)', () => {
  const view = {
    plan: 'pilot', products: 'both', balance_cents: 4000,
    state: { status: 'pilot', lead_spend: 'running', ads: true, servicing: true },
    spend: { appts: 6000, live: 4000, next: { appts: 8000, live: 4000 }, next_from: '2026-11-12' },
    week: { week_start: '2026-11-09', rolled_in_cents: 3500, collected_cents: 66500, types: { appts: { billed_cents: 30000 }, live: { billed_cents: 11200 } } },
    va_cost: { on: true, minutes: 390, rate_cents: 800, cents: 5200 },
    charges: [{ id: 'c1', kind: 'weekly', cents: 66500, status: 'paid' }],
    price_book: { ...BOOK },
  }
  const b = toSampleBilling(view)
  assert.equal(b.plan, 'pilot')
  // P889: the agent gets one spend line; the old per-type view adds up.
  assert.deepEqual(b.spend, { daily: 100 })
  assert.deepEqual(b.pending, { daily: 120, from: '2026-11-12' })
  const one = toSampleBilling({ ...view, spend: { daily: 9000, next: 10000, next_from: '2026-11-12' }, week: { ...view.week, types: undefined, billed_cents: 41200 }, lead_product: { mode: 'both', hours: { Mon: { on: true, start: '9:00 AM', end: '5:00 PM' } }, tz: 'America/Chicago' } })
  assert.deepEqual([one.spend, one.pending, one.wallet.spent, one.take.mode], [{ daily: 90 }, { daily: 100, from: '2026-11-12' }, 412, 'both'])
  assert.equal(b.wallet.topUp, 665)
  assert.equal(b.wallet.rolled, 35)
  assert.equal(b.wallet.spent, 412)
  assert.equal(b.wallet.balance, 40)
  assert.deepEqual(b.va, { on: true, hours: 6.5, rate: 8 })
  assert.equal(b.payment.failed, false)
  assert.equal(b.charges[0].amount, 665)
  assert.equal(b.prices.tiers[1].monthly, 1499)
  assert.equal(toSampleBilling({ ...view, state: { status: 'past_due', lead_spend: 'stopped_payment' } }).payment.failed, true)
  assert.equal(toSampleBilling(null), null)
})

test('the client sends cents, calls the right RPCs and surfaces min_daily', async () => {
  const calls = []
  const db = {
    rpc: async (name, args) => { calls.push(['rpc', name, args]); return { data: { ok: true }, error: null } },
    functions: {
      invoke: async (fn, { body }) => {
        calls.push(['fn', fn, body])
        if (body.appts_cents === 3000) return { data: null, error: { message: 'non-2xx', context: { json: async () => ({ error: 'Pause instead?', code: 'min_daily' }) } } }
        return { data: { from: '2026-11-12' }, error: null }
      },
    },
  }
  await setSpend(db, { appts: 50.5, live: 25 })
  assert.deepEqual(calls.at(-1), ['fn', 'lead-spend', { action: 'set_spend', appts_cents: 5050, live_cents: 2500 }])
  await assert.rejects(setSpend(db, { appts: 30 }), e => e.code === 'min_daily' && e.message === 'Pause instead?')
  await loadBilling(db)
  assert.deepEqual(calls.at(-1), ['rpc', 'my_billing', undefined])
  await pilotSet(db, 'ag1', { on: true, note: 'first' })
  assert.deepEqual(calls.at(-1), ['rpc', 'admin_billing_pilot_set', { p_agent: 'ag1', p_on: true, p_start: null, p_note: 'first' }])
  await adjustBalance(db, 'ag1', 12.34, 'refund a bad day')
  assert.deepEqual(calls.at(-1)[2], { p_agent: 'ag1', p_cents: 1234, p_reason: 'refund a bad day' })
})

test('agents never see engine words: the client and its view have no ads, Meta or GoHighLevel', () => {
  const src = readFileSync('src/lib/leadSpend.js', 'utf8')
  for (const w of ['GoHighLevel', 'Meta', 'campaign']) assert.ok(!src.includes(w), w)
  assert.match(SQL, /create policy acc_admin_read on public\.agent_campaign_control for select to authenticated using \(is_admin\(\)\)/)
})
