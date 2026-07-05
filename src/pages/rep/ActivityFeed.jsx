import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { Bell, Phone, Calendar as CalendarIcon, ChevronLeft, ChevronRight, X } from 'lucide-react'
import { Card } from '../../components/ui/Card'

// The feed is strictly outcome-driven: a calls row exists only when a lead
// was moved to a real outcome (Appointment Booked / No Answer / Not
// Interested / Follow-Up), and the row is deleted if the rep reverts the
// lead to New — so the feed self-corrects. No other event types are logged.
const FEED_OUTCOMES = ['Appointment Booked', 'No Answer', 'Not Interested', 'Follow-Up']

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December']
const DAY_LABELS = ['Su','Mo','Tu','We','Th','Fr','Sa']

// Buckets by UTC calendar date, matching the boundary assign_daily_batches()
// (pg_cron, supabase/migrations/016_daily_batch_cron.sql) actually uses —
// CURRENT_DATE with zero per-rep timezone adjustment. Browser-local would
// disagree with what the rest of the dashboard considers "today" (Prompt 223
// investigation, see brain/Memories.md).
function toUtcDateStr(ts) {
  return new Date(ts).toISOString().slice(0, 10)
}

export default function ActivityFeed() {
  const { profile } = useAuth()
  const [selectedDate, setSelectedDate] = useState(null) // 'YYYY-MM-DD' (UTC) or null = full feed
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
    setSelectedDate(dateStr)
    setCalOpen(false)
  }

  function clearFilter() {
    setSelectedDate(null)
    setCalOpen(false)
  }

  const { data: calls, isLoading } = useQuery({
    queryKey: ['activity', profile?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('calls')
        .select(`*, lead:leads(business_name, contact_name)`)
        .eq('rep_id', profile.id)
        .in('outcome', FEED_OUTCOMES)
        .order('created_at', { ascending: false })
        .limit(50)
      if (error) throw error
      return data
    },
    enabled: !!profile?.id,
  })

  const items = (calls || [])
    .map(c => ({
      id: c.id,
      type: 'call',
      label: `Called ${c.lead?.business_name}`,
      sub: `Outcome: ${c.outcome}`,
      status: c.outcome,
      time: c.created_at,
    }))
    .filter(item => !selectedDate || toUtcDateStr(item.time) === selectedDate)

  const calBtnLabel = selectedDate
    ? `${MONTH_NAMES[+selectedDate.slice(5, 7) - 1].slice(0, 3)} ${+selectedDate.slice(8)}`
    : 'All days'

  return (
    // 60px = one FeedItem row's rendered footprint (56px box + 4px space-y-1
    // gap, measured from live CSS) — shaves exactly one row off the bottom
    // per Prompt 202, so the box no longer ends flush with the last row.
    <div style={{ height: 'calc(100vh - 48px - 60px)', display: 'flex', flexDirection: 'column' }}>
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-xl font-medium text-[var(--text-primary)]">Activity Feed</h1>
          <p className="text-[var(--text-muted)] text-sm mt-0.5">Call outcomes — booked, follow-up, no answer, not interested</p>
        </div>

        <div style={{ position: 'relative' }} ref={calBtnRef}>
          <button
            onClick={() => setCalOpen(o => !o)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              height: 34, padding: '0 12px',
              background: selectedDate || calOpen ? 'var(--bg-elevated)' : 'var(--bg-surface)',
              border: `0.5px solid ${selectedDate ? 'var(--accent)' : 'var(--border)'}`,
              borderRadius: 8, cursor: 'pointer',
              fontSize: 12, color: selectedDate ? 'var(--accent)' : 'var(--text-muted)',
              transition: 'all 0.1s',
            }}
          >
            <CalendarIcon size={12} />
            {calBtnLabel}
            {selectedDate && (
              <span
                onClick={e => { e.stopPropagation(); clearFilter() }}
                style={{ marginLeft: 2, display: 'flex', alignItems: 'center', color: 'var(--text-muted)', cursor: 'pointer' }}
              >
                <X size={11} />
              </span>
            )}
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
              />
            </div>
          )}
        </div>
      </div>

      <Card style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {isLoading ? (
          <div className="space-y-3">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-12 bg-[var(--bg-2)] rounded-lg animate-pulse" />
            ))}
          </div>
        ) : !items.length ? (
          <div className="text-center py-10">
            <Bell className="text-[var(--text-muted)] mx-auto mb-2" size={24} />
            <p className="text-[var(--text-muted)] text-sm">{selectedDate ? 'No activity on this day' : 'No activity yet'}</p>
          </div>
        ) : (
          <div className="space-y-1 scrollbar-thin" style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
            {items.map(item => (
              <FeedItem key={item.id} item={item} />
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}

// Single-day picker — no range selection (explicitly not wanted here, unlike
// RevenueTracker's MiniCalendar range picker). Grid cells are UTC calendar
// dates so "today"/selection lines up with toUtcDateStr() above.
function SingleDayCalendar({ selectedDate, onDayClick, viewYear, viewMonth, onPrev, onNext }) {
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
          const future = dateStr > today
          return (
            <div
              key={dateStr}
              onClick={() => !future && onDayClick(dateStr)}
              style={{
                textAlign: 'center', fontSize: 12,
                padding: '5px 0', borderRadius: 4,
                cursor: future ? 'default' : 'pointer',
                background: isSelected ? 'var(--accent)' : 'transparent',
                color: isSelected
                  ? '#fff'
                  : future
                  ? 'var(--text-muted)'
                  : isToday
                  ? 'var(--accent)'
                  : 'var(--text-primary)',
                fontWeight: isSelected || isToday ? 600 : 400,
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

// Same status color scheme as the Call Now modal / Badge. Exported so My
// Calls can reuse the exact same outcome → color mapping instead of a
// second copy that could drift (Prompt 194).
export const STATUS_COLORS = {
  'New':                { color: '#38BDF8', dim: 'rgba(56,189,248,0.10)' },
  'Appointment Booked': { color: '#22C55E', dim: 'rgba(34,197,94,0.10)' },
  'No Answer':          { color: '#94A3B8', dim: 'rgba(148,163,184,0.10)' },
  'Not Interested':     { color: '#EF4444', dim: 'rgba(239,68,68,0.10)' },
  'Follow-Up':          { color: '#F59E0B', dim: 'rgba(245,158,11,0.10)' },
}

function FeedItem({ item }) {
  const sc = item.status ? STATUS_COLORS[item.status] : null

  const icons = {
    call: <Phone size={14} style={sc ? { color: sc.color } : undefined} className={sc ? undefined : 'text-[var(--accent)]'} />,
  }

  return (
    <div
      className="flex items-start gap-3 px-2 py-2.5 rounded-lg hover:bg-[var(--bg-2)] transition-colors"
      style={sc ? { borderLeft: `2px solid ${sc.color}` } : { borderLeft: '2px solid transparent' }}
    >
      <div
        className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5"
        style={{ background: sc ? sc.dim : 'var(--bg-3)' }}
      >
        {icons[item.type] || <Bell size={14} className="text-[var(--text-secondary)]" />}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-[var(--text-primary)]">{item.label}</p>
        {item.sub && (
          <p className="text-xs" style={{ color: sc ? sc.color : 'var(--text-muted)' }}>{item.sub}</p>
        )}
      </div>
      <p className="text-xs text-[var(--text-muted)] flex-shrink-0">{formatTime(item.time)}</p>
    </div>
  )
}

function formatTime(ts) {
  const d = new Date(ts)
  const now = new Date()
  const isToday = d.toDateString() === now.toDateString()
  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  const isYesterday = d.toDateString() === yesterday.toDateString()
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  if (isToday) return `Today ${time}`
  if (isYesterday) return `Yesterday ${time}`
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ` ${time}`
}
