import { useState } from 'react'
import { useReps, useRepStats } from '../../hooks/useProfiles'
import { Button } from '../../components/ui/Button'
import { Badge } from '../../components/ui/Badge'
import { Card } from '../../components/ui/Card'
import { Phone, Calendar, TrendingUp, Clock } from 'lucide-react'

const PERIODS = ['day', 'week', 'month']

export default function RepPerformance() {
  const { data: reps, isLoading } = useReps()
  const [period, setPeriod] = useState('week')

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-medium text-[var(--text-primary)]">Rep Performance</h1>
          <p className="text-[var(--text-muted)] text-sm mt-0.5">Per-rep analytics filterable by period</p>
        </div>
        <div className="flex gap-1">
          {PERIODS.map(p => (
            <Button key={p} variant={period === p ? 'primary' : 'ghost'} size="sm" onClick={() => setPeriod(p)}>
              {p.charAt(0).toUpperCase() + p.slice(1)}
            </Button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-28 bg-[var(--bg-1)] border border-[var(--border)] rounded-[10px] animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="space-y-4">
          {(reps || []).map(rep => (
            <RepPerformanceRow key={rep.id} rep={rep} period={period} />
          ))}
        </div>
      )}
    </div>
  )
}

function RepPerformanceRow({ rep, period }) {
  const { data: stats } = useRepStats(rep.id, period)

  return (
    <Card>
      <div className="flex items-center gap-3 mb-4">
        <div className="w-8 h-8 rounded-full bg-[var(--accent-dim)] flex items-center justify-center text-sm font-medium text-[var(--accent)]">
          {rep.full_name.charAt(0)}
        </div>
        <div>
          <p className="text-sm font-medium text-[var(--text-primary)]">{rep.full_name}</p>
          <p className="text-xs text-[var(--text-muted)]">{rep.email}</p>
        </div>
        <Badge label={rep.is_active ? 'active' : 'inactive'} variant={rep.is_active ? 'green' : 'red'} />
      </div>
      <div className="grid grid-cols-4 gap-3">
        <Metric icon={Phone} label="Dials" value={stats?.totalDials ?? '—'} color="text-[var(--accent)]" />
        <Metric icon={Calendar} label="Booked" value={stats?.bookedCount ?? '—'} color="text-[var(--success)]" />
        <Metric icon={TrendingUp} label="Book Rate" value={stats ? `${stats.bookingRate}%` : '—'} color="text-[var(--info)]" />
        <Metric icon={Clock} label="Avg Duration" value={stats ? formatDuration(stats.avgCallDuration) : '—'} color="text-[var(--warning)]" />
      </div>
    </Card>
  )
}

function Metric({ icon: Icon, label, value, color }) {
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-1">
        <Icon size={12} className={color} />
        <p className="text-xs text-[var(--text-muted)]">{label}</p>
      </div>
      <p className="text-lg font-medium text-[var(--text-primary)]">{value}</p>
    </div>
  )
}

function formatDuration(s) {
  if (!s) return '0s'
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`
}
