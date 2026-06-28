import { useEffect, useState, useMemo, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { StatCard } from '../../components/ui/StatCard'
import { Card } from '../../components/ui/Card'
import { useConnectOnboard, useCheckOnboardStatus } from '../../hooks/usePayouts'
import { DollarSign, TrendingUp, BarChart2, Target, Landmark, CheckCircle2, Loader2, Handshake, X, ChevronLeft, ChevronRight, Calendar } from 'lucide-react'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
} from 'recharts'

const FILTER_TABS = ['All Time', 'Day', 'Week', 'Month']
const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December']
const DAY_LABELS = ['Su','Mo','Tu','We','Th','Fr','Sa']

function toDateStr(d) {
  return d.toISOString().slice(0, 10)
}

function getWindowStart(filter) {
  const now = new Date()
  if (filter === 'Day') return new Date(now.getFullYear(), now.getMonth(), now.getDate())
  if (filter === 'Week') {
    const d = new Date(now)
    d.setHours(0, 0, 0, 0)
    d.setDate(d.getDate() - d.getDay())
    return d
  }
  return new Date(now.getFullYear(), now.getMonth(), 1)
}

function buildChartData(all, filter, rangeStart, rangeEnd) {
  const sum = arr => arr.reduce((s, d) => s + (d.deal_value || 0), 0)
  const now = new Date()

  if (rangeStart && rangeEnd) {
    const from = new Date(rangeStart + 'T00:00:00')
    const to   = new Date(rangeEnd   + 'T23:59:59')
    const days = []
    for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
      const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate())
      const dayEnd   = new Date(dayStart.getTime() + 86400000)
      const dayDeals = all.filter(a => { const dt = new Date(a.updated_at); return dt >= dayStart && dt < dayEnd })
      days.push({
        label: `${d.getMonth() + 1}/${d.getDate()}`,
        value: sum(dayDeals),
        count: dayDeals.length,
      })
    }
    return days
  }

  if (filter === 'All Time') {
    if (!all.length) {
      return Array.from({ length: 6 }, (_, i) => {
        const d = new Date(now.getFullYear(), now.getMonth() - 5 + i, 1)
        return { label: d.toLocaleString('en-US', { month: 'short', year: '2-digit' }), value: 0, count: 0 }
      })
    }
    const byMonth = {}
    for (const a of all) {
      const key = a.updated_at.slice(0, 7)
      byMonth[key] = (byMonth[key] || 0) + (a.deal_value || 0)
    }
    return Object.keys(byMonth).sort().map(k => {
      const [y, m] = k.split('-')
      const label = new Date(+y, +m - 1, 1).toLocaleString('en-US', { month: 'short', year: '2-digit' })
      return { label, value: byMonth[k], count: 0 }
    })
  }

  if (filter === 'Day') {
    const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    return Array.from({ length: 6 }, (_, i) => {
      const start = new Date(dayStart.getTime() + i * 4 * 3600000)
      const end   = new Date(start.getTime() + 4 * 3600000)
      const block = all.filter(a => { const dt = new Date(a.updated_at); return dt >= start && dt < end })
      return { label: `${i * 4}h`, value: sum(block), count: block.length }
    })
  }

  if (filter === 'Week') {
    const weekStart = getWindowStart('Week')
    return Array.from({ length: 7 }, (_, i) => {
      const start = new Date(weekStart.getTime() + i * 86400000)
      const end   = new Date(start.getTime() + 86400000)
      const day = all.filter(a => { const dt = new Date(a.updated_at); return dt >= start && dt < end })
      return { label: ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][i], value: sum(day), count: day.length }
    })
  }

  // Month — last 8 weeks
  return Array.from({ length: 8 }, (_, i) => {
    const idx = 7 - i
    const start = new Date(now - (idx + 1) * 7 * 86400000)
    const end   = new Date(now - idx * 7 * 86400000)
    const wDeals = all.filter(a => { const dt = new Date(a.updated_at); return dt >= start && dt < end })
    return { label: `W${8 - idx}`, value: sum(wDeals), count: wDeals.length }
  })
}

function MiniCalendar({ rangeStart, rangeEnd, hoverDate, onDayClick, onDayHover, viewYear, viewMonth, onPrev, onNext }) {
  const today = toDateStr(new Date())

  const cells = useMemo(() => {
    const firstDay = new Date(viewYear, viewMonth - 1, 1)
    const startOffset = firstDay.getDay()
    const daysInMonth = new Date(viewYear, viewMonth, 0).getDate()
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
          return (
            <div
              key={dateStr}
              onClick={() => !future && onDayClick(dateStr)}
              onMouseEnter={() => !future && onDayHover(dateStr)}
              onMouseLeave={() => onDayHover(null)}
              style={{
                textAlign: 'center', fontSize: 12,
                padding: '5px 0', borderRadius: 4,
                cursor: future ? 'default' : 'pointer',
                background: edge
                  ? 'var(--accent)'
                  : inRange
                  ? 'rgba(108,99,255,0.18)'
                  : 'transparent',
                color: edge
                  ? '#fff'
                  : future
                  ? 'var(--text-muted)'
                  : isToday
                  ? 'var(--accent)'
                  : 'var(--text-primary)',
                fontWeight: edge || isToday ? 600 : 400,
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

function RevenueTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div style={{
      background: '#13131F', border: '0.5px solid var(--border)',
      borderRadius: 8, padding: '8px 12px',
      boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
    }}>
      <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>{label}</p>
      <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--accent)', fontFamily: 'var(--font-mono)' }}>
        ${Number(payload[0]?.value || 0).toLocaleString()}
      </p>
    </div>
  )
}

export default function RevenueTracker() {
  const { profile } = useAuth()
  const connected = !!profile?.stripe_onboarding_complete
  const onboard = useConnectOnboard()
  const checkStatus = useCheckOnboardStatus()

  const now = new Date()
  const [filter,       setFilter]       = useState('All Time')
  const [rangeStart,   setRangeStart]   = useState(null)
  const [rangeEnd,     setRangeEnd]     = useState(null)
  const [hoverDate,    setHoverDate]    = useState(null)
  const [calOpen,      setCalOpen]      = useState(false)
  const [calViewYear,  setCalViewYear]  = useState(now.getFullYear())
  const [calViewMonth, setCalViewMonth] = useState(now.getMonth() + 1)
  const calBtnRef   = useRef(null)
  const calPanelRef = useRef(null)

  const hasCustomRange = !!(rangeStart && rangeEnd)

  function clearCustomRange() {
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

  async function startOnboarding() {
    try {
      const res = await onboard.mutateAsync()
      if (res?.url) {
        window.open(
          res.url,
          'stripe-connect',
          `popup,width=500,height=700,left=${Math.floor((screen.width - 500) / 2)},top=${Math.floor((screen.height - 700) / 2)}`
        )
      }
    } catch { /* error surfaced via onboard.error */ }
  }

  useEffect(() => {
    const flag = new URLSearchParams(window.location.search).get('onboarding')
    if (!flag) return
    if (flag === 'complete') {
      if (window.opener) {
        window.opener.postMessage('stripe-onboarding-complete', window.location.origin)
        window.close()
      } else {
        checkStatus.mutateAsync().finally(() => window.location.assign('/closer/revenue'))
      }
    } else {
      window.history.replaceState({}, '', '/closer/revenue')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    function onMsg(e) {
      if (e.origin !== window.location.origin) return
      if (e.data !== 'stripe-onboarding-complete') return
      checkStatus.mutateAsync()
    }
    window.addEventListener('message', onMsg)
    return () => window.removeEventListener('message', onMsg)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const { data: allDeals = [] } = useQuery({
    queryKey: ['revenue-raw', profile?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('appointments')
        .select('deal_value, outcome, updated_at')
        .eq('closer_id', profile.id)
        .eq('outcome', 'closed')
      if (error) throw error
      return data || []
    },
    enabled: !!profile?.id,
  })

  const kpis = useMemo(() => {
    const sum = arr => arr.reduce((s, d) => s + (d.deal_value || 0), 0)
    const avg = arr => arr.length ? sum(arr) / arr.length : 0

    let scoped = allDeals
    if (hasCustomRange) {
      const from = new Date(rangeStart + 'T00:00:00')
      const to   = new Date(rangeEnd   + 'T23:59:59')
      scoped = allDeals.filter(a => { const d = new Date(a.updated_at); return d >= from && d <= to })
    } else if (filter !== 'All Time') {
      scoped = allDeals.filter(a => new Date(a.updated_at) >= getWindowStart(filter))
    }

    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    const weekAgo    = new Date(now - 7 * 86400000)

    return {
      allTime:   sum(allDeals),
      thisMonth: sum(allDeals.filter(d => new Date(d.updated_at) >= monthStart)),
      thisWeek:  sum(allDeals.filter(d => new Date(d.updated_at) >= weekAgo)),
      avgDeal:   avg(scoped),
    }
  }, [allDeals, filter, hasCustomRange, rangeStart, rangeEnd])

  const chartData = useMemo(
    () => buildChartData(allDeals, filter, hasCustomRange ? rangeStart : null, hasCustomRange ? rangeEnd : null),
    [allDeals, filter, hasCustomRange, rangeStart, rangeEnd]
  )

  function fmtRangeLabel(iso) {
    const [, m, d] = iso.split('-')
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
    return `${months[+m - 1]} ${+d}`
  }

  const calBtnLabel = hasCustomRange
    ? `${fmtRangeLabel(rangeStart)} – ${fmtRangeLabel(rangeEnd)}`
    : rangeStart
    ? `${fmtRangeLabel(rangeStart)} – …`
    : 'Custom Range'

  const chartTitle = hasCustomRange
    ? `Revenue ${fmtRangeLabel(rangeStart)} – ${fmtRangeLabel(rangeEnd)}`
    : filter === 'All Time' ? 'All-Time Revenue by Month'
    : filter === 'Day' ? "Today's Revenue"
    : filter === 'Week' ? "This Week's Revenue"
    : 'Weekly Revenue (last 8 weeks)'

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20, gap: 16, flexWrap: 'wrap' }}>
        <div>
          <h1 className="text-xl font-medium text-[var(--text-primary)]">Revenue Tracker</h1>
          <p className="text-[var(--text-muted)] text-sm mt-0.5">Your closed revenue across all time</p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          {/* Preset filter tabs */}
          <div style={{
            display: 'flex', gap: 2,
            background: 'var(--bg-surface)', border: '0.5px solid var(--border)',
            borderRadius: 8, padding: 3,
          }}>
            {FILTER_TABS.map(t => (
              <button
                key={t}
                onClick={() => { setFilter(t); clearCustomRange() }}
                style={{
                  height: 28, padding: '0 12px',
                  background: filter === t && !hasCustomRange ? 'var(--bg-elevated)' : 'transparent',
                  border: 'none', borderRadius: 6,
                  fontSize: 12, fontWeight: filter === t && !hasCustomRange ? 500 : 400,
                  color: filter === t && !hasCustomRange ? 'var(--text-primary)' : 'var(--text-muted)',
                  cursor: 'pointer', transition: 'all 0.1s',
                  boxShadow: filter === t && !hasCustomRange ? '0 1px 4px rgba(0,0,0,0.2)' : 'none',
                }}
              >
                {t}
              </button>
            ))}
          </div>

          {/* Custom range trigger + calendar */}
          <div style={{ position: 'relative' }} ref={calBtnRef}>
            <button
              onClick={() => setCalOpen(o => !o)}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                height: 34, padding: '0 12px',
                background: hasCustomRange || calOpen ? 'var(--bg-elevated)' : 'var(--bg-surface)',
                border: `0.5px solid ${hasCustomRange ? 'var(--accent)' : 'var(--border)'}`,
                borderRadius: 8, cursor: 'pointer',
                fontSize: 12, color: hasCustomRange ? 'var(--accent)' : 'var(--text-muted)',
                transition: 'all 0.1s',
              }}
            >
              <Calendar size={12} />
              {calBtnLabel}
              {hasCustomRange && (
                <span
                  onClick={e => { e.stopPropagation(); clearCustomRange() }}
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
                <div style={{ padding: '8px 12px 0', fontSize: 11, color: 'var(--text-muted)' }}>
                  {!rangeStart ? 'Click a start date' : !rangeEnd ? 'Click an end date' : null}
                </div>
                <MiniCalendar
                  rangeStart={rangeStart}
                  rangeEnd={rangeEnd}
                  hoverDate={hoverDate}
                  onDayClick={handleDayClick}
                  onDayHover={setHoverDate}
                  viewYear={calViewYear}
                  viewMonth={calViewMonth}
                  onPrev={prevMonth}
                  onNext={nextMonth}
                />
              </div>
            )}
          </div>

          {/* Bank connect */}
          {connected ? (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 6,
              height: 34, padding: '0 14px',
              background: 'var(--success-dim)', border: '0.5px solid rgba(34,197,94,0.20)',
              borderRadius: 8, fontSize: 13, fontWeight: 500, color: 'var(--success)',
            }}>
              <CheckCircle2 size={14} /> Bank Connected
            </div>
          ) : (
            <button
              onClick={startOnboarding}
              disabled={onboard.isPending}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                height: 34, padding: '0 14px',
                background: 'var(--bg-elevated)',
                border: '0.5px solid var(--border)',
                borderRadius: 8, cursor: onboard.isPending ? 'not-allowed' : 'pointer',
                fontSize: 13, fontWeight: 500,
                color: 'var(--text-secondary)',
                transition: 'border-color 150ms, color 150ms',
              }}
              onMouseEnter={e => { if (!onboard.isPending) { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.color = 'var(--accent)' } }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-secondary)' }}
            >
              {onboard.isPending ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Landmark size={14} />}
              {onboard.isPending ? 'Opening…' : 'Connect Bank'}
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard label="All Time"   value={`$${(kpis.allTime   || 0).toLocaleString()}`} icon={DollarSign}  color="green" />
        <StatCard label="This Month" value={`$${(kpis.thisMonth || 0).toLocaleString()}`} icon={TrendingUp}  color="indigo" />
        <StatCard label="This Week"  value={`$${(kpis.thisWeek  || 0).toLocaleString()}`} icon={BarChart2}   color="blue" />
        <StatCard label="Avg Deal"   value={`$${Math.round(kpis.avgDeal || 0).toLocaleString()}`} icon={Target} color="yellow" />
      </div>

      <Card>
        <p className="text-sm font-medium text-[var(--text-primary)] mb-4">{chartTitle}</p>
        {!chartData.some(d => d.value > 0) ? (
          <p className="text-[var(--text-muted)] text-sm text-center py-8">No closed deals in this period</p>
        ) : (
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 11, fill: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
                axisLine={false} tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 11, fill: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
                axisLine={false} tickLine={false}
                tickFormatter={v => v === 0 ? '$0' : `$${v >= 1000 ? `${(v/1000).toFixed(0)}k` : v}`}
                width={48}
              />
              <Tooltip content={<RevenueTooltip />} />
              <Bar dataKey="value" fill="var(--accent)" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </Card>

      <DealsSection closerId={profile?.id} />
    </div>
  )
}

function DealsSection({ closerId }) {
  const { data: deals = [], isLoading } = useQuery({
    queryKey: ['closer-deals', closerId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('commission_payouts')
        .select('id, amount_cents, status, created_at, appointment:appointments!appointment_id ( lead:leads ( business_name ) )')
        .eq('rep_id', closerId)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data || []
    },
    enabled: !!closerId,
  })

  return (
    <Card style={{ marginTop: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
        <Handshake size={14} style={{ color: 'var(--text-muted)' }} />
        <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', margin: 0 }}>Deals</p>
      </div>
      {isLoading ? (
        <p style={{ fontSize: 13, color: 'var(--text-muted)', textAlign: 'center', padding: '16px 0', margin: 0 }}>Loading…</p>
      ) : deals.length === 0 ? (
        <p style={{ fontSize: 13, color: 'var(--text-muted)', textAlign: 'center', padding: '16px 0', margin: 0 }}>No closed deals yet</p>
      ) : (
        <div>
          {deals.map((d, i) => {
            const biz = d.appointment?.lead?.business_name || '—'
            const payout = d.amount_cents != null ? `$${(d.amount_cents / 100).toLocaleString()}` : '—'
            return (
              <div
                key={d.id}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '10px 0',
                  borderBottom: i < deals.length - 1 ? '0.5px solid var(--border)' : 'none',
                }}
              >
                <span style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 500 }}>{biz}</span>
                <span style={{ fontSize: 13, color: 'var(--success)', fontFamily: 'var(--font-mono)', fontWeight: 500 }}>{payout}</span>
              </div>
            )
          })}
        </div>
      )}
    </Card>
  )
}
