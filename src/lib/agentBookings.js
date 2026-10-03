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
//   No answer     the last call didn't connect — needs another attempt
//   Rescheduling  spoke to them, couldn't cancel this time — needs another call
// No answer and Rescheduling stay their own status until the next call starts
// (then In progress again), so the fact an attempt was made is never lost.

export const STAGE = {
  // Prompt 686 — every status has its own colour (purple / blue / green /
  // amber / pink), matching Restorix's My Pipeline.
  booked:       { label: 'Booked',       tone: 'purple',  fill: 'var(--purple)' },
  inProgress:   { label: 'In progress',  tone: 'info',    fill: 'var(--info)' },
  noAnswer:     { label: 'No answer',    tone: 'warning', fill: 'var(--warning)' },
  rescheduling: { label: 'Rescheduling', tone: 'pink',    fill: 'var(--pink)' },
  cancelled:    { label: 'Cancelled',    tone: 'success', fill: 'var(--success)' },
}

// Why a call ended as Rescheduling (optional, rep-set).
export const SUBSTATUS_LABEL = {
  waiting_carrier: 'Waiting on carrier',
  waiting_client: 'Waiting on client',
}

export const isLive = p => !!p.call_live_since && p.fulfillment_stage !== 'Complete'

export function stageOf(p) {
  if (p.fulfillment_stage === 'Complete') return 'cancelled'
  if (isLive(p)) return 'inProgress'
  if (p.last_call_outcome === 'no_answer') return 'noAnswer'
  if (p.last_call_outcome === 'rescheduling') return 'rescheduling'
  return 'booked'
}

// A call has been placed at least once and nothing's live or resolved: it's
// waiting on the next attempt.
export const needsAnotherCall = p => {
  const s = stageOf(p)
  return s === 'noAnswer' || s === 'rescheduling'
}

// Pipeline buckets are the statuses, keyed the same as STAGE (and as the
// ?stage= URL param).
export const BUCKETS = ['booked', 'inProgress', 'noAnswer', 'rescheduling', 'cancelled']
export const BUCKET = STAGE

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
  pink:    { color: 'var(--pink)',    dim: 'var(--pink-dim)',    bd: 'var(--pink-bd)' },
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

