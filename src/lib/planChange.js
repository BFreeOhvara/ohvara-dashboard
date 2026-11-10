// P921 — Plan changes are paid fairly (Brayden, Nov 9). No imports, so Deno, the screens and the tests share it, and
// supabase/migrations/p921_plan_change.sql does the same sums (src/p921.test.js checks them against each other).
//
//   Moving up (Starter → Growth → Pro): the prorated difference is charged now for the days left in this billing
//   month: (new price − old price) × days left ÷ days in the month, rounded to the cent. The higher band opens only
//   after that charge goes through. The bill date doesn't change; the next bill is the full new price.
//   Moving down: from the next bill date. No refund; the agent keeps the higher band until then.
//   One change at a time: an upgrade cancels a pending downgrade; a second upgrade in the same month charges only the
//   new difference (old price = the plan they're on now). Founding agents: their locked prices (the book passed in).
//
// Dates are ISO 'YYYY-MM-DD' (the agent's billing day, Central). Prices are whole cents.

const MS_DAY = 86400000
const utc = iso => { const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number); return Date.UTC(y, m - 1, d) }
const iso = t => new Date(t).toISOString().slice(0, 10)
export const daysBetween = (a, b) => Math.round((utc(b) - utc(a)) / MS_DAY)

// One month earlier, the day clamped to the month's last day (Mar 31 → Feb 28), as Postgres does `date - interval '1 month'`.
export function monthBefore(day) {
  const [y, m, d] = String(day).slice(0, 10).split('-').map(Number)
  const py = m === 1 ? y - 1 : y
  const pm = m === 1 ? 12 : m - 1
  const last = new Date(Date.UTC(py, pm, 0)).getUTCDate()
  return iso(Date.UTC(py, pm - 1, Math.min(d, last)))
}

// The billing month that ends on nextBill: its first day, how many days it has, how many are left from today
// (today counts: on the first day every day is left, on the last day one is).
// start: the bill before (the database knows it: a bill on the 31st follows one on the 30th); default one month back.
export function billMonth(today, nextBill, start = monthBefore(nextBill)) {
  const days = daysBetween(start, nextBill)
  const left = Math.max(0, Math.min(days, daysBetween(today, nextBill)))
  return { start, days, left }
}

// The prorated difference in cents (never below 0: moving down is never refunded).
export function prorateCents(fromCents, toCents, left, days) {
  if (!days || toCents <= fromCents) return 0
  return Math.round(((toCents - fromCents) * left) / days)
}

const order = (tiers, key) => tiers.findIndex(t => t.key === key)

// What switching from the plan they're on to `toKey` does. tiers = [{ key, label, monthly_cents }] in band order (the
// agent's own book: founding prices when locked). pending = { key, from } a scheduled downgrade, or null.
export function planChange({ tiers, fromKey, toKey, today, nextBill, monthStart, pending = null }) {
  const from = tiers.find(t => t.key === fromKey)
  const to = tiers.find(t => t.key === toKey)
  if (!from || !to) return { direction: 'none' }
  const m = billMonth(today, nextBill, monthStart)
  if (from.key === to.key) {
    // Back to the plan they're on: undoes a pending downgrade, nothing charged.
    return { direction: pending ? 'undo' : 'same', from, to, chargeCents: 0, ...m, nextBill }
  }
  if (order(tiers, to.key) > order(tiers, from.key)) {
    return { direction: 'up', from, to, chargeCents: prorateCents(from.monthly_cents, to.monthly_cents, m.left, m.days), ...m, nextBill, cancelsPending: !!pending }
  }
  return { direction: 'down', from, to, chargeCents: 0, ...m, nextBill, effective: nextBill }
}

// Words for the confirm and the charges list.
const dollars = c => `$${(c / 100).toLocaleString('en-US', { minimumFractionDigits: c % 100 ? 2 : 0, maximumFractionDigits: 2 })}`
const cents2 = c => `$${(c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
export const shortDate = day => new Date(utc(day)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
const dayWord = n => `${n} day${n === 1 ? '' : 's'}`

export function changeWords(c) {
  if (!c || c.direction === 'none' || c.direction === 'same') return null
  const on = shortDate(c.nextBill)
  if (c.direction === 'up') {
    return `${c.to.label} is ${dollars(c.to.monthly_cents)} a month. You pay ${cents2(c.chargeCents)} now for the ${dayWord(c.left)} left this month, then ${dollars(c.to.monthly_cents)} on ${on}.`
  }
  if (c.direction === 'down') {
    return `${c.to.label} is ${dollars(c.to.monthly_cents)} a month, from ${on}. No refund for this month: you keep ${c.from.label} and its spend range until then.`
  }
  return `You stay on ${c.to.label}. The change on ${on} is cancelled.`
}

// The proration charge's line in the charges list: "Upgrade to Pro, 15 days".
export const upgradeLabel = (toLabel, left) => `Upgrade to ${toLabel}, ${dayWord(left)}`
