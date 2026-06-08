import { useState, useMemo } from 'react'
import { GitBranch } from 'lucide-react'
import { useAllAppointments } from '../../hooks/useAppointments'
import { Badge } from '../../components/ui/Badge'

const PERIODS = [
  { key: 'week',  label: 'This Week' },
  { key: 'month', label: 'This Month' },
  { key: 'all',   label: 'All Time' },
]

// Tier badge inline — no hardcoded colors
const TIER_STYLE = {
  'Starter':    { background: 'var(--info-dim)',    color: 'var(--info)',    border: '0.5px solid rgba(56,189,248,0.20)' },
  'Growth':     { background: 'var(--accent-dim)',  color: 'var(--accent)',  border: '0.5px solid var(--accent-border)' },
  'Full Stack': { background: 'var(--success-dim)', color: 'var(--success)', border: '0.5px solid rgba(34,197,94,0.20)' },
}

function TierBadge({ tier }) {
  if (!tier) return <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>—</span>
  const s = TIER_STYLE[tier] || TIER_STYLE['Growth']
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center',
      padding: '2px 7px', borderRadius: 4, fontSize: 11, fontWeight: 500,
      ...s,
    }}>
      {tier}
    </span>
  )
}

function fmtDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })
}

function getPeriodCutoff(period) {
  const d = new Date()
  if (period === 'week')  { d.setDate(d.getDate() - 7); return d }
  if (period === 'month') { d.setMonth(d.getMonth() - 1); return d }
  return null
}

export default function CloserPipeline() {
  const { data: appointments, isLoading } = useAllAppointments()
  const [period, setPeriod] = useState('month')

  const filtered = useMemo(() => {
    if (!appointments) return []
    const cutoff = getPeriodCutoff(period)
    return appointments.filter(a => {
      if (!cutoff) return true
      return new Date(a.created_at) >= cutoff
    })
  }, [appointments, period])

  const totalRevenue = useMemo(() =>
    filtered
      .filter(a => a.outcome === 'closed')
      .reduce((s, a) => s + (a.deal_value || 0), 0),
    [filtered]
  )

  const closedCount  = filtered.filter(a => a.outcome === 'closed').length
  const pendingCount = filtered.filter(a => a.status === 'pending').length

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 18, fontWeight: 500, color: 'var(--text-primary)', margin: 0, letterSpacing: '-0.01em' }}>
            Pipeline
          </h1>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }}>{filtered.length}</span> bookings
            {' · '}
            <span style={{ color: 'var(--success)', fontFamily: 'var(--font-mono)' }}>{closedCount}</span> closed
            {' · '}
            <span style={{ fontFamily: 'var(--font-mono)' }}>{pendingCount}</span> pending
          </p>
        </div>

        {/* Filter bar */}
        <div style={{ display: 'flex', gap: 0, borderBottom: '0.5px solid var(--border)' }}>
          {PERIODS.map(p => (
            <button
              key={p.key}
              onClick={() => setPeriod(p.key)}
              style={{
                height: 32, padding: '0 14px',
                background: 'transparent', border: 'none',
                borderBottom: period === p.key ? '2px solid var(--accent)' : '2px solid transparent',
                marginBottom: -0.5,
                color: period === p.key ? 'var(--text-primary)' : 'var(--text-secondary)',
                fontSize: 13, cursor: 'pointer',
                fontFamily: 'var(--font-sans)',
                transition: 'all 0.1s',
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div style={{
        background: 'var(--bg-surface)',
        border: '0.5px solid var(--border)',
        borderRadius: 8,
        overflow: 'hidden',
        marginBottom: 16,
      }}>
        {/* Table header */}
        <div style={{
          display: 'flex', alignItems: 'center',
          background: 'var(--bg-elevated)',
          borderBottom: '0.5px solid var(--border)',
        }}>
          <div style={{ flex: '1 1 0', padding: '8px 16px' }}      className="section-label">Business</div>
          <div style={{ flex: '0 0 110px', padding: '8px 8px' }}   className="section-label">Rep</div>
          <div style={{ flex: '0 0 110px', padding: '8px 8px' }}   className="section-label">Closer</div>
          <div style={{ flex: '0 0 100px', padding: '8px 8px' }}   className="section-label">Booked</div>
          <div style={{ flex: '0 0 100px', padding: '8px 8px' }}   className="section-label">Stack</div>
          <div style={{ flex: '0 0 100px', padding: '8px 8px' }}   className="section-label">Status</div>
          <div style={{ flex: '0 0 100px', padding: '8px 16px 8px 0', textAlign: 'right' }} className="section-label">Revenue</div>
        </div>

        {/* Rows */}
        {isLoading ? (
          <div>
            {[...Array(6)].map((_, i) => (
              <div key={i} style={{ height: 44, borderBottom: '0.5px solid var(--border)' }}>
                <div style={{ margin: '14px 16px', height: 12, width: `${40 + (i % 3) * 15}%`, background: 'var(--bg-elevated)', borderRadius: 4, animation: 'pulse 2s infinite' }} />
              </div>
            ))}
          </div>
        ) : !filtered.length ? (
          <div style={{
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            padding: '48px 16px', textAlign: 'center',
          }}>
            <div style={{
              width: 40, height: 40, borderRadius: '50%',
              background: 'var(--bg-elevated)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              marginBottom: 12,
            }}>
              <GitBranch size={18} color="var(--text-muted)" />
            </div>
            <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-secondary)', margin: 0 }}>
              No bookings in this period
            </p>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
              Try expanding to All Time.
            </p>
          </div>
        ) : (
          filtered.map(appt => (
            <PipelineRow key={appt.id} appt={appt} />
          ))
        )}
      </div>

      {/* Total pipeline value */}
      <div style={{
        display: 'flex', justifyContent: 'flex-end', alignItems: 'baseline',
        gap: 12, padding: '12px 0',
        borderTop: '0.5px solid var(--border)',
      }}>
        <span style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 500 }}>
          Pipeline Value
        </span>
        <span style={{
          fontSize: 28, fontWeight: 500,
          fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums',
          color: totalRevenue > 0 ? 'var(--success)' : 'var(--text-primary)',
          letterSpacing: '-0.02em', lineHeight: 1,
        }}>
          {totalRevenue > 0 ? `$${totalRevenue.toLocaleString()}` : '$0'}
        </span>
      </div>
    </div>
  )
}

function PipelineRow({ appt }) {
  const lead   = appt.lead
  const rep    = appt.rep
  const closer = appt.closer

  return (
    <div
      style={{
        display: 'flex', alignItems: 'center',
        borderBottom: '0.5px solid var(--border)',
        minHeight: 44,
        transition: 'background-color 100ms',
      }}
      onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-elevated)' }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
    >
      {/* Business */}
      <div style={{ flex: '1 1 0', minWidth: 0, padding: '10px 16px' }}>
        <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {lead?.business_name || '—'}
        </p>
        {lead?.niche && (
          <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>{lead.niche}</p>
        )}
      </div>

      {/* Rep */}
      <div style={{ flex: '0 0 110px', padding: '10px 8px', fontSize: 12, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {rep?.full_name || '—'}
      </div>

      {/* Closer */}
      <div style={{ flex: '0 0 110px', padding: '10px 8px', fontSize: 12, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {closer?.full_name || '—'}
      </div>

      {/* Booked date */}
      <div style={{ flex: '0 0 100px', padding: '10px 8px', fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums' }}>
        {fmtDate(appt.created_at)}
      </div>

      {/* Stack */}
      <div style={{ flex: '0 0 100px', padding: '10px 8px' }}>
        <TierBadge tier={appt.recommended_tier || null} />
      </div>

      {/* Status */}
      <div style={{ flex: '0 0 100px', padding: '10px 8px' }}>
        <Badge label={appt.outcome || appt.status} />
      </div>

      {/* Revenue */}
      <div style={{ flex: '0 0 100px', padding: '10px 16px 10px 0', textAlign: 'right' }}>
        {appt.deal_value ? (
          <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums', color: 'var(--success)' }}>
            ${Number(appt.deal_value).toLocaleString()}
          </span>
        ) : (
          <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>—</span>
        )}
      </div>
    </div>
  )
}
