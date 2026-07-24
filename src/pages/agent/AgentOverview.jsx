import { useMemo, useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  FileText, TrendingUp, CheckCircle, DollarSign, Phone, Target, ArrowRight,
} from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { usePolicies } from '../../hooks/usePolicies'
import { money, fullName, todayISO } from '../../lib/policyFormat'

// Closer · Overview — literal port of the approved Claude Design export
// (vault: media/claude-design-export-ohvara-dashboard-v3.html, lines 163-227).
// Same DOM structure, same tokens, same spacing; the export's sample numbers
// are replaced with the real Supabase book, and anything with no data source
// yet renders an em-dash in the exact same slot rather than a fabricated
// number (Prompt 327).

const MONO = "'JetBrains Mono',monospace"

export default function AgentOverview() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const isAdmin = profile?.role === 'admin'
  const { data: policies = [], isLoading } = usePolicies(isAdmin ? null : profile?.id)

  const [clock, setClock] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setClock(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

  const today = todayISO()
  const month = today.slice(0, 7)

  const k = useMemo(() => {
    const ap = rows => rows.reduce((s, p) => s + Number(p.annual_premium || 0), 0)
    const submittedToday = policies.filter(p => p.policy_sold_date === today)
    const activeThisMonth = policies.filter(
      p => p.status === 'In Effect' && (p.effective_date || '').slice(0, 7) === month
    )
    return {
      submittedTodayAP: ap(submittedToday),
      submittedTodayCount: submittedToday.length,
      activeMonthAP: ap(activeThisMonth),
      activeMonthCount: activeThisMonth.length,
      avgPremium: activeThisMonth.length
        ? activeThisMonth.reduce((s, p) => s + Number(p.monthly_premium || 0), 0) / activeThisMonth.length
        : 0,
    }
  }, [policies, today, month])

  // Only cancellation calls have a real scheduled time in the schema. Paramed
  // exams and callbacks are in the export's sample data but have no source
  // yet — they'll slot into this same table when they do.
  const schedule = useMemo(
    () => policies
      .filter(p => (p.cancellation_call_at || '').slice(0, 10) === today)
      .sort((a, b) => a.cancellation_call_at.localeCompare(b.cancellation_call_at))
      .map(p => ({
        id: p.id,
        time: new Date(p.cancellation_call_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
        tag: 'CANCEL CALL',
        color: 'var(--warning)', dim: 'var(--warning-dim)', bd: 'var(--warning-bd)',
        name: fullName(p),
        detail: `3-way call w/ ${p.carrier_name || 'carrier'}`,
        policyNo: p.policy_number || '—',
      })),
    [policies, today]
  )

  const greeting = (() => {
    const h = clock.getHours()
    if (h < 12) return 'Good morning'
    if (h < 18) return 'Good afternoon'
    return 'Good evening'
  })()

  const firstName = profile?.full_name?.split(' ')[0] || 'there'

  const row1 = [
    {
      label: 'Submitted AP — Today', icon: FileText,
      value: isLoading ? '—' : money(k.submittedTodayAP),
      sub: `${k.submittedTodayCount} app${k.submittedTodayCount === 1 ? '' : 's'} submitted today`,
      subColor: 'var(--text-muted)',
    },
    {
      label: 'Active AP — This Month', icon: TrendingUp,
      value: isLoading ? '—' : money(k.activeMonthAP),
      sub: `${k.activeMonthCount} polic${k.activeMonthCount === 1 ? 'y' : 'ies'} went active this month`,
      subColor: 'var(--text-muted)',
    },
    {
      label: 'Policies Active — This Month', icon: CheckCircle,
      value: isLoading ? '—' : String(k.activeMonthCount),
      sub: 'Went active this month', subColor: 'var(--success)',
    },
    {
      label: 'Average Premium — This Month', icon: DollarSign,
      value: isLoading || !k.avgPremium ? '—' : `${money(k.avgPremium)}/mo`,
      sub: "Avg. across this month's new policies", subColor: 'var(--text-muted)',
    },
  ]

  // Calls happen on the agent's own phone today — no in-app call data exists,
  // so these read as unavailable rather than as a zero.
  const row2 = [
    { label: 'Calls Taken — Today', icon: Phone, value: '—', sub: 'Not tracked in-app yet', subColor: 'var(--text-muted)' },
    { label: 'Close Rate — Today', icon: Target, value: '—', sub: 'Needs call tracking', subColor: 'var(--text-muted)' },
    { label: 'Calls Taken — This Month', icon: Phone, value: '—', sub: 'Not tracked in-app yet', subColor: 'var(--text-muted)' },
    { label: 'Close Rate — This Month', icon: Target, value: '—', sub: 'Needs call tracking', subColor: 'var(--text-muted)' },
  ]

  return (
    <div style={{ maxWidth: 1280 }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 24, marginBottom: 26, flexWrap: 'wrap' }}>
        <div>
          <p style={{ margin: 0, fontSize: 21, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.01em' }}>
            {greeting}, {firstName}
          </p>
          <p style={{ margin: '5px 0 0', fontSize: 13, color: 'var(--text-muted)' }}>
            Here's where things stand before your first call.
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexShrink: 0 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>
            {clock.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
          </span>
          <div style={{
            fontSize: 22, fontWeight: 700, letterSpacing: '-0.01em', lineHeight: 1, color: '#fff',
            fontFamily: MONO, fontVariantNumeric: 'tabular-nums',
            background: 'var(--accent)', border: 'none', borderRadius: 8, padding: '9px 16px', whiteSpace: 'nowrap',
          }}>
            {clock.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' })}
          </div>
        </div>
      </div>

      <div style={{
        background: 'var(--bg-surface)', border: 'var(--border-w) solid var(--border)',
        borderRadius: 8, padding: '28px 32px', marginBottom: 20,
      }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>Today at a glance</span>
        <KpiRow items={row1} style={{ marginTop: 22 }} />
        <KpiRow
          items={row2}
          style={{ marginTop: 26, paddingTop: 22, borderTop: 'var(--border-w) solid var(--border)' }}
        />
      </div>

      <div style={{
        background: 'var(--bg-surface)', border: 'var(--border-w) solid var(--border)',
        borderRadius: 8, marginTop: 20,
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '18px 26px', borderBottom: 'var(--border-w) solid var(--border)',
        }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>What's on today's schedule</span>
          <button
            onClick={() => navigate('/agent/policies')}
            style={{
              border: 'none', background: 'transparent', color: 'var(--accent)',
              fontSize: 11.5, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 4, padding: 0,
            }}
          >
            View my policies <ArrowRight size={11} />
          </button>
        </div>

        <div style={{
          display: 'grid', gridTemplateColumns: '80px 110px 1fr 1.8fr 130px', gap: 12,
          padding: '12px 26px', borderBottom: 'var(--border-w) solid var(--border)',
        }}>
          {['Time', 'Type', 'Name', 'Detail', 'Policy #'].map(h => (
            <span key={h} style={{
              fontSize: 11, fontWeight: 700, letterSpacing: '0.08em',
              textTransform: 'uppercase', color: 'var(--text-secondary)',
            }}>
              {h}
            </span>
          ))}
        </div>

        {schedule.length === 0 ? (
          <div style={{ padding: '22px 26px', fontSize: 13, color: 'var(--text-muted)' }}>
            {isLoading ? 'Loading…' : 'Nothing scheduled today.'}
          </div>
        ) : schedule.map((s, i) => (
          <div
            key={s.id}
            style={{
              display: 'grid', gridTemplateColumns: '80px 110px 1fr 1.8fr 130px', gap: 12,
              alignItems: 'center', padding: '18px 26px',
              borderBottom: i < schedule.length - 1 ? 'var(--border-w) solid var(--border)' : 'none',
            }}
          >
            <span style={{ fontSize: 15, color: 'var(--text-secondary)', fontFamily: MONO }}>{s.time}</span>
            <span style={{
              display: 'inline-flex', alignItems: 'center', alignSelf: 'start',
              padding: '3px 8px', borderRadius: 4, fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap',
              background: s.dim, color: s.color, border: `var(--border-w) solid ${s.bd}`,
            }}>
              {s.tag}
            </span>
            <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>{s.name}</span>
            <span style={{ fontSize: 14, color: 'var(--text-secondary)' }}>{s.detail}</span>
            <span style={{ fontSize: 14, color: 'var(--text-secondary)', fontFamily: MONO }}>{s.policyNo}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// Four columns, hairline dividers between them, no gap — the export's own
// KPI grid, used for both rows.
function KpiRow({ items, style }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,minmax(0,1fr))', gap: 0, ...style }}>
      {items.map((k, i) => (
        <div
          key={k.label}
          style={{
            minWidth: 0,
            padding: `0 32px 0 ${i === 0 ? '0' : '32px'}`,
            borderRight: i % 4 !== 3 ? 'var(--border-w) solid var(--border)' : 'none',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12, minHeight: 28 }}>
            <k.icon size={12} style={{ flexShrink: 0, color: 'var(--text-secondary)' }} />
            <span style={{
              fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase',
              color: 'var(--text-secondary)', lineHeight: 1.4,
            }}>
              {k.label}
            </span>
          </div>
          <div style={{
            fontSize: 30, fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1.1,
            color: 'var(--text-primary)', fontFamily: MONO, fontVariantNumeric: 'tabular-nums',
            whiteSpace: 'nowrap', overflowWrap: 'anywhere',
          }}>
            {k.value}
          </div>
          <p style={{ margin: '11px 0 0', fontSize: 11.5, color: k.subColor }}>{k.sub}</p>
        </div>
      ))}
    </div>
  )
}
