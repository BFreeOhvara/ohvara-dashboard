import { useState, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { CalendarClock, CheckCircle, Ban, Search, Phone, Calendar, X, PhoneOff, RefreshCw } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { useMyAppointments } from '../../hooks/useAppointments'
import { useAuth } from '../../hooks/useAuth'
import { supabase } from '../../lib/supabase'
import { formatInTimezone, inferTimezoneFromState, timezoneAbbr, DEFAULT_TIMEZONE } from '../../lib/timezones'
import { KPICard } from '../../components/ui/KPICard'
import { Badge } from '../../components/ui/Badge'

// ── Closer pipeline tabs ──────────────────────────────────────────────────────
const CLOSER_TABS = [
  { key: 'pending',            label: 'Pending',            icon: CalendarClock },
  { key: 'closed',             label: 'Closed',             icon: CheckCircle },
  { key: 'lost',               label: 'Lost',               icon: Ban },
  { key: 'no_show',            label: 'No Show',            icon: PhoneOff },
  { key: 'needs_rescheduling', label: 'Needs Rescheduling', icon: RefreshCw },
  { key: 'all',                label: 'All',                icon: null },
]

// ── Appointment-setter status tabs ────────────────────────────────────────────
const SETTER_STATUSES = [
  'New', 'No Answer', 'Follow-Up', 'Appointment Booked', 'Not Interested',
]

// Colors per status — matches Badge.jsx STATUS_STYLES tokens exactly
const STATUS_TAB_COLORS = {
  'New':                { color: 'var(--info)',    dim: 'var(--info-dim)',        border: 'rgba(56,189,248,0.20)' },
  'No Answer':          { color: '#94A3B8',         dim: 'rgba(148,163,184,0.10)', border: 'rgba(148,163,184,0.25)' },
  'Follow-Up':          { color: 'var(--warning)',  dim: 'var(--warning-dim)',     border: 'rgba(245,158,11,0.20)' },
  'Appointment Booked': { color: 'var(--success)',  dim: 'var(--success-dim)',     border: 'rgba(34,197,94,0.20)' },
  'Not Interested':     { color: 'var(--danger)',   dim: 'var(--danger-dim)',      border: 'rgba(239,68,68,0.20)' },
  'All':                { color: 'var(--accent)',   dim: 'var(--accent-dim)',      border: 'var(--accent-border)' },
}

// Colors for the closer pipeline sub-tabs
const CLOSER_TAB_COLORS = {
  pending:            { color: 'var(--warning)', dim: 'var(--warning-dim)', border: 'rgba(245,158,11,0.20)' },
  closed:             { color: 'var(--success)', dim: 'var(--success-dim)', border: 'rgba(34,197,94,0.20)' },
  lost:               { color: 'var(--danger)',  dim: 'var(--danger-dim)',  border: 'rgba(239,68,68,0.20)' },
  no_show:            { color: '#94A3B8',        dim: 'rgba(148,163,184,0.10)', border: 'rgba(148,163,184,0.25)' },
  needs_rescheduling: { color: 'var(--info)',    dim: 'var(--info-dim)',    border: 'rgba(56,189,248,0.20)' },
  all:                { color: 'var(--accent)',  dim: 'var(--accent-dim)',  border: 'var(--accent-border)' },
}

const cell = (basis, extra = {}) => ({
  flex: basis, padding: '10px 12px', fontSize: 12, color: 'var(--text-secondary)',
  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0, ...extra,
})

function fmtDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })
}

// Prompt 224: shows the CLIENT's local time (inferred from the lead's
// state), explicitly labeled, rather than a bare time silently converted
// to the viewing closer's own zone — a bare "Jul 6, 2:00 PM" could
// previously be misread as either. Nate's own equivalent (his profile.timezone,
// Settings > Regional) is available on hover rather than taking up column
// width in this fixed 150px cell.
function fmtDateTime(iso, leadState) {
  if (!iso) return '—'
  const clientTz = inferTimezoneFromState(leadState)
  return `${formatInTimezone(iso, clientTz, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} ${timezoneAbbr(clientTz)}`
}

function apptTimeTitle(iso, leadState, viewerTz) {
  if (!iso) return undefined
  const clientTz = inferTimezoneFromState(leadState)
  const yours = formatInTimezone(iso, viewerTz, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  return `Client's local time. Your time: ${yours} ${timezoneAbbr(viewerTz)}`
}

function QueueTable({ columns, rows, renderRow, emptyText, emptyIcon: EmptyIcon }) {
  return (
    <div className="glass" style={{ borderRadius: 12, overflow: 'hidden' }}>
      <div style={{ overflowX: 'auto' }} className="scrollbar-thin">
        <div style={{ minWidth: 600 }}>
          <div style={{ display: 'flex', borderBottom: '0.5px solid var(--border)', background: 'var(--bg-elevated)' }}>
            {columns.map(([label, basis]) => (
              <div key={label} style={cell(basis, { fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', fontWeight: 500 })}>
                {label}
              </div>
            ))}
          </div>
          <div style={{ height: 480, overflowY: 'auto' }} className="scrollbar-thin">
            {!rows?.length ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', padding: '48px 16px', textAlign: 'center' }}>
                {EmptyIcon && (
                  <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'var(--bg-elevated)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}>
                    <EmptyIcon size={18} color="var(--text-muted)" />
                  </div>
                )}
                <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-secondary)', margin: 0 }}>{emptyText}</p>
              </div>
            ) : rows.map(renderRow)}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Closer pipeline sub-views ─────────────────────────────────────────────────

function PendingTab({ rows, tz }) {
  return (
    <QueueTable
      columns={[['Business', '1 1 0'], ['Niche', '0 0 120px'], ['City', '0 0 110px'], ['Phone', '0 0 140px'], ['Set By', '0 0 120px'], ['Scheduled', '0 0 150px']]}
      rows={rows}
      emptyText="No pending appointments."
      emptyIcon={CalendarClock}
      renderRow={a => (
        <div key={a.id} style={{ display: 'flex', borderBottom: '0.5px solid var(--border)' }}>
          <div style={cell('1 1 0', { color: 'var(--text-primary)', fontWeight: 500 })}>{a.lead?.business_name || '—'}</div>
          <div style={cell('0 0 120px')}>{a.lead?.niche || '—'}</div>
          <div style={cell('0 0 110px')}>{a.lead?.city || '—'}</div>
          <div style={cell('0 0 140px', { fontFamily: 'var(--font-mono)' })}>{a.lead?.phone || '—'}</div>
          <div style={cell('0 0 120px')}>{a.rep?.full_name || '—'}</div>
          <div style={cell('0 0 150px', { fontFamily: 'var(--font-mono)' })} title={apptTimeTitle(a.scheduled_at, a.lead?.state, tz)}>{fmtDateTime(a.scheduled_at, a.lead?.state)}</div>
        </div>
      )}
    />
  )
}

function ClosedTab({ rows }) {
  return (
    <QueueTable
      columns={[['Business', '1 1 0'], ['Niche', '0 0 120px'], ['City', '0 0 110px'], ['Phone', '0 0 140px'], ['Set By', '0 0 120px'], ['Closed On', '0 0 130px'], ['Revenue', '0 0 110px']]}
      rows={rows}
      emptyText="No closed deals yet."
      emptyIcon={CheckCircle}
      renderRow={a => (
        <div key={a.id} style={{ display: 'flex', borderBottom: '0.5px solid var(--border)' }}>
          <div style={cell('1 1 0', { color: 'var(--text-primary)', fontWeight: 500 })}>{a.lead?.business_name || '—'}</div>
          <div style={cell('0 0 120px')}>{a.lead?.niche || '—'}</div>
          <div style={cell('0 0 110px')}>{a.lead?.city || '—'}</div>
          <div style={cell('0 0 140px', { fontFamily: 'var(--font-mono)' })}>{a.lead?.phone || '—'}</div>
          <div style={cell('0 0 120px')}>{a.rep?.full_name || '—'}</div>
          <div style={cell('0 0 130px', { fontFamily: 'var(--font-mono)' })}>{fmtDate(a.updated_at || a.created_at)}</div>
          <div style={cell('0 0 110px', { color: 'var(--success)', fontFamily: 'var(--font-mono)' })}>
            {a.deal_value ? `$${Number(a.deal_value).toLocaleString()}` : '—'}
          </div>
        </div>
      )}
    />
  )
}

function LostTab({ rows }) {
  return (
    <QueueTable
      columns={[['Business', '1 1 0'], ['Niche', '0 0 120px'], ['City', '0 0 110px'], ['Phone', '0 0 140px'], ['Set By', '0 0 120px'], ['Outcome', '0 0 120px'], ['Date', '0 0 130px']]}
      rows={rows}
      emptyText="No lost deals yet."
      emptyIcon={Ban}
      renderRow={a => (
        <div key={a.id} style={{ display: 'flex', borderBottom: '0.5px solid var(--border)' }}>
          <div style={cell('1 1 0', { color: 'var(--text-primary)', fontWeight: 500 })}>{a.lead?.business_name || '—'}</div>
          <div style={cell('0 0 120px')}>{a.lead?.niche || '—'}</div>
          <div style={cell('0 0 110px')}>{a.lead?.city || '—'}</div>
          <div style={cell('0 0 140px', { fontFamily: 'var(--font-mono)' })}>{a.lead?.phone || '—'}</div>
          <div style={cell('0 0 120px')}>{a.rep?.full_name || '—'}</div>
          <div style={cell('0 0 120px')}><Badge label={a.outcome} /></div>
          <div style={cell('0 0 130px', { fontFamily: 'var(--font-mono)' })}>{fmtDate(a.updated_at || a.created_at)}</div>
        </div>
      )}
    />
  )
}

function NoShowTab({ rows, tz }) {
  return (
    <QueueTable
      columns={[['Business', '1 1 0'], ['Niche', '0 0 120px'], ['City', '0 0 110px'], ['Phone', '0 0 140px'], ['Set By', '0 0 120px'], ['Was Scheduled', '0 0 150px']]}
      rows={rows}
      emptyText="No no-shows."
      emptyIcon={PhoneOff}
      renderRow={a => (
        <div key={a.id} style={{ display: 'flex', borderBottom: '0.5px solid var(--border)' }}>
          <div style={cell('1 1 0', { color: 'var(--text-primary)', fontWeight: 500 })}>{a.lead?.business_name || '—'}</div>
          <div style={cell('0 0 120px')}>{a.lead?.niche || '—'}</div>
          <div style={cell('0 0 110px')}>{a.lead?.city || '—'}</div>
          <div style={cell('0 0 140px', { fontFamily: 'var(--font-mono)' })}>{a.lead?.phone || '—'}</div>
          <div style={cell('0 0 120px')}>{a.rep?.full_name || '—'}</div>
          <div style={cell('0 0 150px', { fontFamily: 'var(--font-mono)' })} title={apptTimeTitle(a.scheduled_at, a.lead?.state, tz)}>{fmtDateTime(a.scheduled_at, a.lead?.state)}</div>
        </div>
      )}
    />
  )
}

function NeedsReschedulingTab({ rows, tz }) {
  return (
    <QueueTable
      columns={[['Business', '1 1 0'], ['Niche', '0 0 120px'], ['City', '0 0 110px'], ['Phone', '0 0 140px'], ['Set By', '0 0 120px'], ['Was Scheduled', '0 0 150px']]}
      rows={rows}
      emptyText="No appointments need rescheduling."
      emptyIcon={RefreshCw}
      renderRow={a => (
        <div key={a.id} style={{ display: 'flex', borderBottom: '0.5px solid var(--border)' }}>
          <div style={cell('1 1 0', { color: 'var(--text-primary)', fontWeight: 500 })}>{a.lead?.business_name || '—'}</div>
          <div style={cell('0 0 120px')}>{a.lead?.niche || '—'}</div>
          <div style={cell('0 0 110px')}>{a.lead?.city || '—'}</div>
          <div style={cell('0 0 140px', { fontFamily: 'var(--font-mono)' })}>{a.lead?.phone || '—'}</div>
          <div style={cell('0 0 120px')}>{a.rep?.full_name || '—'}</div>
          <div style={cell('0 0 150px', { fontFamily: 'var(--font-mono)' })} title={apptTimeTitle(a.scheduled_at, a.lead?.state, tz)}>{fmtDateTime(a.scheduled_at, a.lead?.state)}</div>
        </div>
      )}
    />
  )
}

const ALL_TAB_STATUS_STYLES = {
  pending:            { color: 'var(--warning)', bg: 'var(--warning-dim)',  border: 'rgba(245,158,11,0.20)',   label: 'pending' },
  completed:          { color: 'var(--success)', bg: 'var(--success-dim)',  border: 'rgba(34,197,94,0.20)',    label: 'closed' },
  lost:               { color: 'var(--danger)',  bg: 'var(--danger-dim)',   border: 'rgba(239,68,68,0.20)',    label: 'lost' },
  no_show:            { color: '#94A3B8',        bg: 'rgba(148,163,184,0.10)', border: 'rgba(148,163,184,0.25)', label: 'no show' },
  missed:             { color: '#94A3B8',        bg: 'rgba(148,163,184,0.10)', border: 'rgba(148,163,184,0.25)', label: 'missed' },
  needs_rescheduling: { color: 'var(--info)',    bg: 'var(--info-dim)',     border: 'rgba(56,189,248,0.20)',   label: 'reschedule' },
}

function AllStatusBadge({ status, outcome }) {
  const key = (outcome === 'closed' || status === 'completed') ? 'completed' : (status || 'pending')
  const s = ALL_TAB_STATUS_STYLES[key] || ALL_TAB_STATUS_STYLES.pending
  return (
    <span style={{
      fontSize: 10, padding: '2px 7px', borderRadius: 10,
      background: s.bg, color: s.color, border: `0.5px solid ${s.border}`,
      fontFamily: 'var(--font-mono)', fontWeight: 500, whiteSpace: 'nowrap',
    }}>
      {s.label}
    </span>
  )
}

function AllTab({ rows, tz }) {
  return (
    <QueueTable
      columns={[['Business', '1 1 0'], ['Niche', '0 0 120px'], ['City', '0 0 110px'], ['Phone', '0 0 140px'], ['Set By', '0 0 120px'], ['Scheduled', '0 0 150px'], ['Status', '0 0 110px']]}
      rows={rows}
      emptyText="No appointments."
      emptyIcon={CalendarClock}
      renderRow={a => (
        <div key={a.id} style={{ display: 'flex', borderBottom: '0.5px solid var(--border)' }}>
          <div style={cell('1 1 0', { color: 'var(--text-primary)', fontWeight: 500 })}>{a.lead?.business_name || '—'}</div>
          <div style={cell('0 0 120px')}>{a.lead?.niche || '—'}</div>
          <div style={cell('0 0 110px')}>{a.lead?.city || '—'}</div>
          <div style={cell('0 0 140px', { fontFamily: 'var(--font-mono)' })}>{a.lead?.phone || '—'}</div>
          <div style={cell('0 0 120px')}>{a.rep?.full_name || '—'}</div>
          <div style={cell('0 0 150px', { fontFamily: 'var(--font-mono)' })} title={apptTimeTitle(a.scheduled_at, a.lead?.state, tz)}>{fmtDateTime(a.scheduled_at, a.lead?.state)}</div>
          <div style={cell('0 0 110px')}><AllStatusBadge status={a.status} outcome={a.outcome} /></div>
        </div>
      )}
    />
  )
}

// ── Lead detail overlay ───────────────────────────────────────────────────────
function LeadDetailOverlay({ lead, onClose }) {
  if (!lead) return null
  return createPortal(
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 9998, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={onClose}
    >
      <div
        style={{ background: '#13131F', border: '0.5px solid var(--border)', borderRadius: 12, padding: '20px 24px', width: 360, maxWidth: '90vw' }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16 }}>
          <div>
            <p style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>{lead.business_name || '—'}</p>
            <div style={{ marginTop: 6 }}><Badge label={lead.status || 'New'} /></div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 2 }}>
            <X size={16} />
          </button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {[
            ['Phone',     lead.phone,         'var(--font-mono)'],
            ['Niche',     lead.niche,         undefined],
            ['City',      lead.city,          undefined],
            ['Follow-up', lead.follow_up_at ? fmtDate(lead.follow_up_at) : null, 'var(--font-mono)'],
          ].filter(([, v]) => v).map(([label, value, ff]) => (
            <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{label}</span>
              <span style={{ fontSize: 12, color: 'var(--text-primary)', fontFamily: ff }}>{value}</span>
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body
  )
}

// ── Appointment-setting view ──────────────────────────────────────────────────

function useRepLeads(profileId) {
  return useQuery({
    queryKey: ['leads', 'rep-pipeline', profileId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('leads')
        .select('id, business_name, phone, city, niche, status, follow_up_at, created_at')
        .eq('assigned_rep_id', profileId)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data || []
    },
    enabled: !!profileId,
  })
}

function SetterView({ profileId, search }) {
  const { data: leads = [], isLoading } = useRepLeads(profileId)
  const [statusFilter, setStatusFilter] = useState('New')
  const [selectedLead, setSelectedLead] = useState(null)

  const counts = useMemo(() => {
    const out = { All: leads.length }
    for (const s of SETTER_STATUSES) out[s] = 0
    for (const l of leads) if (out[l.status] !== undefined) out[l.status]++
    return out
  }, [leads])

  const filtered = useMemo(() => {
    let list = statusFilter === 'All' ? leads : leads.filter(l => l.status === statusFilter)
    if (search.trim()) {
      const q = search.toLowerCase()
      const qDigits = q.replace(/\D/g, '')
      list = list.filter(l =>
        l.business_name?.toLowerCase().includes(q) ||
        l.niche?.toLowerCase().includes(q) ||
        (qDigits && (l.phone || '').replace(/\D/g, '').includes(qDigits))
      )
    }
    return list
  }, [leads, statusFilter, search])

  return (
    <div>
      {/* KPI row */}
      <div className="stagger" style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        <KPICard label="Total" value={counts.All} sub="leads assigned" icon={Phone} />
        <KPICard label="Booked" value={counts['Appointment Booked'] || 0} sub="appointments set" icon={Calendar} />
      </div>

      {/* Status filter tabs — order: statuses first, All last; colored per status */}
      <div style={{ display: 'flex', gap: 4, borderBottom: '0.5px solid var(--border)', marginBottom: 20, overflowX: 'auto' }}>
        {[...SETTER_STATUSES, 'All'].map(s => {
          const tc = STATUS_TAB_COLORS[s]
          const active = statusFilter === s
          return (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '10px 14px', background: 'none', cursor: 'pointer',
                border: 'none', borderBottom: active ? `2px solid ${tc.color}` : '2px solid transparent',
                fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap',
                color: tc.color,
              }}
            >
              {s}
              <span style={{
                fontSize: 10, padding: '1px 6px', borderRadius: 10, fontFamily: 'var(--font-mono)',
                background: tc.dim,
                color: tc.color,
                border: `0.5px solid ${tc.border}`,
              }}>
                {isLoading ? '…' : counts[s] ?? 0}
              </span>
            </button>
          )
        })}
      </div>

      {/* Leads table — click any row to open detail overlay */}
      <QueueTable
        columns={[['Business', '1 1 0'], ['Niche', '0 0 130px'], ['City', '0 0 110px'], ['Phone', '0 0 140px'], ['Status', '0 0 140px'], ['Follow-Up', '0 0 120px']]}
        rows={filtered}
        emptyText={isLoading ? 'Loading…' : {
          'New': 'No new leads',
          'No Answer': 'No no-answer leads',
          'Follow-Up': 'No follow-up leads',
          'Appointment Booked': 'No booked appointments',
          'Not Interested': 'No not-interested leads',
          'All': 'No leads',
        }[statusFilter] || 'No leads'}
        emptyIcon={Phone}
        renderRow={l => (
          <div
            key={l.id}
            onClick={() => setSelectedLead(l)}
            style={{ display: 'flex', borderBottom: '0.5px solid var(--border)', cursor: 'pointer', transition: 'background 100ms' }}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-elevated)' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
          >
            <div style={cell('1 1 0', { color: 'var(--text-primary)', fontWeight: 500 })}>{l.business_name || '—'}</div>
            <div style={cell('0 0 130px')}>{l.niche || '—'}</div>
            <div style={cell('0 0 110px')}>{l.city || '—'}</div>
            <div style={cell('0 0 140px', { fontFamily: 'var(--font-mono)', fontSize: 11 })}>{l.phone || '—'}</div>
            <div style={cell('0 0 140px')}><Badge label={l.status || 'New'} /></div>
            <div style={cell('0 0 120px', { fontFamily: 'var(--font-mono)' })}>{fmtDate(l.follow_up_at)}</div>
          </div>
        )}
      />
      <LeadDetailOverlay lead={selectedLead} onClose={() => setSelectedLead(null)} />
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

const VIEW_TABS = [
  { key: 'closer', label: 'Closer',              icon: CalendarClock },
  { key: 'setter', label: 'Appointment Setting', icon: Phone },
]

export default function CloserPipeline() {
  const { profile } = useAuth()
  const tz = profile?.timezone || DEFAULT_TIMEZONE
  const { data: allAppts, isLoading } = useMyAppointments()
  const [view, setView] = useState('closer')
  const [closerTab, setCloserTab] = useState('pending')
  const [search, setSearch] = useState('')

  const filteredAppts = useMemo(() => {
    if (!allAppts) return { pending: [], closed: [], lost: [], no_show: [], needs_rescheduling: [], all: [] }
    const s = search.trim().toLowerCase()
    const sDigits = s.replace(/\D/g, '')
    const appts = s
      ? allAppts.filter(a =>
          (a.lead?.business_name || '').toLowerCase().includes(s) ||
          (sDigits && (a.lead?.phone || '').replace(/\D/g, '').includes(sDigits))
        )
      : allAppts
    return {
      pending:            appts.filter(a => a.status === 'pending'),
      closed:             appts.filter(a => a.outcome === 'closed'),
      lost:               appts.filter(a => a.outcome === 'lost'),
      no_show:            appts.filter(a => a.status === 'no_show' || a.outcome === 'no_show' || a.status === 'missed'),
      needs_rescheduling: appts.filter(a => a.status === 'needs_rescheduling'),
      all:                appts,
    }
  }, [allAppts, search])

  const closerKPIs = useMemo(() => {
    const all = allAppts || []
    const now = new Date()
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    const pendingAll = all.filter(a => a.status === 'pending')
    return {
      pendingCount:           pendingAll.length,
      todayCount:             pendingAll.filter(a => a.scheduled_at && a.scheduled_at.slice(0, 10) === todayStr).length,
      closedCount:            all.filter(a => a.outcome === 'closed').length,
      lostCount:              all.filter(a => a.outcome === 'lost').length,
      noShowCount:            all.filter(a => a.status === 'no_show' || a.outcome === 'no_show' || a.status === 'missed').length,
      needsReschedulingCount: all.filter(a => a.status === 'needs_rescheduling').length,
    }
  }, [allAppts])

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 18, fontWeight: 500, color: 'var(--text-primary)', margin: 0, letterSpacing: '-0.01em' }}>
            Pipeline
          </h1>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>
            {view === 'setter' ? 'Leads you\'re working as an appointment setter.' : 'Your appointments — pending, closed, and lost.'}
          </p>
        </div>
        <div style={{ position: 'relative' }}>
          <Search size={13} style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search business, niche, phone…"
            style={{
              height: 32, padding: '0 10px 0 28px', width: 220,
              background: 'var(--bg-elevated)', border: '0.5px solid var(--border)',
              borderRadius: 6, fontSize: 12, color: 'var(--text-primary)', fontFamily: 'var(--font-sans)', outline: 'none',
            }}
          />
        </div>
      </div>

      {/* View toggle — Appointment Setting vs Closer */}
      <div style={{ display: 'flex', gap: 4, borderBottom: '0.5px solid var(--border)', marginBottom: 20, overflowX: 'auto' }}>
        {VIEW_TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setView(key)}
            style={{
              display: 'flex', alignItems: 'center', gap: 7,
              padding: '10px 16px', background: 'none', cursor: 'pointer',
              border: 'none', borderBottom: view === key ? '2px solid var(--accent)' : '2px solid transparent',
              fontSize: 14, fontWeight: 500, whiteSpace: 'nowrap',
              color: view === key ? 'var(--accent)' : 'var(--text-muted)',
            }}
          >
            <Icon size={14} />
            {label}
          </button>
        ))}
      </div>

      {/* Appointment Setting view */}
      {view === 'setter' && (
        <SetterView profileId={profile?.id} search={search} />
      )}

      {/* Closer view */}
      {view === 'closer' && (
        <div>
          {/* KPI row — exactly 2 cards: PENDING always left, second varies by tab */}
          <div className="stagger" style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
            <KPICard label="Pending" value={closerKPIs.pendingCount} sub="awaiting close call" icon={CalendarClock} />
            {(closerTab === 'pending' || closerTab === 'all') && (
              <KPICard label="Today" value={closerKPIs.todayCount} sub="scheduled today" icon={Calendar} />
            )}
            {closerTab === 'closed' && (
              <KPICard label="Closed Deals" value={closerKPIs.closedCount} sub="all time" icon={CheckCircle} />
            )}
            {closerTab === 'lost' && (
              <KPICard label="Lost" value={closerKPIs.lostCount} sub="all time" icon={Ban} />
            )}
            {closerTab === 'no_show' && (
              <KPICard label="No Show" value={closerKPIs.noShowCount} sub="client didn't answer" icon={PhoneOff} />
            )}
            {closerTab === 'needs_rescheduling' && (
              <KPICard label="Needs Rescheduling" value={closerKPIs.needsReschedulingCount} sub="needs a new time" icon={RefreshCw} />
            )}
          </div>

          {/* Filter tabs — below KPIs, color-coded always-on */}
          <div style={{ display: 'flex', gap: 4, borderBottom: '0.5px solid var(--border)', marginBottom: 20, overflowX: 'auto' }}>
            {CLOSER_TABS.map(({ key, label, icon: Icon }) => {
              const tc = CLOSER_TAB_COLORS[key]
              const active = closerTab === key
              return (
                <button
                  key={key}
                  onClick={() => setCloserTab(key)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 7,
                    padding: '10px 14px', background: 'none', cursor: 'pointer',
                    border: 'none', borderBottom: active ? `2px solid ${tc.color}` : '2px solid transparent',
                    fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap',
                    color: tc.color,
                  }}
                >
                  {Icon && <Icon size={13} />}
                  {label}
                  <span style={{
                    fontSize: 10, padding: '1px 6px', borderRadius: 10, fontFamily: 'var(--font-mono)',
                    background: tc.dim,
                    color: tc.color,
                    border: `0.5px solid ${tc.border}`,
                  }}>
                    {isLoading ? '…' : filteredAppts[key]?.length ?? 0}
                  </span>
                </button>
              )
            })}
          </div>

          {closerTab === 'pending'            && <PendingTab            rows={filteredAppts.pending}            tz={tz} />}
          {closerTab === 'closed'             && <ClosedTab             rows={filteredAppts.closed} />}
          {closerTab === 'lost'               && <LostTab               rows={filteredAppts.lost} />}
          {closerTab === 'no_show'            && <NoShowTab             rows={filteredAppts.no_show}             tz={tz} />}
          {closerTab === 'needs_rescheduling' && <NeedsReschedulingTab  rows={filteredAppts.needs_rescheduling} tz={tz} />}
          {closerTab === 'all'               && <AllTab                 rows={filteredAppts.all}                tz={tz} />}
        </div>
      )}
    </div>
  )
}
