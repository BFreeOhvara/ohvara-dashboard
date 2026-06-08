import { useQuery } from '@tanstack/react-query'
import { Calendar, TrendingUp, DollarSign, Zap } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { useMyAppointments } from '../../hooks/useAppointments'
import { AppointmentCard } from '../../components/closer/AppointmentCard'

// KPI card — same pattern as rep dashboard for visual consistency
function KpiCard({ label, value, sub, subColor, icon: Icon }) {
  return (
    <div style={{
      flex: 1, minWidth: 0,
      background: 'var(--bg-surface)',
      border: '0.5px solid var(--border)',
      borderRadius: 8,
      padding: '16px 20px',
      display: 'flex',
      flexDirection: 'column',
      gap: 4,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
        {Icon && <Icon size={11} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />}
        <p style={{
          fontSize: 10, fontWeight: 500,
          color: 'var(--text-secondary)',
          textTransform: 'uppercase',
          letterSpacing: '0.1em',
          margin: 0,
        }}>{label}</p>
      </div>
      <p style={{
        fontSize: 32,
        fontFamily: 'var(--font-mono)',
        fontVariantNumeric: 'tabular-nums',
        color: 'var(--text-primary)',
        fontWeight: 500,
        letterSpacing: '-0.02em',
        lineHeight: 1,
        margin: 0,
      }}>{value ?? '—'}</p>
      {sub && (
        <p style={{ fontSize: 11, color: subColor || 'var(--text-muted)', marginTop: 2 }}>
          {sub}
        </p>
      )}
    </div>
  )
}

function useCloserKPIs(closerId) {
  return useQuery({
    queryKey: ['closer-kpis', closerId],
    queryFn: async () => {
      const weekAgo = new Date()
      weekAgo.setDate(weekAgo.getDate() - 7)

      const { data } = await supabase
        .from('appointments')
        .select('id, outcome, deal_value, status, scheduled_at')
        .eq('closer_id', closerId)
        .gte('updated_at', weekAgo.toISOString())

      const all = data || []
      const completed = all.filter(a => a.status === 'completed')
      const closed = completed.filter(a => a.outcome === 'closed')
      const closeRate = completed.length ? Math.round((closed.length / completed.length) * 100) : 0
      const earnings = closed.length * 200 // $200 avg commission
      const revenue = closed.reduce((s, a) => s + (a.deal_value || 0), 0)

      // Today's pending appointments
      const todayStr = new Date().toISOString().split('T')[0]
      const todayAppts = all.filter(a => {
        if (!a.scheduled_at) return false
        return a.scheduled_at.startsWith(todayStr) && a.status === 'pending'
      }).length

      return { closeRate, earnings, revenue, todayAppts }
    },
    enabled: !!closerId,
  })
}

export default function MyAppointments() {
  const { profile } = useAuth()
  const { data: appointments, isLoading } = useMyAppointments()
  const { data: kpis } = useCloserKPIs(profile?.id)

  const pending = appointments?.filter(a => a.status === 'pending') ?? []
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })

  return (
    <div>
      {/* Top bar */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 18, fontWeight: 500, color: 'var(--text-primary)', margin: 0, letterSpacing: '-0.01em' }}>
            My Appointments
          </h1>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }}>
              {pending.length}
            </span> pending
          </p>
        </div>
        <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums', paddingTop: 2 }}>
          {today}
        </span>
      </div>

      {/* KPI row */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 24 }}>
        <KpiCard
          label="Today's Appointments"
          value={kpis?.todayAppts ?? pending.length}
          sub="scheduled today"
          icon={Calendar}
        />
        <KpiCard
          label="Weekly Close Rate"
          value={kpis ? `${kpis.closeRate}%` : '—'}
          sub={kpis?.closeRate >= 30 ? 'Above target' : kpis?.closeRate >= 20 ? 'On track' : 'Keep pushing'}
          subColor={kpis?.closeRate >= 30 ? 'var(--success)' : kpis?.closeRate >= 20 ? 'var(--warning)' : 'var(--danger)'}
          icon={TrendingUp}
        />
        <KpiCard
          label="Est. Earnings"
          value={kpis ? `$${kpis.earnings.toLocaleString()}` : '—'}
          sub="this week · $200/close"
          subColor="var(--accent)"
          icon={DollarSign}
        />
        <KpiCard
          label="Revenue Generated"
          value={kpis?.revenue ? `$${kpis.revenue.toLocaleString()}` : '$0'}
          sub="total deal value closed"
          subColor={kpis?.revenue > 0 ? 'var(--success)' : undefined}
          icon={Zap}
        />
      </div>

      {/* Appointment list */}
      {isLoading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {[...Array(3)].map((_, i) => (
            <div key={i} style={{
              height: 80, borderRadius: 8,
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
          background: 'var(--bg-surface)',
          border: '0.5px solid var(--border)',
          borderRadius: 8,
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
  )
}
