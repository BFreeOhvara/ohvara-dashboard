import { useEffect, useState } from 'react'

// Agent portal (Prompt 665) — one place that decides where a booked client
// stands, so Overview, My Clients and Performance can't disagree.
//
// Model (Brayden, 2026-10-01): the dashboard doesn't track an in-force book
// for agents. Every agent row exists to get a client's EXISTING policy
// cancelled — the agent books the call, Fulfillment works it. So a row is one
// of: booked (waiting for Fulfillment to pick it up), in progress (a
// Fulfillment rep has it), or cancelled (done). Only fulfillment_assigned rows
// are bookings; anything else is pre-pivot data.
//
// Prompt 684 — every booking is auto-assigned to a rep the moment it's made,
// so "has a rep" no longer means "in progress". A row is in progress once
// the rep has actually started it (fulfillment_stage 'In Progress'); until
// then it's still Booked, rep or not.

export const STAGE = {
  // Prompt 669 — Booked was 'accent', which read as the same colour as
  // In progress (both blue) in dark mode and as Cancelled (teal vs green) in
  // light. A neutral chip for "waiting" keeps the three stages distinct.
  // Prompt 686 — Booked is purple now so every status has its own colour
  // (purple / amber / blue / green), matching Restorix's My Pipeline.
  booked:     { label: 'Booked',      tone: 'purple' },
  inProgress: { label: 'In progress', tone: 'info' },
  cancelled:  { label: 'Cancelled',   tone: 'success' },
}

export const SUBSTATUS_LABEL = {
  calling: 'Calling carrier',
  waiting_carrier: 'Waiting on carrier',
  waiting_client: 'Waiting on client',
}

export function stageOf(p) {
  if (p.fulfillment_stage === 'Complete') return 'cancelled'
  if (p.fulfillment_stage === 'In Progress') return 'inProgress'
  return 'booked'
}

// Booked time has passed and the rep hasn't started it yet.
export function isMissed(p, now = Date.now()) {
  return stageOf(p) === 'booked' && !!p.scheduled_call_at && new Date(p.scheduled_call_at).getTime() < now
}

// Prompt 672 — where a client sits right now, with "not started" split out
// of booked so every client lands in exactly one bucket (My Clients' pipeline
// bar and status filter).
export const BUCKETS = ['waiting', 'missed', 'inProgress', 'cancelled']
export const BUCKET = {
  waiting:    { label: 'Booked',        fill: 'var(--purple)',  tone: 'purple' },
  missed:     { label: 'Not started',   fill: 'var(--warning)', tone: 'warning' },
  inProgress: { label: 'In progress',   fill: 'var(--info)',    tone: 'info' },
  cancelled:  { label: 'Cancelled',     fill: 'var(--success)', tone: 'success' },
}

// Pipeline range, by booking date.
export const RANGES = [
  { value: 'week', label: 'This week' },
  { value: 'month', label: 'This month' },
  { value: 'all', label: 'All time' },
]

export function bucketOf(p, now = Date.now()) {
  if (isMissed(p, now)) return 'missed'
  const s = stageOf(p)
  return s === 'booked' ? 'waiting' : s
}

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

