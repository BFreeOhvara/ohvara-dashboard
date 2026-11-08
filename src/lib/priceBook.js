// P884 — the one price source. Every price lives in the database as versioned data (billing_price_book; price_book()
// returns the version in effect). This file mirrors the database books for sample mode and the tests, and turns any
// book into the shapes the screens use. Never put a price in a component: read it from a book. No imports, so Deno
// and the tests can share it.
//
// P901 (Brayden, Nov 7): version 2 is FINAL — three packages by daily lead spend, servicing only $499, a $299 setup
// fee once, month to month (no minimum term). supabase/migrations/p901_price_book_v2.sql adds it (effective the day
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

// The prices in effect. effective_from is set by the migration (the day it's applied); null here.
export const BOOK = {
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
})

export const PRICES = pricesOf(BOOK)

// "Starter · up to $50 a day", "Growth · $51 to $200 a day", "Pro · over $200 a day".
export const bandText = t => (t.from === 0 ? `up to $${t.to} a day` : t.to == null ? `over $${t.from - 1} a day` : `$${t.from} to $${t.to} a day`)
