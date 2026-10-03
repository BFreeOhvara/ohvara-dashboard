import { useMemo, useState } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { Search, Phone, X, Check, ArrowRight, MessageSquare } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { useFulfillmentQueue } from '../../hooks/usePolicies'
import { fieldLabel, ghostBtn, MONO, DISPLAY } from '../../lib/exportStyles'
import { Pipeline } from '../../components/agent/Pipeline'
import { AnchoredSelectField } from '../../components/ui/ExportForm'
import { ListCard, EmptyNote } from '../../components/agent/AgentUI'
import { FulfillHead, FulfillRow } from '../../components/fulfillment/FulfillUI'
import { fullName } from '../../lib/policyFormat'
import { fmtBooking } from '../../lib/scheduling'
import { stageOf, bucketOf, BUCKETS, SUBSTATUS_LABEL, digits, useNow } from '../../lib/agentBookings'
import { LiveDot } from '../../components/ui/LiveDot'
import { needsAttention } from '../../lib/fulfillmentFlags'

// Fulfillment Pipeline (Prompt 681) — every submission in flight across the
// whole agent base, not just "my desk": status, which agent booked it, who
// has it, where it's stuck. Same shape as the agent side's My Pipeline
// (status pills with counts → search → one list card) and the same pill
// component, scoped to everything Fulfillment can see (RLS: every
// fulfillment_assigned policy) instead of one agent's book.
//
// Read-only on purpose: work happens on the desk. A row opens a summary with
// the actions that fit — open it on the desk (your own, or any as admin) or
// message the agent. Intake is gated to the assigned rep (RLS), so nothing
// here shows it. Prompt 684: no claiming — every booking is auto-assigned.

const STAGES = ['all', ...BUCKETS, 'attention']
const UNASSIGNED = '__unassigned'
const STAGE_TEXT = {
  booked: 'Booked, no call yet', inProgress: 'On a call right now', noAnswer: 'No answer, needs another call',
  rescheduling: 'Rescheduling, needs another call', cancelled: 'Cancelled',
}

// Filter options from the rows themselves: one per distinct agent / rep.
function nameOptions(rows, key, nameKey) {
  return [...new Map(rows.filter(p => p[key]).map(p => [p[key], p[nameKey]?.full_name || 'Unknown'])).entries()]
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label))
}

export default function FulfillmentPipeline() {
  const { profile } = useAuth()
  const now = useNow()
  const [params, setParams] = useSearchParams()
  const openId = params.get('open')
  const { data: rows = [], isLoading } = useFulfillmentQueue()

  const filter = STAGES.includes(params.get('stage')) ? params.get('stage') : 'all'
  const setParam = (key, value, fallback) => {
    const next = new URLSearchParams(params)
    if (value === fallback) next.delete(key); else next.set(key, value)
    setParams(next, { replace: true })
  }
  const [search, setSearch] = useState('')
  const [agentId, setAgentId] = useState('')
  const [repId, setRepId] = useState('')

  const agents = useMemo(() => nameOptions(rows, 'agent_id', 'agent'), [rows])
  const reps = useMemo(() => nameOptions(rows, 'assigned_fulfillment_id', 'assigned'), [rows])

  // Agent + rep scope the pills and the list alike; stage and search narrow the list.
  const scoped = useMemo(() => rows.filter(p => (!agentId || p.agent_id === agentId)
    && (!repId || (repId === UNASSIGNED ? !p.assigned_fulfillment_id : p.assigned_fulfillment_id === repId))), [rows, agentId, repId])
  const attentionCount = useMemo(() => scoped.filter(p => needsAttention(p, now)).length, [scoped, now])

  const list = useMemo(() => {
    const q = search.trim().toLowerCase()
    const qd = digits(q)
    const filtered = scoped.filter(p => {
      if (filter === 'attention' ? !needsAttention(p, now) : (filter !== 'all' && bucketOf(p) !== filter)) return false
      if (q) {
        const hay = [p.client_first_name, p.client_last_name, p.agent?.full_name, p.assigned?.full_name, p.carrier_name].filter(Boolean).join(' ').toLowerCase()
        if (!hay.includes(q) && !(qd.length >= 3 && digits(p.client_phone).includes(qd))) return false
      }
      return true
    })
    // Open work first, soonest call first; finished cancellations after, newest first.
    const rank = p => (stageOf(p) === 'cancelled' ? 1 : 0)
    return filtered.sort((a, b) => rank(a) - rank(b) || (rank(a)
      ? (b.fulfillment_completed_at || b.updated_at || '').localeCompare(a.fulfillment_completed_at || a.updated_at || '')
      : (a.scheduled_call_at || '9').localeCompare(b.scheduled_call_at || '9')))
  }, [scoped, filter, search, now])

  const toggle = id => {
    const next = new URLSearchParams(params)
    if (openId === id) next.delete('open'); else next.set('open', id)
    setParams(next, { replace: true })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Pipeline
        rows={scoped} bucket={filter} onBucket={v => setParam('stage', v, 'all')}
        extras={[{ key: 'attention', label: 'Needs attention', count: attentionCount, warn: true }]}
      />

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, height: 40, padding: '0 14px',
          background: 'var(--bg-surface)', border: 'var(--border-w) solid var(--border)',
          borderRadius: 10, flex: '1 1 240px', maxWidth: 380,
        }}>
          <Search size={15} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search client, phone, agent, rep…"
            style={{ flex: 1, minWidth: 0, border: 'none', background: 'transparent', color: 'var(--text-primary)', fontSize: 14, outline: 'none' }}
          />
        </div>
        {agents.length > 1 && (
          <AnchoredSelectField value={agentId} onChange={setAgentId}
            options={[{ value: '', label: 'All agents' }, ...agents]} style={{ width: 200 }} />
        )}
        <AnchoredSelectField value={repId} onChange={setRepId}
          options={[{ value: '', label: 'All reps' }, { value: UNASSIGNED, label: 'Unassigned' }, ...reps]} style={{ width: 180 }} />
        <span style={{ fontFamily: MONO, fontSize: 12.5, color: 'var(--text-muted)' }}>
          {isLoading ? 'Loading…' : `${list.length} of ${scoped.length}`}
        </span>
      </div>

      <ListCard
        empty={(
          <EmptyNote>
            {isLoading ? 'Loading the pipeline…'
              : rows.length === 0 ? 'Nothing booked yet. Every client an agent books shows up here.'
                : 'Nothing matches.'}
          </EmptyNote>
        )}
      >
        {list.length > 0 && <FulfillHead />}
        {list.map((p, i) => (
          <div key={p.id}>
            <FulfillRow p={p} now={now} first={i === 0} active={openId === p.id} onClick={() => toggle(p.id)} />
            {openId === p.id && <Summary p={p} profile={profile} onClose={() => toggle(p.id)} />}
          </div>
        ))}
      </ListCard>
    </div>
  )
}

function Summary({ p, profile, onClose }) {
  const navigate = useNavigate()
  const isAdmin = profile?.role === 'admin'
  const stage = stageOf(p)
  const mine = p.assigned_fulfillment_id === profile?.id
  const desk = () => navigate(`/fulfillment/desk?open=${p.id}`)

  const steps = [
    { label: `Booked by ${p.agent?.full_name || 'the agent'}`, at: p.created_at, done: true },
    { label: p.assigned?.full_name ? `Assigned to ${p.assigned.full_name}` : 'Assigned to a rep', at: p.fulfillment_claimed_at, done: !!p.assigned_fulfillment_id },
    { label: (p.call_attempts || 0) > 1 ? `Called ${p.call_attempts} times` : 'Rep called the client', at: p.last_call_at || p.fulfillment_started_at, done: (p.call_attempts || 0) > 0 },
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
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 4, fontSize: 14, fontFamily: MONO, color: 'var(--text-secondary)' }}>
              <Phone size={13} /> {p.client_phone}
            </span>
          )}
        </div>
        {(mine || isAdmin) && (
          <button onClick={desk} style={ghostBtn}>Open on desk <ArrowRight size={14} /></button>
        )}
        <button onClick={() => navigate(`/messages?thread=${p.id}`)} style={ghostBtn}>
          <MessageSquare size={14} /> {isAdmin ? 'Open conversation' : 'Message agent'}
        </button>
        <button onClick={onClose} title="Close" className="icon-btn" style={{ width: 32, height: 32 }}><X size={15} /></button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(160px, 100%), 1fr))', gap: 16, marginBottom: 20 }}>
        <Info label="Fulfillment call" value={fmtBooking(p.scheduled_call_at)} mono />
        <Info label="New policy" value={[p.carrier_name, p.product_name, p.state].filter(Boolean).join(' · ') || '—'} />
        <Info label="Rep" value={p.assigned?.full_name || 'Unassigned'} />
        <Info label="Status" value={stage === 'inProgress'
          ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><LiveDot /> On a call right now</span>
          : stage === 'rescheduling' && SUBSTATUS_LABEL[p.cancellation_substatus]
            ? `Rescheduling · ${SUBSTATUS_LABEL[p.cancellation_substatus].toLowerCase()}`
            : STAGE_TEXT[stage]} />
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
            {s.done && s.at && <span style={{ fontSize: 12.5, color: 'var(--text-muted)', fontFamily: MONO }}>{fmtBooking(s.at)}</span>}
          </li>
        ))}
      </ol>
      {p.notes && (
        <div style={{ marginTop: 18, paddingTop: 14, borderTop: 'var(--border-w) solid var(--border)' }}>
          <p style={fieldLabel}>Agent's note</p>
          <p style={{ margin: 0, fontSize: 13.5, color: 'var(--text-secondary)', lineHeight: 1.5 }}>{p.notes}</p>
        </div>
      )}
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
