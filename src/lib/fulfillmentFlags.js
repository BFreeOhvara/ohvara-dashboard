// One place that decides whether a cancellation needs attention, so the desk,
// the Fulfillment Overview and Pipeline agree (Prompt 663, shared in 681).

const HOUR = 3600e3
export const STALE_WAITING_H = 24   // unclaimed this long → flagged
export const STALE_CLAIMED_H = 48   // claimed but not finished this long → flagged

function hoursSince(iso, now) {
  return iso ? (now - new Date(iso)) / HOUR : 0
}

export function flagsFor(p, now) {
  const done = p.fulfillment_stage === 'Complete'
  const overdue = !done && p.scheduled_call_at && new Date(p.scheduled_call_at) < now
  const staleWaiting = !done && !p.assigned_fulfillment_id && hoursSince(p.created_at, now) > STALE_WAITING_H
  const staleClaimed = !done && p.assigned_fulfillment_id
    && hoursSince(p.fulfillment_claimed_at || p.updated_at, now) > STALE_CLAIMED_H
  return { overdue, stale: staleWaiting || staleClaimed }
}

export function needsAttention(p, now) {
  const f = flagsFor(p, now)
  return !!(f.overdue || f.stale)
}
