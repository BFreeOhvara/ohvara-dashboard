import { useQuery } from '@tanstack/react-query'
import { Calendar, TrendingUp, DollarSign, Clock } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { useMyAppointments } from '../../hooks/useAppointments'
import { AppointmentCard } from '../../components/closer/AppointmentCard'

function StatsBar({ closerId }) {
  const { data: weekStats } = useQuery({
    queryKey: ['closer-week-stats', closerId],
    queryFn: async () => {
      const weekAgo = new Date()
      weekAgo.setDate(weekAgo.getDate() - 7)

      const { data } = await supabase
        .from('appointments')
        .select('id, outcome, deal_value, status')
        .eq('closer_id', closerId)
        .gte('updated_at', weekAgo.toISOString())

      const completed = (data || []).filter(a => a.status === 'completed')
      const closed    = completed.filter(a => a.outcome === 'closed')
      const closeRate = completed.length ? Math.round((closed.length / completed.length) * 100) : 0
      const earnings  = closed.length * 200  // $200 avg commission
      const revenue   = closed.reduce((s, a) => s + (a.deal_value || 0), 0)

      return { closeRate, earnings, revenue, closedCount: closed.length, totalCount: completed.length }
    },
    enabled: !!closerId,
  })

  const stats = [
    {
      label: 'Weekly Close Rate',
      value: `${weekStats?.closeRate ?? 0}%`,
      color: weekStats?.closeRate >= 30 ? 'var(--success)' : weekStats?.closeRate >= 20 ? 'var(--warning)' : 'var(--text-primary)',
      icon: TrendingUp,
    },
    {
      label: 'Est. Earnings This Week',
      value: `$${(weekStats?.earnings ?? 0).toLocaleString()}`,
      color: 'var(--accent)',
      icon: DollarSign,
    },
    {
      label: 'Closed This Week',
      value: `${weekStats?.closedCount ?? 0} / ${weekStats?.totalCount ?? 0}`,
      color: 'var(--text-primary)',
      icon: Calendar,
    },
    {
      label: 'Revenue Generated',
      value: weekStats?.revenue ? `$${weekStats.revenue.toLocaleString()}` : '$0',
      color: 'var(--success)',
      icon: Clock,
    },
  ]

  return (
    <div style={{
      display: 'flex', gap: 0,
      background: 'var(--bg-surface)',
      border: '0.5px solid var(--border)',
      borderRadius: 8,
      overflow: 'hidden',
      marginTop: 24,
    }}>
      {stats.map((s, i) => (
        <div key={s.label} style={{
          flex: 1, minWidth: 0,
          padding: '12px 16px',
          borderRight: i < stats.length - 1 ? '0.5px solid var(--border)' : 'none',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
            <s.icon size={11} color="var(--text-muted)" />
            <p style={{ fontSize: 10, fontWeight: 500, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', margin: 0 }}>
              {s.label}
            </p>
          </div>
          <p style={{
            fontSize: 20, fontWeight: 500, lineHeight: 1,
            fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums',
            color: s.color, margin: 0,
          }}>
            {s.value}
          </p>
        </div>
      ))}
    </div>
  )
}

export default function MyAppointments() {
  const { profile } = useAuth()
  const { data: appointments, isLoading } = useMyAppointments()

  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })
  const pending = appointments?.filter(a => a.status === 'pending') ?? []

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100%' }}>
      {/* Top bar */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 18, fontWeight: 500, color: 'var(--text-primary)', margin: 0, letterSpacing: '-0.01em' }}>
            My Appointments
          </h1>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }}>
              {pending.length}
            </span> pending today
          </p>
        </div>
        <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums', paddingTop: 2 }}>
          {today}
        </span>
      </div>

      {/* Appointment list — flex-1 pushes stats bar to bottom */}
      <div style={{ flex: 1 }}>
        {isLoading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {[...Array(3)].map((_, i) => (
              <div key={i} style={{
                height: 64, borderRadius: 8,
                background: 'var(--bg-surface)', border: '0.5px solid var(--border)',
                animation: 'pulse 2s infinite',
              }} />
            ))}
          </div>
        ) : !appointments?.length ? (
          <div style={{
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            padding: '64px 16px', textAlign: 'center',
          }}>
            <div style={{
              width: 40, height: 40, borderRadius: '50%',
              background: 'var(--bg-elevated)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              marginBottom: 12,
            }}>
              <Calendar size={18} color="var(--text-muted)" />
            </div>
            <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-secondary)', margin: 0 }}>
              No pending appointments
            </p>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
              New bookings will appear here automatically.
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {appointments.map(appt => (
              <AppointmentCard key={appt.id} appt={appt} />
            ))}
          </div>
        )}
      </div>

      {/* Stats bar — pinned to bottom */}
      {profile?.id && <StatsBar closerId={profile.id} />}
    </div>
  )
}
