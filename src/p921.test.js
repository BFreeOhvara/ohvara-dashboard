// P921 — plan changes are paid fairly: moving up charges the prorated difference now, moving down waits for the next
// bill. The sums (src/lib/planChange.js) for mid-month, the first and last day, 28/30/31-day months and founding
// prices; the database does the same sums (supabase/tests/p921_plan_change.sql checks them there).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { billMonth, monthBefore, prorateCents, planChange, changeWords, upgradeLabel, daysBetween } from './lib/planChange.js'
import { BOOK, BOOK_V1, tiersOf } from './lib/priceBook.js'

const read = p => readFileSync(new URL(p, import.meta.url), 'utf8')
const cents = book => tiersOf(book).map(t => ({ ...t, monthly_cents: Math.round(t.monthly * 100) }))
const V3 = cents(BOOK)
const up = (today, nextBill, from = 'growth', to = 'pro', tiers = V3, monthStart) =>
  planChange({ tiers, fromKey: from, toKey: to, today, nextBill, monthStart })

test('the billing month: days in it and days left (today counts)', () => {
  assert.deepEqual(billMonth('2026-11-16', '2026-12-01'), { start: '2026-11-01', days: 30, left: 15 })
  assert.deepEqual(billMonth('2026-11-01', '2026-12-01'), { start: '2026-11-01', days: 30, left: 30 }, 'first day: every day left')
  assert.deepEqual(billMonth('2026-11-30', '2026-12-01'), { start: '2026-11-01', days: 30, left: 1 }, 'last day: one day left')
  assert.equal(billMonth('2027-02-10', '2027-03-01').days, 28)
  assert.equal(billMonth('2028-02-10', '2028-03-01').days, 29, 'leap year')
  assert.equal(billMonth('2026-12-16', '2027-01-01').days, 31)
  assert.equal(monthBefore('2027-03-31'), '2027-02-28', 'the 31st clamps like Postgres')
  assert.equal(daysBetween('2026-12-31', '2027-01-01'), 1)
})

test('moving up: (new − old) × days left ÷ days in the month, to the cent', () => {
  const c = up('2026-11-16', '2026-12-01')
  assert.equal(c.direction, 'up')
  assert.equal(c.chargeCents, 75000, 'Growth → Pro, 15 of 30 days: $750.00 (the spec example)')
  assert.equal(changeWords(c), 'Pro is $2,999 a month. You pay $750.00 now for the 15 days left this month, then $2,999 on Dec 1.')
  assert.equal(up('2026-11-01', '2026-12-01').chargeCents, 150000, 'first day: the whole difference')
  assert.equal(up('2026-11-30', '2026-12-01').chargeCents, 5000, 'last day: one day of 30')
  assert.equal(up('2027-02-15', '2027-03-01').chargeCents, Math.round(150000 * 14 / 28), '28-day month')
  assert.equal(up('2026-12-16', '2027-01-01').chargeCents, 77419, '31-day month: 150000 × 16 ÷ 31 = 77419.35')
  assert.equal(up('2026-11-16', '2026-12-01', 'starter', 'pro').chargeCents, 115000, 'Starter → Pro skips a plan: 230000 × 15 ÷ 30')
  assert.equal(up('2026-11-16', '2026-12-01', 'starter', 'growth').chargeCents, 40000)
  assert.equal(prorateCents(69900, 149900, 1, 31), 2581, '80000 ÷ 31 = 2580.6 rounds up')
  assert.equal(upgradeLabel('Pro', 15), 'Upgrade to Pro, 15 days')
  assert.equal(upgradeLabel('Pro', 1), 'Upgrade to Pro, 1 day')
})

test('a second upgrade the same month charges only the new difference', () => {
  const first = up('2026-11-10', '2026-12-01', 'starter', 'growth')
  const second = up('2026-11-20', '2026-12-01', 'growth', 'pro')
  assert.equal(first.chargeCents, Math.round(80000 * 21 / 30))
  assert.equal(second.chargeCents, Math.round(150000 * 11 / 30))
  assert.ok(first.chargeCents + second.chargeCents < up('2026-11-10', '2026-12-01', 'starter', 'pro').chargeCents, 'never more than going straight to Pro on the first day')
})

test('founding prices: proration uses the agent’s locked book', () => {
  const v1 = cents(BOOK_V1)
  assert.equal(up('2026-12-16', '2027-01-01', 'starter', 'growth', v1).chargeCents, 41290, '(1,797 − 997) × 16 ÷ 31, the SQL test’s e4')
  assert.equal(up('2026-11-16', '2026-12-01', 'growth', 'pro', v1).chargeCents, 85000, 'v1 Growth → Pro: (3,497 − 1,797) × 15 ÷ 30, not v3 75000')
})

test('moving down: from the next bill, nothing charged; same plan with one pending is Undo', () => {
  const d = up('2026-11-16', '2026-12-01', 'pro', 'starter')
  assert.equal(d.direction, 'down')
  assert.equal(d.chargeCents, 0)
  assert.equal(d.effective, '2026-12-01')
  assert.match(changeWords(d), /^Starter is \$699 a month, from Dec 1\. No refund for this month: you keep Pro and its spend range until then\.$/)
  const u = planChange({ tiers: V3, fromKey: 'pro', toKey: 'pro', today: '2026-11-16', nextBill: '2026-12-01', pending: { key: 'starter' } })
  assert.equal(u.direction, 'undo')
  assert.equal(planChange({ tiers: V3, fromKey: 'pro', toKey: 'pro', today: '2026-11-16', nextBill: '2026-12-01' }).direction, 'same')
  const over = planChange({ tiers: V3, fromKey: 'growth', toKey: 'pro', today: '2026-11-16', nextBill: '2026-12-01', pending: { key: 'starter' } })
  assert.equal(over.chargeCents, 75000, 'an upgrade with a downgrade pending: from the plan they are on now')
  assert.equal(over.cancelsPending, true)
})

test('the database does the same sums, and the band is closed until the upgrade is paid', () => {
  const sql = read('../supabase/migrations/p921_plan_change.sql')
  assert.match(sql, /round\(\(\(t->>'monthly_cents'\)::int - \(cur->>'monthly_cents'\)::int\)::numeric \* \(m->>'left'\)::int \/ \(m->>'days'\)::int\)/)
  assert.match(sql, /if c\.kind <> 'plan_upgrade' then return lead_spend_charge_result_p910/)
  assert.match(sql, /perform billing_plan_apply\(c\.agent_id, c\.tier_to, c\.plan_daily_cents/)
  assert.match(sql, /hint = 'over_plan'/)
  assert.match(sql, /status = 'failed' and kind <> 'plan_upgrade'/, 'Fix card never retries an upgrade')
})

test('Billing: the confirm, the pending move down with Undo, the declined upgrade, the label in Charges', () => {
  const b = read('./template/screens/Billing.jsx')
  assert.match(b, /changeWords\(c\)/)
  assert.match(b, /Pay \$\{money00\(c\.chargeCents \/ 100\)\} and switch/)
  assert.match(b, /Changes to \{pendingTo\.label\} on \{b\.planNext\.on\}/)
  assert.match(b, /onClick=\{undo\}>Undo<\/button>/)
  assert.match(b, /Your upgrade to \{b\.upgradeFailed\.to\} didn/)
  assert.match(b, /const tierNow = planOf\(b\)/)
  const data = read('./template/data/index.js')
  assert.match(data, /label: upgradeLabel\(c\.to\.label, c\.left\)/)
  assert.match(data, /param\('upgrade'\) === 'declined'/)
  const admin = read('./adminshell/screens/Agents.jsx')
  assert.match(admin, /Moves down to \{PLANS\[a\.planNext\.key\]\.label\} on \{a\.planNext\.on\}/)
})
