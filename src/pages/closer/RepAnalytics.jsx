import { useState } from 'react'
import { useReps } from '../../hooks/useProfiles'
import { useRepStats } from '../../hooks/useProfiles'
import { StatCard } from '../../components/ui/StatCard'
import { Phone, Calendar, TrendingUp } from 'lucide-react'
import { Button } from '../../components/ui/Button'

const PERIODS = ['day', 'week', 'month']

export default function RepAnalytics() {
  const { data: reps, isLoading } = useReps()
  const [period, setPeriod] = useState('week')

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-medium text-[var(--text-primary)]">Rep Analytics</h1>
          <p className="text-[var(--text-muted)] text-sm mt-0.5">Read-only view of all appointment setter performance</p>
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
            <div key={i} className="h-24 bg-[var(--bg-1)] border border-[var(--border)] rounded-[10px] animate-pulse" />
          ))}
        </div>
      ) : !reps?.length ? (
        <p className="text-[var(--text-muted)] text-sm">No reps found.</p>
      ) : (
        <div className="space-y-4">
          {reps.map(rep => (
            <RepRow key={rep.id} rep={rep} period={period} />
          ))}
        </div>
      )}
    </div>
  )
}

function RepRow({ rep, period }) {
  const { data: stats } = useRepStats(rep.id, period)

  return (
    <div className="glass" style={{ padding: 16 }}>
      <p className="text-sm font-medium text-[var(--text-primary)] mb-3">{rep.full_name}</p>
      <div className="grid grid-cols-3 gap-3">
        <StatCard label="Dials" value={stats?.totalDials ?? '—'} icon={Phone} color="indigo" />
        <StatCard label="Booked" value={stats?.bookedCount ?? '—'} icon={Calendar} color="green" />
        <StatCard label="Booking Rate" value={stats ? `${stats.bookingRate}%` : '—'} icon={TrendingUp} color="blue" />
      </div>
    </div>
  )
}
