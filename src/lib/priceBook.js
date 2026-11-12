// P884 — the one price source. Every price lives in the database as versioned data (billing_price_book; price_book()
// returns the version in effect). This file mirrors the database books for sample mode and the tests, and turns any
// book into the shapes the screens use. Never put a price in a component: read it from a book. No imports, so Deno
// and the tests can share it.
//
// P901 (Brayden, Nov 7): version 2 was FINAL — three packages by daily lead spend, servicing only $499, a $299 setup
// fee once, month to month (no minimum term). supabase/migrations/247_price_book_v2.sql adds it (effective the day
// it's applied); src/p901.test.js checks this file matches it number for number. Version 1 (the P884 draft) stays
// in the database, append-only, and here only so its parity test keeps holding.

export const BOOK_V1 = {
  version: 1, status: 'draft', effective_from: '2026-11-01',
  tiers: [
    { key: 'starter', label: 'Starter', from: 0, to: 50, monthly_cents: 99700 },
    { key: 'growth', label: 'Growth', from: 51, to: 100, monthly_cents: 179700 },
    { key: 'pro', label: 'Pro', from: 101, to: 200, monthly_cents: 349700 },
    { key: 'scale', label: 'Scale', from: 201, to: null, monthly_cents: null },
  ],
  servicing_only_cents: 49700,
  paid_min_daily_cents: 5000,
  setup: { mode: 'fee', fee_cents: 29700, min_months: 3 },
  grace_days: 3,
  card_fee_rate: 0.03,
  low_days: 2,
}

// Version 2 (P901): final on Nov 7, replaced by version 3 a day later. Kept for its parity test (src/p901.test.js).
export const BOOK_V2 = {
  version: 2, status: 'final', effective_from: null,
  tiers: [
    { key: 'starter', label: 'Starter', from: 0, to: 50, monthly_cents: 79900 },
    { key: 'growth', label: 'Growth', from: 51, to: 200, monthly_cents: 169900 },
    { key: 'pro', label: 'Pro', from: 201, to: null, monthly_cents: 299900 },
  ],
  servicing_only_cents: 49900,
  paid_min_daily_cents: 5000,
  setup: { mode: 'fee', fee_cents: 29900, min_months: 0 },
  grace_days: 3,
  card_fee_rate: 0.03,
  low_days: 2,
}

// P909 (Brayden, Nov 8, model B): version 3 is FINAL and the prices in effect. Plans by daily spend band, plus 12% of
// lead spend (charged nightly with the spend), servicing only by book size, $299 setup once (not refunded).
// supabase/migrations/249_final_pricing.sql adds it; src/p909.test.js checks this file matches it number for number.
// card_fee_rate is what Stripe costs Ohvara (the admin Money page); agents pay no card fee.
export const BOOK = {
  version: 3, status: 'final', effective_from: null,
  tiers: [
    { key: 'starter', label: 'Starter', from: 50, to: 75, monthly_cents: 69900 },
    { key: 'growth', label: 'Growth', from: 76, to: 200, monthly_cents: 149900 },
    { key: 'pro', label: 'Pro', from: 201, to: 500, monthly_cents: 299900 },
  ],
  lead_fee_rate: 0.12,
  servicing_only_cents: 49900,
  servicing_base_clients: 100,
  servicing_step_clients: 100,
  servicing_step_cents: 20000,
  included_added_clients: 50,
  paid_min_daily_cents: 5000,
  setup: { mode: 'fee', fee_cents: 29900, min_months: 0, refundable: false },
  grace_days: 3,
  card_fee_rate: 0.03,
  low_days: 2,
}

// The admin billing settings (billing_settings, one row) as the migration seeds them.
export const BILLING_SETTINGS = {
  charge_mode: 'nightly', max_daily_cents: 50000, charge_hour: 20, retry_hour: 8,
}

const dollars = c => (c == null ? null : c / 100)

// The screens' tier shape (whole dollars a day, monthly price in dollars).
export const tiersOf = (book = BOOK) =>
  book.tiers.map(t => ({ key: t.key, label: t.label, from: t.from, to: t.to, monthly: dollars(t.monthly_cents) }))

export const pricesOf = (book = BOOK) => ({
  version: book.version, draft: book.status !== 'final',
  tiers: tiersOf(book),
  servicingOnly: dollars(book.servicing_only_cents),
  paidMinDaily: dollars(book.paid_min_daily_cents),
  setupFee: dollars(book.setup?.fee_cents),
  setupMode: book.setup?.mode || 'fee',
  minMonths: book.setup?.min_months ?? 0,
  graceDays: book.grace_days,
  cardFee: book.card_fee_rate,
  lowDays: book.low_days,
  leadFee: book.lead_fee_rate ?? 0,
  setupRefundable: book.setup?.refundable ?? false,
  servicingBase: book.servicing_base_clients ?? null,
  servicingStep: book.servicing_step_clients ?? 100,
  servicingStepPrice: dollars(book.servicing_step_cents ?? 0),
  includedAdded: book.included_added_clients ?? null,
})

export const settingsOf = (st = BILLING_SETTINGS) => ({
  maxDaily: st.max_daily_cents / 100, chargeHour: st.charge_hour, retryHour: st.retry_hour,
})
export const SETTINGS = settingsOf(BILLING_SETTINGS)

export const PRICES = pricesOf(BOOK)

// "Starter · $50 to $75 a day", "Growth · $76 to $200 a day", "Pro · $201 to $500 a day" (v2: "up to $50", "over $200").
export const bandText = t => (t.from === 0 ? `up to $${t.to} a day` : t.to == null ? `over $${t.from - 1} a day` : `$${t.from} to $${t.to} a day`)

// "8 PM" from an hour of the day (the nightly charge, the morning retry).
export const hourText = h => `${h % 12 || 12} ${h < 12 ? 'AM' : 'PM'}`

// The nightly charge (P909): tomorrow's spend minus credit, plus the fee rate on that. Whole cents, like the database.
export function nightlyCharge({ daily, credit = 0, rate = PRICES.leadFee }) {
  const spend = Math.round((Number(daily) || 0) * 100)
  const net = Math.max(0, spend - Math.round((Number(credit) || 0) * 100))
  const fee = Math.round(net * rate)
  return { spend: spend / 100, credit: (spend - net) / 100, net: net / 100, fee: fee / 100, total: (net + fee) / 100, rate }
}

// Extra clients: +step price for each started step over the included count (0 when none over).
export function extraClients(count, included, p = PRICES) {
  if (included == null) return { over: 0, extra: 0 }
  const over = Math.max(0, (Number(count) || 0) - included)
  return { over, extra: over ? Math.ceil(over / p.servicingStep) * p.servicingStepPrice : 0 }
}

// Servicing only: base price up to servicingBase clients, then extra.
export const servicingOnlyPrice = (clients, p = PRICES) => p.servicingOnly + extraClients(clients, p.servicingBase, p).extra
