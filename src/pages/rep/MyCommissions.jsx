import { useMemo } from 'react'
import { DollarSign, Briefcase, TrendingUp } from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { useAuth } from '../../hooks/useAuth'
import { useMyCommission } from '../../hooks/useProfiles'
import { KPICard } from '../../components/ui/KPICard'

const CHART_DAYS = 30

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div style={{
      background: '#13131F', border: '0.5px solid var(--border)',
      borderRadius: 8, padding: '8px 12px', boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
    }}>
      <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '0 0 4px' }}>{label}</p>
      <p style={{ fontSize: 12, color: 'var(--success)', margin: 0, fontFamily: 'var(--font-mono)' }}>
        ${payload[0].value.toFixed(2)}
      </p>
    </div>
  )
}

export default function MyCommissions() {
  const { profile } = useAuth()
  const { data: commission, isLoading } = useMyCommission(profile?.id)

  // Daily earned series over the last CHART_DAYS (local days)
  const daily = useMemo(() => {
    const days = []
    for (let i = CHART_DAYS - 1; i >= 0; i--) {
      const d = new Date()
      d.setDate(d.getDate() - i)
      d.setHours(0, 0, 0, 0)
      days.push({
        key: d.toDateString(),
        label: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        earned: 0,
      })
    }
    const byKey = Object.fromEntries(days.map(d => [d.key, d]))
    for (const row of commission?.rows || []) {
      const day = byKey[new Date(row.created_at).toDateString()]
      if (day) day.earned += Number(row.amount || 0)
    }
    return days
  }, [commission])

  const thisWeek = useMemo(() => {
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - 7)
    return (commission?.rows || [])
      .filter(r => new Date(r.created_at) >= cutoff)
      .reduce((sum, r) => sum + Number(r.amount || 0), 0)
  }, [commission])

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 18, fontWeight: 500, color: 'var(--text-primary)', margin: 0, letterSpacing: '-0.01em' }}>
          My Commissions
        </h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>
          $248 per closed deal — 50% of the $497 setup fee, paid when the closer signs the client
        </p>
      </div>

      {/* KPI row */}
      <div className="stagger" style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
        <KPICard
          label="Total Earned"
          value={Math.floor(commission?.total ?? 0)}
          prefix="$"
          sub="All time"
          subColor={(commission?.total ?? 0) > 0 ? 'var(--success)' : undefined}
          accent={(commission?.total ?? 0) > 0}
          icon={DollarSign}
        />
        <KPICard
          label="Closed Deals"
          value={commission?.deals ?? 0}
          sub="$248 each"
          icon={Briefcase}
        />
        <KPICard
          label="Last 7 Days"
          value={Math.floor(thisWeek)}
          prefix="$"
          sub={thisWeek > 0 ? 'Keep it rolling' : 'Book more appointments'}
          icon={TrendingUp}
        />
      </div>

      {/* Daily earnings chart */}
      <div className="glass" style={{ padding: '18px 20px', borderRadius: 12 }}>
        <p style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-primary)', margin: '0 0 2px' }}>
          Last {CHART_DAYS} Days
        </p>
        <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '0 0 14px' }}>
          Commission earned per day
        </p>
        <div style={{ width: '100%', height: 240 }}>
          <ResponsiveContainer>
            <BarChart data={daily}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
                axisLine={{ stroke: 'var(--border)' }}
                tickLine={false}
                interval={Math.ceil(CHART_DAYS / 10) - 1}
              />
              <YAxis
                allowDecimals={false}
                tick={{ fontSize: 11, fill: 'var(--text-muted)' }}
                axisLine={false}
                tickLine={false}
                width={40}
                tickFormatter={v => `$${v}`}
              />
              <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
              <Bar
                dataKey="earned"
                name="Earned"
                fill="#22C55E"
                radius={[3, 3, 0, 0]}
                animationDuration={700}
                animationEasing="ease-out"
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
        {!isLoading && (commission?.deals ?? 0) === 0 && (
          <p style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', margin: '12px 0 0' }}>
            No commissions yet — they appear here when the closer signs a deal you booked.
          </p>
        )}
      </div>
    </div>
  )
}
