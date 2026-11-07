import { useEffect, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { useExit } from './motion'

// P854 — the open day of a week calendar (DayBox.jsx draws it): in the URL as ?day=2026-11-10.
// P848: the week's own isoOf (data useWeek) when given; the sample weeks are in November 2026.
const novIso = d => `2026-11-${String(d).padStart(2, '0')}`

// The open day from the URL. days = the day numbers that can open; esc = whether Esc closes (off while a drawer is up).
export function useOpenDay(days, { esc = true, isoOf = novIso } = {}) {
  const [params, setParams] = useSearchParams()
  const location = useLocation()
  const navigate = useNavigate()
  const want = params.get('day')
  const raw = days.find(d => isoOf(d) === want) ?? null
  const day = days.includes(raw) ? raw : null
  const close = () => {
    // Opened here: step back, so Back after closing doesn't reopen it. Came in on a link: drop the day in place.
    if (location.state?.dayBox) { navigate(-1); return }
    const next = new URLSearchParams(params)
    next.delete('day')
    setParams(next, { replace: true })
  }
  const open = d => {
    if (d === day) { close(); return }
    const next = new URLSearchParams(params)
    next.set('day', isoOf(d))
    // A swap replaces the entry (Back still closes); the first open adds one.
    setParams(next, day == null ? { state: { dayBox: true } } : { replace: true, state: location.state })
  }
  useEffect(() => {
    if (day == null || !esc) return undefined
    const onKey = e => { if (e.key === 'Escape' && !e.defaultPrevented) close() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })
  // Keep ?day= on the drawer links so closing a drawer comes back to the same open day.
  return { day, open, close, search: location.search }
}

// The open day as shown: while the box slides out it keeps the day it had; then null (the week).
export function useStickyDay(day) {
  const [last, setLast] = useState(day)
  if (day != null && day !== last) setLast(day)
  const [shown, leaving] = useExit(day != null, 280)
  return { view: shown ? (day ?? last) : null, leaving }
}

