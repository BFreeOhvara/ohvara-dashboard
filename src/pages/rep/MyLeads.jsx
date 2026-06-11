import { useState, useMemo } from 'react'
import { Phone, RefreshCw, PhoneCall, Target, BarChart2, List } from 'lucide-react'
import { useMyLeads } from '../../hooks/useLeads'
import { CallModal } from '../../components/rep/CallModal'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { KPICard } from '../../components/ui/KPICard'

const STATUS_FILTERS = ['All', 'New', 'Appointment Booked', 'Follow-Up', 'No Answer', 'Not Interested']

// KPI helper computed from leads data
function computeKPIs(leads) {
  if (!leads) return { called: 0, booked: 0, connectRate: 0, total: 0 }
  const total   = leads.length
  const booked  = leads.filter(l => ['Booked', 'Appointment Booked'].includes(l.status)).length
  const called  = leads.filter(l => l.status !== 'New').length
  const reached = leads.filter(l => ['Contacted', 'Interested', 'Booked', 'Appointment Booked', 'Follow-Up', 'Not Interested'].includes(l.status)).length
  const connectRate = called > 0 ? Math.round((reached / called) * 100) : 0
  return { called, booked, connectRate, total }
}

// Individual table row — clicking anywhere opens the Call Now modal
function LeadRow({ lead, onOpen, animDelay = 0 }) {
  return (
    <div
      className="table-row-animated"
      onClick={() => onOpen(lead)}
      style={{
        display: 'flex', alignItems: 'center', gap: 0,
        borderBottom: '0.5px solid var(--border)',
        background: 'transparent',
        transition: 'background-color 100ms',
        cursor: 'pointer',
        animationDelay: `${animDelay}ms`,
      }}
      onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-elevated)' }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
    >
      {/* Business name + contact */}
      <div style={{ flex: '1 1 0', minWidth: 0, padding: '12px 16px', minHeight: 44 }}>
        <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', margin: 0 }}>
          {lead.business_name}
        </p>
        {lead.contact_name && (
          <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {lead.contact_name}
          </p>
        )}
      </div>

      {/* Niche */}
      <div style={{ flex: '0 0 120px', padding: '12px 8px', fontSize: 12, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minHeight: 44 }}>
        {lead.niche || '—'}
      </div>

      {/* City */}
      <div style={{ flex: '0 0 100px', padding: '12px 8px', fontSize: 12, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minHeight: 44 }}>
        {lead.city || '—'}
      </div>

      {/* Phone */}
      <div style={{ flex: '0 0 130px', padding: '12px 8px', fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minHeight: 44 }}>
        {lead.phone || '—'}
      </div>

      {/* Status */}
      <div style={{ flex: '0 0 110px', padding: '12px 8px', minHeight: 44 }}>
        <Badge label={lead.status} />
      </div>

      {/* Actions */}
      <div style={{ flex: '0 0 120px', padding: '8px 16px 8px 0', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', minHeight: 44 }}>
        <button
          className="btn-call"
          onClick={e => { e.stopPropagation(); onOpen(lead) }}
        >
          <Phone size={11} />
          Call Now
        </button>
      </div>
    </div>
  )
}

export default function MyLeads() {
  const { data: leads, isLoading, refetch } = useMyLeads()
  const [activeFilter, setActiveFilter] = useState('All')
  const [callLead, setCallLead] = useState(null)

  const kpis = useMemo(() => computeKPIs(leads), [leads])

  const filtered = useMemo(() => {
    if (!leads) return []
    if (activeFilter === 'All') return leads
    return leads.filter(l => l.status === activeFilter)
  }, [leads, activeFilter])

  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })

  return (
    <div>
      {/* Top bar */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 18, fontWeight: 500, color: 'var(--text-primary)', margin: 0, letterSpacing: '-0.01em' }}>
            My Leads
          </h1>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>
            Today's batch · <span style={{ fontFamily: 'var(--font-mono)' }}>{leads?.length ?? '…'}</span> leads assigned
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
            {today}
          </span>
          <Button variant="secondary" size="sm" onClick={() => refetch()}>
            <RefreshCw size={12} />
            Refresh
          </Button>
        </div>
      </div>

      {/* KPI row — glass cards with countup */}
      <div className="stagger" style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
        <KPICard
          label="Calls Today"
          value={kpis.called}
          sub={`${kpis.total - kpis.called} remaining`}
          icon={PhoneCall}
        />
        <KPICard
          label="Booked Today"
          value={kpis.booked}
          sub={kpis.booked > 0 ? 'Great work!' : 'Keep dialing'}
          subColor={kpis.booked > 0 ? 'var(--success)' : undefined}
          accent={kpis.booked > 0}
          icon={Target}
        />
        <KPICard
          label="Connect Rate"
          value={kpis.connectRate}
          suffix="%"
          sub={kpis.connectRate >= 15 ? 'Above target' : kpis.connectRate >= 8 ? 'Near target' : 'Below target'}
          subColor={kpis.connectRate >= 15 ? 'var(--success)' : kpis.connectRate >= 8 ? 'var(--warning)' : 'var(--danger)'}
          icon={BarChart2}
        />
        <KPICard
          label="Batch Total"
          value={kpis.total}
          sub="Leads assigned today"
          icon={List}
        />
      </div>

      {/* Daily progress bar */}
      {leads && leads.length > 0 && (
        <div style={{
          background: 'var(--bg-surface)',
          border: '0.5px solid var(--border)',
          borderRadius: 8,
          padding: '10px 16px',
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          marginBottom: 16,
        }}>
          <div style={{ flex: 1, height: 6, background: 'var(--bg-elevated)', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{
              height: '100%',
              width: `${Math.min((kpis.called / Math.max(leads.length, 1)) * 100, 100)}%`,
              background: kpis.called >= leads.length ? 'var(--success)' : 'var(--accent)',
              borderRadius: 3,
              transition: 'width 0.4s ease',
            }} />
          </div>
          <div style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
            {kpis.called} / {leads.length}
          </div>
          {kpis.called >= leads.length && (
            <span style={{ fontSize: 11, color: 'var(--success)', fontWeight: 500 }}>Batch complete!</span>
          )}
        </div>
      )}

      {/* Status filter row — underline tabs */}
      <div style={{
        display: 'flex',
        gap: 0,
        borderBottom: '0.5px solid var(--border)',
        marginBottom: 16,
        overflowX: 'auto',
      }}>
        {STATUS_FILTERS.map(f => {
          const count = f !== 'All' && leads ? leads.filter(l => l.status === f).length : null
          const isActive = activeFilter === f
          return (
            <button
              key={f}
              onClick={() => setActiveFilter(f)}
              style={{
                height: 36,
                padding: '0 12px',
                background: 'transparent',
                border: 'none',
                borderBottom: isActive ? '2px solid var(--accent)' : '2px solid transparent',
                marginBottom: -0.5,
                color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
                fontSize: 13,
                cursor: 'pointer',
                fontFamily: 'var(--font-sans)',
                whiteSpace: 'nowrap',
                transition: 'all 0.1s',
                display: 'flex',
                alignItems: 'center',
                gap: 5,
              }}
            >
              {f}
              {count !== null && count > 0 && (
                <span style={{
                  fontSize: 10,
                  background: 'var(--bg-elevated)',
                  color: isActive ? 'var(--accent)' : 'var(--text-dim)',
                  padding: '1px 5px',
                  borderRadius: 3,
                  fontFamily: 'var(--font-mono)',
                  fontVariantNumeric: 'tabular-nums',
                }}>
                  {count}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* Table — glass surface */}
      <div className="glass" style={{ overflow: 'hidden', borderRadius: 10 }}>
        {/* Table header */}
        <div style={{
          display: 'flex', alignItems: 'center',
          borderBottom: '0.5px solid var(--border)',
          padding: '0',
          background: 'var(--bg-elevated)',
        }}>
          <div style={{ flex: '1 1 0', padding: '8px 16px' }} className="section-label">Business</div>
          <div style={{ flex: '0 0 120px', padding: '8px 8px' }} className="section-label">Niche</div>
          <div style={{ flex: '0 0 100px', padding: '8px 8px' }} className="section-label">City</div>
          <div style={{ flex: '0 0 130px', padding: '8px 8px' }} className="section-label">Phone</div>
          <div style={{ flex: '0 0 110px', padding: '8px 8px' }} className="section-label">Status</div>
          <div style={{ flex: '0 0 120px', padding: '8px 16px 8px 0', textAlign: 'right' }} className="section-label">Action</div>
        </div>

        {/* Rows */}
        {isLoading ? (
          <div>
            {[...Array(8)].map((_, i) => (
              <div key={i} style={{ height: 48, borderBottom: '0.5px solid var(--border)', background: 'var(--bg-surface)' }}>
                <div style={{ margin: '12px 16px', height: 14, width: `${40 + (i % 4) * 15}%`, background: 'var(--bg-elevated)', borderRadius: 4, animation: 'pulse 2s infinite' }} />
              </div>
            ))}
          </div>
        ) : !filtered.length ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '48px 16px', textAlign: 'center' }}>
            <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'var(--bg-elevated)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}>
              <Phone size={18} color="var(--text-muted)" />
            </div>
            <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-secondary)', margin: 0 }}>
              {activeFilter === 'All' ? 'No leads assigned today' : `No ${activeFilter} leads`}
            </p>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
              {activeFilter === 'All' ? 'Check back after the nightly batch runs.' : 'Try a different filter.'}
            </p>
          </div>
        ) : (
          filtered.map((lead, i) => (
            <LeadRow
              key={lead.id}
              lead={lead}
              onOpen={setCallLead}
              animDelay={i * 30}
            />
          ))
        )}
      </div>

      {/* Row count */}
      {filtered.length > 0 && (
        <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8, fontFamily: 'var(--font-mono)' }}>
          Showing {filtered.length} of {leads?.length ?? 0} leads
        </p>
      )}

      {/* Call Now modal — opened by row click or the Call Now button */}
      {callLead && (
        <CallModal
          lead={callLead}
          onClose={() => setCallLead(null)}
        />
      )}
    </div>
  )
}
