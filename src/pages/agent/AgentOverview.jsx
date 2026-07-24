import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertCircle, CalendarClock, ArrowRight } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { useHierarchy } from '../../hooks/useHierarchy'
import { usePolicies, bookMetrics, pendingEffectuation } from '../../hooks/usePolicies'
import { LiveClock } from '../../components/ui/LiveClock'
import { moneyShort, money, fullName, formatDate, currentMonth } from '../../lib/policyFormat'

// Overview — "where do things stand for me, right now" (Round 4).
//
// Numbers are the primary content (Round 7), with a single full-width
// attention row underneath (Round 6). Deliberately NOT a shrunk-down preview
// of every other page — depth lives one click away on My Policies.

export default function AgentOverview() {
  const { profile } = useAuth()
  const isAdmin = profile?.role === 'admin'
  const { downline } = useHierarchy(profile?.id, isAdmin)

  const [scope, setScope] = useState('own')
  const [period, setPeriod] = useState('month')
  const effectiveScope = isAdmin ? 'all' : scope
  const { data: policies = [], isLoading } = usePolicies(
    effectiveScope === 'own' ? profile?.id : null
  )

  const metrics = useMemo(
    () => bookMetrics(policies, { month: period === 'month' ? currentMonth() : null }),
    [policies, period]
  )

  const needsEffectuation = useMemo(() => pendingEffectuation(policies), [policies])
  const needsCancellationCall = useMemo(
    () => policies.filter(p =>
      p.status !== 'Not Interested' &&
      p.cancellation_status !== 'Cancellation Complete' &&
      !p.cancellation_call_at
    ),
    [policies]
  )

  const greeting = (() => {
    const h = new Date().getHours()
    if (h < 12) return 'Good morning'
    if (h < 18) return 'Good afternoon'
    return 'Good evening'
  })()

  const firstName = profile?.full_name?.split(' ')[0] || 'there'

  return (
    <div className="page-enter" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 500, color: 'var(--text-primary)', margin: 0, letterSpacing: '-0.02em' }}>
            {greeting}, {firstName}
          </h1>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '4px 0 0' }}>
            {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
          </p>
        </div>
        <LiveClock timezone={profile?.timezone} />
      </div>

      {/* Scope controls — time window always, You/Team only when the agent
          actually has recruits (Round 8). */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Toggle
          options={[['month', 'This month'], ['all', 'All time']]}
          value={period}
          onChange={setPeriod}
        />
        {!isAdmin && downline.length > 0 && (
          <Toggle
            options={[['own', 'You'], ['team', 'Team']]}
            value={scope}
            onChange={setScope}
          />
        )}
      </div>

      {/* Headline numbers — one continuous full-width row (Round 6) */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
        <Metric label="Active AP" value={moneyShort(metrics.activeAP)} mono />
        <Metric label={period === 'month' ? 'Submitted AP (mo)' : 'Submitted AP'} value={moneyShort(metrics.submittedAP)} mono />
        <Metric label="Policies Active" value={String(metrics.policiesActive)} mono />
        <Metric label="Average Premium" value={money(metrics.averagePremium)} mono />
        <Metric label="Placed Rate" value={`${metrics.placedRate.toFixed(0)}%`} mono />
        <Metric label="Pending Cancellations" value={String(metrics.pendingCancellations)} mono />
      </div>

      {/* Call metrics have no data source yet — calls happen on the agent's
          own phone, outside the app (North Star). Shown as unavailable rather
          than as a zero that would read as "you made no calls." */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
        <Metric label="Calls Taken" value="—" sub="Not tracked in-app yet" />
        <Metric label="Close Rate" value="—" sub="Needs call tracking" />
      </div>

      {/* Needs your attention — full-width row beneath the numbers (Round 6) */}
      <div className="glass" style={{ padding: 20 }}>
        <h2 style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)', margin: 0 }}>
          Needs your attention
        </h2>

        {isLoading ? (
          <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '14px 0 0' }}>Loading…</p>
        ) : needsEffectuation.length === 0 && needsCancellationCall.length === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '14px 0 0' }}>
            Nothing needs you right now.
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 16 }}>
            {needsEffectuation.slice(0, 4).map(p => (
              <AttentionRow
                key={`eff-${p.id}`}
                icon={AlertCircle}
                title={`Did ${fullName(p)}'s policy go into effect?`}
                detail={`Effective ${formatDate(p.effective_date)} · ${p.carrier_name || 'No carrier'}`}
                to="/agent/policies"
                cta="Answer"
              />
            ))}
            {needsCancellationCall.slice(0, 4).map(p => (
              <AttentionRow
                key={`cx-${p.id}`}
                icon={CalendarClock}
                title={`Schedule the 3-way cancellation call for ${fullName(p)}`}
                detail={`Sold ${formatDate(p.policy_sold_date)} · old policy still active`}
                to="/agent/submissions"
                cta="Schedule"
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function Toggle({ options, value, onChange }) {
  return (
    <div style={{ display: 'flex', gap: 4, padding: 3, background: 'var(--bg-elevated)', border: '0.5px solid var(--border)', borderRadius: 8 }}>
      {options.map(([key, label]) => (
        <button
          key={key}
          onClick={() => onChange(key)}
          style={{
            padding: '6px 14px', borderRadius: 6, fontSize: 12,
            fontWeight: value === key ? 500 : 400, cursor: 'pointer', border: 'none',
            background: value === key ? 'var(--accent-dim)' : 'transparent',
            color: value === key ? 'var(--accent)' : 'var(--text-muted)',
          }}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

function Metric({ label, value, sub, mono }) {
  return (
    <div className="glass" style={{ padding: 16 }}>
      <p className="section-label" style={{ margin: 0 }}>{label}</p>
      <p style={{
        fontSize: 22, fontWeight: 500, letterSpacing: '-0.02em',
        color: 'var(--text-primary)', margin: '10px 0 0',
        fontFamily: mono ? 'var(--font-mono)' : undefined,
        fontVariantNumeric: 'tabular-nums',
      }}>
        {value}
      </p>
      {sub && <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '6px 0 0' }}>{sub}</p>}
    </div>
  )
}

function AttentionRow({ icon: Icon, title, detail, to, cta }) {
  return (
    <Link
      to={to}
      style={{
        display: 'flex', alignItems: 'center', gap: 12, textDecoration: 'none',
        padding: '12px 14px', borderRadius: 8,
        background: 'var(--bg-base)', border: '0.5px solid var(--border)',
      }}
    >
      <Icon size={15} style={{ color: 'var(--warning)', flexShrink: 0 }} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <p style={{ fontSize: 13, color: 'var(--text-primary)', margin: 0 }}>{title}</p>
        <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '3px 0 0' }}>{detail}</p>
      </div>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--accent)', flexShrink: 0 }}>
        {cta} <ArrowRight size={12} />
      </span>
    </Link>
  )
}
