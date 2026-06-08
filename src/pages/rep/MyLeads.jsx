import { useState, useMemo } from 'react'
import { Phone, RefreshCw, ChevronDown, ChevronUp, MapPin, Save, X } from 'lucide-react'
import { useMyLeads, useUpdateLeadStatus } from '../../hooks/useLeads'
import { AIScriptPanel } from '../../components/rep/AIScriptPanel'
import { CallButton } from '../../components/rep/CallButton'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { Select, Textarea } from '../../components/ui/Input'

const STATUS_FILTERS = ['All', 'New', 'Contacted', 'Voicemail', 'No Answer', 'Interested', 'Booked', 'Not Interested']
const STATUSES = ['New', 'Contacted', 'Voicemail', 'No Answer', 'Interested', 'Booked', 'Not Interested']

function fmt(date) {
  return new Date(date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

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

// Inline row editor — appears between table rows on expand
function RowEditor({ lead, onClose }) {
  const [status, setStatus] = useState(lead.status)
  const [notes,  setNotes ] = useState(lead.notes || '')
  const [saving, setSaving] = useState(false)
  const updateStatus = useUpdateLeadStatus()

  async function handleSave() {
    setSaving(true)
    await updateStatus.mutateAsync({ leadId: lead.id, status, notes })
    setSaving(false)
    onClose()
  }

  return (
    <div style={{
      background: 'var(--bg-elevated)',
      borderBottom: '0.5px solid var(--border)',
      padding: '12px 16px',
    }}>
      <div style={{ display: 'flex', gap: 12 }}>
        {/* Contact info */}
        <div style={{ minWidth: 0, flex: '0 0 200px' }}>
          <p className="section-label" style={{ marginBottom: 6 }}>Contact</p>
          {lead.phone && (
            <a href={`tel:${lead.phone}`} style={{
              display: 'flex', alignItems: 'center', gap: 6,
              fontSize: 12, color: 'var(--text-secondary)',
              fontFamily: 'var(--font-mono)',
              textDecoration: 'none',
            }}>
              <Phone size={10} /> {lead.phone}
            </a>
          )}
          {lead.city && (
            <p style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
              <MapPin size={9} /> {lead.city}{lead.state ? `, ${lead.state}` : ''}
            </p>
          )}
          {lead.pain_points && (
            <div style={{ marginTop: 8, padding: '6px 8px', background: 'var(--bg-overlay)', borderRadius: 4 }}>
              <p className="section-label" style={{ marginBottom: 2 }}>Pain Points</p>
              <p style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.5 }}>{lead.pain_points}</p>
            </div>
          )}
        </div>

        {/* Status + notes */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', gap: 8 }}>
          <div style={{ flex: '0 0 160px' }}>
            <p className="section-label" style={{ marginBottom: 6 }}>Status</p>
            <select
              value={status}
              onChange={e => setStatus(e.target.value)}
              style={{
                width: '100%', height: 32, padding: '0 8px',
                background: 'var(--bg-base)', border: '0.5px solid var(--border)',
                borderRadius: 6, fontSize: 12, color: 'var(--text-primary)',
                fontFamily: 'var(--font-sans)', cursor: 'pointer',
              }}
            >
              {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p className="section-label" style={{ marginBottom: 6 }}>Call Notes</p>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={2}
              placeholder="What happened on this call?"
              style={{
                width: '100%', padding: '6px 8px',
                background: 'var(--bg-base)', border: '0.5px solid var(--border)',
                borderRadius: 6, fontSize: 12, color: 'var(--text-primary)',
                fontFamily: 'var(--font-sans)', resize: 'none', lineHeight: 1.5,
              }}
            />
          </div>
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-end', flexShrink: 0 }}>
          <button
            onClick={onClose}
            style={{ color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer', padding: 2 }}
          >
            <X size={13} />
          </button>
          <Button variant="secondary" size="sm" onClick={handleSave} disabled={saving}>
            <Save size={11} />
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>
    </div>
  )
}

// Individual table row
function LeadRow({ lead, onScriptOpen }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <>
      {/* Main row */}
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 0,
          borderBottom: '0.5px solid var(--border)',
          background: expanded ? 'var(--bg-elevated)' : 'transparent',
          transition: 'background-color 100ms',
          cursor: 'default',
        }}
        onMouseEnter={e => { if (!expanded) e.currentTarget.style.background = 'var(--bg-elevated)' }}
        onMouseLeave={e => { if (!expanded) e.currentTarget.style.background = 'transparent' }}
      >
        {/* Business name + contact */}
        <div style={{ flex: '1 1 0', minWidth: 0, padding: '10px 16px' }}>
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
        <div style={{ flex: '0 0 120px', padding: '10px 8px', fontSize: 12, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {lead.niche || '—'}
        </div>

        {/* City */}
        <div style={{ flex: '0 0 100px', padding: '10px 8px', fontSize: 12, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {lead.city || '—'}
        </div>

        {/* Phone */}
        <div style={{ flex: '0 0 130px', padding: '10px 8px', fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {lead.phone || '—'}
        </div>

        {/* Status */}
        <div style={{ flex: '0 0 110px', padding: '10px 8px' }}>
          <Badge label={lead.status} />
        </div>

        {/* Actions */}
        <div style={{ flex: '0 0 160px', padding: '8px 16px 8px 0', display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end' }}>
          <CallButton
            lead={lead}
            onScriptOpen={() => onScriptOpen(lead)}
            onCallEnd={() => {}}
          />
          <button
            onClick={() => setExpanded(v => !v)}
            style={{
              color: 'var(--text-muted)', background: 'none', border: 'none',
              cursor: 'pointer', padding: 4, display: 'flex', alignItems: 'center',
              borderRadius: 4, transition: 'color 100ms',
            }}
            onMouseEnter={e => e.currentTarget.style.color = 'var(--text-primary)'}
            onMouseLeave={e => e.currentTarget.style.color = 'var(--text-muted)'}
          >
            {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </button>
        </div>
      </div>

      {/* Expanded editor */}
      {expanded && <RowEditor lead={lead} onClose={() => setExpanded(false)} />}
    </>
  )
}

// KPI card
function KpiCard({ label, value, sub, subColor }) {
  return (
    <div style={{
      flex: 1, minWidth: 0,
      background: 'var(--bg-surface)',
      border: '0.5px solid var(--border)',
      borderRadius: 8,
      padding: '14px 16px',
    }}>
      <p style={{ fontSize: 11, fontWeight: 500, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', margin: 0 }}>
        {label}
      </p>
      <p style={{
        fontSize: 28, fontWeight: 500, lineHeight: 1,
        fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums',
        color: 'var(--text-primary)', margin: '8px 0 0',
      }}>
        {value ?? '—'}
      </p>
      {sub && (
        <p style={{ fontSize: 11, color: subColor || 'var(--text-muted)', marginTop: 4 }}>
          {sub}
        </p>
      )}
    </div>
  )
}

export default function MyLeads() {
  const { data: leads, isLoading, refetch } = useMyLeads()
  const [scriptLead, setScriptLead]         = useState(null)
  const [activeFilter, setActiveFilter]     = useState('All')

  const kpis = useMemo(() => computeKPIs(leads), [leads])

  const filtered = useMemo(() => {
    if (!leads) return []
    if (activeFilter === 'All') return leads
    return leads.filter(l => l.status === activeFilter)
  }, [leads, activeFilter])

  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })

  return (
    <div style={{ display: 'flex', height: '100%' }}>
      {/* Main content — shifts left when panel open */}
      <div style={{ flex: 1, minWidth: 0, marginRight: scriptLead ? 420 : 0, transition: 'margin-right 180ms cubic-bezier(0.16,1,0.3,1)' }}>

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

        {/* KPI row */}
        <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
          <KpiCard
            label="Calls Today"
            value={kpis.called}
            sub={`${kpis.total - kpis.called} remaining`}
          />
          <KpiCard
            label="Booked Today"
            value={kpis.booked}
            sub={kpis.booked > 0 ? 'Great work!' : 'Keep dialing'}
            subColor={kpis.booked > 0 ? 'var(--success)' : undefined}
          />
          <KpiCard
            label="Connect Rate"
            value={`${kpis.connectRate}%`}
            sub={kpis.connectRate >= 15 ? 'Above target' : kpis.connectRate >= 8 ? 'Near target' : 'Below target'}
            subColor={kpis.connectRate >= 15 ? 'var(--success)' : kpis.connectRate >= 8 ? 'var(--warning)' : 'var(--danger)'}
          />
          <KpiCard
            label="Batch Total"
            value={kpis.total}
            sub="Leads assigned today"
          />
        </div>

        {/* Status filter row */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 12, flexWrap: 'wrap' }}>
          {STATUS_FILTERS.map(f => (
            <button
              key={f}
              onClick={() => setActiveFilter(f)}
              style={{
                padding: '4px 10px',
                borderRadius: 4,
                fontSize: 12,
                fontWeight: 500,
                border: '0.5px solid',
                cursor: 'pointer',
                transition: 'all 100ms',
                background: activeFilter === f ? 'var(--accent-dim)' : 'transparent',
                borderColor: activeFilter === f ? 'var(--accent-border)' : 'var(--border)',
                color: activeFilter === f ? 'var(--accent)' : 'var(--text-muted)',
              }}
            >
              {f}
              {f !== 'All' && leads && (
                <span style={{
                  marginLeft: 4,
                  fontFamily: 'var(--font-mono)',
                  fontSize: 10,
                  color: activeFilter === f ? 'var(--accent)' : 'var(--text-dim)',
                }}>
                  {leads.filter(l => l.status === f).length}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Table */}
        <div style={{
          background: 'var(--bg-surface)',
          border: '0.5px solid var(--border)',
          borderRadius: 8,
          overflow: 'hidden',
        }}>
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
            <div style={{ flex: '0 0 160px', padding: '8px 16px 8px 0', textAlign: 'right' }} className="section-label">Action</div>
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
            filtered.map(lead => (
              <LeadRow
                key={lead.id}
                lead={lead}
                onScriptOpen={setScriptLead}
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

      {/* AI Script Panel */}
      {scriptLead && (
        <AIScriptPanel
          lead={scriptLead}
          onClose={() => setScriptLead(null)}
        />
      )}
    </div>
  )
}
