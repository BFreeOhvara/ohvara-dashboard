// P884 — the one price source. Every price lives in the database as versioned data (billing_price_book in
// supabase/migrations/p884_billing_engine.sql; price_book() returns the version in effect). This file is the SAME
// version 1 for sample mode and the tests (src/p884.test.js checks it matches the migration's seed), and turns any
// book into the shapes the screens use. Every price is a DRAFT until Brayden marks a version final after the pilot.
// Never put a price in a component: read it from a book. No imports, so Deno and the tests can share it.

export const DRAFT_BOOK = {
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

const dollars = c => (c == null ? null : c / 100)

// The screens' tier shape (whole dollars a day, monthly price in dollars).
export const tiersOf = (book = DRAFT_BOOK) =>
  book.tiers.map(t => ({ key: t.key, label: t.label, from: t.from, to: t.to, monthly: dollars(t.monthly_cents) }))

export const pricesOf = (book = DRAFT_BOOK) => ({
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

export const DRAFT = pricesOf(DRAFT_BOOK)
