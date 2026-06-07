import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { StatCard } from '../../components/ui/StatCard'
import { Card } from '../../components/ui/Card'
import { DollarSign, TrendingUp, BarChart2, Target } from 'lucide-react'

export default function RevenueTracker() {
  const { profile } = useAuth()

  const { data: revenue } = useQuery({
    queryKey: ['revenue', profile?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('appointments')
        .select('deal_value, outcome, updated_at')
        .eq('closer_id', profile.id)
        .eq('outcome', 'closed')
      if (error) throw error

      const now = new Date()
      const weekAgo = new Date(now - 7 * 86400000)
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)

      const all = data || []
      const week = all.filter(d => new Date(d.updated_at) >= weekAgo)
      const month = all.filter(d => new Date(d.updated_at) >= monthStart)

      const sum = arr => arr.reduce((s, d) => s + (d.deal_value || 0), 0)
      const avg = arr => arr.length ? sum(arr) / arr.length : 0

      // Weekly breakdown for chart (last 8 weeks)
      const weeks = []
      for (let i = 7; i >= 0; i--) {
        const start = new Date(now - (i + 1) * 7 * 86400000)
        const end = new Date(now - i * 7 * 86400000)
        const wDeals = all.filter(d => {
          const dt = new Date(d.updated_at)
          return dt >= start && dt < end
        })
        weeks.push({ label: `W${8 - i}`, value: sum(wDeals), count: wDeals.length })
      }

      return {
        allTime: sum(all),
        thisMonth: sum(month),
        thisWeek: sum(week),
        avgDeal: avg(all),
        totalDeals: all.length,
        weeklyChart: weeks,
      }
    },
    enabled: !!profile?.id,
  })

  const maxVal = Math.max(...(revenue?.weeklyChart?.map(w => w.value) || [1]), 1)

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-[var(--text-primary)]">Revenue Tracker</h1>
        <p className="text-[var(--text-muted)] text-sm mt-0.5">Your closed revenue across all time</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard label="All Time" value={`$${(revenue?.allTime || 0).toLocaleString()}`} icon={DollarSign} color="green" />
        <StatCard label="This Month" value={`$${(revenue?.thisMonth || 0).toLocaleString()}`} icon={TrendingUp} color="indigo" />
        <StatCard label="This Week" value={`$${(revenue?.thisWeek || 0).toLocaleString()}`} icon={BarChart2} color="blue" />
        <StatCard label="Avg Deal" value={`$${Math.round(revenue?.avgDeal || 0).toLocaleString()}`} icon={Target} color="yellow" />
      </div>

      <Card>
        <p className="text-sm font-semibold text-[var(--text-primary)] mb-4">Weekly Revenue (last 8 weeks)</p>
        {!revenue?.weeklyChart?.length ? (
          <p className="text-[var(--text-muted)] text-sm text-center py-8">No closed deals yet</p>
        ) : (
          <div className="flex items-end gap-2 h-40">
            {revenue.weeklyChart.map((w, i) => (
              <div key={i} className="flex-1 flex flex-col items-center gap-1">
                <div
                  className="w-full bg-indigo-600 rounded-t-sm transition-all"
                  style={{ height: `${(w.value / maxVal) * 120}px`, minHeight: w.value > 0 ? '4px' : '0' }}
                />
                <p className="text-xs text-[var(--text-muted)]">{w.label}</p>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}
