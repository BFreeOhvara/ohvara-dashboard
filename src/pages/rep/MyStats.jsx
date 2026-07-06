import { useState } from 'react'
import { Phone, Calendar, TrendingUp, Clock } from 'lucide-react'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, CartesianGrid } from 'recharts'
import { useAuth } from '../../hooks/useAuth'
import { useRepStats, useRepDailyActivity, useCompletedDays, useTodayCallStats, DAILY_BATCH_TARGET } from '../../hooks/useProfiles'
import { StatCard } from '../../components/ui/StatCard'
import { Button } from '../../components/ui/Button'
import { DayFilterBar, useDayFilter } from '../../components/ui/DayFilterBar'

// Prompt 234: replaced the Day/Week/Month/Custom tabs with the same shared
// single-day DayFilterBar used on Activity Feed/My Calls, plus a standalone
// All Time toggle — only two states now, not five.
const SS_VIEW_MODE = 'ohvara_mystats_view_mode'

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div style={{
      background: '#13131F', border: '0.5px solid var(--border)',
      borderRadius: 8, padding: '8px 12px', boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
    }}>
      <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '0 0 4px' }}>{label}</p>
      {payload.map(p => (
        <p key={p.dataKey} style={{ fontSize: 12, color: p.stroke || p.fill, margin: 0, fontFamily: 'var(--font-mono)' }}>
          {p.name}: {p.value}
        </p>
      ))}
    </div>
  )
}

// ── Completed Days heatmap ────────────────────────────────────────────────
// white (0) → pink → dark red (progress, lerp) → dark red (hit 150) → green (Perfect Day: 150 dials + 2+ bookings)
const RAMP_START = [255, 255, 255]  // white
const RAMP_END = [185, 28, 28]      // dark red — matches the completed/non-perfect cap below

function lerpColor(a, b, t) {
  const ch = (x, y) => Math.round(x + (y - x) * t)
  return `rgb(${ch(a[0], b[0])}, ${ch(a[1], b[1])}, ${ch(a[2], b[2])})`
}

function cellColor(d) {
  if (!d || d.dialed === 0) return lerpColor(RAMP_START, RAMP_END, 0)
  if (d.completed && (d.bookings || 0) >= 2) return 'var(--success)'
  if (d.completed) return lerpColor(RAMP_START, RAMP_END, 1)
  const r = Math.min(d.dialed / DAILY_BATCH_TARGET, 1)
  // Power curve so low dial counts are clearly visible instead of near-white
  // (linear t left e.g. 7/150 at t≈0.05 — barely off white).
  return lerpColor(RAMP_START, RAMP_END, Math.pow(r, 0.4))
}

function CompletedDaysHeatmap({ days }) {
  const sorted = [...(days || [])].sort((a, b) => new Date(a.day) - new Date(b.day))
  const weeks = []
  for (let i = 0; i < sorted.length; i += 7) weeks.push(sorted.slice(i, i + 7))

  return (
    <div className="glass" style={{ marginTop: 20, padding: '18px 20px', borderRadius: 12 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 10 }}>
        <div>
          <p style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-primary)', margin: '0 0 4px' }}>
            Completed Days
          </p>
          <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: 0, lineHeight: 1.5 }}>Completed Day = {DAILY_BATCH_TARGET} dials</p>
          <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: 0, lineHeight: 1.5 }}>Perfect Day = {DAILY_BATCH_TARGET} dials + 2 bookings</p>
        </div>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Last 21 days</span>
      </div>

      {/* heatmap rows: one per week — grid shrunk + centered, cells fill it, square */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, width: '70%', margin: '4px auto 0' }}>
        {weeks.map((wk, wi) => (
          <div key={wi} style={{ display: 'flex', gap: 6, width: '100%' }}>
            {wk.map((d, di) => (
              <div key={di} className="group" style={{ position: 'relative', flex: 1, minWidth: 0, aspectRatio: '1' }}>
                <div
                  style={{
                    width: '100%', height: '100%', borderRadius: 5,
                    background: cellColor(d),
                    border: '0.5px solid rgba(255,255,255,0.06)',
                    transition: 'transform 80ms ease, box-shadow 80ms ease',
                    cursor: 'default',
                  }}
                  className="hover:!shadow-[0_0_0_2px_rgba(108,99,255,0.5)]"
                />
                <div
                  className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 hidden group-hover:block z-20 whitespace-nowrap"
                  style={{
                    background: '#13131F', border: '0.5px solid var(--border)',
                    borderRadius: 8, padding: '6px 9px', boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
                  }}
                >
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{d.label}</span>
                  <span style={{ fontSize: 12, color: d.dialed === 0 ? 'var(--text-secondary)' : (d.completed && (d.bookings || 0) >= 2 ? 'var(--success)' : d.completed ? '#ef4444' : 'rgba(239,68,68,0.7)'), margin: '0 0 0 6px', fontFamily: 'var(--font-mono)' }}>
                    {d.dialed}/{DAILY_BATCH_TARGET}{(d.bookings || 0) > 0 ? ` · ${d.bookings} booked` : ''}
                  </span>
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* legend — swatches call cellColor directly so they can't drift from the actual cells */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14 }}>
        <div style={{ width: 12, height: 12, borderRadius: 3, background: cellColor(null), border: '0.5px solid rgba(255,255,255,0.06)' }} />
        {[0.2, 0.45, 0.7].map(r => (
          <div key={r} style={{ width: 12, height: 12, borderRadius: 3, background: cellColor({ dialed: Math.round(r * DAILY_BATCH_TARGET), completed: false }), border: '0.5px solid rgba(255,255,255,0.06)' }} />
        ))}
        <div style={{ width: 12, height: 12, borderRadius: 3, background: cellColor({ dialed: DAILY_BATCH_TARGET, completed: true, bookings: 0 }) }} />
        <div style={{ width: 12, height: 12, borderRadius: 3, background: cellColor({ dialed: DAILY_BATCH_TARGET, completed: true, bookings: 2 }) }} />
        <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>0 · progress · 150 dials · Perfect Day</span>
      </div>
    </div>
  )
}

export default function MyStats() {
  const { profile } = useAuth()
  const { todayStr, selectedDate, setSelectedDate, firstCallDateStr } = useDayFilter(profile?.id)
  // Defaults to 'day' (today, via useDayFilter) per Brayden: "that's what it's
  // on by default." Only two states now — a specific day, or All Time.
  const [viewMode, setViewMode] = useState(() => sessionStorage.getItem(SS_VIEW_MODE) || 'day')
  const isToday = selectedDate === todayStr

  function selectDay(dateStr) {
    setSelectedDate(dateStr)
    setViewMode('day')
    sessionStorage.setItem(SS_VIEW_MODE, 'day')
  }
  function selectAllTime() {
    setViewMode('all')
    sessionStorage.setItem(SS_VIEW_MODE, 'all')
  }

  // 'day' mode reuses the 'custom' period's {from,to} bounds with the same
  // start/end date — a single-day range — rather than adding a third period type.
  const dayRange = viewMode === 'day' ? { from: selectedDate, to: selectedDate } : null
  const { data: stats, isLoading } = useRepStats(profile?.id, viewMode === 'all' ? 'all' : 'custom', dayRange)
  const { data: daily } = useRepDailyActivity(profile?.id)
  const { data: completedDays } = useCompletedDays(profile?.id, 21)
  const { data: today } = useTodayCallStats(profile?.id)

  // Single source of truth: today's headline numbers come from the same
  // rep_today_metrics RPC as the My Leads KPIs, so "Total Dials" here ===
  // "Calls Today" on My Leads exactly. Only applies when the selected day is
  // actually today — a past day falls through to the plain scoped query.
  const display = viewMode === 'day' && isToday && today
    ? { totalDials: today.calls, bookedCount: today.booked, bookingRate: String(today.bookingRate), avgCallDuration: stats?.avgCallDuration }
    : stats

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-medium text-[var(--text-primary)]">My Stats</h1>
          <p className="text-[var(--text-muted)] text-sm mt-0.5">Your personal performance metrics</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant={viewMode === 'all' ? 'primary' : 'ghost'}
            size="sm"
            onClick={selectAllTime}
          >
            All Time
          </Button>
          <div style={{ opacity: viewMode === 'all' ? 0.5 : 1, transition: 'opacity 0.1s' }}>
            <DayFilterBar
              selectedDate={selectedDate}
              todayStr={todayStr}
              onChange={selectDay}
              firstCallDateStr={firstCallDateStr}
            />
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-24 rounded-[10px] bg-[var(--bg-1)] border border-[var(--border)] animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard label="Total Dials" value={display?.totalDials ?? 0} icon={Phone} color="indigo" />
          <StatCard label="Booked" value={display?.bookedCount ?? 0} icon={Calendar} color="green" />
          <StatCard
            label="Booking Rate"
            value={`${display?.bookingRate ?? '0'}%`}
            icon={TrendingUp}
            color="blue"
          />
          <StatCard
            label="Avg Call Duration"
            value={formatDuration(display?.avgCallDuration)}
            icon={Clock}
            color="yellow"
          />
        </div>
      )}

      {/* Past 7 days — daily calls + bookings */}
      <div className="glass" style={{ marginTop: 20, padding: '18px 20px', borderRadius: 12 }}>
        <p style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-primary)', margin: '0 0 2px' }}>
          Last 7 Days
        </p>
        <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '0 0 14px' }}>
          Daily calls and appointments booked
        </p>
        {/* Stock-style chart: smooth lines with gradient fills below */}
        <div style={{ width: '100%', height: 240 }}>
          <ResponsiveContainer>
            <AreaChart data={daily || []}>
              <defs>
                <linearGradient id="gradCalls" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#6C63FF" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="#6C63FF" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gradBookings" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#22C55E" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="#22C55E" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 11, fill: 'var(--text-muted)' }}
                axisLine={{ stroke: 'var(--border)' }}
                tickLine={false}
              />
              <YAxis
                allowDecimals={false}
                tick={{ fontSize: 11, fill: 'var(--text-muted)' }}
                axisLine={false}
                tickLine={false}
                width={28}
              />
              <Tooltip content={<ChartTooltip />} cursor={{ stroke: 'rgba(255,255,255,0.15)', strokeDasharray: '3 3' }} />
              <Legend
                wrapperStyle={{ fontSize: 12, color: 'var(--text-secondary)' }}
                iconType="circle"
                iconSize={8}
              />
              <Area
                type="monotone"
                dataKey="calls"
                name="Calls"
                stroke="#6C63FF"
                strokeWidth={2}
                fill="url(#gradCalls)"
                dot={false}
                activeDot={{ r: 4, strokeWidth: 0 }}
                animationDuration={700}
                animationEasing="ease-out"
              />
              <Area
                type="monotone"
                dataKey="bookings"
                name="Bookings"
                stroke="#22C55E"
                strokeWidth={2}
                fill="url(#gradBookings)"
                dot={false}
                activeDot={{ r: 4, strokeWidth: 0 }}
                animationDuration={700}
                animationEasing="ease-out"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Completed days — color-graded heatmap (leads dialed vs the 150 target) */}
      <CompletedDaysHeatmap days={completedDays} />
    </div>
  )
}

function formatDuration(seconds) {
  if (!seconds) return '0s'
  if (seconds < 60) return `${seconds}s`
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}
