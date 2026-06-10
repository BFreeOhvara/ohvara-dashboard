import { useState, useMemo, useEffect } from 'react'
import { Phone, RefreshCw, MapPin, X, PhoneCall, Target, BarChart2, List, User, Tag, Globe, Check, Loader2 } from 'lucide-react'
import { useMyLeads, useUpdateLeadStatus } from '../../hooks/useLeads'
import { CallButton } from '../../components/rep/CallButton'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { KPICard } from '../../components/ui/KPICard'

const STATUS_FILTERS = ['All', 'New', 'Contacted', 'Interested', 'Callback', 'Not Interested']
// Status options reps can set from the detail panel
const PANEL_STATUSES = ['New', 'Contacted', 'Interested', 'Callback', 'Not Interested']

// KPI helper computed from leads data
function computeKPIs(leads) {
  if (!leads) return { called: 0, booked: 0, connectRate: 0, total: 0 }
  const total   = leads.length
  const booked  = leads.filter(l => l.status === 'Booked').length
  const called  = leads.filter(l => l.status !== 'New').length
  const reached = leads.filter(l => ['Contacted', 'Interested', 'Booked'].includes(l.status)).length
  const connectRate = called > 0 ? Math.round((reached / called) * 100) : 0
  return { called, booked, connectRate, total }
}

// Labeled field for the detail panel
function Field({ icon: Icon, label, value, mono = false }) {
  if (!value) return null
  return (
    <div style={{ marginBottom: 14 }}>
      <p className="section-label" style={{ marginBottom: 4, display: 'flex', alignItems: 'center', gap: 5 }}>
        {Icon && <Icon size={10} />} {label}
      </p>
      <p style={{
        fontSize: 13, color: 'var(--text-secondary)', margin: 0, lineHeight: 1.6,
        fontFamily: mono ? 'var(--font-mono)' : 'inherit',
        wordBreak: 'break-word',
      }}>
        {value}
      </p>
    </div>
  )
}

// Right-side detail panel — opens on row click
function LeadDetailPanel({ lead, onClose }) {
  const updateStatus = useUpdateLeadStatus()
  const [status, setStatus]       = useState(lead.status)
  const [saveState, setSaveState] = useState('idle') // idle | saving | saved | error

  // Re-sync when a different lead is selected
  useEffect(() => {
    setStatus(lead.status)
    setSaveState('idle')
  }, [lead.id])

  async function handleStatusChange(e) {
    const next = e.target.value
    setStatus(next)
    setSaveState('saving')
    try {
      await updateStatus.mutateAsync({ leadId: lead.id, status: next })
      setSaveState('saved')
      setTimeout(() => setSaveState(s => (s === 'saved' ? 'idle' : s)), 2000)
    } catch {
      setSaveState('error')
    }
  }

  return (
    <div
      className="panel-slide-in"
      style={{
        position: 'fixed', top: 0, right: 0, bottom: 0,
        width: 400, zIndex: 150,
        // solid backdrop — --bg-surface is translucent and lets the page bleed through
        background: '#0E0E1A',
        borderLeft: '0.5px solid var(--border)',
        display: 'flex', flexDirection: 'column',
      }}
    >
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'flex-start', gap: 12,
        padding: '16px 18px', borderBottom: '0.5px solid var(--border)', flexShrink: 0,
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: 15, fontWeight: 500, color: 'var(--text-primary)', margin: 0 }}>
            {lead.business_name}
          </p>
          <div style={{ marginTop: 6 }}>
            <Badge label={lead.status} />
          </div>
        </div>
        <button
          onClick={onClose}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 8 }}
        >
          <X size={17} />
        </button>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '18px' }} className="scrollbar-thin">

        {/* Status dropdown — saves immediately */}
        <div style={{ marginBottom: 20 }}>
          <p className="section-label" style={{ marginBottom: 6 }}>Status</p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <select
              value={status}
              onChange={handleStatusChange}
              disabled={saveState === 'saving'}
              style={{
                flex: 1, height: 40, padding: '0 12px',
                background: 'var(--bg-elevated)', border: '0.5px solid var(--border)',
                borderRadius: 8, fontSize: 13, color: 'var(--text-primary)',
                fontFamily: 'var(--font-sans)', cursor: 'pointer',
              }}
            >
              {/* Keep the lead's current status visible even if it's outside the rep set */}
              {!PANEL_STATUSES.includes(lead.status) && (
                <option value={lead.status}>{lead.status}</option>
              )}
              {PANEL_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            {saveState === 'saving' && <Loader2 size={15} color="var(--accent)" style={{ animation: 'spin 1s linear infinite' }} />}
            {saveState === 'saved'  && <Check size={15} color="var(--success)" />}
          </div>
          {saveState === 'error' && (
            <p style={{ fontSize: 11, color: 'var(--danger)', marginTop: 5 }}>Save failed — try again.</p>
          )}
          {saveState === 'saved' && (
            <p style={{ fontSize: 11, color: 'var(--success)', marginTop: 5 }}>Saved</p>
          )}
        </div>

        {/* Lead details */}
        <Field icon={User}   label="Contact"  value={lead.contact_name} />
        <Field icon={Phone}  label="Phone"    value={lead.phone} mono />
        <Field icon={Tag}    label="Niche"    value={lead.niche} />
        <Field icon={MapPin} label="Location" value={[lead.city, lead.state].filter(Boolean).join(', ')} />
        <Field icon={Globe}  label="Source"   value={lead.source === 'google_maps' ? 'Google Maps' : lead.source === 'indeed' ? 'Indeed' : lead.source} />
        {lead.website && <Field icon={Globe} label="Website" value={lead.website} />}
        {lead.email   && <Field label="Email" value={lead.email} mono />}

        {lead.pain_points && (
          <div style={{
            marginBottom: 14, padding: '10px 12px',
            background: 'var(--bg-elevated)', borderRadius: 8, border: '0.5px solid var(--border)',
          }}>
            <p className="section-label" style={{ marginBottom: 4 }}>Pain Points</p>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: 0, lineHeight: 1.6 }}>{lead.pain_points}</p>
          </div>
        )}

        {lead.notes && (
          <div style={{
            marginBottom: 14, padding: '10px 12px',
            background: 'var(--bg-elevated)', borderRadius: 8, border: '0.5px solid var(--border)',
          }}>
            <p className="section-label" style={{ marginBottom: 4 }}>Notes</p>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: 0, lineHeight: 1.6 }}>{lead.notes}</p>
          </div>
        )}
      </div>

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}

// Individual table row — clicking anywhere opens the detail panel
function LeadRow({ lead, onSelect, isSelected, animDelay = 0 }) {
  return (
    <div
      className="table-row-animated"
      onClick={() => onSelect(lead)}
      style={{
        display: 'flex', alignItems: 'center', gap: 0,
        borderBottom: '0.5px solid var(--border)',
        background: isSelected ? 'var(--bg-elevated)' : 'transparent',
        transition: 'background-color 100ms',
        cursor: 'pointer',
        animationDelay: `${animDelay}ms`,
      }}
      onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = 'var(--bg-elevated)' }}
      onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = 'transparent' }}
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
      <div
        style={{ flex: '0 0 120px', padding: '8px 16px 8px 0', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', minHeight: 44 }}
        onClick={e => e.stopPropagation()}
      >
        <CallButton lead={lead} />
      </div>
    </div>
  )
}

export default function MyLeads() {
  const { data: leads, isLoading, refetch } = useMyLeads()
  const [selectedLead, setSelectedLead] = useState(null)
  const [activeFilter, setActiveFilter] = useState('All')

  const kpis = useMemo(() => computeKPIs(leads), [leads])

  const filtered = useMemo(() => {
    if (!leads) return []
    if (activeFilter === 'All') return leads
    return leads.filter(l => l.status === activeFilter)
  }, [leads, activeFilter])

  // Keep the panel's lead fresh after a status save refetches the list
  const panelLead = useMemo(() => {
    if (!selectedLead) return null
    return leads?.find(l => l.id === selectedLead.id) || selectedLead
  }, [selectedLead, leads])

  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })

  return (
    <div style={{ display: 'flex', height: '100%' }}>
      {/* Main content — shifts left when panel open */}
      <div style={{ flex: 1, minWidth: 0, marginRight: panelLead ? 420 : 0, transition: 'margin-right 180ms cubic-bezier(0.16,1,0.3,1)' }}>

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
                onSelect={setSelectedLead}
                isSelected={panelLead?.id === lead.id}
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
      </div>

      {/* Lead detail panel */}
      {panelLead && (
        <LeadDetailPanel
          lead={panelLead}
          onClose={() => setSelectedLead(null)}
        />
      )}
    </div>
  )
}
