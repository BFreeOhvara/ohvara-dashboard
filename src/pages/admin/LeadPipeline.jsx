import { useState, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { PhoneMissed, CalendarClock, Ban, CheckCircle, Inbox, FilePlus2, Search, Phone, Upload } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useReps } from '../../hooks/useProfiles'
import { KPICard } from '../../components/ui/KPICard'
import { AppointmentCard } from '../../components/closer/AppointmentCard'

// ── Pipeline — 3 top-level tabs ───────────────────────────────────────────────
// Tab 1 Unassigned   — scraped leads with no rep yet (the pool)
// Tab 2 Appointment Setting — rep-assigned leads (New / No Answer / Follow-Up / Not Interested)
// Tab 3 Closer       — appointments in the closer pipeline

const VIEW_TABS = [
  { key: 'unassigned',           label: 'Unassigned',           icon: Inbox },
  { key: 'appointment_setting',  label: 'Appointment Setting',  icon: Phone },
  { key: 'closer',               label: 'Closer',               icon: CalendarClock },
]

const SETTER_FILTER_TABS = [
  { key: 'new',            label: 'New',            icon: FilePlus2,   color: 'var(--info)',    dim: 'var(--info-dim)',    border: 'rgba(56,189,248,0.20)' },
  { key: 'no_answer',      label: 'No Answer',      icon: PhoneMissed, color: '#94A3B8',        dim: 'rgba(148,163,184,0.10)', border: 'rgba(148,163,184,0.25)' },
  { key: 'follow_up',      label: 'Follow-Up',      icon: CalendarClock, color: 'var(--warning)', dim: 'var(--warning-dim)', border: 'rgba(245,158,11,0.20)' },
  { key: 'not_interested', label: 'Not Interested', icon: Ban,         color: 'var(--danger)',  dim: 'var(--danger-dim)',  border: 'rgba(239,68,68,0.20)' },
  { key: 'all',            label: 'All',            icon: null,        color: 'var(--accent)',  dim: 'var(--accent-dim)',     border: 'var(--accent-border)' },
]

// Page-level filters applied client-side to every tab's rows. `getRepName`
// returns the row's assigned-rep name (tab-specific); when a rep is selected,
// rows without that rep — including all Unassigned rows — drop out.
function applyFilters(rows, { search, repName }, getRepName) {
  if (!rows) return rows
  const s = search.trim().toLowerCase()
  const sDigits = s.replace(/\D/g, '')
  return rows.filter(r => {
    if (s) {
      const biz   = (r.lead?.business_name ?? r.business_name ?? '').toLowerCase()
      const phone = (r.lead?.phone ?? r.phone ?? '').replace(/\D/g, '')
      if (!biz.includes(s) && !(sDigits && phone.includes(sDigits))) return false
    }
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
          *,
          lead:leads(id, business_name, contact_name, phone, email, niche, city, state, pain_points, notes, job_title, monthly_labor_cost, calls_missed_per_week, avg_ticket, recommended_automations, custom_monthly_price, recommended_stack, stack_generated_at),
          closer:profiles!appointments_closer_id_fkey(full_name),
          rep:profiles!appointments_rep_id_fkey(id, full_name)
        `)
        .order('scheduled_at', { ascending: true })
        .limit(300)
      if (error) throw error
      return data
    },
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

function useAllRepAssigned() {
  return useQuery({
    queryKey: ['pipeline', 'all_rep_assigned'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('leads')
        .select('id, business_name, niche, city, status, batch_date, assigned_rep:profiles!leads_assigned_rep_id_fkey(full_name)')
        .not('assigned_rep_id', 'is', null)
        .order('batch_date', { ascending: false })
        .limit(1000)
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

function useUnassignedByVerified(verified) {
  return useQuery({
    queryKey: ['pipeline', 'unassigned', verified],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('leads')
        .select('id, business_name, niche, city, phone, source, created_at, verified')
        .is('assigned_rep_id', null)
        .is('assigned_closer_id', null)
        .eq('verified', verified)
        .order('created_at', { ascending: false })
        .limit(500)
      if (error) throw error
      return data
    },
    refetchInterval: 60_000,
  })
}

async function confirmLead(id) {
  const { error } = await supabase.from('leads').update({ verified: true }).eq('id', id)
  if (error) throw error
}

function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim())
  if (lines.length < 2) return []
  const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/^"|"$/g, ''))
  const COL_MAP = { business_name: ['business_name', 'business name', 'name', 'company', 'company_name'], niche: ['niche', 'industry', 'category'], city: ['city'], phone: ['phone', 'phone_number', 'phone number', 'tel'], website: ['website', 'url', 'web'], state: ['state'] }
  const idx = {}
  for (const [field, aliases] of Object.entries(COL_MAP)) {
    const found = headers.findIndex(h => aliases.includes(h))
    if (found !== -1) idx[field] = found
  }
  if (!Object.keys(idx).length) return null // no recognized columns
  return lines.slice(1).map(line => {
    const cols = line.split(',').map(c => c.trim().replace(/^"|"$/g, ''))
    const row = {}
    for (const [field, i] of Object.entries(idx)) row[field] = cols[i] || null
    return row
  }).filter(r => r.business_name || r.phone)
}

function UnassignedTab({ filters }) {
  const [subTab, setSubTab] = useState('confirmed')
  const { data: reviewRows = [], isLoading: loadingReview, refetch: refetchReview } = useUnassignedByVerified(false)
  const { data: confirmedRows = [], isLoading: loadingConfirmed, refetch: refetchConfirmed } = useUnassignedByVerified(true)
  const [confirming, setConfirming] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [uploadMsg, setUploadMsg] = useState(null)
  const fileInputRef = useRef(null)

  async function handleConfirm(id) {
    setConfirming(id)
    try {
      await confirmLead(id)
      await refetchReview()
      await refetchConfirmed()
    } finally {
      setConfirming(null)
    }
  }

  async function handleFileChange(e) {
    const file = e.target.files?.[0]
    if (!fileInputRef.current) return
    fileInputRef.current.value = ''
    if (!file) return
    setUploading(true)
    setUploadMsg(null)
    try {
      const text = await file.text()
      const rows = parseCSV(text)
      if (rows === null) { setUploadMsg({ type: 'error', text: 'No recognized columns in CSV. Expected: business_name, niche, city, phone, website, state.' }); return }
      if (!rows.length) { setUploadMsg({ type: 'error', text: 'CSV parsed but no valid rows found.' }); return }

      // Fetch existing leads for dedup
      const { data: existing } = await supabase.from('leads').select('phone, business_name, city')
      const existingPhones = new Set((existing || []).map(l => (l.phone || '').replace(/\D/g, '')).filter(Boolean))
      const existingBizCity = new Set((existing || []).map(l => `${(l.business_name || '').toLowerCase()}|${(l.city || '').toLowerCase()}`))

      const toInsert = rows.filter(r => {
        const phone = (r.phone || '').replace(/\D/g, '')
        if (phone && existingPhones.has(phone)) return false
        const bizCity = `${(r.business_name || '').toLowerCase()}|${(r.city || '').toLowerCase()}`
        if (r.business_name && r.city && existingBizCity.has(bizCity)) return false
        return true
      }).map(r => ({ ...r, verified: false, assigned_rep_id: null }))

      if (!toInsert.length) { setUploadMsg({ type: 'error', text: `All ${rows.length} rows already exist in the database — none added.` }); return }

      const { error } = await supabase.from('leads').insert(toInsert)
      if (error) throw error
      await refetchReview()
      setUploadMsg({ type: 'success', text: `${toInsert.length} lead${toInsert.length === 1 ? '' : 's'} added to Review${rows.length > toInsert.length ? ` (${rows.length - toInsert.length} duplicate${rows.length - toInsert.length === 1 ? '' : 's'} skipped)` : ''}.` })
    } catch (err) {
      setUploadMsg({ type: 'error', text: err.message || 'Upload failed.' })
    } finally {
      setUploading(false)
    }
  }

  const reviewFiltered    = applyFilters(reviewRows,    filters, null)
  const confirmedFiltered = applyFilters(confirmedRows, filters, null)

  return (
    <div>
      {/* Sub-tabs */}
      <div style={{ display: 'flex', gap: 4, borderBottom: '0.5px solid var(--border)', marginBottom: 20, overflowX: 'auto' }}>
        {[
          { key: 'review',    label: 'Review',    color: 'var(--warning)', count: reviewRows.length },
          { key: 'confirmed', label: 'Confirmed', color: 'var(--success)', count: confirmedRows.length },
        ].map(({ key, label, color, count }) => (
          <button
            key={key}
            onClick={() => setSubTab(key)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '10px 14px', background: 'none', cursor: 'pointer',
              border: 'none', borderBottom: subTab === key ? `2px solid ${color}` : '2px solid transparent',
              fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap', color,
            }}
          >
            {label}
            <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 10, fontFamily: 'var(--font-mono)', background: `${color}22`, color, border: `0.5px solid ${color}33` }}>
              {count}
            </span>
          </button>
        ))}
      </div>

      {subTab === 'review' && (
        <div>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
            <div className="stagger" style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <KPICard label="Pending Review" value={reviewRows.length} sub="unverified leads" icon={Inbox} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
              <input ref={fileInputRef} type="file" accept=".csv" style={{ display: 'none' }} onChange={handleFileChange} />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '8px 14px', fontSize: 12, fontWeight: 500,
                  background: 'var(--accent-dim)', color: 'var(--accent)',
                  border: '0.5px solid var(--accent-border)', borderRadius: 8,
                  cursor: uploading ? 'not-allowed' : 'pointer',
                }}
              >
                <Upload size={13} />
                {uploading ? 'Uploading…' : 'Upload Leads'}
              </button>
              {uploadMsg && (
                <span style={{ fontSize: 11, color: uploadMsg.type === 'success' ? 'var(--success)' : 'var(--danger)' }}>
                  {uploadMsg.text}
                </span>
              )}
            </div>
          </div>
          <QueueTable
            columns={[['Business', '1 1 0'], ['Niche', '0 0 120px'], ['City', '0 0 110px'], ['Phone', '0 0 130px'], ['Google', '0 0 80px'], ['Date Added', '0 0 120px'], ['', '0 0 100px']]}
            rows={reviewFiltered}
            emptyText={loadingReview ? 'Loading…' : 'No leads pending review.'}
            renderRow={r => (
              <div key={r.id} style={{ display: 'flex', borderBottom: '0.5px solid var(--border)', alignItems: 'center' }}>
                <div style={cell('1 1 0', { color: 'var(--text-primary)', fontWeight: 500 })}>{r.business_name}</div>
                <div style={cell('0 0 120px')}>{r.niche || '—'}</div>
                <div style={cell('0 0 110px')}>{r.city || '—'}</div>
                <div style={cell('0 0 130px', { fontFamily: 'var(--font-mono)', fontSize: 11 })}>{r.phone || '—'}</div>
                <div style={cell('0 0 80px', { textAlign: 'center' })}>
                  <a
                    href={`https://www.google.com/search?q=${encodeURIComponent((r.business_name || '') + ' ' + (r.city || ''))}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: 'var(--accent)', fontSize: 11, textDecoration: 'none' }}
                  >
                    🔍
                  </a>
                </div>
                <div style={cell('0 0 120px', { fontFamily: 'var(--font-mono)' })}>
                  {r.created_at ? new Date(r.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
                </div>
                <div style={cell('0 0 100px')}>
                  <button
                    onClick={() => handleConfirm(r.id)}
                    disabled={confirming === r.id}
                    style={{
                      padding: '3px 10px', fontSize: 11, fontWeight: 500,
                      background: 'var(--success-dim)', color: 'var(--success)',
                      border: '0.5px solid rgba(34,197,94,0.30)', borderRadius: 6,
                      cursor: confirming === r.id ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {confirming === r.id ? '…' : 'Confirm'}
                  </button>
                </div>
              </div>
            )}
          />
        </div>
      )}

      {subTab === 'confirmed' && (
        <div>
          <div className="stagger" style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
            <KPICard label="In Pool" value={confirmedRows.length} sub="verified, no rep yet" icon={Inbox} />
          </div>
          <QueueTable
            columns={[['Business', '1 1 0'], ['Niche', '0 0 130px'], ['City', '0 0 120px'], ['Source', '0 0 110px'], ['Scraped', '0 0 130px']]}
            rows={confirmedFiltered}
            emptyText={loadingConfirmed ? 'Loading…' : 'No confirmed leads in the pool.'}
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
      )}
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
      {isLoading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {[...Array(3)].map((_, i) => (
            <div key={i} style={{ height: 72, borderRadius: 8, background: 'var(--bg-surface)', border: '0.5px solid var(--border)', animation: 'pulse 2s infinite' }} />
          ))}
        </div>
      ) : !rows?.length ? (
        <p style={{ padding: 24, textAlign: 'center', fontSize: 13, color: 'var(--text-muted)' }}>No booked appointments.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {rows.map(r => <AppointmentCard key={r.id} appt={r} />)}
        </div>
      )}
    </div>
  )
}

// ── Admin Closer view ─────────────────────────────────────────────────────────

const ADMIN_CLOSER_TABS = [
  { key: 'pending',            label: 'Pending',            color: 'var(--warning)', dim: 'var(--warning-dim)', border: 'rgba(245,158,11,0.20)' },
  { key: 'closed',             label: 'Closed',             color: 'var(--success)', dim: 'var(--success-dim)', border: 'rgba(34,197,94,0.20)' },
  { key: 'lost',               label: 'Lost',               color: 'var(--danger)',  dim: 'var(--danger-dim)',  border: 'rgba(239,68,68,0.20)' },
  { key: 'no_show',            label: 'No Show',            color: '#94A3B8',        dim: 'rgba(148,163,184,0.10)', border: 'rgba(148,163,184,0.25)' },
  { key: 'needs_rescheduling', label: 'Needs Rescheduling', color: 'var(--info)',    dim: 'var(--info-dim)',    border: 'rgba(56,189,248,0.20)' },
  { key: 'all',                label: 'All',                color: 'var(--accent)',  dim: 'var(--accent-dim)',  border: 'var(--accent-border)' },
]

const ADMIN_CLOSER_STATUS_STYLES = {
  pending:            { color: 'var(--warning)', bg: 'var(--warning-dim)',  border: 'rgba(245,158,11,0.20)',   label: 'pending' },
  completed:          { color: 'var(--success)', bg: 'var(--success-dim)',  border: 'rgba(34,197,94,0.20)',    label: 'closed' },
  lost:               { color: 'var(--danger)',  bg: 'var(--danger-dim)',   border: 'rgba(239,68,68,0.20)',    label: 'lost' },
  no_show:            { color: '#94A3B8',        bg: 'rgba(148,163,184,0.10)', border: 'rgba(148,163,184,0.25)', label: 'no show' },
  missed:             { color: '#94A3B8',        bg: 'rgba(148,163,184,0.10)', border: 'rgba(148,163,184,0.25)', label: 'missed' },
  needs_rescheduling: { color: 'var(--info)',    bg: 'var(--info-dim)',     border: 'rgba(56,189,248,0.20)',   label: 'reschedule' },
}

function AdminCloserStatusBadge({ status, outcome }) {
  const key = (outcome === 'closed' || status === 'completed') ? 'completed' : (status || 'pending')
  const s = ADMIN_CLOSER_STATUS_STYLES[key] || ADMIN_CLOSER_STATUS_STYLES.pending
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

function useAllCloserAppointments() {
  return useQuery({
    queryKey: ['pipeline', 'all_closer_appointments'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('appointments')
        .select(`
          id, status, outcome, scheduled_at, deal_value,
          lead:leads(business_name, niche, city, phone),
          closer:profiles!appointments_closer_id_fkey(full_name),
          rep:profiles!appointments_rep_id_fkey(full_name)
        `)
        .order('scheduled_at', { ascending: false })
        .limit(500)
      if (error) throw error
      return data || []
    },
    refetchInterval: 60_000,
  })
}

function fmtDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })
}

function AdminCloserView({ filters }) {
  const [filterTab, setFilterTab] = useState('pending')
  const { data: allAppts = [], isLoading } = useAllCloserAppointments()

  const buckets = {
    pending:            allAppts.filter(a => a.status === 'pending'),
    closed:             allAppts.filter(a => a.outcome === 'closed'),
    lost:               allAppts.filter(a => a.outcome === 'lost'),
    no_show:            allAppts.filter(a => a.status === 'no_show' || a.outcome === 'no_show' || a.status === 'missed'),
    needs_rescheduling: allAppts.filter(a => a.status === 'needs_rescheduling'),
    all:                allAppts,
  }

  const applyApptFilters = rows => {
    if (!rows) return []
    const s = filters.search.trim().toLowerCase()
    const sDigits = s.replace(/\D/g, '')
    return rows.filter(r => {
      if (!s) return true
      const biz = (r.lead?.business_name || '').toLowerCase()
      const phone = (r.lead?.phone || '').replace(/\D/g, '')
      return biz.includes(s) || (sDigits && phone.includes(sDigits))
    })
  }

  const rows = applyApptFilters(buckets[filterTab])
  const COLS = [['Business', '1 1 0'], ['Niche', '0 0 110px'], ['City', '0 0 100px'], ['Phone', '0 0 130px'], ['Set By', '0 0 110px'], ['Closer', '0 0 110px'], ['Scheduled', '0 0 140px']]
  const COLS_ALL = [...COLS, ['Status', '0 0 110px']]

  return (
    <div>
      {/* KPI cards */}
      <div className="stagger" style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        <KPICard label="Pending Total" value={buckets.pending.length} sub="all closers" icon={CalendarClock} />
        <KPICard label="Closed Total"  value={buckets.closed.length}  sub="all time"    icon={CheckCircle} />
      </div>

      {/* Filter tabs */}
      <div style={{ display: 'flex', gap: 4, borderBottom: '0.5px solid var(--border)', marginBottom: 20, overflowX: 'auto' }}>
        {ADMIN_CLOSER_TABS.map(({ key, label, color, dim, border }) => {
          const active = filterTab === key
          return (
            <button
              key={key}
              onClick={() => setFilterTab(key)}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '10px 14px', background: 'none', cursor: 'pointer',
                border: 'none', borderBottom: active ? `2px solid ${color}` : '2px solid transparent',
                fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap', color,
              }}
            >
              {label}
              <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 10, fontFamily: 'var(--font-mono)', background: dim, color, border: `0.5px solid ${border}` }}>
                {isLoading ? '…' : buckets[key]?.length ?? 0}
              </span>
            </button>
          )
        })}
      </div>

      <QueueTable
        columns={filterTab === 'all' ? COLS_ALL : COLS}
        rows={rows}
        emptyText={isLoading ? 'Loading…' : 'No appointments.'}
        renderRow={a => (
          <div key={a.id} style={{ display: 'flex', borderBottom: '0.5px solid var(--border)' }}>
            <div style={cell('1 1 0', { color: 'var(--text-primary)', fontWeight: 500 })}>{a.lead?.business_name || '—'}</div>
            <div style={cell('0 0 110px')}>{a.lead?.niche || '—'}</div>
            <div style={cell('0 0 100px')}>{a.lead?.city || '—'}</div>
            <div style={cell('0 0 130px', { fontFamily: 'var(--font-mono)' })}>{a.lead?.phone || '—'}</div>
            <div style={cell('0 0 110px')}>{a.rep?.full_name || '—'}</div>
            <div style={cell('0 0 110px')}>{a.closer?.full_name || '—'}</div>
            <div style={cell('0 0 140px', { fontFamily: 'var(--font-mono)' })}>{fmtDate(a.scheduled_at)}</div>
            {filterTab === 'all' && (
              <div style={cell('0 0 110px')}><AdminCloserStatusBadge status={a.status} outcome={a.outcome} /></div>
            )}
          </div>
        )}
      />
    </div>
  )
}

function AppointmentSettingView({ filters }) {
  const [filterTab, setFilterTab] = useState('new')
  const { data: newRows,    isLoading: loadingNew }    = useNewAssigned()
  const { data: naRows,     isLoading: loadingNA }     = useNoAnswerQueue()
  const { data: fuRows,     isLoading: loadingFU }     = useFollowUpQueue()
  const { data: niRows,     isLoading: loadingNI }     = useNotInterested()
  const { data: allRows,    isLoading: loadingAll }    = useAllRepAssigned()

  const counts = {
    new:            newRows?.length ?? 0,
    no_answer:      naRows?.length  ?? 0,
    follow_up:      fuRows?.length  ?? 0,
    not_interested: niRows?.length  ?? 0,
    all:            allRows?.length ?? 0,
  }

  return (
    <div>
      {/* Filter tabs */}
      <div style={{ display: 'flex', gap: 4, borderBottom: '0.5px solid var(--border)', marginBottom: 20, overflowX: 'auto' }}>
        {SETTER_FILTER_TABS.map(({ key, label, icon: Icon, color, dim, border }) => {
          const active = filterTab === key
          return (
            <button
              key={key}
              onClick={() => setFilterTab(key)}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '10px 14px', background: 'none', cursor: 'pointer',
                border: 'none', borderBottom: active ? `2px solid ${color}` : '2px solid transparent',
                fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap',
                color,
              }}
            >
              {Icon && <Icon size={13} />}
              {label}
              <span style={{
                fontSize: 10, padding: '1px 6px', borderRadius: 10, fontFamily: 'var(--font-mono)',
                background: dim, color, border: `0.5px solid ${border}`,
              }}>
                {counts[key] ?? 0}
              </span>
            </button>
          )
        })}
      </div>

      {filterTab === 'new'            && <NewTab filters={filters} />}
      {filterTab === 'no_answer'      && <NoAnswerTab filters={filters} />}
      {filterTab === 'follow_up'      && <FollowUpTab filters={filters} />}
      {filterTab === 'not_interested' && <NotInterestedTab filters={filters} />}
      {filterTab === 'all' && (
        <div>
          <div className="stagger" style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
            <KPICard label="Rep-Assigned Total" value={allRows?.length ?? 0} sub="across all reps" icon={Phone} />
          </div>
          <QueueTable
            columns={[['Business', '1 1 0'], ['Niche', '0 0 130px'], ['City', '0 0 120px'], ['Rep Assigned', '0 0 140px'], ['Status', '0 0 140px'], ['Batch Date', '0 0 120px']]}
            rows={applyFilters(allRows, filters, r => r.assigned_rep?.full_name)}
            emptyText={loadingAll ? 'Loading…' : 'No rep-assigned leads.'}
            renderRow={r => (
              <div key={r.id} style={{ display: 'flex', borderBottom: '0.5px solid var(--border)' }}>
                <div style={cell('1 1 0', { color: 'var(--text-primary)', fontWeight: 500 })}>{r.business_name}</div>
                <div style={cell('0 0 130px')}>{r.niche || '—'}</div>
                <div style={cell('0 0 120px')}>{r.city || '—'}</div>
                <div style={cell('0 0 140px')}>{r.assigned_rep?.full_name || '—'}</div>
                <div style={cell('0 0 140px')}>{r.status || '—'}</div>
                <div style={cell('0 0 120px', { fontFamily: 'var(--font-mono)' })}>
                  {r.batch_date ? new Date(r.batch_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'}
                </div>
              </div>
            )}
          />
        </div>
      )}
    </div>
  )
}

export default function LeadPipeline() {
  const [view, setView] = useState('unassigned')
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
              placeholder="Search business, niche, city, phone…"
              style={{
                height: 32, padding: '0 10px 0 28px', width: 240,
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

      {/* Top-level view tabs */}
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

      {/* Unassigned */}
      {view === 'unassigned' && <UnassignedTab filters={filters} />}

      {/* Appointment Setting — colored filter tabs with counts */}
      {view === 'appointment_setting' && <AppointmentSettingView filters={filters} />}

      {/* Closer */}
      {view === 'closer' && <AdminCloserView filters={filters} />}
    </div>
  )
}
