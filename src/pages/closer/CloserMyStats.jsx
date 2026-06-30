import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { StatCard } from '../../components/ui/StatCard'
import { Card } from '../../components/ui/Card'
import { Target, TrendingUp, CheckCircle, BarChart2 } from 'lucide-react'
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid,
} from 'recharts'

const FILTER_TABS = ['Day', 'Week', 'Month']

function getWindowStart(filter) {
  const now = new Date()
  if (filter === 'Day') return new Date(now.getFullYear(), now.getMonth(), now.getDate())
  if (filter === 'Week') {
    const d = new Date(now)
    d.setHours(0, 0, 0, 0)
    d.setDate(d.getDate() - d.getDay()) // Sunday
    return d
  }
  // Month
  return new Date(now.getFullYear(), now.getMonth(), 1)
}


function CloseRateTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div style={{
      background: '#13131F', border: '0.5px solid var(--border)',
      borderRadius: 8, padding: '8px 12px',
      boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
    }}>
      <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>{label}</p>
      <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--accent)', fontFamily: 'var(--font-mono)' }}>
        {payload[0]?.value ?? 0}%
      </p>
    </div>
  )
}

function useCloserRawData(closerId) {
  return useQuery({
    queryKey: ['closer-stats-raw', closerId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('appointments')
        .select('outcome, deal_value, created_at')
        .eq('closer_id', closerId)
        .not('outcome', 'is', null)
      if (error) throw error
      return data || []
    },
    enabled: !!closerId,
  })
}

function useCloserCommissions(closerId) {
  return useQuery({
    queryKey: ['commissions', 'closer', closerId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('commissions')
        .select('amount, created_at')
        .eq('recipient_id', closerId)
        .neq('status', 'voided')
      if (error) throw error
      return data || []
    },
    enabled: !!closerId,
  })
}

export default function CloserMyStats() {
  const { profile } = useAuth()
  const [filter, setFilter] = useState('Day')
  const { data: raw = [] } = useCloserRawData(profile?.id)

  const windowStart = useMemo(() => getWindowStart(filter), [filter])

  const windowData = useMemo(() => {
    return raw.filter(a => new Date(a.created_at) >= windowStart)
  }, [raw, windowStart])

  const stats = useMemo(() => {
    const closed = windowData.filter(a => a.outcome === 'closed')
    const lost   = windowData.filter(a => a.outcome === 'lost')
    const noShow = windowData.filter(a => a.outcome === 'no_show')
    const total  = closed.length + lost.length + noShow.length
    return {
      closeRate: (closed.length + lost.length) > 0
        ? ((closed.length / (closed.length + lost.length)) * 100).toFixed(1)
        : '0',
      showRate: total > 0
        ? (((closed.length + lost.length) / total) * 100).toFixed(1)
        : '0',
      dealsClosed: closed.length,
      avgDeal: closed.length ? closed.reduce((s, a) => s + (a.deal_value || 0), 0) / closed.length : 0,
    }
  }, [windowData])

  // Chart: last 7 calendar days — independent of filter
  const chartData = useMemo(() => {
    const now = new Date()
    return Array.from({ length: 7 }, (_, i) => {
      const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (6 - i))
      const dayEnd   = new Date(dayStart.getTime() + 86400000)
      const dayAll    = raw.filter(a => { const d = new Date(a.created_at); return d >= dayStart && d < dayEnd && (a.outcome === 'closed' || a.outcome === 'lost') })
      const dayClosed = raw.filter(a => { const d = new Date(a.created_at); return d >= dayStart && d < dayEnd && a.outcome === 'closed' })
      return {
        label: ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][dayStart.getDay()],
        rate: dayAll.length ? Math.round((dayClosed.length / dayAll.length) * 100) : 0,
      }
    })
  }, [raw])

  const windowCommission = useMemo(
    () => Math.round(windowData.filter(a => a.outcome === 'closed').reduce((s, a) => s + (a.deal_value || 0), 0) * 0.45),
    [windowData]
  )
  const hasChartData = chartData.some(d => d.rate > 0)

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24, gap: 16, flexWrap: 'wrap' }}>
        <div>
          <h1 className="text-xl font-medium text-[var(--text-primary)]">My Stats</h1>
          <p className="text-[var(--text-muted)] text-sm mt-0.5">Your close rate, deal outcomes, and commission earned</p>
        </div>
        {/* Day / Week / Month filter */}
        <div style={{
          display: 'flex', gap: 2,
          background: 'var(--bg-surface)', border: '0.5px solid var(--border)',
          borderRadius: 8, padding: 3,
        }}>
          {FILTER_TABS.map(t => (
            <button
              key={t}
              onClick={() => setFilter(t)}
              style={{
                height: 28, padding: '0 14px',
                background: filter === t ? 'var(--bg-elevated)' : 'transparent',
                border: 'none', borderRadius: 6,
                fontSize: 12, fontWeight: filter === t ? 500 : 400,
                color: filter === t ? 'var(--text-primary)' : 'var(--text-muted)',
                cursor: 'pointer', transition: 'all 0.1s',
                boxShadow: filter === t ? '0 1px 4px rgba(0,0,0,0.2)' : 'none',
              }}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard label="Close Rate"  value={`${stats.closeRate}%`}  icon={Target}     color="indigo" />
        <StatCard label="Show Rate"   value={`${stats.showRate}%`}   icon={TrendingUp} color="blue" />
        <StatCard label="Deals Closed" value={stats.dealsClosed}     icon={CheckCircle} color="green" />
        <StatCard label="Avg Deal"    value={stats.avgDeal ? `$${Math.round(stats.avgDeal).toLocaleString()}` : '—'} icon={BarChart2} color="yellow" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        <Card>
          <p className="text-sm font-medium text-[var(--text-primary)] mb-4">
            Close Rate — Last 7 Days
          </p>
          {!hasChartData ? (
            <p className="text-[var(--text-muted)] text-sm text-center py-8">No closed outcomes yet</p>
          ) : (
            <ResponsiveContainer width="100%" height={160}>
              <AreaChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="closeRateGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="var(--accent)" stopOpacity={0.20} />
                    <stop offset="95%" stopColor="var(--accent)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 11, fill: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
                  axisLine={false} tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
                  axisLine={false} tickLine={false}
                  tickFormatter={v => `${v}%`}
                  width={40}
                />
                <Tooltip content={<CloseRateTooltip />} />
                <Area
                  type="monotone"
                  dataKey="rate"
                  stroke="var(--accent)"
                  strokeWidth={2}
                  fill="url(#closeRateGrad)"
                  dot={false}
                  activeDot={{ r: 4, fill: 'var(--accent)', strokeWidth: 0 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </Card>

        <Card>
          <p className="text-sm font-medium text-[var(--text-primary)] mb-4">Earnings Summary</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Total revenue closed</span>
              <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--success)', fontFamily: 'var(--font-mono)' }}>
                ${(windowData.filter(a => a.outcome === 'closed').reduce((s, a) => s + (a.deal_value || 0), 0)).toLocaleString()}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Deals closed</span>
              <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>
                {windowData.filter(a => a.outcome === 'closed').length}
              </span>
            </div>
            <div style={{ height: '0.5px', background: 'var(--border)' }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Commission earned</span>
              <span style={{ fontSize: 16, fontWeight: 600, color: 'var(--accent)', fontFamily: 'var(--font-mono)' }}>
                ${windowCommission.toLocaleString()}
              </span>
            </div>
          </div>
        </Card>
      </div>
    </div>
  )
}
