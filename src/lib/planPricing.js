// Prompt 835 — the new billing model's draft numbers (Brayden, 2026-11-04): agents set a WEEKLY budget with a
// slider and see a RANGE of booked appointments or live calls it buys; policy servicing is billed MONTHLY; one
// one-time setup fee. Every number the plan builder shows lives here, never in a component, so a price change is
// one edit. All drafts. Same math as the approved mockup (claude.ai artifact JDaaXXaKNmhb73FjoetxNu v2).
// No imports: plain numbers and sums, safe to share with the real portal and with Deno later.

export const PLAN = {
  budget: { min: 300, max: 3000, step: 50, start: 1000, ticks: [300, 1000, 2000, 3000] },
  adShare: 0.55, // the part of the weekly budget that buys ads
  weeksPerMonth: 52 / 12,
  cost: { appts: { low: 100, high: 175 }, calls: { low: 60, high: 110 } }, // what one costs in ads, best to worst
  servicingMonthly: 299,
  setupFee: 1997,
}

export const MODES = [
  { key: 'appts', label: 'Booked appointments', unit: 'booked appointments', one: 'booked appointment' },
  { key: 'calls', label: 'Live calls', unit: 'live calls', one: 'live call' },
]
export const modeOf = key => MODES.find(m => m.key === key) || MODES[0]

export const clampBudget = (n, p = PLAN) => {
  const { min, max, step } = p.budget
  const v = Math.round((Number(n) || min) / step) * step
  return Math.min(max, Math.max(min, v))
}

// Low = the budget at the worst cost, high = at the best cost. A week never shows less than 1.
export function planRange(weekly, mode = 'appts', p = PLAN) {
  const c = p.cost[mode] || p.cost.appts
  const weekAds = weekly * p.adShare
  const monthAds = weekAds * p.weeksPerMonth
  const wLo = Math.max(1, Math.floor(weekAds / c.high))
  return {
    month: { low: Math.floor(monthAds / c.high), high: Math.round(monthAds / c.low) },
    week: { low: wLo, high: Math.max(wLo, Math.round(weekAds / c.low)) },
  }
}

export const rangeText = r => `${r.low} to ${r.high}`

// Where a budget sits on the slider, 0 to 1 (for the filled track and the tick marks).
export const budgetShare = (n, p = PLAN) => (n - p.budget.min) / (p.budget.max - p.budget.min)
