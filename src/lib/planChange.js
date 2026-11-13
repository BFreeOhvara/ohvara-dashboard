// P921 — Plan changes (Brayden, Nov 9); P990 (Brayden, Nov 13): no day-counting anywhere. No imports, so Deno, the
// screens and the tests share it, and supabase/migrations/273_no_proration.sql does the same sums (src/p921.test.js).
//
//   Moving up (Starter → Growth → Pro): the price difference (new price − old price) is charged today, in full. The
//   billing day stays the same; the next bill is the full new price. The higher band opens once it's paid.
//   Moving down: from the next bill date. No refund; the agent keeps the higher band until then.
//   One change at a time: an upgrade cancels a pending downgrade. Founding agents: their locked prices (the book).
//
// Dates are ISO 'YYYY-MM-DD' (the agent's billing day, Central). Prices are whole cents.

const utc = iso => { const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number); return Date.UTC(y, m - 1, d) }

// The difference in cents (never below 0: moving down is never refunded).
export const diffCents = (fromCents, toCents) => Math.max(0, toCents - fromCents)

// "1st", "2nd", "13th", "31st": the billing day of the month.
export function ordinal(n) {
  const v = n % 100
  const s = v >= 11 && v <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th')
  return `${n}${s}`
}
// The billing day of a bill date: '2026-12-13' → '13th'.
export const billDay = day => ordinal(Number(String(day).slice(8, 10)))

const order = (tiers, key) => tiers.findIndex(t => t.key === key)

// What switching from the plan they're on to `toKey` does. tiers = [{ key, label, monthly_cents }] in band order (the
// agent's own book: founding prices when locked). pending = { key, from } a scheduled downgrade, or null.
export function planChange({ tiers, fromKey, toKey, nextBill, pending = null }) {
  const from = tiers.find(t => t.key === fromKey)
  const to = tiers.find(t => t.key === toKey)
  if (!from || !to) return { direction: 'none' }
  if (from.key === to.key) {
    // Back to the plan they're on: undoes a pending downgrade, nothing charged.
    return { direction: pending ? 'undo' : 'same', from, to, chargeCents: 0, nextBill }
  }
  if (order(tiers, to.key) > order(tiers, from.key)) {
    return { direction: 'up', from, to, chargeCents: diffCents(from.monthly_cents, to.monthly_cents), nextBill, cancelsPending: !!pending }
  }
  return { direction: 'down', from, to, chargeCents: 0, nextBill, effective: nextBill }
}

// Words for the confirm and the charges list.
const dollars = c => `$${(c / 100).toLocaleString('en-US', { minimumFractionDigits: c % 100 ? 2 : 0, maximumFractionDigits: 2 })}`
const cents2 = c => `$${(c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
export const shortDate = day => new Date(utc(day)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })

export function changeWords(c) {
  if (!c || c.direction === 'none' || c.direction === 'same') return null
  const on = shortDate(c.nextBill)
  if (c.direction === 'up') {
    return `Charged today ${cents2(c.chargeCents)}, the difference from ${c.from.label} · then ${dollars(c.to.monthly_cents)} every month on the ${billDay(c.nextBill)}, starting ${on}.`
  }
  if (c.direction === 'down') {
    return `${c.to.label} is ${dollars(c.to.monthly_cents)} a month, from ${on}. No refund for this month: you keep ${c.from.label} and its spend range until then.`
  }
  return `You stay on ${c.to.label}. The change on ${on} is cancelled.`
}

// The upgrade charge's line in the charges list: "Upgrade to Pro, the difference from Growth".
export const upgradeLabel = (toLabel, fromLabel) => `Upgrade to ${toLabel}, the difference from ${fromLabel}`
