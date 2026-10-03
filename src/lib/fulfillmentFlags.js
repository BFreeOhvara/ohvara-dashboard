// One place that decides whether a cancellation needs attention, so the desk,
// the Fulfillment Overview and Pipeline agree (Prompt 663, shared in 681).
//
// Prompt 684 — items are auto-assigned at booking, often for a call days
// out, so "how long since it was assigned" stopped meaning anything. Not
// started: stale a day past its call time (or a day after booking if it has
// no time). Started: stale two days after the rep started it.

const HOUR = 3600e3
export const STALE_WAITING_H = 24   // not started, this long past its call → flagged
export const STALE_CLAIMED_H = 48   // started but not finished this long → flagged
export const SLOT_MS = 30 * 60e3    // Book a call's slot length; the overlap window

function hoursSince(iso, now) {
  return iso ? (now - new Date(iso)) / HOUR : 0
}

export function flagsFor(p, now) {
  const done = p.fulfillment_stage === 'Complete'
  const started = p.fulfillment_stage === 'In Progress'
  const overdue = !done && !started && !!p.scheduled_call_at && new Date(p.scheduled_call_at) < now
  const staleWaiting = !done && !started && hoursSince(p.scheduled_call_at || p.created_at, now) > STALE_WAITING_H
  const staleStarted = started
    && hoursSince(p.fulfillment_started_at || p.fulfillment_claimed_at || p.updated_at, now) > STALE_CLAIMED_H
  return { overdue, stale: staleWaiting || staleStarted }
}

export function needsAttention(p, now) {
  const f = flagsFor(p, now)
  return !!(f.overdue || f.stale)
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
