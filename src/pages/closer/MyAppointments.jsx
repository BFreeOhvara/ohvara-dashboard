import { useQuery } from '@tanstack/react-query'
import { Calendar, TrendingUp, DollarSign, Zap } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { useMyAppointments } from '../../hooks/useAppointments'
import { AppointmentCard } from '../../components/closer/AppointmentCard'
import { KPICard } from '../../components/ui/KPICard'

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

      {/* KPI row — glass + countup */}
      <div className="stagger" style={{ display: 'flex', gap: 12, marginBottom: 24 }}>
        <KPICard
          label="Today's Appointments"
          value={kpis?.todayAppts ?? pending.length}
          sub="scheduled today"
          icon={Calendar}
        />
        <KPICard
          label="Weekly Close Rate"
          value={kpis?.closeRate ?? 0}
          suffix="%"
          sub={kpis?.closeRate >= 30 ? 'Above target' : kpis?.closeRate >= 20 ? 'On track' : 'Keep pushing'}
          subColor={kpis?.closeRate >= 30 ? 'var(--success)' : kpis?.closeRate >= 20 ? 'var(--warning)' : 'var(--danger)'}
          icon={TrendingUp}
        />
        <KPICard
          label="Est. Earnings"
          value={kpis?.earnings ?? 0}
          prefix="$"
          sub="this week · $200/close"
          subColor="var(--accent)"
          accent={kpis?.earnings > 0}
          icon={DollarSign}
        />
        <KPICard
          label="Revenue Generated"
          value={kpis?.revenue ?? 0}
          prefix="$"
          sub="total deal value closed"
          subColor={kpis?.revenue > 0 ? 'var(--success)' : undefined}
          icon={Zap}
        />
      </div>

      {/* Appointment list — scrollable box */}
      <div className="glass" style={{ borderRadius: 12, overflow: 'hidden' }}>
        <div className="scrollbar-thin" style={{ height: 560, overflowY: 'auto' }}>
          {isLoading ? (
            <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {[...Array(3)].map((_, i) => (
                <div key={i} style={{ height: 80, borderRadius: 8, background: 'var(--bg-surface)', border: '0.5px solid var(--border)', animation: 'pulse 2s infinite' }} />
              ))}
            </div>
          ) : !pending.length ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '64px 16px', textAlign: 'center' }}>
              <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'var(--bg-elevated)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}>
                <Calendar size={18} color="var(--text-muted)" />
              </div>
              <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-secondary)', margin: 0 }}>No appointments</p>
              <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>New bookings will appear here automatically.</p>
            </div>
          ) : (
            <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {pending.map(appt => (
                <AppointmentCard key={appt.id} appt={appt} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
