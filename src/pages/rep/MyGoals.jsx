import { useState } from 'react'
import { Trophy, Zap, Calendar, Lock } from 'lucide-react'
import { clsx } from 'clsx'
import { useAuth } from '../../hooks/useAuth'
import { useRepStats, useMyCommission, useBadgeActivity, DAILY_BATCH_TARGET } from '../../hooks/useProfiles'
import { useBadgeNotifier } from '../../hooks/useRepNotificationTriggers'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'

// Goal targets per period. Daily dials = the 150 batch; weekly = 150 × 5
// working days; monthly closes counts commission rows (one per closed deal).
const GOAL_PERIODS = [
  { key: 'daily',   label: 'Daily',   statsPeriod: 'day' },
  { key: 'weekly',  label: 'Weekly',  statsPeriod: 'week' },
  { key: 'monthly', label: 'Monthly', statsPeriod: 'month' },
]
const SS_PERIOD = 'ohvara_mygoals_period'

const GOALS = {
  daily:   { dials: DAILY_BATCH_TARGET, bookings: 2 },
  weekly:  { dials: 750,  bookings: 10 },
  monthly: { dials: 3000, bookings: 40 },
}

// Milestone badges in seven groups. Dials / bookings badges read this
// month's stats; commission badges read all-time earnings; streak, perfect-
// day, days-completed and special badges read lifetime call activity
// (useBadgeActivity). Total count is derived (TOTAL_BADGES). Special
// badges are over-and-above achievements only — time-of-day badges and any
// single-day milestone at or below the 150/day target were removed (a setter
// is expected to hit 150/day, so beating it is the achievement worth a badge).
const BADGE_GROUPS = [
  {
    group: 'Dialer',
    badges: [
      { id: 'dial_1',     label: 'First Dial',    icon: '🎯', condition: c => (c.month?.totalDials || 0) >= 1 },
      { id: 'dial_10',    label: '10 Dials',      icon: '📞', condition: c => (c.month?.totalDials || 0) >= 10 },
      { id: 'dial_50',    label: '50 Dials',      icon: '🔥', condition: c => (c.month?.totalDials || 0) >= 50 },
      { id: 'dial_100',   label: '100 Dials',     icon: '💪', condition: c => (c.month?.totalDials || 0) >= 100 },
      { id: 'dial_250',   label: '250 Dials',     icon: '⚡', condition: c => (c.month?.totalDials || 0) >= 250 },
      { id: 'dial_500',   label: '500 Dials',     icon: '🚀', condition: c => (c.month?.totalDials || 0) >= 500 },
      { id: 'dial_1000',  label: '1,000 Dials',   icon: '🏅', condition: c => (c.month?.totalDials || 0) >= 1000 },
      { id: 'dial_2500',  label: '2,500 Dials',   icon: '🌟', condition: c => (c.month?.totalDials || 0) >= 2500 },
      { id: 'dial_5000',  label: '5,000 Dials',   icon: '👑', condition: c => (c.month?.totalDials || 0) >= 5000 },
      { id: 'dial_10000', label: '10,000 Dials',  icon: '🔱', condition: c => (c.month?.totalDials || 0) >= 10000 },
    ],
  },
  {
    group: 'Booking',
    badges: [
      { id: 'book_1',   label: 'First Booking', icon: '🎯', condition: c => (c.month?.bookedCount || 0) >= 1 },
      { id: 'book_5',   label: '5 Bookings',    icon: '⭐', condition: c => (c.month?.bookedCount || 0) >= 5 },
      { id: 'book_10',  label: '10 Bookings',   icon: '🏆', condition: c => (c.month?.bookedCount || 0) >= 10 },
      { id: 'book_25',  label: '25 Bookings',   icon: '💫', condition: c => (c.month?.bookedCount || 0) >= 25 },
      { id: 'book_50',  label: '50 Bookings',   icon: '🔥', condition: c => (c.month?.bookedCount || 0) >= 50 },
      { id: 'book_100', label: '100 Bookings',  icon: '👑', condition: c => (c.month?.bookedCount || 0) >= 100 },
      { id: 'book_250', label: '250 Bookings',  icon: '🌙', condition: c => (c.month?.bookedCount || 0) >= 250 },
    ],
  },
  {
    group: 'Streak',
    badges: [
      { id: 'streak_3',  label: '3-Day Streak',   icon: '🗓️', condition: c => (c.activity?.longestStreak || 0) >= 3,
        detail: ['Complete 3 days in a row', 'A completed day = 150 dials'] },
      { id: 'streak_5',  label: 'Full Work Week', icon: '🔥', condition: c => (c.activity?.longestStreak || 0) >= 5,
        detail: 'Complete a work week (5 days in a row)' },
      { id: 'streak_10', label: 'Two-Week Run',   icon: '👑', condition: c => (c.activity?.longestStreak || 0) >= 10,
        detail: 'Complete two work weeks in a row' },
      { id: 'perfect_streak_3', label: '3 Perfect Days in a Row', icon: '✨', condition: c => (c.activity?.perfectStreak || 0) >= 3,
        detail: '3 perfect weekdays in a row' },
      { id: 'perfect_week',     label: 'Perfect Week',            icon: '🌈', condition: c => (c.activity?.perfectStreak || 0) >= 5,
        detail: 'A full work week of perfect days' },
    ],
  },
  {
    group: 'Perfect Days',
    badges: [
      { id: 'perfect_day', label: 'Perfect Day', icon: '✅', condition: c => !!c.activity?.perfectDay,
        detail: '150 dials + 2 bookings in one day' },
      { id: 'perfect_5',  label: '5 Perfect Days',  icon: '💯', condition: c => (c.activity?.totalPerfectDays || 0) >= 5,
        detail: '5 completed days with 150 dials + 2 bookings' },
      { id: 'perfect_25', label: '25 Perfect Days', icon: '🌟', condition: c => (c.activity?.totalPerfectDays || 0) >= 25,
        detail: '25 perfect days total' },
      { id: 'perfect_50', label: '50 Perfect Days', icon: '👑', condition: c => (c.activity?.totalPerfectDays || 0) >= 50,
        detail: '50 perfect days total' },
    ],
  },
  {
    group: 'Days Completed',
    badges: [
      { id: 'days_10',  label: '10 Days',  icon: '📅', condition: c => (c.activity?.totalCompletedDays || 0) >= 10,
        detail: '10 completed days total' },
      { id: 'days_25',  label: '25 Days',  icon: '⚡', condition: c => (c.activity?.totalCompletedDays || 0) >= 25,
        detail: '25 completed days total' },
      { id: 'days_50',  label: '50 Days',  icon: '🏅', condition: c => (c.activity?.totalCompletedDays || 0) >= 50,
        detail: '50 completed days total' },
      { id: 'days_75',  label: '75 Days',  icon: '🌟', condition: c => (c.activity?.totalCompletedDays || 0) >= 75,
        detail: '75 completed days total' },
      { id: 'days_100', label: '100 Days', icon: '🔱', condition: c => (c.activity?.totalCompletedDays || 0) >= 100,
        detail: '100 completed days total' },
    ],
  },
  {
    group: 'Commission',
    badges: [
      { id: 'comm_first', label: 'First Commission', icon: '💰', condition: c => (c.commission?.total || 0) > 0 },
      { id: 'comm_500',   label: '$500 Earned',      icon: '💵', condition: c => (c.commission?.total || 0) >= 500 },
      { id: 'comm_1k',    label: '$1K Earned',       icon: '🎰', condition: c => (c.commission?.total || 0) >= 1000 },
      { id: 'comm_2_5k',  label: '$2.5K Earned',     icon: '💎', condition: c => (c.commission?.total || 0) >= 2500 },
      { id: 'comm_5k',    label: '$5K Earned',       icon: '🔱', condition: c => (c.commission?.total || 0) >= 5000 },
      { id: 'comm_10k',   label: '$10K Earned',      icon: '👑', condition: c => (c.commission?.total || 0) >= 10000 },
    ],
  },
  {
    group: 'Special',
    badges: [
      { id: 'five_a_day',   label: '5 in a Day',   icon: '🚀', condition: c => (c.activity?.bestDayBookings || 0) >= 5,
        detail: '5 bookings in one day' },
      { id: 'back_to_back', label: 'Back-to-Back Bookings', icon: '🔁', condition: c => !!c.activity?.backToBack,
        detail: '2 bookings in a row' },
    ],
  },
]

const TOTAL_BADGES = BADGE_GROUPS.reduce((n, g) => n + g.badges.length, 0)

export default function MyGoals() {
  const { profile } = useAuth()
  // Period selection survives tab switches via sessionStorage
  const [periodKey, setPeriodKey] = useState(() => sessionStorage.getItem(SS_PERIOD) || 'daily')
  const period = GOAL_PERIODS.find(p => p.key === periodKey) || GOAL_PERIODS[0]
  const { data: stats } = useRepStats(profile?.id, period.statsPeriod)
  const { data: monthStats } = useRepStats(profile?.id, 'month')
  const { data: commission } = useMyCommission(profile?.id)
  const { data: activity } = useBadgeActivity(profile?.id)

  function changePeriod(key) {
    setPeriodKey(key)
    sessionStorage.setItem(SS_PERIOD, key)
  }

  const goals = GOALS[period.key]

  const badgeCtx = { month: monthStats, commission, activity }
  useBadgeNotifier(profile?.id, badgeCtx)
  const earnedCount = BADGE_GROUPS
    .flatMap(g => g.badges)
    .filter(b => b.condition(badgeCtx)).length

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-medium text-[var(--text-primary)]">My Goals</h1>
          <p className="text-[var(--text-muted)] text-sm mt-0.5">
            {period.label} targets and milestone badges
          </p>
        </div>
        <div className="flex gap-1">
          {GOAL_PERIODS.map(p => (
            <Button
              key={p.key}
              variant={periodKey === p.key ? 'primary' : 'ghost'}
              size="sm"
              onClick={() => changePeriod(p.key)}
            >
              {p.label}
            </Button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 mb-6 md:grid-cols-2">
        <GoalCard
          label={`${period.label} Dials`}
          unit="dials"
          current={stats?.totalDials || 0}
          target={goals.dials}
          icon={Zap}
          color="indigo"
        />
        <GoalCard
          label={`${period.label} Bookings`}
          unit="bookings"
          current={stats?.bookedCount || 0}
          target={goals.bookings}
          icon={Calendar}
          color="green"
        />
      </div>

      <Card>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Trophy size={16} className="text-[var(--warning)]" />
            <h2 className="text-sm font-medium text-[var(--text-primary)]">Milestone Badges</h2>
          </div>
          <span
            className="text-xs font-medium text-[var(--text-secondary)]"
            style={{ fontFamily: 'var(--font-mono)' }}
          >
            {earnedCount} / {TOTAL_BADGES} badges earned
          </span>
        </div>

        {BADGE_GROUPS.map(group => (
          <div key={group.group} className="mb-5 last:mb-0">
            <p className="section-label" style={{ marginBottom: 8 }}>{group.group}</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {group.badges.map(badge => {
                const earned = badge.condition(badgeCtx)
                return (
                  <div
                    key={badge.id}
                    className={clsx(
                      'relative flex flex-col items-center gap-1.5 p-3 rounded-lg border text-center',
                      earned
                        ? 'border-yellow-700 bg-yellow-900/20'
                        : 'border-[var(--border)] bg-[var(--bg-2)] opacity-40 grayscale'
                    )}
                    style={earned ? { boxShadow: '0 0 14px rgba(245,158,11,0.18)' } : undefined}
                  >
                    {!earned && (
                      <Lock
                        size={11}
                        className="absolute top-2 right-2 text-[var(--text-muted)]"
                      />
                    )}
                    <span className="text-2xl">{badge.icon}</span>
                    <p className="text-xs text-[var(--text-secondary)] font-medium">{badge.label}</p>
                    {badge.detail &&
                      (Array.isArray(badge.detail) ? badge.detail : [badge.detail]).map((line, i) => (
                        <p key={i} className="text-[10px] text-[var(--text-muted)]">{line}</p>
                      ))}
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </Card>
    </div>
  )
}

function GoalCard({ label, unit, current, target, icon: Icon, color }) {
  const pct = Math.min(100, Math.round((current / target) * 100))
  const colors = {
    indigo: { bar: 'bg-[var(--accent)]', text: 'text-[var(--accent)]' },
    green:  { bar: 'bg-[var(--success)]', text: 'text-[var(--success)]' },
  }
  const c = colors[color]

  return (
    <Card>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Icon size={14} className={c.text} />
          <p className="text-sm font-medium text-[var(--text-primary)]">{label}</p>
        </div>
        <span className={clsx('text-sm font-medium', c.text)}>{pct}%</span>
      </div>
      <div className="h-2 bg-[var(--bg-3)] rounded-full overflow-hidden mb-2">
        <div
          className={clsx('h-full rounded-full transition-all duration-500', c.bar)}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="text-xs text-[var(--text-muted)]">
        {current.toLocaleString()} / {target.toLocaleString()} {unit}
      </p>
    </Card>
  )
}
