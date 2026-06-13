import { useState } from 'react'
import { Phone, Calendar, TrendingUp, Clock, Check } from 'lucide-react'
import { AreaChart, Area, BarChart, Bar, Cell, ReferenceLine, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, CartesianGrid } from 'recharts'
import { useAuth } from '../../hooks/useAuth'
import { useRepStats, useRepDailyActivity, useCompletedDays, useTodayCallStats, DAILY_BATCH_TARGET } from '../../hooks/useProfiles'
import { StatCard } from '../../components/ui/StatCard'
import { Button } from '../../components/ui/Button'

const PERIODS = ['day', 'week', 'month']
const SS_PERIOD = 'ohvara_mystats_period'

// Daily goals for the gamified completion module (matches MyGoals Daily tab:
// 150 dials / 3 bookings; 10% booking rate is the "above target" line on My Leads)
const DAILY_GOALS = { dials: DAILY_BATCH_TARGET, booked: 3, rate: 10 }

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

// Gamified daily-completion module — each daily goal flips to a satisfying
// completed state (success glow + checkmark) the moment live data clears it.
// Tied to the same single source (useTodayCallStats) as every other surface.
function DailyGoals({ today }) {
  const items = [
    { key: 'dials',  label: 'Daily Dials',  value: today?.calls ?? 0,       goal: DAILY_GOALS.dials,  icon: Phone,      suffix: '' },
    { key: 'booked', label: 'Booked',       value: today?.booked ?? 0,      goal: DAILY_GOALS.booked, icon: Calendar,   suffix: '' },
    { key: 'rate',   label: 'Booking Rate', value: today?.bookingRate ?? 0, goal: DAILY_GOALS.rate,   icon: TrendingUp, suffix: '%' },
  ]
  const metCount = items.filter(i => i.value >= i.goal).length

  return (
    <div className="glass" style={{ marginTop: 20, padding: '18px 20px', borderRadius: 12 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 14 }}>
        <div>
          <p style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-primary)', margin: '0 0 2px' }}>Today's Goals</p>
          <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: 0 }}>Clear all three to complete the day</p>
        </div>
        <span style={{
          fontSize: 11, fontFamily: 'var(--font-mono)', fontWeight: 600,
          color: metCount === items.length ? 'var(--success)' : 'var(--text-secondary)',
          background: metCount === items.length ? 'rgba(34,197,94,0.12)' : 'var(--bg-elevated)',
          border: `0.5px solid ${metCount === items.length ? 'rgba(34,197,94,0.3)' : 'var(--border)'}`,
          borderRadius: 20, padding: '3px 10px',
        }}>
          {metCount === items.length ? '✦ Day complete' : `${metCount} / ${items.length} cleared`}
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
        {items.map(it => {
          const done = it.value >= it.goal
          const pct = Math.min((it.value / it.goal) * 100, 100)
          const Icon = it.icon
          return (
            <div key={it.key} style={{
              position: 'relative', overflow: 'hidden',
              background: done ? 'rgba(34,197,94,0.07)' : 'var(--bg-surface)',
              border: `0.5px solid ${done ? 'rgba(34,197,94,0.35)' : 'var(--border)'}`,
              borderRadius: 10, padding: '14px 14px',
              transition: 'background 0.4s ease, border-color 0.4s ease',
              boxShadow: done ? '0 0 0 1px rgba(34,197,94,0.15), 0 4px 16px rgba(34,197,94,0.08)' : 'none',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <Icon size={15} color={done ? 'var(--success)' : 'var(--text-muted)'} />
                <div style={{
                  width: 20, height: 20, borderRadius: '50%', flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: done ? 'var(--success)' : 'var(--bg-elevated)',
                  border: done ? 'none' : '0.5px solid var(--border)',
                  transition: 'all 0.3s ease', transform: done ? 'scale(1)' : 'scale(0.85)',
                }}>
                  {done && <Check size={12} color="white" />}
                </div>
              </div>
              <p style={{ fontSize: 20, fontWeight: 600, color: done ? 'var(--success)' : 'var(--text-primary)', margin: 0, fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.02em' }}>
                {it.value}{it.suffix}<span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 400 }}> / {it.goal}{it.suffix}</span>
              </p>
              <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '2px 0 10px' }}>{it.label}</p>
              <div style={{ height: 5, background: 'var(--bg-elevated)', borderRadius: 3, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${pct}%`, background: done ? 'var(--success)' : 'var(--accent)', borderRadius: 3, transition: 'width 0.5s ease' }} />
              </div>
            </div>
          )
        })}
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
  const completedCount = (completedDays || []).filter(d => d.completed).length

  // Single source of truth: the Day view's headline numbers come from the
  // same rep_today_metrics RPC as the My Leads KPIs and the goals module, so
  // "Total Dials" on Day === "Calls Today" on My Leads exactly.
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

      {/* Gamified daily completion — live from the single-source today RPC */}
      <DailyGoals today={today} />

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

      {/* Completed days — full daily batch worked (leads dialed vs the 150 target) */}
      <div className="glass" style={{ marginTop: 20, padding: '18px 20px', borderRadius: 12 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
          <div>
            <p style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-primary)', margin: '0 0 2px' }}>
              Completed Days
            </p>
            <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '0 0 14px' }}>
              Days you worked the full {DAILY_BATCH_TARGET}-lead batch — green bars cleared the line
            </p>
          </div>
          <p style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: completedCount > 0 ? 'var(--success)' : 'var(--text-muted)', margin: 0 }}>
            {completedCount} of {completedDays?.length ?? 21} days completed
          </p>
        </div>
        <div style={{ width: '100%', height: 200 }}>
          <ResponsiveContainer>
            <BarChart data={completedDays || []}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
                axisLine={{ stroke: 'var(--border)' }}
                tickLine={false}
                interval={2}
              />
              <YAxis
                allowDecimals={false}
                domain={[0, DAILY_BATCH_TARGET]}
                tick={{ fontSize: 11, fill: 'var(--text-muted)' }}
                axisLine={false}
                tickLine={false}
                width={32}
              />
              <Tooltip
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null
                  const d = payload[0].payload
                  return (
                    <div style={{
                      background: '#13131F', border: '0.5px solid var(--border)',
                      borderRadius: 8, padding: '8px 12px', boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
                    }}>
                      <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '0 0 4px' }}>{label}</p>
                      <p style={{ fontSize: 12, color: d.completed ? 'var(--success)' : 'var(--text-secondary)', margin: 0, fontFamily: 'var(--font-mono)' }}>
                        {d.dialed} / {DAILY_BATCH_TARGET} leads{d.completed ? ' ✓ complete' : ''}
                      </p>
                    </div>
                  )
                }}
                cursor={{ fill: 'rgba(255,255,255,0.04)' }}
              />
              <ReferenceLine y={DAILY_BATCH_TARGET} stroke="#22C55E" strokeDasharray="4 4" strokeOpacity={0.5} />
              <Bar dataKey="dialed" name="Leads dialed" radius={[3, 3, 0, 0]} animationDuration={700} animationEasing="ease-out">
                {(completedDays || []).map((d, i) => (
                  <Cell key={i} fill={d.completed ? '#22C55E' : 'rgba(108,99,255,0.45)'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  )
}

function formatDuration(seconds) {
  if (!seconds) return '0s'
  if (seconds < 60) return `${seconds}s`
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}
