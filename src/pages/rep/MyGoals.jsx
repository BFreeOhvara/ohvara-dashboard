import { useAuth } from '../../hooks/useAuth'
import { useRepStats } from '../../hooks/useProfiles'
import { Card } from '../../components/ui/Card'
import { Trophy, Zap, Calendar } from 'lucide-react'
import { clsx } from 'clsx'

const WEEKLY_GOALS = { dials: 150, bookings: 10 }

const BADGES = [
  { id: 'first_booking', label: 'First Booking', icon: '🎯', condition: s => s?.bookedCount >= 1 },
  { id: 'dialer_50',     label: '50 Dials',      icon: '📞', condition: s => s?.totalDials >= 50 },
  { id: 'dialer_100',    label: '100 Dials',      icon: '🔥', condition: s => s?.totalDials >= 100 },
  { id: 'bookings_5',    label: '5 Bookings',     icon: '⭐', condition: s => s?.bookedCount >= 5 },
  { id: 'bookings_10',   label: '10 Bookings',    icon: '🏆', condition: s => s?.bookedCount >= 10 },
  { id: 'rate_10',       label: '10% Rate',       icon: '💎', condition: s => parseFloat(s?.bookingRate) >= 10 },
]

export default function MyGoals() {
  const { profile } = useAuth()
  const { data: stats } = useRepStats(profile?.id, 'week')

  const dialPct = Math.min(100, Math.round(((stats?.totalDials || 0) / WEEKLY_GOALS.dials) * 100))
  const bookPct = Math.min(100, Math.round(((stats?.bookedCount || 0) / WEEKLY_GOALS.bookings) * 100))

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-medium text-[var(--text-primary)]">My Goals</h1>
        <p className="text-[var(--text-muted)] text-sm mt-0.5">Weekly targets and milestone badges</p>
      </div>

      <div className="grid md:grid-cols-2 gap-4 mb-6">
        <GoalCard
          label="Weekly Dials"
          current={stats?.totalDials || 0}
          target={WEEKLY_GOALS.dials}
          pct={dialPct}
          icon={Zap}
          color="indigo"
        />
        <GoalCard
          label="Weekly Bookings"
          current={stats?.bookedCount || 0}
          target={WEEKLY_GOALS.bookings}
          pct={bookPct}
          icon={Calendar}
          color="green"
        />
      </div>

      <Card>
        <div className="flex items-center gap-2 mb-4">
          <Trophy size={16} className="text-[var(--warning)]" />
          <h2 className="text-sm font-medium text-[var(--text-primary)]">Milestone Badges</h2>
        </div>
        <div className="grid grid-cols-3 gap-3">
          {BADGES.map(badge => {
            const earned = badge.condition(stats)
            return (
              <div
                key={badge.id}
                className={clsx(
                  'flex flex-col items-center gap-2 p-3 rounded-lg border text-center',
                  earned
                    ? 'border-yellow-700 bg-yellow-900/20'
                    : 'border-[var(--border)] bg-[var(--bg-2)] opacity-40 grayscale'
                )}
              >
                <span className="text-2xl">{badge.icon}</span>
                <p className="text-xs text-[var(--text-secondary)] font-medium">{badge.label}</p>
              </div>
            )
          })}
        </div>
      </Card>
    </div>
  )
}

function GoalCard({ label, current, target, pct, icon: Icon, color }) {
  const colors = {
    indigo: { bar: 'bg-[var(--accent)]', text: 'text-[var(--accent)]' },
    green:  { bar: 'bg-[var(--success)]',  text: 'text-[var(--success)]' },
  }
  const c = colors[color]

  return (
    <Card>
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm font-medium text-[var(--text-primary)]">{label}</p>
        <span className={clsx('text-sm font-medium', c.text)}>{pct}%</span>
      </div>
      <div className="h-2 bg-[var(--bg-3)] rounded-full overflow-hidden mb-2">
        <div
          className={clsx('h-full rounded-full transition-all duration-500', c.bar)}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="text-xs text-[var(--text-muted)]">
        {current} / {target} {label.split(' ')[1].toLowerCase()}
      </p>
    </Card>
  )
}
