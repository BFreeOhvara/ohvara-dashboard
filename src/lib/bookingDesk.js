// P933 — the Booking desk (Brayden, Nov 9 23:22–23:25: a bare "+12%" on every line "feels scammy"). The percentage
// stays (it's fair, like a tax that scales with spend) and stays an admin setting in the price book (lead_fee_rate);
// the agent side names it "Booking desk" everywhere and explains it once, the same words in the plan picker, at
// checkout and on Billing (the "i" next to the name). Admin Revenue says "Booking desk (12%)". No imports, so the
// tests and Deno can share it.

export const DESK_NAME = 'Booking desk'

// The one explanation (Admin › Settings › Wording to approve lists it). {pct} is the book's rate, so a change in the
// price book changes the words too.
export const DESK_WORDS_TEMPLATE = 'Your ad money goes 100% to your ads. The booking desk is {pct} of it and pays for the AI calling every lead in seconds, the texts, booking, reminders and our team. More spend means more leads to work, so it grows with your spend.'
export const deskWords = rate => DESK_WORDS_TEMPLATE.replace('{pct}', `${Math.round((Number(rate) || 0) * 100)}%`)

// Admin only: "Booking desk (12%)".
export const deskAdminLabel = rate => `${DESK_NAME} (${Math.round((Number(rate) || 0) * 100)}%)`

const whole = n => `$${Math.round(Number(n) || 0).toLocaleString('en-US')}`
const cents2 = n => {
  const v = Math.round((Number(n) || 0) * 100) / 100
  return Number.isInteger(v) ? `$${v.toLocaleString('en-US')}` : `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

// One night's charge in dollars: { total, ads, desk }. Whole cents, like the database (fee = round(spend × rate)).
export function deskSplit(spend, rate) {
  const ads = Math.round((Number(spend) || 0) * 100)
  const desk = Math.round(ads * (Number(rate) || 0))
  return { ads: ads / 100, desk: desk / 100, total: (ads + desk) / 100 }
}

// The small line under a charge: "Tonight $112 · $100 to your ads · $12 booking desk". lead = 'Tonight' | a date.
export function deskBreakdown(lead, spend, desk) {
  const total = (Number(spend) || 0) + (Number(desk) || 0)
  return `${lead ? `${lead} ` : ''}${cents2(total)} · ${cents2(spend)} to your ads${desk ? ` · ${cents2(desk)} booking desk` : ''}`
}
// Just the parts: "$100 to your ads · $12 booking desk".
export const deskParts = (spend, desk) => `${cents2(spend)} to your ads${desk ? ` · ${cents2(desk)} booking desk` : ''}`

// The monthly estimate beside the plan picker and the spend slider (30 days):
// "At $100/day: about $3,000 to your ads + $360 booking desk."
export const MONTH_DAYS = 30
export function monthlyEstimate(daily, rate) {
  const ads = (Number(daily) || 0) * MONTH_DAYS
  const desk = Math.round(ads * (Number(rate) || 0))
  return { ads, desk, text: `At ${whole(daily)}/day: about ${whole(ads)} to your ads + ${whole(desk)} booking desk.` }
}
