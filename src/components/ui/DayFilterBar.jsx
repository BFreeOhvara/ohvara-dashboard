import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight } from 'lucide-react'
import { supabase } from '../../lib/supabase'

// Shared single-day-only calendar filter — Activity Feed (Prompt 223/225) and
// My Calls (Prompt 227) both use this. No "all days" escape hatch: callers
// always get a real selected date, never null (Prompt 227 removed the old
// clear/X affordance for good).
const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December']
const DAY_LABELS = ['Su','Mo','Tu','We','Th','Fr','Sa']

export function toUtcDateStr(ts) {
  return new Date(ts).toISOString().slice(0, 10)
}

function addUtcDays(dateStr, delta) {
  const d = new Date(`${dateStr}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + delta)
  return toUtcDateStr(d.getTime())
}

// Tracks "today" (UTC calendar day) live and keeps selectedDate pinned to it
// across a UTC midnight rollover, unless the user has stepped to a different
// day. Always returns a real date string — never null/"all days".
// repId (optional) also fetches the rep's first-ever call date, for the
// "day one" star marker in DayFilterBar's calendar grid (Prompt 231).
export function useDayFilter(repId) {
  const [todayStr, setTodayStr] = useState(() => toUtcDateStr(Date.now()))
  const [selectedDate, setSelectedDate] = useState(() => toUtcDateStr(Date.now()))

  useEffect(() => {
    function checkRollover() {
      const nowStr = toUtcDateStr(Date.now())
      setTodayStr(prevToday => {
        if (nowStr === prevToday) return prevToday
        setSelectedDate(prevSelected => prevSelected === prevToday ? nowStr : prevSelected)
        return nowStr
      })
    }
    const interval = setInterval(checkRollover, 60_000)
    document.addEventListener('visibilitychange', checkRollover)
    return () => {
      clearInterval(interval)
      document.removeEventListener('visibilitychange', checkRollover)
    }
  }, [])

  const { data: firstCallDateStr } = useQuery({
    queryKey: ['first-graded-call-date', repId],
    queryFn: async () => {
      // Prompt 232 item C: scoped to graded calls only — raw `calls` rows can
      // be blank leftover seed/test data (no outcome, no grade) that never
      // represented a real dial. "First call" for the star marker means the
      // first call that actually completed and got graded.
      const { data, error } = await supabase
        .from('calls')
        .select('created_at')
        .eq('rep_id', repId)
        .not('grade', 'is', null)
        .order('created_at', { ascending: true })
        .limit(1)
      if (error) throw error
      return data?.[0] ? toUtcDateStr(data[0].created_at) : null
    },
    enabled: !!repId,
    staleTime: Infinity,
  })

  return { todayStr, selectedDate, setSelectedDate, firstCallDateStr }
}

export function DayFilterBar({ selectedDate, todayStr, onChange, firstCallDateStr }) {
  const [calOpen, setCalOpen] = useState(false)
  const now = new Date()
  const [calViewYear, setCalViewYear] = useState(now.getUTCFullYear())
  const [calViewMonth, setCalViewMonth] = useState(now.getUTCMonth() + 1)
  const calBtnRef = useRef(null)
  const calPanelRef = useRef(null)

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

  function prevMonth() {
    if (calViewMonth === 1) { setCalViewMonth(12); setCalViewYear(y => y - 1) }
    else setCalViewMonth(m => m - 1)
  }
  function nextMonth() {
    if (calViewMonth === 12) { setCalViewMonth(1); setCalViewYear(y => y + 1) }
    else setCalViewMonth(m => m + 1)
  }

  function handleDayClick(dateStr) {
    onChange(dateStr)
    setCalOpen(false)
  }

  function stepDay(delta) {
    const next = addUtcDays(selectedDate, delta)
    if (next > todayStr) return
    onChange(next)
    setCalViewYear(+next.slice(0, 4))
    setCalViewMonth(+next.slice(5, 7))
  }

  const calBtnLabel = `${MONTH_NAMES[+selectedDate.slice(5, 7) - 1].slice(0, 3)} ${+selectedDate.slice(8)}`
  const canStepForward = selectedDate < todayStr

  return (
    <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 4 }} ref={calBtnRef}>
      <button
        onClick={() => stepDay(-1)}
        title="Previous day"
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          width: 28, height: 34, background: 'var(--bg-surface)',
          border: '0.5px solid var(--border)', borderRadius: 8,
          color: 'var(--text-muted)', cursor: 'pointer',
        }}
      >
        <ChevronLeft size={13} />
      </button>

      <button
        onClick={() => setCalOpen(o => !o)}
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          height: 34, padding: '0 12px',
          background: calOpen ? 'var(--bg-elevated)' : 'var(--bg-surface)',
          border: '0.5px solid var(--accent)',
          borderRadius: 8, cursor: 'pointer',
          fontSize: 12, color: 'var(--accent)',
          transition: 'all 0.1s',
        }}
      >
        <CalendarIcon size={12} />
        {calBtnLabel}
      </button>

      <button
        onClick={() => stepDay(1)}
        disabled={!canStepForward}
        title="Next day"
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          width: 28, height: 34, background: 'var(--bg-surface)',
          border: '0.5px solid var(--border)', borderRadius: 8,
          color: 'var(--text-muted)', cursor: canStepForward ? 'pointer' : 'not-allowed',
          opacity: canStepForward ? 1 : 0.4,
        }}
      >
        <ChevronRight size={13} />
      </button>

      {calOpen && (
        <div
          ref={calPanelRef}
          style={{
            position: 'absolute', top: '100%', right: 0, marginTop: 6, zIndex: 200,
            background: '#13131F', border: '0.5px solid var(--border)',
            borderRadius: 10, boxShadow: '0 16px 40px rgba(0,0,0,0.4)',
            minWidth: 224,
          }}
        >
          <SingleDayCalendar
            selectedDate={selectedDate}
            onDayClick={handleDayClick}
            viewYear={calViewYear}
            viewMonth={calViewMonth}
            onPrev={prevMonth}
            onNext={nextMonth}
            firstCallDateStr={firstCallDateStr}
          />
        </div>
      )}
    </div>
  )
}

function SingleDayCalendar({ selectedDate, onDayClick, viewYear, viewMonth, onPrev, onNext, firstCallDateStr }) {
  const today = new Date().toISOString().slice(0, 10)

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
          const isSelected = dateStr === selectedDate
          const isToday = dateStr === today
          const isFirstCall = dateStr === firstCallDateStr
          const future = dateStr > today
          return (
            <div
              key={dateStr}
              onClick={() => !future && onDayClick(dateStr)}
              title={isFirstCall ? 'Your first graded call' : undefined}
              style={{
                position: 'relative',
                textAlign: 'center', fontSize: 12,
                padding: '5px 0', borderRadius: 4,
                cursor: future ? 'default' : 'pointer',
                background: isSelected ? 'var(--accent)' : isFirstCall ? 'var(--warning)' : 'transparent',
                color: isSelected || isFirstCall
                  ? '#fff'
                  : future
                  ? 'var(--text-muted)'
                  : isToday
                  ? 'var(--accent)'
                  : 'var(--text-primary)',
                fontWeight: isSelected || isToday || isFirstCall ? 600 : 400,
                transition: 'background 80ms',
              }}
            >
              {+dateStr.slice(8)}
            </div>
          )
        })}
      </div>
    </div>
  )
}
