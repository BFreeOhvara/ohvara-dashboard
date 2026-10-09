import { useEffect, useState } from 'react'
import { fullName } from './policyFormat'

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

// Prompt 717 — My Pipeline's four tabs. Needs attention holds the two statuses only
// the agent can move on (Confirm number, Needs attention); the rest are
// agentStageOf as is.
export const PIPELINE_TABS = ['booked', 'noAnswer', 'needs', 'cancelled']
export function tabOf(p) {
  const s = agentStageOf(p)
  return s === 'confirmNumber' || s === 'needsAttention' ? 'needs' : s
}

// Re-book is the agent's move only when nobody else owns the lead: Needs
// attention (call, then rebook), or a No answer that isn't in Prompt 696's
// automated flow (texting off / flow not started) — otherwise it would be a
// dead end. Inside the flow the system owns it. (Moved here from Clients.jsx
// by Prompt 714 so the Overview's attention rows use the same rule.)
export const canRebook = p => {
  const s = agentStageOf(p)
  return s === 'needsAttention' || (s === 'noAnswer' && !p.recovery_step)
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

// Client search (Prompt 717, shared with the header search by Prompt 722):
// name, carrier, city (Prompt 726) and agent name contain the query, or 3+ typed digits appear in
// the phone number. Sorted by name, numeric-aware.
export function matchClients(rows, query) {
  const q = String(query || '').trim().toLowerCase()
  if (!q) return []
  const qd = digits(q)
  return (rows || [])
    .filter(p => {
      const hay = [p.client_first_name, p.client_last_name, p.current_carrier, p.client_city, p.agent?.full_name].filter(Boolean).join(' ').toLowerCase()
      return hay.includes(q) || (qd.length >= 3 && digits(p.client_phone).includes(qd))
    })
    .sort((a, b) => fullName(a).localeCompare(fullName(b), undefined, { numeric: true }))
}

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


// Prompt 724 — "Pensacola, FL", or '' for rows booked before city/state.
export const placeOf = p => [p?.client_city, p?.state].filter(Boolean).join(', ')
