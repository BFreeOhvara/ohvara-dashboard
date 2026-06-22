import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { PhoneMissed, CalendarClock, Ban, CheckCircle, Inbox, FilePlus2, Search } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useReps } from '../../hooks/useProfiles'
import { useAuth } from '../../hooks/useAuth'
import { formatInTimezone, DEFAULT_TIMEZONE } from '../../lib/timezones'
import { KPICard } from '../../components/ui/KPICard'
import { Badge } from '../../components/ui/Badge'

// ── Pipeline — one page, full lead lifecycle in six tabs ──────────────────────
// Tab 1 Unassigned (scraped, no rep yet — the pool)
// Tab 2 New (assigned to a rep, not yet called)
// Tab 3 No Answer Queue (24h redistribution pool)
// Tab 4 Follow-Up Queue (same-rep scheduled returns)
// Tab 5 Not Interested Archive (permanent do-not-contact, read-only)
// Tab 6 Booked (closer pipeline)
// A page-level business-name search + rep filter narrow every tab.

const TABS = [
  { key: 'unassigned',     label: 'Unassigned',       icon: Inbox },
  { key: 'new',            label: 'New',              icon: FilePlus2 },
  { key: 'no_answer',      label: 'No Answer Queue',  icon: PhoneMissed },
  { key: 'follow_up',      label: 'Follow-Up Queue',  icon: CalendarClock },
  { key: 'not_interested', label: 'Not Interested',   icon: Ban },
  { key: 'booked',         label: 'Booked',           icon: CheckCircle },
]

// Page-level filters applied client-side to every tab's rows. `getRepName`
// returns the row's assigned-rep name (tab-specific); when a rep is selected,
// rows without that rep — including all Unassigned rows — drop out.
function applyFilters(rows, { search, repName }, getRepName) {
  if (!rows) return rows
  const s = search.trim().toLowerCase()
  return rows.filter(r => {
    const biz = (r.lead?.business_name ?? r.business_name ?? '').toLowerCase()
    if (s && !biz.includes(s)) return false
    if (repName && (getRepName ? getRepName(r) : null) !== repName) return false
    return true
  })
}

function weekAgoISO() {
  const d = new Date()
  d.setDate(d.getDate() - 7)
  return d.toISOString()
}

function useNoAnswerQueue() {
  return useQuery({
    queryKey: ['pipeline', 'no_answer_queue'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('no_answer_queue')
        .select(`
          id, called_at, available_at, distributed_at,
          lead:leads(business_name, niche, city),
          orig_rep:profiles!no_answer_queue_called_by_rep_id_fkey(full_name),
          dist_rep:profiles!no_answer_queue_distributed_to_rep_id_fkey(full_name)
        `)
        .order('available_at', { ascending: true })
        .limit(300)
      if (error) throw error
      return data
    },
    refetchInterval: 60_000,
  })
}

function useFollowUpQueue() {
  return useQuery({
    queryKey: ['pipeline', 'follow_up_queue'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('follow_up_queue')
        .select(`
          id, follow_up_at, reason, reminded_at, completed_at,
          lead:leads(business_name, niche, city),
          rep:profiles!follow_up_queue_rep_id_fkey(full_name)
        `)
        .order('follow_up_at', { ascending: true })
        .limit(300)
      if (error) throw error
      return data
    },
    refetchInterval: 60_000,
  })
}

function useNotInterested() {
  return useQuery({
    queryKey: ['pipeline', 'not_interested'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('leads')
        .select('id, business_name, niche, city, updated_at, rep:profiles!leads_assigned_rep_id_fkey(full_name)')
        .eq('status', 'Not Interested')
        .order('updated_at', { ascending: false })
        .limit(300)
      if (error) throw error
      return data
    },
  })
}

function useBooked() {
  return useQuery({
    queryKey: ['pipeline', 'booked'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('appointments')
        .select(`
          id, scheduled_at, status, outcome, deal_value,
          lead:leads(business_name, niche, city),
          closer:profiles!appointments_closer_id_fkey(full_name),
          rep:profiles!appointments_rep_id_fkey(full_name)
        `)
        .order('scheduled_at', { ascending: true })
        .limit(300)
      if (error) throw error
      return data
    },
  })
}

// Unassigned — scraped leads sitting in the pool with no rep yet
function useUnassigned() {
  return useQuery({
    queryKey: ['pipeline', 'unassigned'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('leads')
        .select('id, business_name, niche, city, source, created_at')
        .is('assigned_rep_id', null)
        .order('created_at', { ascending: false })
        .limit(500)
      if (error) throw error
      return data
    },
    refetchInterval: 60_000,
  })
}

// New — assigned to a rep but not yet called
function useNewAssigned() {
  return useQuery({
    queryKey: ['pipeline', 'new_assigned'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('leads')
        .select('id, business_name, niche, city, batch_date, assigned_rep:profiles!leads_assigned_rep_id_fkey(full_name)')
        .eq('status', 'New')
        .not('assigned_rep_id', 'is', null)
        .order('batch_date', { ascending: false })
        .limit(500)
      if (error) throw error
      return data
    },
    refetchInterval: 60_000,
  })
}

// "redistributes in Xh Xm" countdown (or how it resolved)
function countdown(availableAt, distributedAt) {
  if (distributedAt) return 'distributed'
  const ms = new Date(availableAt) - new Date()
  if (ms <= 0) return 'next cron run'
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  return `redistributes in ${h}h ${m}m`
}

const cell = (basis, extra = {}) => ({
  flex: basis, padding: '10px 12px', fontSize: 12, color: 'var(--text-secondary)',
  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0, ...extra,
})

function QueueTable({ columns, rows, renderRow, emptyText }) {
  return (
    <div className="glass" style={{ borderRadius: 12, overflow: 'hidden' }}>
      {/* overflowX keeps fixed-basis columns reachable on small screens */}
      <div style={{ overflowX: 'auto' }} className="scrollbar-thin">
        <div style={{ minWidth: 720 }}>
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

function UnassignedTab({ filters }) {
  const { data: allRows, isLoading } = useUnassigned()
  const rows = applyFilters(allRows, filters, null) // no rep — rep filter empties it

  return (
    <div>
      <div className="stagger" style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        <KPICard label="In Pool" value={allRows?.length ?? 0} sub="scraped, no rep yet" icon={Inbox} />
      </div>
      <QueueTable
        columns={[['Business', '1 1 0'], ['Niche', '0 0 130px'], ['City', '0 0 120px'], ['Source', '0 0 110px'], ['Scraped', '0 0 130px']]}
        rows={rows}
        emptyText={isLoading ? 'Loading…' : 'No unassigned leads in the pool.'}
        renderRow={r => (
          <div key={r.id} style={{ display: 'flex', borderBottom: '0.5px solid var(--border)' }}>
            <div style={cell('1 1 0', { color: 'var(--text-primary)', fontWeight: 500 })}>{r.business_name}</div>
            <div style={cell('0 0 130px')}>{r.niche || '—'}</div>
            <div style={cell('0 0 120px')}>{r.city || '—'}</div>
            <div style={cell('0 0 110px', { textTransform: 'capitalize' })}>{r.source?.replace('_', ' ') || '—'}</div>
            <div style={cell('0 0 130px', { fontFamily: 'var(--font-mono)' })}>
              {r.created_at ? new Date(r.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
            </div>
          </div>
        )}
      />
    </div>
  )
}

function NewTab({ filters }) {
  const { data: allRows, isLoading } = useNewAssigned()
  const rows = applyFilters(allRows, filters, r => r.assigned_rep?.full_name)

  return (
    <div>
      <div className="stagger" style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        <KPICard label="New, Uncalled" value={allRows?.length ?? 0} sub="assigned, awaiting first call" icon={FilePlus2} />
      </div>
      <QueueTable
        columns={[['Business', '1 1 0'], ['Niche', '0 0 130px'], ['City', '0 0 120px'], ['Rep Assigned', '0 0 130px'], ['Batch Date', '0 0 130px']]}
        rows={rows}
        emptyText={isLoading ? 'Loading…' : 'No uncalled New leads.'}
        renderRow={r => (
          <div key={r.id} style={{ display: 'flex', borderBottom: '0.5px solid var(--border)' }}>
            <div style={cell('1 1 0', { color: 'var(--text-primary)', fontWeight: 500 })}>{r.business_name}</div>
            <div style={cell('0 0 130px')}>{r.niche || '—'}</div>
            <div style={cell('0 0 120px')}>{r.city || '—'}</div>
            <div style={cell('0 0 130px')}>{r.assigned_rep?.full_name || '—'}</div>
            <div style={cell('0 0 130px', { fontFamily: 'var(--font-mono)' })}>
              {r.batch_date ? new Date(r.batch_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'}
            </div>
          </div>
        )}
      />
    </div>
  )
}

function NoAnswerTab({ filters }) {
  const { data: allRows, isLoading } = useNoAnswerQueue()
  const rows = applyFilters(allRows, filters, r => r.orig_rep?.full_name)
  const waiting = allRows?.filter(r => !r.distributed_at) ?? []
  const todayStr = new Date().toISOString().slice(0, 10)
  const dueToday = waiting.filter(r => r.available_at?.slice(0, 10) <= todayStr).length
  const distributedThisWeek = allRows?.filter(r => r.distributed_at && r.distributed_at >= weekAgoISO()).length ?? 0

  return (
    <div>
      <div className="stagger" style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        <KPICard label="In Queue" value={waiting.length} sub="waiting on 24h window" icon={PhoneMissed} />
        <KPICard label="Redistributing Today" value={dueToday} sub="hit the pool today" icon={CalendarClock} />
        <KPICard label="Redistributed This Week" value={distributedThisWeek} sub="back in rotation" icon={CheckCircle} />
      </div>
      <QueueTable
        columns={[['Business', '1 1 0'], ['Niche', '0 0 110px'], ['City', '0 0 100px'], ['Marked By', '0 0 110px'], ['Called At', '0 0 130px'], ['Redistribution', '0 0 160px'], ['Status', '0 0 130px']]}
        rows={rows}
        emptyText={isLoading ? 'Loading…' : 'No leads in the No Answer queue.'}
        renderRow={r => (
          <div key={r.id} style={{ display: 'flex', borderBottom: '0.5px solid var(--border)' }}>
            <div style={cell('1 1 0', { color: 'var(--text-primary)', fontWeight: 500 })}>{r.lead?.business_name || '—'}</div>
            <div style={cell('0 0 110px')}>{r.lead?.niche || '—'}</div>
            <div style={cell('0 0 100px')}>{r.lead?.city || '—'}</div>
            <div style={cell('0 0 110px')}>{r.orig_rep?.full_name || '—'}</div>
            <div style={cell('0 0 130px', { fontFamily: 'var(--font-mono)' })}>
              {r.called_at ? new Date(r.called_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—'}
            </div>
            <div style={cell('0 0 160px', { color: r.distributed_at ? 'var(--text-muted)' : 'var(--warning)' })}>
              {countdown(r.available_at, r.distributed_at)}
            </div>
            <div style={cell('0 0 130px')}>
              <span style={{
                fontSize: 10, padding: '2px 7px', borderRadius: 4, fontWeight: 500,
                background: r.distributed_at ? 'var(--success-dim)' : 'var(--warning-dim)',
                color: r.distributed_at ? 'var(--success)' : 'var(--warning)',
              }}>
                {r.distributed_at ? `→ ${r.dist_rep?.full_name || 'distributed'}` : 'waiting'}
              </span>
            </div>
          </div>
        )}
      />
    </div>
  )
}

function FollowUpTab({ filters }) {
  const { data: allRows, isLoading } = useFollowUpQueue()
  const rows = applyFilters(allRows, filters, r => r.rep?.full_name)
  const pending = allRows?.filter(r => !r.reminded_at && !r.completed_at) ?? []
  const now = new Date()
  const todayStr = now.toISOString().slice(0, 10)
  const dueToday = pending.filter(r => r.follow_up_at?.slice(0, 10) === todayStr).length
  const overdue = pending.filter(r => new Date(r.follow_up_at) < now).length

  const statusOf = r => r.completed_at ? 'completed' : r.reminded_at ? 'returned' : 'pending'

  return (
    <div>
      <div className="stagger" style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        <KPICard label="Pending Follow-Ups" value={pending.length} sub="scheduled by reps" icon={CalendarClock} />
        <KPICard label="Due Today" value={dueToday} sub="return today" icon={PhoneMissed} />
        <KPICard label="Overdue" value={overdue} sub="past due, next cron run" icon={Ban} />
      </div>
      <QueueTable
        columns={[['Business', '1 1 0'], ['Rep Assigned', '0 0 120px'], ['Follow-Up At', '0 0 150px'], ['Reason', '1 1 0'], ['Status', '0 0 100px']]}
        rows={rows}
        emptyText={isLoading ? 'Loading…' : 'No follow-ups scheduled.'}
        renderRow={r => (
          <div key={r.id} style={{ display: 'flex', borderBottom: '0.5px solid var(--border)' }}>
            <div style={cell('1 1 0', { color: 'var(--text-primary)', fontWeight: 500 })}>{r.lead?.business_name || '—'}</div>
            <div style={cell('0 0 120px')}>{r.rep?.full_name || '—'}</div>
            <div style={cell('0 0 150px', { fontFamily: 'var(--font-mono)' })}>
              {new Date(r.follow_up_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
            </div>
            <div style={cell('1 1 0', { fontStyle: r.reason ? 'normal' : 'italic' })}>{r.reason || 'no reason recorded'}</div>
            <div style={cell('0 0 100px')}>
              <span style={{
                fontSize: 10, padding: '2px 7px', borderRadius: 4, fontWeight: 500,
                background: statusOf(r) === 'pending' ? 'var(--warning-dim)' : 'var(--success-dim)',
                color: statusOf(r) === 'pending' ? 'var(--warning)' : 'var(--success)',
              }}>
                {statusOf(r)}
              </span>
            </div>
          </div>
        )}
      />
    </div>
  )
}

function NotInterestedTab({ filters }) {
  const { data: allRows, isLoading } = useNotInterested()
  const rows = applyFilters(allRows, filters, r => r.rep?.full_name)
  const addedThisWeek = allRows?.filter(r => r.updated_at >= weekAgoISO()).length ?? 0

  return (
    <div>
      <div className="stagger" style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        <KPICard label="Do-Not-Contact Total" value={allRows?.length ?? 0} sub="flagged permanently" icon={Ban} />
        <KPICard label="Added This Week" value={addedThisWeek} sub="new flags" icon={CalendarClock} />
      </div>
      <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 12px' }}>
        Read-only archive. These businesses are excluded from every batch and deduplicated out of all future scrapes.
      </p>
      <QueueTable
        columns={[['Business', '1 1 0'], ['Niche', '0 0 130px'], ['City', '0 0 120px'], ['Flagged By', '0 0 130px'], ['Date Flagged', '0 0 130px']]}
        rows={rows}
        emptyText={isLoading ? 'Loading…' : 'No do-not-contact leads yet.'}
        renderRow={r => (
          <div key={r.id} style={{ display: 'flex', borderBottom: '0.5px solid var(--border)' }}>
            <div style={cell('1 1 0', { color: 'var(--text-primary)', fontWeight: 500 })}>{r.business_name}</div>
            <div style={cell('0 0 130px')}>{r.niche || '—'}</div>
            <div style={cell('0 0 120px')}>{r.city || '—'}</div>
            <div style={cell('0 0 130px')}>{r.rep?.full_name || '—'}</div>
            <div style={cell('0 0 130px', { fontFamily: 'var(--font-mono)' })}>
              {new Date(r.updated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
            </div>
          </div>
        )}
      />
    </div>
  )
}

function BookedTab({ filters }) {
  const { data: allRows, isLoading } = useBooked()
  const rows = applyFilters(allRows, filters, r => r.rep?.full_name)
  const pending = allRows?.filter(r => r.status === 'pending') ?? []
  const closed = allRows?.filter(r => r.outcome === 'closed').length ?? 0

  return (
    <div>
      <div className="stagger" style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        <KPICard label="Pending Appointments" value={pending.length} sub="with closers now" icon={CalendarClock} />
        <KPICard label="Closed" value={closed} sub="all time" icon={CheckCircle} />
      </div>
      <QueueTable
        columns={[['Business', '1 1 0'], ['Niche', '0 0 120px'], ['Set By', '0 0 110px'], ['Closer', '0 0 110px'], ['Scheduled', '0 0 150px'], ['Status', '0 0 110px']]}
        rows={rows}
        emptyText={isLoading ? 'Loading…' : 'No booked appointments.'}
        renderRow={r => (
          <div key={r.id} style={{ display: 'flex', borderBottom: '0.5px solid var(--border)', alignItems: 'center' }}>
            <div style={cell('1 1 0', { color: 'var(--text-primary)', fontWeight: 500 })}>{r.lead?.business_name || '—'}</div>
            <div style={cell('0 0 120px')}>{r.lead?.niche || '—'}</div>
            <div style={cell('0 0 110px')}>{r.rep?.full_name || '—'}</div>
            <div style={cell('0 0 110px')}>{r.closer?.full_name || '—'}</div>
            <div style={cell('0 0 150px', { fontFamily: 'var(--font-mono)' })}>
              {formatInTimezone(r.scheduled_at, tz, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
            </div>
            <div style={cell('0 0 110px')}><Badge label={r.outcome || r.status} /></div>
          </div>
        )}
      />
    </div>
  )
}

export default function LeadPipeline() {
  const { profile } = useAuth()
  const tz = profile?.timezone || DEFAULT_TIMEZONE
  const [tab, setTab] = useState('unassigned')
  const [search, setSearch] = useState('')
  const [repName, setRepName] = useState('')
  const { data: reps } = useReps()
  const filters = { search, repName }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 18, fontWeight: 500, color: 'var(--text-primary)', margin: 0, letterSpacing: '-0.01em' }}>
            Lead Pipeline
          </h1>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>
            Every lead, scrape to close — pool, assigned, and post-call queues.
          </p>
        </div>

        {/* Page-level filters — apply to every tab */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
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
          <select
            value={repName}
            onChange={e => setRepName(e.target.value)}
            style={{
              height: 32, padding: '0 10px',
              background: 'var(--bg-elevated)', border: '0.5px solid var(--border)',
              borderRadius: 6, fontSize: 12, color: 'var(--text-primary)', fontFamily: 'var(--font-sans)', cursor: 'pointer',
            }}
          >
            <option value="">All Reps</option>
            {(reps || []).map(r => <option key={r.id} value={r.full_name}>{r.full_name}</option>)}
          </select>
        </div>
      </div>

      {/* Tabs — underline pattern */}
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
          </button>
        ))}
      </div>

      {tab === 'unassigned' && <UnassignedTab filters={filters} />}
      {tab === 'new' && <NewTab filters={filters} />}
      {tab === 'no_answer' && <NoAnswerTab filters={filters} />}
      {tab === 'follow_up' && <FollowUpTab filters={filters} />}
      {tab === 'not_interested' && <NotInterestedTab filters={filters} />}
      {tab === 'booked' && <BookedTab filters={filters} />}
    </div>
  )
}
