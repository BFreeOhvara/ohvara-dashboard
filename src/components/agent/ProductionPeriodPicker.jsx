import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon } from 'lucide-react'

// Unified period control behind Performance → Production (Prompt 348) —
// literal port of the export's date field (media/claude-design-export-
// ohvara-dashboard-v3.html, lines 390-422): quick pills (Today / This Month /
// All Time), a single-month calendar grid (click a date for a single day,
// click a second date to span a range), step arrows for day/month modes, and
// a "Done" button to close. The export's popover calendar never navigates
// off its hardcoded sample month — added prev/next here since a real picker
// needs to reach dates outside the current month (same nav pattern the
// app's other calendar, components/ui/RangeCalendar.jsx, already has).

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December']
const DAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

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

export function usePeriodPicker(todayStr) {
  const todayMonthKey = todayStr.slice(0, 7)

  const [mode, setMode] = useState('alltime') // Default: All Time (Brayden's explicit call, Prompt 348)
  const [day, setDay] = useState(todayStr)
  const [rangeStart, setRangeStart] = useState(todayStr)
  const [rangeEnd, setRangeEnd] = useState(todayStr)
  const [monthKey, setMonthKey] = useState(todayMonthKey)
  const [pickAnchor, setPickAnchor] = useState(null)
  const [calOpen, setCalOpen] = useState(false)
  const [viewYear, setViewYear] = useState(() => +todayStr.slice(0, 4))
  const [viewMonth, setViewMonth] = useState(() => +todayStr.slice(5, 7))
  const btnRef = useRef(null)
  const panelRef = useRef(null)

  const bounds = useMemo(() => {
    if (mode === 'day') return { lo: day, hi: day }
    if (mode === 'range') {
      return rangeStart <= rangeEnd ? { lo: rangeStart, hi: rangeEnd } : { lo: rangeEnd, hi: rangeStart }
    }
    if (mode === 'month') {
      const [y, m] = monthKey.split('-').map(Number)
      return { lo: `${monthKey}-01`, hi: `${monthKey}-${pad2(new Date(y, m, 0).getDate())}` }
    }
    return { lo: '0000-01-01', hi: '9999-12-31' }
  }, [mode, day, rangeStart, rangeEnd, monthKey])

  const asOf = mode === 'alltime' ? todayStr : bounds.hi

  const label = useMemo(() => {
    if (mode === 'day') return day === todayStr ? `Today · ${shortLabel(day)}` : `${shortLabel(day)}, ${day.slice(0, 4)}`
    if (mode === 'range') {
      return bounds.lo === bounds.hi
        ? `${shortLabel(bounds.lo)}, ${bounds.lo.slice(0, 4)}`
        : `${shortLabel(bounds.lo)} – ${shortLabel(bounds.hi)}`
    }
    if (mode === 'month') {
      const [y, m] = monthKey.split('-').map(Number)
      return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    }
    return 'All Time'
  }, [mode, day, bounds, monthKey, todayStr])

  const showArrows = mode === 'day' || mode === 'month'
  const canNext = mode === 'day' ? day < todayStr : mode === 'month' ? monthKey < todayMonthKey : false

  function prevArrow() {
    if (mode === 'day') setDay(k => addDays(k, -1))
    else if (mode === 'month') setMonthKey(k => addMonthsToKey(k, -1))
  }
  function nextArrow() {
    if (!canNext) return
    if (mode === 'day') setDay(k => addDays(k, 1))
    else if (mode === 'month') setMonthKey(k => addMonthsToKey(k, 1))
  }

  function setToday() { setMode('day'); setDay(todayStr); setCalOpen(false); setPickAnchor(null) }
  function setThisMonth() { setMode('month'); setMonthKey(todayMonthKey); setCalOpen(false); setPickAnchor(null) }
  function setAllTime() { setMode('alltime'); setCalOpen(false); setPickAnchor(null) }

  function pickDate(key) {
    if (pickAnchor == null) {
      setRangeStart(key); setRangeEnd(key); setMode('day'); setDay(key); setPickAnchor(key)
      return
    }
    if (pickAnchor === key) {
      setRangeStart(key); setRangeEnd(key); setMode('day'); setDay(key)
      return
    }
    const lo = pickAnchor < key ? pickAnchor : key
    const hi = pickAnchor < key ? key : pickAnchor
    setRangeStart(lo); setRangeEnd(hi); setMode('range'); setPickAnchor(null)
  }

  function prevViewMonth() {
    if (viewMonth === 1) { setViewMonth(12); setViewYear(y => y - 1) } else setViewMonth(m => m - 1)
  }
  function nextViewMonth() {
    if (viewMonth === 12) { setViewMonth(1); setViewYear(y => y + 1) } else setViewMonth(m => m + 1)
  }

  useEffect(() => {
    function onClick(e) {
      if (
        btnRef.current && !btnRef.current.contains(e.target) &&
        panelRef.current && !panelRef.current.contains(e.target)
      ) setCalOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  return {
    mode, bounds, asOf, label, showArrows, canNext, todayStr,
    calOpen, setCalOpen, btnRef, panelRef,
    viewYear, viewMonth, prevViewMonth, nextViewMonth,
    prevArrow, nextArrow, setToday, setThisMonth, setAllTime, pickDate,
    close: () => { setCalOpen(false); setPickAnchor(null) },
    quickTodayOn: mode === 'day' && day === todayStr,
    quickMonthOn: mode === 'month' && monthKey === todayMonthKey,
    quickAllOn: mode === 'alltime',
  }
}

function PillButton({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1, border: `1px solid ${active ? 'var(--accent-border)' : 'var(--border)'}`,
        borderRadius: 6, padding: '6px 4px', fontSize: 10.5, fontWeight: 700,
        background: active ? 'var(--accent-dim)' : 'var(--bg-surface)',
        color: active ? 'var(--accent)' : 'var(--text-secondary)',
      }}
    >
      {children}
    </button>
  )
}

const arrowBtnStyle = {
  border: 'none', background: 'transparent', padding: 4,
  display: 'inline-flex', color: 'var(--text-secondary)', cursor: 'pointer',
}

const fieldBtnStyle = {
  display: 'flex', alignItems: 'center', gap: 7,
  border: 'var(--border-w) solid var(--border)', borderRadius: 6,
  padding: '6px 14px', fontSize: 11.5, fontWeight: 700,
  background: 'var(--bg-elevated)', color: 'var(--text-primary)', whiteSpace: 'nowrap',
}

export function PeriodPicker(picker) {
  const {
    mode, bounds, label, showArrows, canNext, todayStr,
    calOpen, setCalOpen, btnRef, panelRef,
    viewYear, viewMonth, prevViewMonth, nextViewMonth,
    prevArrow, nextArrow, setToday, setThisMonth, setAllTime, pickDate, close,
    quickTodayOn, quickMonthOn, quickAllOn,
  } = picker

  const cells = useMemo(() => {
    const firstDay = new Date(viewYear, viewMonth - 1, 1).getDay()
    const daysInMonth = new Date(viewYear, viewMonth, 0).getDate()
    const grid = []
    for (let i = 0; i < firstDay; i++) grid.push(null)
    for (let day = 1; day <= daysInMonth; day++) grid.push(`${viewYear}-${pad2(viewMonth)}-${pad2(day)}`)
    return grid
  }, [viewYear, viewMonth])

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, position: 'relative' }}>
      {showArrows && <button onClick={prevArrow} style={arrowBtnStyle}><ChevronLeft size={15} /></button>}

      <button ref={btnRef} onClick={() => setCalOpen(o => !o)} style={fieldBtnStyle}>
        <CalendarIcon size={13} style={{ color: 'var(--text-muted)' }} />
        {label}
      </button>

      {showArrows && (
        <button
          onClick={nextArrow}
          disabled={!canNext}
          style={{ ...arrowBtnStyle, color: canNext ? 'var(--text-secondary)' : 'var(--text-muted)', opacity: canNext ? 1 : 0.4, cursor: canNext ? 'pointer' : 'default' }}
        >
          <ChevronRight size={15} />
        </button>
      )}

      {calOpen && (
        <div
          ref={panelRef}
          style={{
            position: 'absolute', top: 36, right: 0, zIndex: 20,
            background: 'var(--bg-elevated)', border: 'var(--border-w) solid var(--border)',
            borderRadius: 10, padding: 14, boxShadow: '0 12px 32px rgba(0,0,0,0.4)', width: 270,
          }}
        >
          <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
            <PillButton active={quickTodayOn} onClick={setToday}>Today</PillButton>
            <PillButton active={quickMonthOn} onClick={setThisMonth}>This Month</PillButton>
            <PillButton active={quickAllOn} onClick={setAllTime}>All Time</PillButton>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <button onClick={prevViewMonth} style={{ ...arrowBtnStyle, color: 'var(--text-muted)' }}><ChevronLeft size={14} /></button>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)' }}>
              {MONTH_NAMES[viewMonth - 1]} {viewYear}
            </span>
            <button onClick={nextViewMonth} style={{ ...arrowBtnStyle, color: 'var(--text-muted)' }}><ChevronRight size={14} /></button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 4, marginBottom: 4 }}>
            {DAY_LABELS.map((w, i) => (
              <span key={i} style={{ fontSize: 9.5, fontWeight: 700, color: 'var(--text-muted)', textAlign: 'center' }}>{w}</span>
            ))}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 4 }}>
            {cells.map((key, i) => {
              if (!key) return <span key={i} />
              const future = key > todayStr
              const edge = mode === 'day' ? key === bounds.lo : (key === bounds.lo || key === bounds.hi)
              const inRange = mode === 'range' && key > bounds.lo && key < bounds.hi
              return (
                <button
                  key={key}
                  disabled={future}
                  onClick={() => pickDate(key)}
                  style={{
                    border: 'none', borderRadius: 6, height: 26, fontSize: 11,
                    fontWeight: edge ? 700 : 500,
                    background: edge ? 'var(--accent)' : inRange ? 'var(--accent-dim)' : 'transparent',
                    color: future ? 'var(--text-muted)' : edge ? '#fff' : inRange ? 'var(--accent)' : 'var(--text-primary)',
                    cursor: future ? 'default' : 'pointer',
                  }}
                >
                  {+key.slice(8)}
                </button>
              )
            })}
          </div>

          <p style={{ margin: '10px 0 0', fontSize: 10, color: 'var(--text-muted)', lineHeight: 1.5 }}>
            Click a date to select a single day. Click a second date to span a range.
          </p>
          <button
            onClick={close}
            style={{ marginTop: 10, width: '100%', border: 'none', borderRadius: 6, padding: 7, fontSize: 11, fontWeight: 700, background: 'var(--accent)', color: '#fff' }}
          >
            Done
          </button>
        </div>
      )}
    </div>
  )
}
