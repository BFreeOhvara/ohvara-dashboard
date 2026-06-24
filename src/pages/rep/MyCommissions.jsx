import { useMemo, useEffect } from 'react'
import { DollarSign, Briefcase, TrendingUp, Landmark, CheckCircle2, Loader2 } from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { useAuth } from '../../hooks/useAuth'
import { useMyCommission } from '../../hooks/useProfiles'
import { useMyPayouts, useConnectOnboard, useCheckOnboardStatus } from '../../hooks/usePayouts'
import { KPICard } from '../../components/ui/KPICard'

const CHART_DAYS = 30

// status → chip colors, shared with the admin Payouts tab semantics.
const PAYOUT_STATUS = {
  pending:  { label: 'Pending',  color: '#F59E0B', dim: 'rgba(245,158,11,0.12)' },
  approved: { label: 'Approved', color: '#38BDF8', dim: 'rgba(56,189,248,0.12)' },
  paid:     { label: 'Paid',     color: '#22C55E', dim: 'rgba(34,197,94,0.12)' },
  failed:   { label: 'Failed',   color: '#EF4444', dim: 'rgba(239,68,68,0.12)' },
}

function StatusChip({ status }) {
  const s = PAYOUT_STATUS[status] || PAYOUT_STATUS.pending
  return (
    <span style={{
      fontSize: 11, fontWeight: 500, color: s.color, background: s.dim,
      padding: '3px 9px', borderRadius: 999, whiteSpace: 'nowrap',
    }}>
      {s.label}
    </span>
  )
}

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
  const connected = !!profile?.stripe_onboarding_complete
  const onboard = useConnectOnboard()
  const checkStatus = useCheckOnboardStatus()

  async function startOnboarding() {
    try {
      const res = await onboard.mutateAsync()
      if (res?.url) {
        window.open(
          res.url,
          'stripe-connect',
          `popup,width=500,height=700,left=${Math.floor((screen.width - 500) / 2)},top=${Math.floor((screen.height - 700) / 2)}`
        )
      }
    } catch { /* error surfaced via onboard.error below */ }
  }

  // When Stripe returns to ?onboarding=complete inside the popup, relay via
  // postMessage and close. If window.opener is null (popup blocked / same-tab
  // fallback), run checkStatus directly.
  useEffect(() => {
    const flag = new URLSearchParams(window.location.search).get('onboarding')
    if (!flag) return
    if (flag === 'complete') {
      if (window.opener) {
        window.opener.postMessage('stripe-onboarding-complete', window.location.origin)
        window.close()
      } else {
        checkStatus.mutateAsync().finally(() => window.location.assign('/rep/commissions'))
      }
    } else {
      window.history.replaceState({}, '', '/rep/commissions')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Receive the popup's relay message and confirm onboarding status.
  useEffect(() => {
    function handleMessage(e) {
      if (e.origin !== window.location.origin) return
      if (e.data !== 'stripe-onboarding-complete') return
      checkStatus.mutateAsync().finally(() => window.history.replaceState({}, '', '/rep/commissions'))
    }
    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
          10% of every closed deal — paid when the closer signs the client you booked
        </p>
      </div>

      {/* Connect bank button — own row above KPI cards, right-aligned */}
      {!connected && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
          <button
            onClick={startOnboarding}
            disabled={onboard.isPending}
            style={{
              display: 'flex', alignItems: 'center', gap: 7, height: 36, padding: '0 14px',
              background: 'var(--accent)', border: 'none', borderRadius: 8,
              fontSize: 13, fontWeight: 500, color: 'white',
              cursor: onboard.isPending ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap',
            }}
          >
            {onboard.isPending
              ? <><Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Opening…</>
              : <><Landmark size={14} /> Connect bank</>}
          </button>
        </div>
      )}

      {/* KPI row */}
      <div className="stagger" style={{ display: 'flex', gap: 12, marginBottom: 20, alignItems: 'flex-start' }}>
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
          sub="10% per close"
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

      <MyPayouts connected={connected} />
    </div>
  )
}

// Stripe Connect bank-link + payout history. Reps connect their bank once
// (Stripe handles KYC + 1099), then watch each closed deal's 10% move
// pending → paid here.
function MyPayouts({ connected }) {
  const { profile } = useAuth()
  const { data: payouts } = useMyPayouts(profile?.id)

  return (
    <div className="glass" style={{ padding: '18px 20px', borderRadius: 12, marginTop: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 14 }}>
        <div>
          <p style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-primary)', margin: '0 0 2px' }}>My Payouts</p>
          <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: 0 }}>
            Connect your bank once — paid commissions land in ~2 days
          </p>
        </div>
        {connected && (
          <span style={{
            display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 500,
            color: 'var(--success)', background: 'rgba(34,197,94,0.12)', padding: '6px 12px', borderRadius: 999,
          }}>
            <CheckCircle2 size={14} /> Bank connected
          </span>
        )}
      </div>

      {(payouts?.length ?? 0) === 0 ? (
        <p style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', margin: '8px 0' }}>
          No payouts yet — a pending payout appears here when the closer signs a deal you booked.
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {payouts.map(p => {
            const biz = p.appointment?.lead?.business_name || 'Closed deal'
            const dealValueCents = p.deal_value_cents ?? (p.amount_cents * 10)
            const dealDollars = Math.round(dealValueCents / 100).toLocaleString()
            const cutDollars = Math.round(p.amount_cents / 100).toLocaleString()
            return (
              <div key={p.id} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
                padding: '10px 4px', borderBottom: '0.5px solid var(--border)',
              }}>
                <div style={{ minWidth: 0 }}>
                  <p style={{ fontSize: 13, color: 'var(--text-primary)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {biz}
                  </p>
                  <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '2px 0 0', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>
                    Closed ${dealDollars} · Your cut: ${cutDollars}
                  </p>
                </div>
                {p.source === 'legacy' ? (
                  <span style={{ fontSize: 11, color: 'var(--text-muted)', background: 'var(--bg-elevated)', padding: '3px 8px', borderRadius: 999, whiteSpace: 'nowrap' }}>
                    Legacy
                  </span>
                ) : (
                  <StatusChip status={p.status} />
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
