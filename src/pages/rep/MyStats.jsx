import { useState } from 'react'
import { Phone, Calendar, TrendingUp, Clock } from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import { useAuth } from '../../hooks/useAuth'
import { useRepStats, useRepDailyActivity } from '../../hooks/useProfiles'
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
        <p key={p.dataKey} style={{ fontSize: 12, color: p.fill, margin: 0, fontFamily: 'var(--font-mono)' }}>
          {p.name}: {p.value}
        </p>
      ))}
    </div>
  )
}

export default function MyStats() {
  const { profile } = useAuth()
  // Period selection survives tab switches via sessionStorage
  const [period, setPeriod] = useState(() => sessionStorage.getItem(SS_PERIOD) || 'week')
  const { data: stats, isLoading } = useRepStats(profile?.id, period)
  const { data: daily } = useRepDailyActivity(profile?.id)

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
          <StatCard label="Total Dials" value={stats?.totalDials ?? 0} icon={Phone} color="indigo" />
          <StatCard label="Booked" value={stats?.bookedCount ?? 0} icon={Calendar} color="green" />
          <StatCard
            label="Booking Rate"
            value={`${stats?.bookingRate ?? '0'}%`}
            icon={TrendingUp}
            color="blue"
          />
          <StatCard
            label="Avg Call Duration"
            value={formatDuration(stats?.avgCallDuration)}
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
        <div style={{ width: '100%', height: 240 }}>
          <ResponsiveContainer>
            <BarChart data={daily || []} barGap={4}>
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
              <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
              <Legend
                wrapperStyle={{ fontSize: 12, color: 'var(--text-secondary)' }}
                iconType="circle"
                iconSize={8}
              />
              <Bar
                dataKey="calls"
                name="Calls"
                fill="#6C63FF"
                radius={[4, 4, 0, 0]}
                animationDuration={700}
                animationEasing="ease-out"
              />
              <Bar
                dataKey="bookings"
                name="Bookings"
                fill="#22C55E"
                radius={[4, 4, 0, 0]}
                animationDuration={700}
                animationEasing="ease-out"
              />
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
