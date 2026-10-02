import { useMemo, useState } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { Search, Phone, CalendarPlus, Check, X } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { useAgentBookings, useLegacyPolicyCount, useRescheduleBooking } from '../../hooks/useAgentBookings'
import { fieldLabel, primaryBtn, ghostBtn, MONO, DISPLAY } from '../../lib/exportStyles'
import { Segmented } from '../../components/ui/Segmented'
import { AnchoredSelectField, GapNote } from '../../components/ui/ExportForm'
import { ClientRow, EmptyNote, SlotPicker, ListCard } from '../../components/agent/AgentUI'
import { fullName } from '../../lib/policyFormat'
import { slotToISO, localDateISO, fmtBooking, isFarOut } from '../../lib/scheduling'
import { stageOf, SUBSTATUS_LABEL, digits, useNow } from '../../lib/agentBookings'
import { excludeTestAccounts } from '../../lib/testAccounts'

// My Clients (Prompt 665) — replaces My Policies.
//
// Naming: "My Policies" read as an in-force book of business, which this
// dashboard doesn't track (Brayden, 2026-10-01). Every row an agent creates
// is a client whose EXISTING policy is being cancelled, so this is a log of
// clients you've booked and where each cancellation stands: Booked → In
// progress (a Fulfillment rep has it) → Cancelled. No AP, no policy #, no
// effectuation/underwriting/lapse banners — none of that applies any more.
//
// Admin lands here too (nav "Clients") and sees every agent's bookings, with
// an agent filter; the test account is held out of that company-wide view.
//
// Prompt 669 — restyled to Restorix Portal's design system: segmented status
// filter, one list card with an eyebrow header (Restorix's tables), and the
// client detail opening in place under its row instead of as a separate card.

const FILTERS = ['all', 'booked', 'inProgress', 'cancelled']
const FILTER_LABEL = { all: 'All', booked: 'Booked', inProgress: 'In progress', cancelled: 'Cancelled' }

export default function Clients() {
  const { profile } = useAuth()
  const isAdmin = profile?.role === 'admin'
  const navigate = useNavigate()
  const now = useNow()
  const [params, setParams] = useSearchParams()
  const openId = params.get('open')

  const { data: raw = [], isLoading } = useAgentBookings(isAdmin ? null : profile?.id)
  const { data: legacyCount = 0 } = useLegacyPolicyCount(isAdmin ? null : profile?.id)
  const rows = useMemo(() => (isAdmin ? excludeTestAccounts(raw, profile?.id) : raw), [raw, isAdmin, profile?.id])

  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [agentId, setAgentId] = useState('')

  const agents = useMemo(() => [...new Map(rows.map(p => [p.agent_id, p.agent?.full_name || 'Unknown'])).entries()]
    .map(([id, name]) => ({ value: id, label: name }))
    .sort((a, b) => a.label.localeCompare(b.label)), [rows])

  const counts = useMemo(() => {
    const c = { all: rows.length, booked: 0, inProgress: 0, cancelled: 0 }
    for (const p of rows) c[stageOf(p)]++
    return c
  }, [rows])

  const list = useMemo(() => {
    const q = search.trim().toLowerCase()
    const qd = digits(q)
    const filtered = rows.filter(p => {
      if (filter !== 'all' && stageOf(p) !== filter) return false
      if (agentId && p.agent_id !== agentId) return false
      if (q) {
        const hay = [p.client_first_name, p.client_last_name, p.current_carrier, p.agent?.full_name].filter(Boolean).join(' ').toLowerCase()
        if (!hay.includes(q) && !(qd.length >= 3 && digits(p.client_phone).includes(qd))) return false
      }
      return true
    })
    // Open work first, soonest call first; finished cancellations after, newest first.
    const rank = p => (stageOf(p) === 'cancelled' ? 1 : 0)
    return filtered.sort((a, b) => rank(a) - rank(b) || (rank(a)
      ? (b.fulfillment_completed_at || b.updated_at || '').localeCompare(a.fulfillment_completed_at || a.updated_at || '')
      : (a.scheduled_call_at || '9').localeCompare(b.scheduled_call_at || '9')))
  }, [rows, filter, search, agentId])

  const toggle = id => {
    const next = new URLSearchParams(params)
    if (openId === id) next.delete('open'); else next.set('open', id)
    setParams(next, { replace: true })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <Segmented
          value={filter} onChange={setFilter}
          options={FILTERS.map(f => ({ value: f, label: `${FILTER_LABEL[f]} (${counts[f]})` }))}
          style={{ maxWidth: '100%', overflowX: 'auto' }}
        />
        <div style={{ flex: 1 }} />
        {!isAdmin && (
          <button onClick={() => navigate('/agent/book')} style={primaryBtn}>
            <CalendarPlus size={16} /> Book a call
          </button>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, height: 40, padding: '0 14px',
          background: 'var(--bg-surface)', border: 'var(--border-w) solid var(--border)',
          borderRadius: 10, flex: '1 1 240px', maxWidth: 380,
        }}>
          <Search size={15} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search name, phone, carrier…"
            style={{ flex: 1, minWidth: 0, border: 'none', background: 'transparent', color: 'var(--text-primary)', fontSize: 14, outline: 'none' }}
          />
        </div>
        {isAdmin && agents.length > 1 && (
          <AnchoredSelectField
            value={agentId} onChange={setAgentId}
            options={[{ value: '', label: 'All agents' }, ...agents]}
            style={{ width: 220 }}
          />
        )}
        <span style={{ fontFamily: MONO, fontSize: 12.5, color: 'var(--text-muted)' }}>
          {isLoading ? 'Loading…' : `${list.length} of ${rows.length} client${rows.length === 1 ? '' : 's'}`}
        </span>
      </div>

      <ListCard
        head
        empty={(
          <EmptyNote>
            {isLoading ? 'Loading clients…'
              : rows.length === 0 ? 'No clients yet — everyone you book a call for shows up here.'
                : 'No clients match.'}
          </EmptyNote>
        )}
      >
        {list.map((p, i) => (
          <div key={p.id}>
            <ClientRow p={p} now={now} showAgent={isAdmin} first={i === 0} active={openId === p.id} onClick={() => toggle(p.id)} />
            {openId === p.id && (
              <ClientDetail p={p} now={now} canMove={isAdmin || p.agent_id === profile?.id} onClose={() => toggle(p.id)} />
            )}
          </div>
        ))}
      </ListCard>

      {legacyCount > 0 && (
        <GapNote>
          {legacyCount} older record{legacyCount === 1 ? '' : 's'} from the pre-pivot submission flow {legacyCount === 1 ? "isn't" : "aren't"} shown
          here — {legacyCount === 1 ? "it was" : "they were"} never booked with Fulfillment.
        </GapNote>
      )}
    </div>
  )
}

function ClientDetail({ p, now, canMove, onClose }) {
  const stage = stageOf(p)
  const [moving, setMoving] = useState(false)

  const steps = [
    { label: 'Booked', at: p.created_at, done: true },
    { label: p.assigned?.full_name ? `Picked up by ${p.assigned.full_name}` : 'Picked up by Fulfillment', at: p.fulfillment_claimed_at, done: stage !== 'booked' },
    { label: 'Old policy cancelled', at: p.fulfillment_completed_at, done: stage === 'cancelled' },
  ]

  return (
    <div style={{
      padding: '20px 24px 22px', background: 'var(--bg-elevated)',
      borderTop: 'var(--border-w) solid var(--border)', boxShadow: 'inset 3px 0 0 var(--accent)',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap', marginBottom: 18 }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <p style={{ margin: 0, fontFamily: DISPLAY, fontSize: 19, fontWeight: 500, letterSpacing: '-0.01em', color: 'var(--text-primary)' }}>{fullName(p)}</p>
          {p.client_phone && (
            <a href={`tel:${digits(p.client_phone)}`} style={{
              display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 4,
              fontSize: 14, fontFamily: MONO, color: 'var(--accent)', textDecoration: 'none',
            }}>
              <Phone size={13} /> {p.client_phone}
            </a>
          )}
        </div>
        <button onClick={onClose} title="Close" className="icon-btn" style={{ width: 32, height: 32 }}><X size={15} /></button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(160px, 100%), 1fr))', gap: 16, marginBottom: 20 }}>
        <Info label="Fulfillment call" value={fmtBooking(p.scheduled_call_at)} mono />
        <Info label="Leaving" value={p.current_carrier || 'Not noted'} />
        <Info label="Status" value={stage === 'inProgress' ? (SUBSTATUS_LABEL[p.cancellation_substatus] || 'In progress') : stage === 'cancelled' ? 'Cancelled' : 'Waiting for Fulfillment'} />
        {stage === 'cancelled' && <Info label="Carrier confirmation #" value={p.cancellation_confirmation || 'Not recorded'} mono />}
      </div>

      <p style={fieldLabel}>Progress</p>
      <ol style={{ listStyle: 'none', margin: '8px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {steps.map((s, i) => (
          <li key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span style={{
              width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              background: s.done ? 'var(--success)' : 'var(--bg-surface)',
              border: s.done ? 'none' : 'var(--border-w) solid var(--border-strong)', color: '#fff',
            }}>
              {s.done && <Check size={13} strokeWidth={3} />}
            </span>
            <span style={{ fontSize: 14, fontWeight: s.done ? 500 : 400, color: s.done ? 'var(--text-primary)' : 'var(--text-muted)' }}>{s.label}</span>
            {s.done && s.at && (
              <span style={{ fontSize: 12.5, color: 'var(--text-muted)', fontFamily: MONO }}>{fmtBooking(s.at)}</span>
            )}
          </li>
        ))}
      </ol>

      {stage === 'booked' && canMove && (
        moving
          ? <Reschedule p={p} now={now} onDone={() => setMoving(false)} />
          : (
            <button onClick={() => setMoving(true)} style={{ ...ghostBtn, marginTop: 20 }}>
              Move to a different time
            </button>
          )
      )}
      {stage === 'inProgress' && (
        <p style={{ margin: '18px 0 0', fontSize: 13, color: 'var(--text-muted)' }}>
          Fulfillment has this one — if the time needs to change, ask them directly.
        </p>
      )}
    </div>
  )
}

function Reschedule({ p, now, onDone }) {
  const move = useRescheduleBooking()
  const current = p.scheduled_call_at ? new Date(p.scheduled_call_at) : null
  const [date, setDate] = useState(() => (current && current.getTime() > Date.now() ? localDateISO(0, current) : localDateISO(0)))
  const [slot, setSlot] = useState('')
  const [farOk, setFarOk] = useState(false)
  const iso = slot ? slotToISO(date, slot) : null
  const needsFarOk = isFarOut(iso) && !farOk

  return (
    <div style={{ marginTop: 20, paddingTop: 18, borderTop: 'var(--border-w) solid var(--border)' }}>
      <p style={fieldLabel}>New time</p>
      <SlotPicker date={date} slot={slot} onDate={d => { setDate(d); setSlot(''); setFarOk(false) }}
        onSlot={s => { setSlot(s); setFarOk(false) }} now={now} />
      {needsFarOk && (
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, fontSize: 13, color: 'var(--warning)' }}>
          <input type="checkbox" checked={farOk} onChange={e => setFarOk(e.target.checked)} />
          More than a day out — Fulfillment is booked through then
        </label>
      )}
      {move.isError && <p style={{ margin: '10px 0 0', fontSize: 13, color: 'var(--danger)' }}>{move.error?.message}</p>}
      <div style={{ display: 'flex', gap: 10, marginTop: 16, flexWrap: 'wrap' }}>
        <button
          disabled={!iso || needsFarOk || move.isPending}
          onClick={() => move.mutate({ id: p.id, scheduledAt: iso }, { onSuccess: onDone })}
          style={{ ...primaryBtn, opacity: !iso || needsFarOk || move.isPending ? 0.5 : 1 }}
        >
          {move.isPending ? 'Saving…' : iso ? `Move to ${fmtBooking(iso)}` : 'Pick a time'}
        </button>
        <button onClick={onDone} style={{ ...ghostBtn, height: 40 }}>Cancel</button>
      </div>
    </div>
  )
}

function Info({ label, value, mono }) {
  return (
    <div>
      <p style={fieldLabel}>{label}</p>
      <p style={{ margin: 0, fontSize: 14, color: 'var(--text-primary)', fontFamily: mono ? MONO : undefined }}>{value}</p>
    </div>
  )
}
