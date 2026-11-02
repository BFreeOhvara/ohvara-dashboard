// The chargeback watch, one row per policy for the agent pages (read side only).
// The watch may be stored as 12 monthly rows; the Clients pages draw and time one row, and the kept
// row (the latest due_at, month 12) carries the watch end that watchProgress reads.

const dueMs = t => (t.due_at ? new Date(t.due_at).getTime() : -Infinity)

// The group a watch row belongs to: its policy, else its lead. Never the client, because one client
// can hold several policies and each keeps its own watch.
const watchKey = t => t.policy_id || t.lead_id || null

// Among chargeback_watch rows keep one per policy (else lead): the latest due_at, a null due_at counting
// as earliest. Every other row stays, and the original order is kept.
export function oneWatchPerPolicy(rows) {
  const list = rows || []
  const keep = new Map() // key -> the row to keep
  for (const t of list) {
    if (t.kind !== 'chargeback_watch') continue
    const key = watchKey(t)
    if (key === null) continue
    const cur = keep.get(key)
    if (!cur || dueMs(t) > dueMs(cur)) keep.set(key, t)
  }
  return list.filter(t => {
    if (t.kind !== 'chargeback_watch') return true
    const key = watchKey(t)
    return key === null || keep.get(key) === t
  })
}

// The chargeback watch runs 12 months from when it was seeded; due_at is its end.
// Only one watch row per policy reaches this (oneWatchPerPolicy, applied in useServicingTasks): the month 12 row, so due_at stays the end.
export function watchProgress(task, nowMs = Date.now()) {
  const start = new Date(task.created_at).getTime()
  const end = task.due_at ? new Date(task.due_at).getTime() : start + 365 * 864e5
  const months = 12
  const month = Math.min(months, Math.max(1, Math.ceil(((nowMs - start) / (end - start || 1)) * months)))
  return { month, months, end: task.due_at, done: task.status === 'done' || nowMs >= end }
}
