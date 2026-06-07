import { useState } from 'react'
import { Phone, Calendar, TrendingUp, Clock } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { useRepStats } from '../../hooks/useProfiles'
import { StatCard } from '../../components/ui/StatCard'
import { Button } from '../../components/ui/Button'

const PERIODS = ['day', 'week', 'month']

export default function MyStats() {
  const { profile } = useAuth()
  const [period, setPeriod] = useState('week')
  const { data: stats, isLoading } = useRepStats(profile?.id, period)

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-slate-100">My Stats</h1>
          <p className="text-slate-500 text-sm mt-0.5">Your personal performance metrics</p>
        </div>
        <div className="flex gap-1">
          {PERIODS.map(p => (
            <Button
              key={p}
              variant={period === p ? 'primary' : 'ghost'}
              size="sm"
              onClick={() => setPeriod(p)}
            >
              {p.charAt(0).toUpperCase() + p.slice(1)}
            </Button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-24 rounded-xl bg-[#161b24] border border-[#2a3347] animate-pulse" />
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
    </div>
  )
}

function formatDuration(seconds) {
  if (!seconds) return '0s'
  if (seconds < 60) return `${seconds}s`
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}
