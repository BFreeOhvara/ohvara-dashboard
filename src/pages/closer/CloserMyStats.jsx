import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { StatCard } from '../../components/ui/StatCard'
import { Card } from '../../components/ui/Card'
import { Target, TrendingUp, CheckCircle, BarChart2 } from 'lucide-react'

function useCloserStats(closerId) {
  return useQuery({
    queryKey: ['closer-stats', closerId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('appointments')
        .select('outcome, deal_value, updated_at')
        .eq('closer_id', closerId)
        .not('outcome', 'is', null)
      if (error) throw error

      const all = data || []
      const closed = all.filter(a => a.outcome === 'closed')
      const lost   = all.filter(a => a.outcome === 'lost')
      const noShow = all.filter(a => a.outcome === 'no_show')

      const totalOutcomes = closed.length + lost.length + noShow.length
      const closeRate = (closed.length + lost.length) > 0
        ? ((closed.length / (closed.length + lost.length)) * 100).toFixed(1)
        : '0'
      const showRate = totalOutcomes > 0
        ? (((closed.length + lost.length) / totalOutcomes) * 100).toFixed(1)
        : '0'

      const revenue = closed.reduce((s, a) => s + (a.deal_value || 0), 0)
      const avgDeal = closed.length ? revenue / closed.length : 0

      // Last 8 weeks weekly bar chart
      const now = new Date()
      const weeks = []
      for (let i = 7; i >= 0; i--) {
        const start = new Date(now - (i + 1) * 7 * 86400000)
        const end   = new Date(now - i * 7 * 86400000)
        const wClosed = closed.filter(a => {
          const dt = new Date(a.updated_at)
          return dt >= start && dt < end
        })
        const wTotal = all.filter(a => {
          const dt = new Date(a.updated_at)
          return dt >= start && dt < end && (a.outcome === 'closed' || a.outcome === 'lost')
        })
        weeks.push({
          label: `W${8 - i}`,
          rate: wTotal.length ? Math.round((wClosed.length / wTotal.length) * 100) : 0,
          count: wClosed.length,
        })
      }

      return { closeRate, showRate, dealsClosed: closed.length, avgDeal, revenue, weeks }
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
        .select('amount')
        .eq('recipient_id', closerId)
        .neq('status', 'voided')
      if (error) throw error
      return (data || []).reduce((s, c) => s + Number(c.amount || 0), 0)
    },
    enabled: !!closerId,
  })
}

export default function CloserMyStats() {
  const { profile } = useAuth()
  const { data: stats } = useCloserStats(profile?.id)
  const { data: totalCommission } = useCloserCommissions(profile?.id)

  const maxRate = Math.max(...(stats?.weeks?.map(w => w.rate) || [1]), 1)

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-medium text-[var(--text-primary)]">My Stats</h1>
        <p className="text-[var(--text-muted)] text-sm mt-0.5">Your close rate, deal outcomes, and commission earned</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard
          label="Close Rate"
          value={`${stats?.closeRate ?? '—'}%`}
          icon={Target}
          color="indigo"
        />
        <StatCard
          label="Show Rate"
          value={`${stats?.showRate ?? '—'}%`}
          icon={TrendingUp}
          color="blue"
        />
        <StatCard
          label="Deals Closed"
          value={stats?.dealsClosed ?? '—'}
          icon={CheckCircle}
          color="green"
        />
        <StatCard
          label="Avg Deal"
          value={stats?.avgDeal != null ? `$${Math.round(stats.avgDeal).toLocaleString()}` : '—'}
          icon={BarChart2}
          color="yellow"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        <Card>
          <p className="text-sm font-medium text-[var(--text-primary)] mb-4">Weekly Close Rate (last 8 weeks)</p>
          {!stats?.weeks?.length || stats.weeks.every(w => w.rate === 0) ? (
            <p className="text-[var(--text-muted)] text-sm text-center py-8">No closed outcomes yet</p>
          ) : (
            <div className="flex items-end gap-2 h-36">
              {stats.weeks.map((w, i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-1">
                  <p style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{w.rate > 0 ? `${w.rate}%` : ''}</p>
                  <div
                    className="w-full bg-[var(--accent)] rounded-t-sm transition-all"
                    style={{ height: `${(w.rate / maxRate) * 100}px`, minHeight: w.rate > 0 ? '4px' : '0' }}
                  />
                  <p className="text-xs text-[var(--text-muted)]">{w.label}</p>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card>
          <p className="text-sm font-medium text-[var(--text-primary)] mb-4">Earnings Summary</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Total revenue closed</span>
              <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--success)', fontFamily: 'var(--font-mono)' }}>
                ${(stats?.revenue || 0).toLocaleString()}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Deals closed</span>
              <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>
                {stats?.dealsClosed ?? 0}
              </span>
            </div>
            <div style={{ height: '0.5px', background: 'var(--border)' }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Commission earned</span>
              <span style={{ fontSize: 16, fontWeight: 600, color: 'var(--accent)', fontFamily: 'var(--font-mono)' }}>
                ${(totalCommission || 0).toLocaleString()}
              </span>
            </div>
          </div>
        </Card>
      </div>
    </div>
  )
}
