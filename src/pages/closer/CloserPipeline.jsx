import { useState, useMemo } from 'react'
import { CalendarClock, CheckCircle, Ban, Search } from 'lucide-react'
import { useMyAppointments } from '../../hooks/useAppointments'
import { KPICard } from '../../components/ui/KPICard'
import { Badge } from '../../components/ui/Badge'

const TABS = [
  { key: 'pending', label: 'Pending', icon: CalendarClock },
  { key: 'closed',  label: 'Closed',  icon: CheckCircle },
  { key: 'lost',    label: 'Lost',    icon: Ban },
]

const cell = (basis, extra = {}) => ({
  flex: basis, padding: '10px 12px', fontSize: 12, color: 'var(--text-secondary)',
  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0, ...extra,
})

function fmtDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })
}

function fmtDateTime(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function QueueTable({ columns, rows, renderRow, emptyText }) {
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
          <div style={{ maxHeight: 480, overflowY: 'auto' }} className="scrollbar-thin">
            {!rows?.length ? (
              <p style={{ padding: 24, textAlign: 'center', fontSize: 13, color: 'var(--text-muted)' }}>{emptyText}</p>
            ) : rows.map(renderRow)}
          </div>
        </div>
      </div>
    </div>
  )
}

function PendingTab({ rows }) {
  const scheduled = rows.filter(a => a.scheduled_at)
  return (
    <div>
      <div className="stagger" style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        <KPICard label="Pending" value={rows.length} sub="awaiting close call" icon={CalendarClock} />
        <KPICard label="Scheduled" value={scheduled.length} sub="time confirmed" icon={CheckCircle} />
      </div>
      <QueueTable
        columns={[['Business', '1 1 0'], ['Niche', '0 0 120px'], ['City', '0 0 110px'], ['Set By', '0 0 120px'], ['Scheduled', '0 0 150px'], ['Status', '0 0 100px']]}
        rows={rows}
        emptyText="No pending appointments."
        renderRow={a => (
          <div key={a.id} style={{ display: 'flex', borderBottom: '0.5px solid var(--border)' }}>
            <div style={cell('1 1 0', { color: 'var(--text-primary)', fontWeight: 500 })}>{a.lead?.business_name || '—'}</div>
            <div style={cell('0 0 120px')}>{a.lead?.niche || '—'}</div>
            <div style={cell('0 0 110px')}>{a.lead?.city || '—'}</div>
            <div style={cell('0 0 120px')}>{a.rep?.full_name || '—'}</div>
            <div style={cell('0 0 150px', { fontFamily: 'var(--font-mono)' })}>{fmtDateTime(a.scheduled_at)}</div>
            <div style={cell('0 0 100px')}><Badge label={a.status} /></div>
          </div>
        )}
      />
    </div>
  )
}

function ClosedTab({ rows }) {
  const totalRevenue = rows.reduce((s, a) => s + (a.deal_value || 0), 0)
  return (
    <div>
      <div className="stagger" style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        <KPICard label="Closed Deals" value={rows.length} sub="all time" icon={CheckCircle} />
        <KPICard label="Total Revenue" value={totalRevenue > 0 ? `$${totalRevenue.toLocaleString()}` : '$0'} sub="deal value" icon={CheckCircle} />
      </div>
      <QueueTable
        columns={[['Business', '1 1 0'], ['Niche', '0 0 120px'], ['City', '0 0 110px'], ['Set By', '0 0 120px'], ['Closed On', '0 0 130px'], ['Revenue', '0 0 110px']]}
        rows={rows}
        emptyText="No closed deals yet."
        renderRow={a => (
          <div key={a.id} style={{ display: 'flex', borderBottom: '0.5px solid var(--border)' }}>
            <div style={cell('1 1 0', { color: 'var(--text-primary)', fontWeight: 500 })}>{a.lead?.business_name || '—'}</div>
            <div style={cell('0 0 120px')}>{a.lead?.niche || '—'}</div>
            <div style={cell('0 0 110px')}>{a.lead?.city || '—'}</div>
            <div style={cell('0 0 120px')}>{a.rep?.full_name || '—'}</div>
            <div style={cell('0 0 130px', { fontFamily: 'var(--font-mono)' })}>{fmtDate(a.updated_at || a.created_at)}</div>
            <div style={cell('0 0 110px', { color: 'var(--success)', fontFamily: 'var(--font-mono)' })}>
              {a.deal_value ? `$${Number(a.deal_value).toLocaleString()}` : '—'}
            </div>
          </div>
        )}
      />
    </div>
  )
}

function LostTab({ rows }) {
  return (
    <div>
      <div className="stagger" style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        <KPICard label="Lost / No Show" value={rows.length} sub="all time" icon={Ban} />
      </div>
      <QueueTable
        columns={[['Business', '1 1 0'], ['Niche', '0 0 120px'], ['City', '0 0 110px'], ['Set By', '0 0 120px'], ['Outcome', '0 0 120px'], ['Date', '0 0 130px']]}
        rows={rows}
        emptyText="No lost deals yet."
        renderRow={a => (
          <div key={a.id} style={{ display: 'flex', borderBottom: '0.5px solid var(--border)' }}>
            <div style={cell('1 1 0', { color: 'var(--text-primary)', fontWeight: 500 })}>{a.lead?.business_name || '—'}</div>
            <div style={cell('0 0 120px')}>{a.lead?.niche || '—'}</div>
            <div style={cell('0 0 110px')}>{a.lead?.city || '—'}</div>
            <div style={cell('0 0 120px')}>{a.rep?.full_name || '—'}</div>
            <div style={cell('0 0 120px')}><Badge label={a.outcome} /></div>
            <div style={cell('0 0 130px', { fontFamily: 'var(--font-mono)' })}>{fmtDate(a.updated_at || a.created_at)}</div>
          </div>
        )}
      />
    </div>
  )
}

export default function CloserPipeline() {
  const { data: allAppts, isLoading } = useMyAppointments()
  const [tab, setTab] = useState('pending')
  const [search, setSearch] = useState('')

  const filtered = useMemo(() => {
    if (!allAppts) return { pending: [], closed: [], lost: [] }
    const s = search.trim().toLowerCase()
    const appts = s
      ? allAppts.filter(a => (a.lead?.business_name || '').toLowerCase().includes(s))
      : allAppts
    return {
      pending: appts.filter(a => a.status === 'pending'),
      closed:  appts.filter(a => a.outcome === 'closed'),
      lost:    appts.filter(a => a.outcome === 'lost' || a.outcome === 'no_show'),
    }
  }, [allAppts, search])

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 18, fontWeight: 500, color: 'var(--text-primary)', margin: 0, letterSpacing: '-0.01em' }}>
            Pipeline
          </h1>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>
            Your appointments — pending, closed, and lost.
          </p>
        </div>
        <div style={{ position: 'relative' }}>
          <Search size={13} style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search business name…"
            style={{
              height: 32, padding: '0 10px 0 28px', width: 200,
              background: 'var(--bg-elevated)', border: '0.5px solid var(--border)',
              borderRadius: 6, fontSize: 12, color: 'var(--text-primary)', fontFamily: 'var(--font-sans)', outline: 'none',
            }}
          />
        </div>
      </div>

      <div style={{ display: 'flex', gap: 4, borderBottom: '0.5px solid var(--border)', marginBottom: 20, overflowX: 'auto' }}>
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            style={{
              display: 'flex', alignItems: 'center', gap: 7,
              padding: '10px 14px', background: 'none', cursor: 'pointer',
              border: 'none', borderBottom: tab === key ? '2px solid var(--accent)' : '2px solid transparent',
              fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap',
              color: tab === key ? 'var(--accent)' : 'var(--text-muted)',
            }}
          >
            <Icon size={13} />
            {label}
            <span style={{
              fontSize: 10, padding: '1px 6px', borderRadius: 10, fontFamily: 'var(--font-mono)',
              background: tab === key ? 'var(--accent-dim)' : 'var(--bg-elevated)',
              color: tab === key ? 'var(--accent)' : 'var(--text-muted)',
              border: `0.5px solid ${tab === key ? 'var(--accent-border)' : 'var(--border)'}`,
            }}>
              {isLoading ? '…' : filtered[key]?.length ?? 0}
            </span>
          </button>
        ))}
      </div>

      {tab === 'pending' && <PendingTab rows={filtered.pending} />}
      {tab === 'closed'  && <ClosedTab  rows={filtered.closed} />}
      {tab === 'lost'    && <LostTab    rows={filtered.lost} />}
    </div>
  )
}
