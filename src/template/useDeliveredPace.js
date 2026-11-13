import { useSampleOverview, useSampleBilling } from './data'
import { deliveredRange, deliveredOf } from './spendPlan'
import { paceOf, lastWeekWords } from './weekPace'

// P991 — the one read of "Delivered this week" for every screen that shows it (desktop Overview, phone Overview and
// Home): the count, the full-week range, the pace against how much of the week has passed, and last week by this time.
export function useDeliveredPace() {
  const { data: o } = useSampleOverview()
  const { data: bill } = useSampleBilling()
  const wk = deliveredRange(bill.expected)
  const dl = deliveredOf({ booked: bill.booked, live: bill.live || 0 })
  const chart = o.bookedChart
  const pace = paceOf({ total: dl.total, range: wk, share: chart.share ?? 1 })
  return { dl, wk, pace, chart, last: lastWeekWords(chart.prevSoFar, chart.prev, pace.closed) }
}
