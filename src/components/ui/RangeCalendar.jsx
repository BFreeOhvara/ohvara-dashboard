import { useMemo, useState, useRef, useEffect } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useFirstGradedCallDate } from './DayFilterBar'
import { DEFAULT_TIMEZONE, zonedDateStr } from '../../lib/timezones'

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December']
const DAY_LABELS = ['Su','Mo','Tu','We','Th','Fr','Sa']

export function fmtRangeLabel(iso) {
  const [, m, d] = iso.split('-')
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${months[+m - 1]} ${+d}`
}

// Contiguous start+end click-to-select range state — shared behavior for
// every 2-endpoint range picker in the app (MyCommissions, MyStats) so they
// stay pixel-for-pixel and behaviorally identical instead of drifting.
// repId (optional) fetches the rep's first-graded-call date for the "day
// one" star marker (Prompt 240) — same source DayFilterBar's calendar uses.
// timezone (optional, profile.timezone) sources "today" for future-day
// disabling and the initial visible month — the rep's own local calendar
// day, not UTC (Prompt 244).
export function useRangeCalendar(repId, timezone) {
  const tz = timezone || DEFAULT_TIMEZONE
  const todayStr = zonedDateStr(Date.now(), tz)
  const firstCallDateStr = useFirstGradedCallDate(repId, tz)
  const [rangeStart, setRangeStart] = useState(null)
  const [rangeEnd, setRangeEnd] = useState(null)
  const [hoverDate, setHoverDate] = useState(null)
  const [calOpen, setCalOpen] = useState(false)
  const [calViewYear, setCalViewYear] = useState(() => +todayStr.slice(0, 4))
  const [calViewMonth, setCalViewMonth] = useState(() => +todayStr.slice(5, 7))
  const calBtnRef = useRef(null)
  const calPanelRef = useRef(null)

  const hasCustomRange = !!(rangeStart && rangeEnd)

  function clearRange() {
    setRangeStart(null)
    setRangeEnd(null)
    setHoverDate(null)
    setCalOpen(false)
  }

  function handleDayClick(dateStr) {
    if (!rangeStart || rangeEnd) {
      setRangeStart(dateStr)
      setRangeEnd(null)
    } else {
      const [a, b] = dateStr < rangeStart ? [dateStr, rangeStart] : [rangeStart, dateStr]
      setRangeStart(a)
      setRangeEnd(b)
      setCalOpen(false)
      setHoverDate(null)
    }
  }

  function prevMonth() {
    if (calViewMonth === 1) { setCalViewMonth(12); setCalViewYear(y => y - 1) }
    else setCalViewMonth(m => m - 1)
  }
  function nextMonth() {
    if (calViewMonth === 12) { setCalViewMonth(1); setCalViewYear(y => y + 1) }
    else setCalViewMonth(m => m + 1)
  }

  useEffect(() => {
    function onClick(e) {
      if (
        calBtnRef.current && !calBtnRef.current.contains(e.target) &&
        calPanelRef.current && !calPanelRef.current.contains(e.target)
      ) setCalOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  const calBtnLabel = hasCustomRange
    ? rangeStart === rangeEnd
      ? fmtRangeLabel(rangeStart)
      : `${fmtRangeLabel(rangeStart)} – ${fmtRangeLabel(rangeEnd)}`
    : rangeStart
    ? `${fmtRangeLabel(rangeStart)} – …`
    : 'Custom Range'

  return {
    rangeStart, rangeEnd, hoverDate, setHoverDate,
    calOpen, setCalOpen, calViewYear, calViewMonth,
    calBtnRef, calPanelRef, hasCustomRange, calBtnLabel,
    clearRange, handleDayClick, prevMonth, nextMonth,
    firstCallDateStr, todayStr,
  }
}

// Presentational month grid — contiguous start+end click-to-select with
// hover preview (Prompt 231D, extracted to shared in Prompt 233 so My Stats
// doesn't become a third hand-rolled variant of the same picker).
export function RangeCalendar({ rangeStart, rangeEnd, hoverDate, onDayClick, onDayHover, viewYear, viewMonth, onPrev, onNext, firstCallDateStr, todayStr }) {
  const today = todayStr

  const cells = useMemo(() => {
    const firstDay = new Date(Date.UTC(viewYear, viewMonth - 1, 1))
    const startOffset = firstDay.getUTCDay()
    const daysInMonth = new Date(Date.UTC(viewYear, viewMonth, 0)).getUTCDate()
    const grid = []
    for (let i = 0; i < 42; i++) {
      const dayNum = i - startOffset + 1
      if (dayNum < 1 || dayNum > daysInMonth) {
        grid.push(null)
      } else {
        const mm = String(viewMonth).padStart(2, '0')
        const dd = String(dayNum).padStart(2, '0')
        grid.push(`${viewYear}-${mm}-${dd}`)
      }
    }
    return grid
  }, [viewYear, viewMonth])

  function isInRange(dateStr) {
    if (!dateStr) return false
    if (rangeStart && rangeEnd) return dateStr >= rangeStart && dateStr <= rangeEnd
    if (rangeStart && !rangeEnd && hoverDate) {
      const [a, b] = hoverDate < rangeStart ? [hoverDate, rangeStart] : [rangeStart, hoverDate]
      return dateStr >= a && dateStr <= b
    }
    return false
  }

  function isEdge(dateStr) {
    if (!dateStr) return false
    if (rangeStart && rangeEnd) return dateStr === rangeStart || dateStr === rangeEnd
    if (rangeStart && !rangeEnd) return dateStr === rangeStart || (hoverDate && dateStr === hoverDate)
    return false
  }

  return (
    <div style={{ padding: 12, userSelect: 'none' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <button onClick={onPrev} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 2, display: 'flex' }}>
          <ChevronLeft size={14} />
        </button>
        <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-primary)' }}>
          {MONTH_NAMES[viewMonth - 1]} {viewYear}
        </span>
        <button onClick={onNext} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 2, display: 'flex' }}>
          <ChevronRight size={14} />
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 1, marginBottom: 4 }}>
        {DAY_LABELS.map(d => (
          <div key={d} style={{ textAlign: 'center', fontSize: 10, color: 'var(--text-muted)', padding: '2px 0' }}>{d}</div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 1 }}>
        {cells.map((dateStr, i) => {
          if (!dateStr) return <div key={i} />
          const inRange = isInRange(dateStr)
          const edge = isEdge(dateStr)
          const isToday = dateStr === today
          const future = dateStr > today
          const isFirstCall = dateStr === firstCallDateStr
          // Star suppressed whenever this day is part of the current
          // selection/preview (edge or in-range) — a range picker highlights
          // more than one cell, so "selected" here means covered by the
          // active pick or hover-preview, not just an exact single-day match
          // (Prompt 240, mirrors DayFilterBar's single-day suppress rule).
          const showStar = isFirstCall && !edge && !inRange
          return (
            <div
              key={dateStr}
              onClick={() => !future && onDayClick(dateStr)}
              onMouseEnter={() => !future && onDayHover(dateStr)}
              onMouseLeave={() => onDayHover(null)}
              title={isFirstCall ? 'Your start day' : undefined}
              style={{
                position: 'relative',
                textAlign: 'center', fontSize: 12,
                padding: '5px 0', borderRadius: 4,
                cursor: future ? 'default' : 'pointer',
                background: edge
                  ? 'var(--accent)'
                  : inRange
                  ? 'rgba(108,99,255,0.18)'
                  : 'transparent',
                color: edge || showStar
                  ? '#fff'
                  : future
                  ? 'var(--text-muted)'
                  : isToday
                  ? 'var(--accent)'
                  : 'var(--text-primary)',
                fontWeight: edge || isToday || isFirstCall ? 600 : 400,
                transition: 'background 80ms',
              }}
            >
              {showStar && (
                <svg
                  viewBox="0 0 24 24"
                  fill="var(--warning)"
                  style={{ position: 'absolute', inset: 0, margin: 'auto', width: '90%', height: '90%', zIndex: 0 }}
                >
                  <polygon points="12 1.5, 15.09 8.26, 22 9.27, 17 14.14, 18.18 21.02, 12 17.77, 5.82 21.02, 7 14.14, 2 9.27, 8.91 8.26" />
                </svg>
              )}
              <span style={{ position: 'relative', zIndex: 1 }}>{+dateStr.slice(8)}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
