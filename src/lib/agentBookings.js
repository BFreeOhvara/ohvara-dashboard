import { useEffect, useState } from 'react'

// Agent portal (Prompt 665) — one place that decides where a booked client
// stands, so Overview, My Clients and Performance can't disagree.
//
// Model (Brayden, 2026-10-01): the dashboard doesn't track an in-force book
// for agents. Every agent row exists to get a client's EXISTING policy
// cancelled — the agent books the call, Fulfillment works it. Only
// fulfillment_assigned rows are bookings; anything else is pre-pivot data.
//
// Prompt 689 — final status set. Every booking is auto-assigned (Prompt 684),
// so there is no "untouched" bucket distinct from Booked:
//   Booked        no call has been placed yet
//   In progress   a call is happening RIGHT NOW (call_live_since is set)
//   Cancelled     the old policy is confirmed cancelled
//   No answer     the last call didn't resolve — it never connected, or it
//                 connected without the carrier confirming — needs another try
// Prompt 695 — "Rescheduling" is gone: both failure outcomes are No answer, and
// the agent gets the lead back to Booked by re-booking it (agent_rebook_call).
// No answer stays its own status until the next call starts (then In progress
// again), so the fact an attempt was made is never lost.

export const STAGE = {
  // Prompt 686 — every status has its own colour. Prompt 695 recoloured:
  // No answer gray, Booked blue, In progress yellow, Cancelled green.
  booked:       { label: 'Booked',       tone: 'info',    fill: 'var(--info)' },
  inProgress:   { label: 'In progress',  tone: 'warning', fill: 'var(--warning)' },
  noAnswer:     { label: 'No answer',    tone: 'muted',   fill: 'var(--text-muted)' },
  cancelled:    { label: 'Cancelled',    tone: 'success', fill: 'var(--success)' },
  // Prompt 702 — agent-only statuses (see agentStageOf).
  confirmNumber:  { label: 'Confirm number',  tone: 'teal',    fill: 'var(--teal)' },
  needsAttention: { label: 'Needs attention', tone: 'warning', fill: 'var(--warning)' },
}

// Optional reason on a No answer the rep reached the client on (rep-set).
export const SUBSTATUS_LABEL = {
  waiting_carrier: 'Waiting on carrier',
  waiting_client: 'Waiting on client',
}

export const isLive = p => !!p.call_live_since && p.fulfillment_stage !== 'Complete'

export function stageOf(p) {
  if (p.fulfillment_stage === 'Complete') return 'cancelled'
  if (isLive(p)) return 'inProgress'
  if (p.last_call_outcome === 'no_answer') return 'noAnswer'
  return 'booked'
}

// Prompt 696 — where a No answer lead sits in the text-and-retry flow
// (migration 122), as a short phrase for the badge. Null when no flow is
// running (opt-in off, or it hasn't started).
export function recoveryLabel(p, now = Date.now()) {
  if (stageOf(p) !== 'noAnswer' || !p.recovery_step) return null
  switch (p.recovery_step) {
    case 'retry_locked': {
      if (!p.recovery_retry_at) return 'retry locked'
      const at = new Date(p.recovery_retry_at)
      if (sameLocalDay(at, new Date(now))) return 'retry today'
      if (sameLocalDay(at, new Date(now + 24 * 3600e3))) return 'retry tomorrow'
      return `retry ${at.toLocaleDateString('en-US', { weekday: 'short' })}`
    }
    case 'number_check': return 'needs number check'
    case 'followup':
      return p.recovery_pm_sent_at ? 'follow-up (PM sent)'
        : p.recovery_am_sent_at ? 'follow-up (AM sent)'
          : 'follow-up scheduled'
    case 'call_directly': return 'agent to call directly'
    default: return null
  }
}

// A call has been placed at least once and nothing's live or resolved: it's
// waiting on the next attempt.
export const needsAnotherCall = p => {
  return stageOf(p) === 'noAnswer'
}

// Prompt 702 — the agent's My Pipeline view of the same leads. "In progress" is
// not a status here: a live call is a pulse on a Booked row (isLive), and the
// No answer lead splits by where Prompt 696's recovery has got to — still
// automated (No answer), one-tap number check (Confirm number), or handed to
// the agent to phone (Needs attention). Fulfillment's views keep stageOf.
// The call-end resolution is column-driven (call_live_since / last_call_outcome
// / recovery_step), never keyed off a status value, so none of this touches it.
export function agentStageOf(p) {
  const s = stageOf(p)
  if (s === 'inProgress') return 'booked'
  if (s === 'noAnswer') {
    if (p.recovery_step === 'number_check') return 'confirmNumber'
    if (p.recovery_step === 'call_directly') return 'needsAttention'
  }
  return s
}

// Pipeline buckets are the statuses, keyed the same as STAGE (and as the
// ?stage= URL param).
export const BUCKETS = ['booked', 'inProgress', 'noAnswer', 'cancelled']
export const BUCKET = STAGE
export const AGENT_BUCKETS = ['booked', 'noAnswer', 'confirmNumber', 'needsAttention', 'cancelled']

// Pipeline range, by booking date.
export const RANGES = [
  { value: 'week', label: 'This week' },
  { value: 'month', label: 'This month' },
  { value: 'all', label: 'All time' },
]

export const bucketOf = p => stageOf(p)

export function isBooking(p) {
  return !!p.fulfillment_assigned
}

export const digits = s => String(s || '').replace(/\D/g, '')

// Monday 00:00 local of the week containing `d`.
export function startOfWeek(d = new Date()) {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  const dow = (x.getDay() + 6) % 7
  x.setDate(x.getDate() - dow)
  return x
}

export function startOfMonth(d = new Date()) {
  return new Date(d.getFullYear(), d.getMonth(), 1)
}

export function sameLocalDay(iso, d = new Date()) {
  return !!iso && new Date(iso).toDateString() === d.toDateString()
}

export function hoursBetween(a, b) {
  return (new Date(b) - new Date(a)) / 3600e3
}

export function median(xs) {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

export function fmtDuration(hours) {
  if (hours == null || !isFinite(hours)) return '—'
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))}m`
  if (hours < 48) return `${Math.round(hours)}h`
  return `${(hours / 24).toFixed(1)}d`
}

export const TONE = {
  neutral: { color: 'var(--text-secondary)', dim: 'var(--bg-elevated)', bd: 'var(--border)' },
  muted:   { color: 'var(--text-secondary)', dim: 'var(--bg-muted)',    bd: 'var(--border-strong)' },
  purple:  { color: 'var(--purple)',  dim: 'var(--purple-dim)',  bd: 'var(--purple-bd)' },
  teal:    { color: 'var(--teal)',    dim: 'var(--teal-dim)',    bd: 'var(--teal-bd)' },
  pink:   { color: 'var(--pink)',    dim: 'var(--pink-dim)',    bd: 'var(--pink-bd)' },
  accent:  { color: 'var(--accent)',  dim: 'var(--accent-dim)',  bd: 'var(--accent-border)' },
  info:    { color: 'var(--info)',    dim: 'var(--info-dim)',    bd: 'var(--info-bd)' },
  warning: { color: 'var(--warning)', dim: 'var(--warning-dim)', bd: 'var(--warning-bd)' },
  danger:  { color: 'var(--danger)',  dim: 'var(--danger-dim)',  bd: 'var(--danger-bd)' },
  success: { color: 'var(--success)', dim: 'var(--success-dim)', bd: 'var(--success-bd)' },
}

export function useNow(intervalMs = 60e3) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(t)
  }, [intervalMs])
  return now
}

