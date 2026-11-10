// P913 — days off without approvals (Brayden's walk-through, Nov 8). Each VA gets a set number of days off a month
// (admin setting, Fulfillment › Time off). They book their own days; once they've used them up, they can't book more.
// Pure, so the admin page, the VA side and node --test share one rule. rows: { va_id, date, status } where a
// 'declined' row (from before P913) doesn't count.
// P945 (Brayden, Nov 10): 3 days a month by default; a request is booked at once while days are left, and can't be
// made once they're used ("No days left"). No approval step anywhere.
export const DAYS_OFF_DEFAULT = 3
export const NO_DAYS_LEFT = 'No days left'

const counts = r => r.status !== 'declined'

export const daysUsed = (rows = [], vaId) => rows.filter(r => r.va_id === vaId && counts(r)).length
export const daysLeft = (rows = [], vaId, allowance = DAYS_OFF_DEFAULT) => Math.max(0, allowance - daysUsed(rows, vaId))

// Can this VA book another day off? No if it's used up or the day is already booked.
export function canBookDayOff(rows = [], vaId, date, allowance = DAYS_OFF_DEFAULT) {
  if (rows.some(r => r.va_id === vaId && r.date === date && counts(r))) return { ok: false, why: 'That day is already booked off.' }
  if (daysLeft(rows, vaId, allowance) <= 0) return { ok: false, none: true, why: `${NO_DAYS_LEFT}: you've used all ${allowance} of your days off this month.` }
  return { ok: true, why: '' }
}
