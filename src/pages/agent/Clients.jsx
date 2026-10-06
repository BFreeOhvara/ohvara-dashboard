import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { Search, Phone, Check, X, MessageSquare } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { useAgentBookings, useRescheduleBooking, useRebookCall, useConfirmRecoveryNumber } from '../../hooks/useAgentBookings'
import { fieldLabel, primaryBtn, ghostBtn, control, MONO, DISPLAY } from '../../lib/exportStyles'
import { Pipeline } from '../../components/agent/Pipeline'
import { AnchoredSelectField } from '../../components/ui/ExportForm'
import { ClientRow, EmptyNote, SlotPicker, ListCard } from '../../components/agent/AgentUI'
import { fullName } from '../../lib/policyFormat'
import { slotToISO, localDateISO, fmtBooking, isFarOut } from '../../lib/scheduling'
import { isLive, agentStageOf, AGENT_BUCKETS, RANGES, SUBSTATUS_LABEL, digits, useNow, startOfWeek, startOfMonth } from '../../lib/agentBookings'
import { LiveDot } from '../../components/ui/LiveDot'
import { excludeTestAccounts } from '../../lib/testAccounts'

// My Pipeline (Prompt 665, was My Clients until 680) — replaces My Policies.
//
// Naming: "My Policies" read as an in-force book of business, which this
// dashboard doesn't track (Brayden, 2026-10-01). Every row an agent creates
// is a client whose EXISTING policy is being cancelled, so this is a log of
// clients you've booked and where each cancellation stands: Booked → In
// progress (a call is live right now) → Cancelled / No answer
// (Prompt 689). No AP, no policy #, no
// effectuation/underwriting/lapse banners — none of that applies any more.
//
// Admin lands here too (nav "Clients") and sees every agent's bookings, with
// an agent filter; the test account is held out of that company-wide view.
//
// Prompt 669 — restyled to Restorix Portal's design system: segmented status
// filter, one list card with an eyebrow header (Restorix's tables), and the
// client detail opening in place under its row instead of as a separate card.
//
// Prompt 672 — status and range live in the
// URL (?stage=noAnswer&range=week) so Overview's tiles link straight to the
// matching slice. Range is by booking date and scopes the whole page; search
// only narrows the list.
//
// Prompt 680 — renamed My Pipeline and simplified to Restorix's shape: status
// pills with counts, then search, then the list. The funnel card and its range
// toggle are gone; a range arriving from an Overview tile shows as a removable
// chip next to the count instead.
//
// Prompt 695 — Rescheduling is gone (merged into No answer); the header is one
// row (status pills left, lead count right); a No answer lead has a Re-book
// action that sets a new time and sends it back to Booked.
//
// Prompt 702 — five statuses (no In progress — a live call pulses on its Booked
// row); the manual Re-book is gone while Prompt 696's automation owns a No
// answer lead; Confirm number is a one-tap row, Needs attention is "Call &
// rebook".
//
// Prompt 687 — lead detail opens in a popup instead of expanding under its row;
// the page lands on Booked (the pills are one grouped bar); search looks across
// every status (the pills only filter when the search box is empty); the lead
// count sits above the search bar on the right; the Book a call shortcut is gone
// (it has its own nav item).

// Re-book is the agent's move only when nobody else owns the lead: Needs
// attention (call, then rebook), or a No answer that isn't in Prompt 696's
// automated flow (texting off / flow not started) — otherwise it would be a
// dead end. Inside the flow the system owns it.
const canRebook = p => {
  const s = agentStageOf(p)
  return s === 'needsAttention' || (s === 'noAnswer' && !p.recovery_step)
}

const STAGES = ['all', ...AGENT_BUCKETS]
const RANGE_VALUES = RANGES.map(r => r.value)

export default function Clients() {
  const { profile } = useAuth()
  const isAdmin = profile?.role === 'admin'
  const now = useNow()
  const [params, setParams] = useSearchParams()
  const openId = params.get('open')
  const rebook = params.get('rebook') === '1'

  const { data: raw = [], isLoading } = useAgentBookings(isAdmin ? null : profile?.id)
  const rows = useMemo(() => (isAdmin ? excludeTestAccounts(raw, profile?.id) : raw), [raw, isAdmin, profile?.id])

  const filter = STAGES.includes(params.get('stage')) ? params.get('stage') : 'booked'
  const range = RANGE_VALUES.includes(params.get('range')) ? params.get('range') : 'all'
  const setParam = (key, value, fallback) => {
    const next = new URLSearchParams(params)
    if (value === fallback) next.delete(key); else next.set(key, value)
    setParams(next, { replace: true })
  }
  const [search, setSearch] = useState('')
  const [agentId, setAgentId] = useState('')

  const agents = useMemo(() => [...new Map(rows.map(p => [p.agent_id, p.agent?.full_name || 'Unknown'])).entries()]
    .map(([id, name]) => ({ value: id, label: name }))
    .sort((a, b) => a.label.localeCompare(b.label)), [rows])

  // Range + agent scope the pipeline and the list alike.
  const scoped = useMemo(() => {
    const from = range === 'week' ? startOfWeek(new Date(now)).getTime()
      : range === 'month' ? startOfMonth(new Date(now)).getTime() : null
    return rows.filter(p => (!agentId || p.agent_id === agentId)
      && (from == null || new Date(p.created_at).getTime() >= from))
  }, [rows, agentId, range, now])

  const list = useMemo(() => {
    const q = search.trim().toLowerCase()
    const qd = digits(q)
    const filtered = scoped.filter(p => {
      // Search spans every status; the pills only filter when nothing is typed.
      if (!q && filter !== 'all' && agentStageOf(p) !== filter) return false
      if (q) {
        const hay = [p.client_first_name, p.client_last_name, p.current_carrier, p.agent?.full_name].filter(Boolean).join(' ').toLowerCase()
        if (!hay.includes(q) && !(qd.length >= 3 && digits(p.client_phone).includes(qd))) return false
      }
      return true
    })
    // Open work first, soonest call first; finished cancellations after, newest first.
    const rank = p => (agentStageOf(p) === 'cancelled' ? 1 : 0)
    return filtered.sort((a, b) => rank(a) - rank(b) || (rank(a)
      ? (b.fulfillment_completed_at || b.updated_at || '').localeCompare(a.fulfillment_completed_at || a.updated_at || '')
      : (a.scheduled_call_at || '9').localeCompare(b.scheduled_call_at || '9')))
  }, [scoped, filter, search])

  const toggle = id => {
    const next = new URLSearchParams(params)
    next.delete('rebook')
    if (openId === id) next.delete('open'); else next.set('open', id)
    setParams(next, { replace: true })
  }
  const openOnly = id => {
    const next = new URLSearchParams(params)
    next.set('open', id)
    next.delete('rebook')
    setParams(next, { replace: true })
  }
  const startRebook = id => {
    const next = new URLSearchParams(params)
    next.set('open', id)
    next.set('rebook', '1')
    setParams(next, { replace: true })
  }
  // Looked up from every row, not the filtered list, so a link from Overview
  // opens its lead whichever pill is selected.
  const openRow = openId ? rows.find(p => p.id === openId) : null

  return (
    // Prompt 686 — fixed-height column (viewport minus header + main padding) so
    // the page never scrolls; only the list card scrolls inside it.
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, height: 'calc(100dvh - 160px)', minHeight: 360 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', flexShrink: 0 }}>
        <Pipeline rows={scoped} buckets={AGENT_BUCKETS} bucketFn={agentStageOf} bucket={filter} onBucket={v => setParam('stage', v, 'booked')} showAll={false} />
        {isAdmin && agents.length > 1 && (
          <AnchoredSelectField
            value={agentId} onChange={setAgentId}
            options={[{ value: '', label: 'All agents' }, ...agents]}
            style={{ width: 220 }}
          />
        )}
        {range !== 'all' && (
          <button onClick={() => setParam('range', 'all', 'all')} style={{ ...ghostBtn, height: 30 }}>
            {range === 'week' ? 'Booked this week' : 'Booked this month'} <X size={13} />
          </button>
        )}
        <div style={{ flex: 1 }} />
        <span style={{ fontFamily: MONO, fontSize: 12.5, color: 'var(--text-muted)' }}>
          {isLoading ? 'Loading…' : `${list.length} lead${list.length === 1 ? '' : 's'}`}
        </span>
      </div>

      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, height: 44, padding: '0 14px', flexShrink: 0,
        background: 'var(--bg-surface)', border: 'var(--border-w) solid var(--border)', borderRadius: 10,
      }}>
        <Search size={15} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
        <input
          value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search name, phone, carrier…"
          style={{ flex: 1, minWidth: 0, border: 'none', background: 'transparent', color: 'var(--text-primary)', fontSize: 14, outline: 'none' }}
        />
      </div>

      <ListCard
        head
        style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}
        empty={(
          <EmptyNote>
            {isLoading ? 'Loading clients…'
              : rows.length === 0 ? 'No clients yet — everyone you book a call for shows up here.'
                : scoped.length === 0 ? `Nobody booked ${range === 'week' ? 'this week' : 'this month'} yet.`
                : 'No clients match.'}
          </EmptyNote>
        )}
      >
        {list.map((p, i) => (
          <ClientRow
            key={p.id} p={p} now={now} showAgent={isAdmin} tall first={i === 0} last={i === list.length - 1} active={openId === p.id} onClick={() => toggle(p.id)}
            onRebook={canRebook(p) && (isAdmin || p.agent_id === profile?.id) ? () => startRebook(p.id) : undefined}
            rebookLabel={agentStageOf(p) === 'needsAttention' ? 'Call & rebook' : 'Re-book'}
            onConfirmNumber={agentStageOf(p) === 'confirmNumber' && (isAdmin || p.agent_id === profile?.id) ? () => openOnly(p.id) : undefined}
          />
        ))}
      </ListCard>

      {openRow && (
        <ClientModal onClose={() => toggle(openRow.id)}>
          <ClientDetail key={`${openRow.id}:${rebook}`} p={openRow} now={now} canMove={isAdmin || openRow.agent_id === profile?.id} startRebook={rebook} onClose={() => toggle(openRow.id)} />
        </ClientModal>
      )}
    </div>
  )
}

// Centered popup, same overlay/surface as PolicyModal.
function ClientModal({ onClose, children }) {
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => { document.body.style.overflow = prev; window.removeEventListener('keydown', onKey) }
  }, [onClose])

  return createPortal(
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
    >
      <div
        onClick={e => e.stopPropagation()}
        className="scrollbar-thin"
        style={{
          width: '100%', maxWidth: 640, maxHeight: '86vh', overflowY: 'auto',
          background: 'var(--bg-elevated)', border: 'var(--border-w) solid var(--border)', borderRadius: 14,
        }}
      >
        {children}
      </div>
    </div>,
    document.body,
  )
}

function ClientDetail({ p, now, canMove, startRebook, onClose }) {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const stage = agentStageOf(p)
  const live = isLive(p)
  const [moving, setMoving] = useState(!!startRebook && canRebook(p) && canMove)

  const attempted = (p.call_attempts || 0) > 0
  const caller = p.assigned?.full_name || 'Fulfillment'
  const steps = [
    { label: 'Booked', at: p.created_at, done: true },
    { label: attempted ? `Called by ${caller}` : 'Waiting for Fulfillment to call', at: p.fulfillment_started_at || p.fulfillment_claimed_at, done: attempted },
    { label: 'Old policy cancelled', at: p.fulfillment_completed_at, done: stage === 'cancelled' },
  ]
  const statusText = {
    booked: live ? 'On a call right now' : 'Waiting for Fulfillment',
    noAnswer: `No answer${SUBSTATUS_LABEL[p.cancellation_substatus] ? ` · ${SUBSTATUS_LABEL[p.cancellation_substatus].toLowerCase()}` : ''} — ${{
      retry_locked: `retry call locked for ${fmtBooking(p.recovery_retry_at)}; we've texted them a link to pick another time`,
      followup: "we're texting them a link to pick a time; you'll be told if they don't reply",
    }[p.recovery_step] || 're-book a time, or Fulfillment will try again'}`,
    confirmNumber: 'two tries, no answer. Confirm their number to continue',
    needsAttention: "they haven't replied to our texts. Call them and re-book",
    cancelled: 'Cancelled',
  }[stage]

  return (
    <div style={{
      padding: '22px 24px 24px',
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
        <button onClick={() => navigate(`/messages?thread=${p.id}`)} style={ghostBtn}>
          <MessageSquare size={14} /> {profile?.role === 'admin' ? 'Open conversation' : 'Message Fulfillment'}
        </button>
        <button onClick={onClose} title="Close" className="icon-btn" style={{ width: 32, height: 32 }}><X size={15} /></button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(160px, 100%), 1fr))', gap: 16, marginBottom: 20 }}>
        <Info label="Fulfillment call" value={fmtBooking(p.scheduled_call_at)} mono />
        <Info label="Leaving" value={p.current_carrier || 'Not noted'} />
        <Info label="Status" value={live && stage === 'booked'
          ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><LiveDot /> {statusText}</span>
          : statusText} />
        {attempted && stage !== 'cancelled' && <Info label="Calls so far" value={String(p.call_attempts)} mono />}
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

      {stage === 'booked' && !live && canMove && (
        moving
          ? <Reschedule p={p} now={now} onDone={() => setMoving(false)} />
          : (
            <button onClick={() => setMoving(true)} style={{ ...ghostBtn, marginTop: 20 }}>
              Move to a different time
            </button>
          )
      )}
      {stage === 'confirmNumber' && canMove && <ConfirmNumber p={p} />}
      {canRebook(p) && canMove && (
        moving
          ? <Reschedule p={p} now={now} rebook onDone={() => setMoving(false)} />
          : (
            <button onClick={() => setMoving(true)} style={{ ...primaryBtn, marginTop: 20 }}>
              {stage === 'needsAttention' ? 'Call & rebook' : 'Re-book a call'}
            </button>
          )
      )}
      {(stage !== 'booked' || live) && stage !== 'cancelled' && stage !== 'confirmNumber' && !(canRebook(p) && canMove) && (
        <p style={{ margin: '18px 0 0', fontSize: 13, color: 'var(--text-muted)' }}>
          {stage === 'noAnswer' ? "We're working this one — nothing for you to do yet." : 'Fulfillment is on this one — if the time needs to change, message them.'}
        </p>
      )}
    </div>
  )
}

// Prompt 696 — the checkpoint after two unanswered calls: nothing else is sent
// until the agent says this is the right number (optionally fixing it first).
function ConfirmNumber({ p }) {
  const confirm = useConfirmRecoveryNumber()
  const [editing, setEditing] = useState(false)
  const [phone, setPhone] = useState(p.client_phone || '')
  const valid = [10, 11].includes(digits(phone).length)
  const first = p.client_first_name || 'them'
  return (
    <div style={{ marginTop: 20, paddingTop: 18, borderTop: 'var(--border-w) solid var(--border)' }}>
      <p style={fieldLabel}>Confirm the number</p>
      <p style={{ margin: '6px 0 12px', fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
        Fulfillment couldn't reach {first} after two tries. Is <span style={{ fontFamily: MONO, color: 'var(--text-primary)' }}>{p.client_phone || 'no number'}</span> still
        right? Confirm and we'll text them tomorrow morning and evening. If neither gets a reply, you'll be asked to call them yourself.
      </p>
      {editing && (
        <input
          value={phone} onChange={e => setPhone(e.target.value)} inputMode="tel" autoFocus
          aria-label="Client phone number" placeholder="(555) 555-5555"
          style={{ ...control, background: 'var(--bg-base)', padding: '0 12px', maxWidth: 260, marginBottom: 12, fontFamily: MONO }}
        />
      )}
      {confirm.isError && <p style={{ margin: '0 0 10px', fontSize: 13, color: 'var(--danger)' }}>{confirm.error?.message}</p>}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <button
          disabled={confirm.isPending || (editing && !valid)}
          onClick={() => confirm.mutate({ id: p.id, phone: editing && digits(phone) !== digits(p.client_phone) ? phone : null })}
          style={{ ...primaryBtn, opacity: confirm.isPending || (editing && !valid) ? 0.5 : 1 }}
        >
          {confirm.isPending ? 'Saving…' : editing ? 'Save and confirm' : 'Yes, this is the right number'}
        </button>
        {!editing && <button onClick={() => setEditing(true)} style={{ ...ghostBtn, height: 40 }}>Change number</button>}
      </div>
    </div>
  )
}

// Moves a Booked call (Prompt 665) or, with `rebook`, puts a No answer lead
// back on Booked at a new time (Prompt 695) — same slot picker either way.
function Reschedule({ p, now, onDone, rebook }) {
  const reschedule = useRescheduleBooking()
  const rebookCall = useRebookCall()
  const move = rebook ? rebookCall : reschedule
  const current = p.scheduled_call_at ? new Date(p.scheduled_call_at) : null
  const [date, setDate] = useState(() => (current && current.getTime() > Date.now() ? localDateISO(0, current) : localDateISO(0)))
  const [slot, setSlot] = useState('')
  const [farOk, setFarOk] = useState(false)
  const iso = slot ? slotToISO(date, slot) : null
  const needsFarOk = isFarOut(iso) && !farOk

  return (
    <div style={{ marginTop: 20, paddingTop: 18, borderTop: 'var(--border-w) solid var(--border)' }}>
      <p style={fieldLabel}>{rebook ? 'Re-book for' : 'New time'}</p>
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
          {move.isPending ? 'Saving…' : iso ? `${rebook ? 'Re-book for' : 'Move to'} ${fmtBooking(iso)}` : 'Pick a time'}
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
