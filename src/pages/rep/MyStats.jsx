import { useState } from 'react'
import { Phone, Calendar, TrendingUp, Clock } from 'lucide-react'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, CartesianGrid } from 'recharts'
import { useAuth } from '../../hooks/useAuth'
import { useRepStats, useRepDailyActivity, useCompletedDays, useTodayCallStats, DAILY_BATCH_TARGET } from '../../hooks/useProfiles'
import { StatCard } from '../../components/ui/StatCard'
import { Button } from '../../components/ui/Button'

const PERIODS = ['day', 'week', 'month']
const SS_PERIOD = 'ohvara_mystats_period'

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
// GitHub-contribution-style grid: one cell per day, colour intensity scales
// with dials vs the 150 target. Colourblind-safe — the tooltip always states
// the count + letter grade (never hue alone), and grade chips back the colour.
const GRADE_BANDS = [
  { min: 1.0, grade: 'A' },
  { min: 0.8, grade: 'B' },
  { min: 0.6, grade: 'C' },
  { min: 0.4, grade: 'D' },
  { min: 0,   grade: 'F' },
]
function gradeFor(ratio) {
  return (GRADE_BANDS.find(b => ratio >= b.min) || GRADE_BANDS[GRADE_BANDS.length - 1]).grade
}
function cellColor(d) {
  if (!d || d.dialed === 0) return 'var(--bg-elevated)'
  if (d.completed) return 'var(--success)' // cleared the 150 line
  const r = Math.min(d.dialed / DAILY_BATCH_TARGET, 1)
  return `rgba(108,99,255,${(0.18 + r * 0.55).toFixed(3)})` // indigo intensity ramp
}
const GRADE_CHIP = {
  A: { color: 'var(--success)',   bg: 'rgba(34,197,94,0.12)',  bd: 'rgba(34,197,94,0.3)' },
  B: { color: 'var(--accent)',    bg: 'rgba(108,99,255,0.14)', bd: 'rgba(108,99,255,0.35)' },
  C: { color: 'var(--text-secondary)', bg: 'var(--bg-elevated)', bd: 'var(--border)' },
  D: { color: 'var(--warning)',   bg: 'rgba(245,158,11,0.12)', bd: 'rgba(245,158,11,0.3)' },
  F: { color: 'var(--danger)',    bg: 'rgba(239,68,68,0.10)',  bd: 'rgba(239,68,68,0.28)' },
}

function CompletedDaysHeatmap({ days }) {
  const sorted = [...(days || [])].sort((a, b) => new Date(a.day) - new Date(b.day))
  const completedCount = sorted.filter(d => d.completed).length
  // bucket into weeks of 7, oldest first
  const weeks = []
  for (let i = 0; i < sorted.length; i += 7) weeks.push(sorted.slice(i, i + 7))
  // week-over-week trend on average dials (last 7 vs previous 7)
  const avg = arr => (arr.length ? arr.reduce((s, d) => s + d.dialed, 0) / arr.length : 0)
  const recentAvg = avg(sorted.slice(-7))
  const prevAvg = avg(sorted.slice(-14, -7))
  const delta = recentAvg - prevAvg
  const trendPct = prevAvg > 0 ? Math.round((delta / prevAvg) * 100) : (recentAvg > 0 ? 100 : 0)
  const up = delta >= 0

  const weekGrade = wk => {
    if (!wk.length) return 'F'
    const ratio = wk.reduce((s, d) => s + d.dialed, 0) / (DAILY_BATCH_TARGET * wk.length)
    return gradeFor(ratio)
  }

  return (
    <div className="glass" style={{ marginTop: 20, padding: '18px 20px', borderRadius: 12 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <p style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-primary)', margin: '0 0 2px' }}>
            Completed Days
          </p>
          <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '0 0 14px' }}>
            Each cell is a day — darker means closer to the {DAILY_BATCH_TARGET}-lead target; green cleared it
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {prevAvg > 0 && (
            <span title="This week's avg dials vs last week's" style={{
              fontSize: 11, fontFamily: 'var(--font-mono)', fontWeight: 600,
              color: up ? 'var(--success)' : 'var(--danger)',
              background: up ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.10)',
              border: `0.5px solid ${up ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.28)'}`,
              borderRadius: 20, padding: '3px 9px',
            }}>
              {up ? '↑' : '↓'} {Math.abs(trendPct)}% vs last wk
            </span>
          )}
          <p style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: completedCount > 0 ? 'var(--success)' : 'var(--text-muted)', margin: 0 }}>
            {completedCount} of {sorted.length || 21} days completed
          </p>
        </div>
      </div>

      {/* heatmap rows: one per week, with a trailing week-grade chip */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
        {weeks.map((wk, wi) => {
          const g = weekGrade(wk)
          const chip = GRADE_CHIP[g]
          return (
            <div key={wi} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ display: 'flex', gap: 6 }}>
                {wk.map((d, di) => {
                  const ratio = Math.min(d.dialed / DAILY_BATCH_TARGET, 1)
                  return (
                    <div key={di} className="group" style={{ position: 'relative' }}>
                      <div
                        style={{
                          width: 24, height: 24, borderRadius: 5,
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
                        <span style={{ fontSize: 12, color: cellColor(d) === 'var(--bg-elevated)' ? 'var(--text-secondary)' : (d.completed ? 'var(--success)' : 'var(--accent)'), margin: '0 0 0 6px', fontFamily: 'var(--font-mono)' }}>
                          {d.dialed}/{DAILY_BATCH_TARGET} · {gradeFor(ratio)}
                        </span>
                      </div>
                    </div>
                  )
                })}
              </div>
              <span title="Week grade" style={{
                fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: 700,
                color: chip.color, background: chip.bg, border: `0.5px solid ${chip.bd}`,
                borderRadius: 5, padding: '2px 7px', lineHeight: 1.4,
              }}>
                {g}
              </span>
            </div>
          )
        })}
      </div>

      {/* legend */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14 }}>
        <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Less</span>
        {[0, 0.35, 0.6, 0.85].map((r, i) => (
          <div key={i} style={{ width: 12, height: 12, borderRadius: 3, background: r === 0 ? 'var(--bg-elevated)' : `rgba(108,99,255,${(0.18 + r * 0.55).toFixed(3)})`, border: '0.5px solid rgba(255,255,255,0.06)' }} />
        ))}
        <div style={{ width: 12, height: 12, borderRadius: 3, background: 'var(--success)' }} title="Hit the 150 target" />
        <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>More · green = target hit</span>
      </div>
    </div>
  )
}

export default function MyStats() {
  const { profile } = useAuth()
  // Period selection survives tab switches via sessionStorage — Day is the default view
  const [period, setPeriod] = useState(() => sessionStorage.getItem(SS_PERIOD) || 'day')
  const { data: stats, isLoading } = useRepStats(profile?.id, period)
  const { data: daily } = useRepDailyActivity(profile?.id)
  const { data: completedDays } = useCompletedDays(profile?.id, 21)
  const { data: today } = useTodayCallStats(profile?.id)

  // Single source of truth: the Day view's headline numbers come from the
  // same rep_today_metrics RPC as the My Leads KPIs, so "Total Dials" on Day
  // === "Calls Today" on My Leads exactly.
  const display = period === 'day' && today
    ? { totalDials: today.calls, bookedCount: today.booked, bookingRate: String(today.bookingRate), avgCallDuration: stats?.avgCallDuration }
    : stats

  function changePeriod(p) {
    setPeriod(p)
    sessionStorage.setItem(SS_PERIOD, p)
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-medium text-[var(--text-primary)]">My Stats</h1>
          <p className="text-[var(--text-muted)] text-sm mt-0.5">Your personal performance metrics</p>
        </div>
        <div className="flex gap-1">
          {PERIODS.map(p => (
            <Button
              key={p}
              variant={period === p ? 'primary' : 'ghost'}
              size="sm"
              onClick={() => changePeriod(p)}
            >
              {p.charAt(0).toUpperCase() + p.slice(1)}
            </Button>
          ))}
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
