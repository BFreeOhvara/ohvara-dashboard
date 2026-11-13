// P921 — plan changes; P990 (Brayden, Nov 13): no day-counting. Moving up charges the full price difference today and
// keeps the billing day; moving down waits for the next bill. The sums (src/lib/planChange.js) and founding prices; the
// database does the same sums (supabase/migrations/273_no_proration.sql).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { diffCents, planChange, changeWords, upgradeLabel, ordinal, billDay } from './lib/planChange.js'
import { BOOK, BOOK_V1, tiersOf } from './lib/priceBook.js'

const read = p => readFileSync(new URL(p, import.meta.url), 'utf8')
const cents = book => tiersOf(book).map(t => ({ ...t, monthly_cents: Math.round(t.monthly * 100) }))
const V3 = cents(BOOK)
const up = (nextBill, from = 'growth', to = 'pro', tiers = V3) => planChange({ tiers, fromKey: from, toKey: to, nextBill })

test('P990: the billing day in words', () => {
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 31].map(ordinal), ['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '23rd', '31st'])
  assert.equal(billDay('2026-12-13'), '13th')
  assert.equal(billDay('2027-02-28'), '28th')
})

test('P990: moving up charges the whole price difference, whatever the day, and keeps the billing day', () => {
  const c = up('2026-12-01')
  assert.equal(c.direction, 'up')
  assert.equal(c.chargeCents, 150000, 'Growth → Pro: $2,999 − $1,499')
  assert.equal(up('2026-11-17').chargeCents, 150000, 'no days: same on any day of the month')
  assert.equal(c.nextBill, '2026-12-01')
  assert.equal(changeWords(c), 'Charged today $1,500.00, the difference from Growth · then $2,999 every month on the 1st, starting Dec 1.')
  assert.equal(up('2026-12-01', 'starter', 'pro').chargeCents, 230000, 'Starter → Pro skips a plan')
  assert.equal(up('2026-12-01', 'starter', 'growth').chargeCents, 80000)
  assert.equal(diffCents(149900, 69900), 0, 'never below 0')
  assert.equal(upgradeLabel('Pro', 'Growth'), 'Upgrade to Pro, the difference from Growth')
  assert.equal('left' in c || 'days' in c, false, 'no day-counting in the result')
})

test('founding prices: the difference uses the agent’s locked book', () => {
  const v1 = cents(BOOK_V1)
  assert.equal(up('2027-01-01', 'starter', 'growth', v1).chargeCents, 80000, '1,797 − 997')
  assert.equal(up('2026-12-01', 'growth', 'pro', v1).chargeCents, 170000, 'v1 Growth → Pro: 3,497 − 1,797, not v3 150000')
})

test('moving down: from the next bill, nothing charged; same plan with one pending is Undo', () => {
  const d = up('2026-12-01', 'pro', 'starter')
  assert.equal(d.direction, 'down')
  assert.equal(d.chargeCents, 0)
  assert.equal(d.effective, '2026-12-01')
  assert.match(changeWords(d), /^Starter is \$699 a month, from Dec 1\. No refund for this month: you keep Pro and its spend range until then\.$/)
  const u = planChange({ tiers: V3, fromKey: 'pro', toKey: 'pro', today: '2026-11-16', nextBill: '2026-12-01', pending: { key: 'starter' } })
  assert.equal(u.direction, 'undo')
  assert.equal(planChange({ tiers: V3, fromKey: 'pro', toKey: 'pro', today: '2026-11-16', nextBill: '2026-12-01' }).direction, 'same')
  const over = planChange({ tiers: V3, fromKey: 'growth', toKey: 'pro', today: '2026-11-16', nextBill: '2026-12-01', pending: { key: 'starter' } })
  assert.equal(over.chargeCents, 150000, 'an upgrade with a downgrade pending: from the plan they are on now')
  assert.equal(over.cancelsPending, true)
})

test('the database does the same sums (273), and the band is closed until the upgrade is paid', () => {
  const sql = read('../supabase/migrations/257_plan_change.sql')
  const n = read('../supabase/migrations/273_no_proration.sql')
  assert.match(n, /amt := greatest\(0, \(t->>'monthly_cents'\)::int - \(cur->>'monthly_cents'\)::int\)/, 'P990: the difference, no days')
  assert.doesNotMatch(n.replace(/^--.*$/gm, ''), /m->>'left'|left_days|\* \(bm->>'left'\)/, 'P990: nothing counts days')
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
  assert.match(data, /label: upgradeLabel\(c\.to\.label, c\.from\.label\)/)
  assert.match(data, /param\('upgrade'\) === 'declined'/)
  const admin = read('./adminshell/screens/Agents.jsx')
  assert.match(admin, /Moves down to \{PLANS\[a\.planNext\.key\]\.label\} on \{a\.planNext\.on\}/)
})
