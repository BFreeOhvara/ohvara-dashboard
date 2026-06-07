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
          <h1 className="text-xl font-bold text-slate-100">Rep Analytics</h1>
          <p className="text-slate-500 text-sm mt-0.5">Read-only view of all appointment setter performance</p>
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
            <div key={i} className="h-24 bg-[#161b24] border border-[#2a3347] rounded-xl animate-pulse" />
          ))}
        </div>
      ) : !reps?.length ? (
        <p className="text-slate-500 text-sm">No reps found.</p>
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
    <div className="bg-[#161b24] border border-[#2a3347] rounded-xl p-4">
      <p className="text-sm font-semibold text-slate-100 mb-3">{rep.full_name}</p>
      <div className="grid grid-cols-3 gap-3">
        <StatCard label="Dials" value={stats?.totalDials ?? '—'} icon={Phone} color="indigo" />
        <StatCard label="Booked" value={stats?.bookedCount ?? '—'} icon={Calendar} color="green" />
        <StatCard label="Booking Rate" value={stats ? `${stats.bookingRate}%` : '—'} icon={TrendingUp} color="blue" />
      </div>
    </div>
  )
}
