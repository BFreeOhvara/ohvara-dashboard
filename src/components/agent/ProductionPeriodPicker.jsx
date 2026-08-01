import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Segmented } from '../ui/Segmented'

// Unified period control behind Performance → Production (Prompt 348).
//
// Prompt 356: replaced the single "All Time ▾" button + popover/calendar
// (quick pills, a month grid, click-click range selection) with a persistent
// 3-option Daily/Monthly/All Time toggle — same visual pattern as the
// You/Team Segmented already next to it — plus an inline stepper for Daily
// and Monthly. No popover, no click-to-open, no custom range at all
// (Brayden's explicit call). Custom-range mode and the calendar grid are
// gone, not hidden — nothing in this app read `mode === 'range'` outside
// this file.

const pad2 = n => String(n).padStart(2, '0')
const shortLabel = key => {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
const addDays = (key, n) => {
  const d = new Date(`${key}T00:00:00`)
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}
const addMonthsToKey = (mk, n) => {
  const [y, m] = mk.split('-').map(Number)
  const d = new Date(y, m - 1 + n, 1)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`
}

// `defaultMode` (Prompt 402) lets a second caller (Leaderboard) open on
// Monthly instead of Production's own "All Time" default (Brayden's
// explicit call, Prompt 348) — everything else about the stepper is shared,
// not reimplemented.
export function usePeriodPicker(todayStr, defaultMode = 'alltime') {
  const todayMonthKey = todayStr.slice(0, 7)

  const [mode, setModeState] = useState(defaultMode)
  const [day, setDay] = useState(todayStr)
  const [monthKey, setMonthKey] = useState(todayMonthKey)

  // Switching tabs always lands on today/this month rather than remembering
  // wherever the stepper was last left — matches the old quick-pill
  // "Today"/"This Month" reset behavior and avoids surfacing stale state
  // silently (e.g. landing back on Daily 3 days in the past with no cue why).
  function setMode(next) {
    setModeState(next)
    if (next === 'daily') setDay(todayStr)
    else if (next === 'monthly') setMonthKey(todayMonthKey)
  }

  const bounds = useMemo(() => {
    if (mode === 'daily') return { lo: day, hi: day }
    if (mode === 'monthly') {
      const [y, m] = monthKey.split('-').map(Number)
      return { lo: `${monthKey}-01`, hi: `${monthKey}-${pad2(new Date(y, m, 0).getDate())}` }
    }
    return { lo: '0000-01-01', hi: '9999-12-31' }
  }, [mode, day, monthKey])

  const asOf = mode === 'alltime' ? todayStr : bounds.hi

  // Kept meaningful even in All Time mode (not just used by the hidden
  // stepper) — Performance.jsx's tile subtitles read `picker.label` directly.
  const label = useMemo(() => {
    if (mode === 'daily') return day === todayStr ? 'Today' : shortLabel(day)
    if (mode === 'monthly') {
      const [y, m] = monthKey.split('-').map(Number)
      return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    }
    return 'All Time'
  }, [mode, day, monthKey, todayStr])

  const canNext = mode === 'daily' ? day < todayStr : mode === 'monthly' ? monthKey < todayMonthKey : false

  function prevArrow() {
    if (mode === 'daily') setDay(k => addDays(k, -1))
    else if (mode === 'monthly') setMonthKey(k => addMonthsToKey(k, -1))
  }
  function nextArrow() {
    if (!canNext) return
    if (mode === 'daily') setDay(k => addDays(k, 1))
    else if (mode === 'monthly') setMonthKey(k => addMonthsToKey(k, 1))
  }

  return { mode, setMode, bounds, asOf, label, canNext, prevArrow, nextArrow }
}

const arrowBtnStyle = {
  border: 'none', background: 'transparent', padding: 4,
  display: 'inline-flex', color: 'var(--text-secondary)', cursor: 'pointer',
}

// The "‹ Aug 2026 ›" stepper row itself — pulled out of PeriodPicker
// (Prompt 402) so Leaderboard can reuse the exact same nav without also
// inheriting Production's own Daily/Monthly/All Time mode toggle above it.
// `hidden` reserves the row's height via `visibility` rather than removing
// it from the DOM, so a caller that toggles it (Production's All Time mode)
// can't shift whatever sits above/beside it — same fix Prompt 386 made.
export function DateNav({ label, canNext, prevArrow, nextArrow, hidden = false }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center',
      border: 'var(--border-w) solid var(--border)', borderRadius: 6, background: 'var(--bg-elevated)',
      visibility: hidden ? 'hidden' : 'visible',
    }}>
      <button onClick={prevArrow} style={arrowBtnStyle}><ChevronLeft size={14} /></button>
      <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text-primary)', minWidth: 92, textAlign: 'center', whiteSpace: 'nowrap' }}>
        {label}
      </span>
      <button
        onClick={nextArrow}
        disabled={!canNext}
        style={{ ...arrowBtnStyle, color: canNext ? 'var(--text-secondary)' : 'var(--text-muted)', opacity: canNext ? 1 : 0.4, cursor: canNext ? 'pointer' : 'default' }}
      >
        <ChevronRight size={14} />
      </button>
    </div>
  )
}

// Prompt 386: the mode toggle and the date nav used to share one flex row,
// so the date nav's own width (present in Daily/Monthly, gone in All Time)
// changed the row's total width — and since this sits flush-right next to
// the You/Team toggle (Performance.jsx's `justify-content: space-between`
// header), a width change there visibly shifted the toggle buttons
// left/right. Split into two independently-positioned rows: the toggle's
// row never changes size, and the date-nav row below it always renders
// (just visually hidden in All Time) so it keeps its reserved height —
// nothing above it can ever move.
export function PeriodPicker({ mode, setMode, label, canNext, prevArrow, nextArrow }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, marginTop: -4 }}>
      <Segmented
        size="sm"
        value={mode}
        onChange={setMode}
        options={[
          { value: 'daily', label: 'Daily' },
          { value: 'monthly', label: 'Monthly' },
          { value: 'alltime', label: 'All Time' },
        ]}
      />
      <DateNav label={label} canNext={canNext} prevArrow={prevArrow} nextArrow={nextArrow} hidden={mode === 'alltime'} />
    </div>
  )
}
