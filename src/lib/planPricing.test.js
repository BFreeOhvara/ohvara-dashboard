import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PLAN, planRange, clampBudget, budgetShare, modeOf } from './planPricing.js'

// The mockup's own sum, copied as-is, so the portal can never drift from what Brayden approved.
function mockup(s, mode) {
  const AD_SHARE = 0.55, WEEKS = 52 / 12
  const COST = { appts: { low: 100, high: 175 }, calls: { low: 60, high: 110 } }
  const monthAds = s * AD_SHARE * WEEKS, weekAds = s * AD_SHARE, c = COST[mode]
  const wLo = Math.max(1, Math.floor(weekAds / c.high))
  return { month: { low: Math.floor(monthAds / c.high), high: Math.round(monthAds / c.low) }, week: { low: wLo, high: Math.max(wLo, Math.round(weekAds / c.low)) } }
}

test('ranges match the mockup at $300, $1,000 and $3,000', () => {
  const want = {
    appts: { 300: [4, 7, 1, 2], 1000: [13, 24, 3, 6], 3000: [40, 72, 9, 17] },
    calls: { 300: [6, 12, 1, 3], 1000: [21, 40, 5, 9], 3000: [65, 119, 15, 28] },
  }
  for (const mode of ['appts', 'calls']) {
    for (const s of [300, 1000, 3000]) {
      const r = planRange(s, mode)
      assert.deepEqual(r, mockup(s, mode), `${mode} $${s}`)
      assert.deepEqual([r.month.low, r.month.high, r.week.low, r.week.high], want[mode][s], `${mode} $${s}`)
    }
  }
})

test('every slider stop matches the mockup', () => {
  for (let s = PLAN.budget.min; s <= PLAN.budget.max; s += PLAN.budget.step) {
    for (const mode of ['appts', 'calls']) assert.deepEqual(planRange(s, mode), mockup(s, mode))
  }
})

test('draft prices and slider stops', () => {
  assert.equal(PLAN.servicingMonthly, 299)
  assert.equal(PLAN.setupFee, 1997)
  assert.deepEqual([PLAN.budget.min, PLAN.budget.max, PLAN.budget.step], [300, 3000, 50])
  assert.equal(clampBudget(120), 300)
  assert.equal(clampBudget(9999), 3000)
  assert.equal(clampBudget(1024), 1000)
  assert.equal(budgetShare(300), 0)
  assert.equal(budgetShare(3000), 1)
  assert.equal(modeOf('nope').key, 'appts')
})
