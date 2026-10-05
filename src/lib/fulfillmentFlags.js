// One place that decides whether a cancellation needs attention, so the desk,
// the Fulfillment Overview and Pipeline agree (Prompt 663, shared in 681).
//
// Prompt 684 — items are auto-assigned at booking, often for a call days
// out, so "how long since it was assigned" stopped meaning anything.
// Prompt 689 — statuses are Booked / In progress (live) / No answer /
// Cancelled (Rescheduling merged into No answer, 695):
//   * Booked (never called): overdue once its call time passes; stale a day past it.
//   * No answer: waiting on another attempt; stale two days after
//     the last call ended.
//   * Live: a call open for 45+ minutes is probably one nobody ended — flagged so
//     the rep records how it went (otherwise the agent keeps seeing it as live).

const HOUR = 3600e3
export const STALE_WAITING_H = 24   // never called, this long past its call → flagged
export const STALE_RETRY_H = 48     // called but not resolved, this long since → flagged
export const LIVE_STALE_MIN = 45    // call still marked live this long → flagged
export const SLOT_MS = 30 * 60e3    // Book a call's slot length; the overlap window

function hoursSince(iso, now) {
  return iso ? (now - new Date(iso)) / HOUR : 0
}

export function flagsFor(p, now) {
  const done = p.fulfillment_stage === 'Complete'
  const live = !done && !!p.call_live_since
  const retry = !done && !live && !!p.last_call_outcome
  const booked = !done && !live && !retry
  const overdue = booked && !!p.scheduled_call_at && new Date(p.scheduled_call_at) < now
  const staleBooked = booked && hoursSince(p.scheduled_call_at || p.created_at, now) > STALE_WAITING_H
  const staleRetry = retry && hoursSince(p.last_call_at || p.fulfillment_started_at || p.updated_at, now) > STALE_RETRY_H
  const liveStale = live && (now - new Date(p.call_live_since)) / 60e3 > LIVE_STALE_MIN
  return { overdue, stale: staleBooked || staleRetry, liveStale }
}

export function needsAttention(p, now) {
  const f = flagsFor(p, now)
  return !!(f.overdue || f.stale || f.liveStale)
}

// Open items on the same rep's desk whose calls are within one slot of this
// one. Assignment avoids this whenever any rep is free; it only happens when
// every rep already had a call then, so the desk shows it rather than hiding it.
export function overlapsFor(p, rows) {
  if (!p.scheduled_call_at || !p.assigned_fulfillment_id || p.fulfillment_stage === 'Complete') return []
  const t = new Date(p.scheduled_call_at).getTime()
  return rows.filter(o => o.id !== p.id
    && o.assigned_fulfillment_id === p.assigned_fulfillment_id
    && o.fulfillment_stage !== 'Complete'
    && o.scheduled_call_at
    && Math.abs(new Date(o.scheduled_call_at).getTime() - t) < SLOT_MS)
}
