import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowLeft, ArrowRight, CheckCircle2, Clock, Phone, User, Eye, EyeOff,
  ShieldAlert, Inbox, Briefcase, AlertTriangle, CircleCheckBig, Send,
  FileSignature, Undo2, ChevronDown, ChevronUp, PhoneCall, MessageCircleMore, Loader2,
} from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { useFulfillmentQueue, useUpdatePolicy, useClaimCancellation } from '../../hooks/usePolicies'
import { usePolicyFulfillmentDetails } from '../../hooks/useFulfillmentDetails'
import { card, cardTitle, primaryBtn, ghostBtn, fieldLabel, control, MONO } from '../../lib/exportStyles'
import { Segmented } from '../../components/ui/Segmented'
import { SavedTick } from '../../components/ui/SavedTick'
import { money, fullName, formatDate, maskLast4 } from '../../lib/policyFormat'
import { invokeCallerId, FALLBACK_CODES } from '../../lib/callerId'

// Cancellations (Prompt 663 rebuild of the Prompt 418 Fulfillment Queue).
//
// Built for a small team whose whole day is one loop: claim a cancellation,
// work it with the old carrier, mark it cancelled, take the next one. So the
// page is a desk, not a list: a status strip up top, "On your desk" (what
// you've claimed) beside "Up next" (what's waiting), and a focused work view
// for one cancellation at a time with the steps laid out in order.
//
// Data is unchanged in shape — policies rows with fulfillment_assigned=true,
// intake in policy_fulfillment_details (claim-gated by RLS). Migration 106
// added claimed/completed timestamps (server-stamped), an in-progress
// sub-status, and a place for the carrier's confirmation # + working notes.

const HOUR = 3600e3
const STALE_WAITING_H = 24   // unclaimed this long → flagged
const STALE_CLAIMED_H = 48   // claimed but not finished this long → flagged

const SUBSTATUS = [
  { value: 'calling',         label: 'Calling carrier' },
  { value: 'waiting_carrier', label: 'Waiting on carrier' },
  { value: 'waiting_client',  label: 'Waiting on client' },
]
const SUBSTATUS_LABEL = Object.fromEntries(SUBSTATUS.map(s => [s.value, s.label]))

const TONE = {
  neutral: { color: 'var(--text-secondary)', dim: 'var(--bg-elevated)', bd: 'var(--border)' },
  accent:  { color: 'var(--accent)',  dim: 'var(--accent-dim)',  bd: 'var(--accent-border)' },
  info:    { color: 'var(--info)',    dim: 'var(--info-dim)',    bd: 'var(--info-bd)' },
  warning: { color: 'var(--warning)', dim: 'var(--warning-dim)', bd: 'var(--warning-bd)' },
  danger:  { color: 'var(--danger)',  dim: 'var(--danger-dim)',  bd: 'var(--danger-bd)' },
  success: { color: 'var(--success)', dim: 'var(--success-dim)', bd: 'var(--success-bd)' },
}

// ── time helpers ────────────────────────────────────────────────────────────

function ago(iso, now) {
  if (!iso) return ''
  const m = Math.max(0, Math.round((now - new Date(iso)) / 60e3))
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 48) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}

function hoursSince(iso, now) {
  return iso ? (now - new Date(iso)) / HOUR : 0
}

function fmtCallback(iso) {
  if (!iso) return null
  return new Date(iso).toLocaleString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  })
}

function isToday(iso, now) {
  if (!iso) return false
  return new Date(iso).toDateString() === new Date(now).toDateString()
}

// One place that decides whether an item needs attention, so the status strip
// and each row flag agree.
function flagsFor(p, now) {
  const done = p.fulfillment_stage === 'Complete'
  const overdue = !done && p.scheduled_call_at && new Date(p.scheduled_call_at) < now
  const staleWaiting = !done && !p.assigned_fulfillment_id && hoursSince(p.created_at, now) > STALE_WAITING_H
  const staleClaimed = !done && p.assigned_fulfillment_id
    && hoursSince(p.fulfillment_claimed_at || p.updated_at, now) > STALE_CLAIMED_H
  return { overdue, stale: staleWaiting || staleClaimed }
}

function useNow(intervalMs = 60e3) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(t)
  }, [intervalMs])
  return now
}

// ── small pieces ────────────────────────────────────────────────────────────

function Pill({ tone = 'neutral', icon: Icon, children }) {
  const t = TONE[tone]
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 7px', borderRadius: 4,
      fontSize: 10, fontWeight: 700, whiteSpace: 'nowrap',
      background: t.dim, color: t.color, border: `1px solid ${t.bd}`,
    }}>
      {Icon && <Icon size={10} />}{children}
    </span>
  )
}

function FlagPills({ p, now }) {
  const { overdue, stale } = flagsFor(p, now)
  return (
    <>
      {overdue && <Pill tone="danger" icon={AlertTriangle}>Callback overdue</Pill>}
      {!overdue && stale && <Pill tone="warning" icon={Clock}>Stale</Pill>}
    </>
  )
}

function StatTile({ icon: Icon, label, value, sub, tone = 'neutral' }) {
  const t = TONE[tone]
  return (
    <div style={{ ...card, padding: '14px 16px', display: 'flex', alignItems: 'flex-start', gap: 12 }}>
      <span style={{
        width: 30, height: 30, borderRadius: 7, flexShrink: 0,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        background: t.dim, border: `1px solid ${t.bd}`, color: t.color,
      }}>
        <Icon size={14} />
      </span>
      <div style={{ minWidth: 0 }}>
        <p style={{ ...fieldLabel, margin: 0 }}>{label}</p>
        <p style={{ margin: '2px 0 0', fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', fontFamily: MONO, lineHeight: 1.1 }}>
          {value}
        </p>
        {sub && <p style={{ margin: '2px 0 0', fontSize: 10.5, color: 'var(--text-muted)' }}>{sub}</p>}
      </div>
    </div>
  )
}

function EmptyNote({ children }) {
  return (
    <div style={{
      padding: '22px 16px', borderRadius: 7, textAlign: 'center',
      border: 'var(--border-w) dashed var(--border)', color: 'var(--text-muted)', fontSize: 12.5,
    }}>
      {children}
    </div>
  )
}

// Prompt 661 placeholder, carried forward unchanged in meaning: there is no
// e-signature provider behind this yet.
function AuthorizationStatus({ compact }) {
  if (compact) {
    return <Pill icon={FileSignature}>Auth: not collected · soon</Pill>
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <Pill icon={FileSignature}>Not yet collected</Pill>
      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
        E-signature collection is coming soon — nothing to do here yet.
      </span>
    </div>
  )
}

// Prompt 661 placeholder: honest disabled state, no external ping wired.
function NotifyAgentButton() {
  return (
    <button
      disabled
      title="Coming soon — automatic status ping back to the submitting agent"
      style={{ ...ghostBtn, opacity: 0.5, cursor: 'not-allowed' }}
    >
      <Send size={12} /> Notify agent · soon
    </button>
  )
}

// ── queue rows ──────────────────────────────────────────────────────────────

function RowShell({ children, onClick, highlight }) {
  return (
    <div
      onClick={onClick}
      style={{
        padding: '12px 14px', borderRadius: 7, cursor: onClick ? 'pointer' : 'default',
        background: 'var(--bg-elevated)',
        border: `var(--border-w) solid ${highlight ? 'var(--accent-border)' : 'var(--border)'}`,
        display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
      }}
    >
      {children}
    </div>
  )
}

function RowMain({ p, now, children }) {
  return (
    <div style={{ flex: '1 1 200px', minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 3 }}>
        <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>{fullName(p)}</p>
        <FlagPills p={p} now={now} />
        {children}
      </div>
      <p style={{ margin: 0, fontSize: 11, color: 'var(--text-muted)' }}>
        {[p.carrier_name, p.product_name, p.state].filter(Boolean).join(' · ') || 'No carrier/product on file'}
        {' · '}{p.agent?.full_name || 'unknown agent'}
      </p>
      <p style={{ margin: '3px 0 0', fontSize: 11, color: 'var(--text-secondary)', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
        <Clock size={11} /> {fmtCallback(p.scheduled_call_at) || 'No callback time'}
      </p>
    </div>
  )
}

function WaitingRow({ p, now, onClaim, busy }) {
  return (
    <RowShell>
      <RowMain p={p} now={now}>
        <span style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>in queue {ago(p.created_at, now)}</span>
      </RowMain>
      <button
        onClick={() => onClaim(p)}
        disabled={busy}
        style={{ ...primaryBtn, height: 32, display: 'inline-flex', alignItems: 'center', gap: 6, opacity: busy ? 0.6 : 1 }}
      >
        Claim & start <ArrowRight size={13} />
      </button>
    </RowShell>
  )
}

function DeskRow({ p, now, onOpen }) {
  return (
    <RowShell onClick={() => onOpen(p.id)} highlight>
      <RowMain p={p} now={now}>
        <Pill tone="info">{SUBSTATUS_LABEL[p.cancellation_substatus] || 'In progress'}</Pill>
      </RowMain>
      <span style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>claimed {ago(p.fulfillment_claimed_at, now)}</span>
      <button style={{ ...ghostBtn, height: 32 }}>
        Resume <ArrowRight size={12} />
      </button>
    </RowShell>
  )
}

function TeamRow({ p, now, onOpen }) {
  return (
    <RowShell onClick={onOpen ? () => onOpen(p.id) : undefined}>
      <RowMain p={p} now={now}>
        <Pill>{SUBSTATUS_LABEL[p.cancellation_substatus] || 'In progress'}</Pill>
      </RowMain>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--text-muted)' }}>
        <User size={11} /> {p.assigned?.full_name || 'someone'} · {ago(p.fulfillment_claimed_at, now)}
      </span>
    </RowShell>
  )
}

// ── intake (claim-gated) ────────────────────────────────────────────────────

// Prompt 419 — driver's license/routing/account numbers default masked
// (last 4 visible) with an explicit per-field reveal.
function MaskedField({ label, value, revealed, onToggleReveal }) {
  return (
    <div>
      <p style={fieldLabel}>{label}</p>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 12.5, color: 'var(--text-primary)', fontFamily: MONO }}>
          {value ? (revealed ? value : maskLast4(value)) : '—'}
        </span>
        {value && (
          <button
            onClick={onToggleReveal}
            title={revealed ? 'Hide' : 'Reveal'}
            style={{ border: 'none', background: 'transparent', color: 'var(--text-muted)', display: 'inline-flex', padding: 2 }}
          >
            {revealed ? <EyeOff size={12} /> : <Eye size={12} />}
          </button>
        )}
      </div>
    </div>
  )
}

function PlainField({ label, value, mono }) {
  return (
    <div>
      <p style={fieldLabel}>{label}</p>
      <p style={{ margin: 0, fontSize: 12.5, color: 'var(--text-primary)', fontFamily: mono ? MONO : undefined, wordBreak: 'break-word' }}>
        {value || '—'}
      </p>
    </div>
  )
}

function IntakeGrid({ data }) {
  const [revealed, setRevealed] = useState(new Set())
  const toggle = key => setRevealed(r => {
    const next = new Set(r)
    next.has(key) ? next.delete(key) : next.add(key)
    return next
  })
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(140px, 100%), 1fr))', gap: 14 }}>
      <PlainField label="Full legal name" value={data.full_legal_name} />
      <PlainField label="Date of birth" value={formatDate(data.date_of_birth)} />
      <PlainField label="State of birth" value={data.state_of_birth} />
      <PlainField label="State of residence" value={data.state_of_residence} />
      <PlainField label="Email" value={data.email} />
      <PlainField label="Height" value={data.height} />
      <PlainField label="Weight" value={data.weight} />
      <PlainField label="Draft day" value={data.draft_day} mono />
      <MaskedField
        label="Driver's license #" value={data.drivers_license_number}
        revealed={revealed.has('dl')} onToggleReveal={() => toggle('dl')}
      />
      <PlainField
        label="Address"
        value={[data.address_street, data.address_city, data.address_state, data.address_zip].filter(Boolean).join(', ')}
      />
      <PlainField
        label={data.beneficiaries?.length > 1 ? 'Beneficiaries' : 'Beneficiary'}
        value={(data.beneficiaries || []).map(b => `${b.name} (${b.relationship})`).join(', ')}
      />
      <PlainField label="Bank" value={data.bank_name} />
      <MaskedField
        label="Routing #" value={data.routing_number}
        revealed={revealed.has('routing')} onToggleReveal={() => toggle('routing')}
      />
      <MaskedField
        label="Account #" value={data.account_number}
        revealed={revealed.has('account')} onToggleReveal={() => toggle('account')}
      />
    </div>
  )
}

// ── calling the client (Prompt 666) ─────────────────────────────────────────

const firstName = name => (name || '').trim().split(/\s+/)[0] || ''

function telHref(phone) {
  return `tel:${phone.replace(/[^\d+]/g, '')}`
}

// The agent has verified their number and left it switched on → the client
// sees the agent's number. Off or unverified → today's plain tel: link.
function agentCallerIdOn(p) {
  return !!(p.agent?.caller_id_verified_at && p.agent?.caller_id_enabled)
}

// "Call client" rings the rep's own phone first (Twilio), then connects them
// to the client showing the agent's number. If Twilio can't place it (no
// number bought yet, agent switched it off since the page loaded), it says
// why and offers the direct dial instead — the rep is never stuck.
function ClientCallAction({ p, canBridge }) {
  const [state, setState] = useState({ phase: 'idle' })
  const agent = firstName(p.agent?.full_name) || 'the agent'

  if (!p.client_phone) {
    return <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>No client phone on file</span>
  }

  const directLink = (label, style) => (
    <a href={telHref(p.client_phone)} style={style}>
      <Phone size={14} /> {label}
    </a>
  )
  const primaryLink = { ...primaryBtn, display: 'inline-flex', alignItems: 'center', gap: 8, textDecoration: 'none', fontFamily: MONO }

  if (!canBridge) return directLink(p.client_phone, primaryLink)

  async function call() {
    setState({ phase: 'calling' })
    try {
      await invokeCallerId('start-agent-caller-id-call', { policy_id: p.id })
      setState({ phase: 'ringing' })
    } catch (e) {
      setState({ phase: FALLBACK_CODES.has(e.code) ? 'fallback' : 'error', message: e.message })
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-start', maxWidth: 300 }}>
      <button
        onClick={call}
        disabled={state.phase === 'calling'}
        style={{ ...primaryBtn, display: 'inline-flex', alignItems: 'center', gap: 8, opacity: state.phase === 'calling' ? 0.6 : 1 }}
      >
        {state.phase === 'calling' ? <Loader2 size={14} className="animate-spin" /> : <PhoneCall size={14} />}
        Call client
      </button>
      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
        Shows {agent}'s number · <span style={{ fontFamily: MONO }}>{p.client_phone}</span>
      </span>
      {state.phase === 'ringing' && (
        <span style={{ fontSize: 11.5, color: 'var(--success)' }}>
          Ringing your phone now. Pick up and you'll be connected to {p.client_first_name || 'the client'}.
        </span>
      )}
      {(state.phase === 'fallback' || state.phase === 'error') && (
        <span style={{ fontSize: 11.5, color: state.phase === 'error' ? 'var(--danger)' : 'var(--warning)', lineHeight: 1.5 }}>
          {state.message}{' '}
          {directLink('Dial directly instead', { color: 'var(--accent)', display: 'inline-flex', alignItems: 'center', gap: 4 })}
          {' '}(shows your own number).
        </span>
      )}
    </div>
  )
}

// Same "read this" hint pattern as Book a call. Lives in the work view itself,
// not just the spec: the client sees the agent's number, so the rep has to be
// clear they're calling for the agent, never as them.
function OnBehalfHint({ p, profile }) {
  const agent = p.agent?.full_name || 'the agent'
  const me = firstName(profile?.full_name) || 'your name'
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 8,
      padding: '9px 12px', borderRadius: 6,
      background: 'var(--bg-panel)', border: 'var(--border-w) solid var(--border)',
    }}>
      <MessageCircleMore size={13} style={{ color: 'var(--accent)', flexShrink: 0, marginTop: 1 }} />
      <p style={{ margin: 0, fontSize: 11.5, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
        <b style={{ color: 'var(--text-primary)', fontStyle: 'normal' }}>
          The client sees {firstName(agent) || 'the agent'}'s number. You're calling on behalf of {agent}. Never say you are them.
        </b>{' '}
        <i>"Hi {p.client_first_name || 'there'}, this is {me} calling on behalf of {agent}. We spoke with you about getting your old policy cancelled."</i>
      </p>
    </div>
  )
}

// ── focused work view ───────────────────────────────────────────────────────

function Step({ n, title, done, children, last }) {
  return (
    <div style={{ display: 'flex', gap: 14 }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
        <span style={{
          width: 26, height: 26, borderRadius: '50%', fontSize: 11.5, fontWeight: 700, fontFamily: MONO,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          background: done ? 'var(--success-dim)' : 'var(--accent-dim)',
          border: `1px solid ${done ? 'var(--success-bd)' : 'var(--accent-border)'}`,
          color: done ? 'var(--success)' : 'var(--accent)',
        }}>
          {done ? <CheckCircle2 size={13} /> : n}
        </span>
        {!last && <span style={{ flex: 1, width: 1, background: 'var(--border)', margin: '4px 0' }} />}
      </div>
      <div style={{ flex: 1, minWidth: 0, paddingBottom: last ? 0 : 20 }}>
        <p style={{ margin: '4px 0 10px', fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>{title}</p>
        {children}
      </div>
    </div>
  )
}

function WorkView({ p, now, profile, isAdmin, onBack, onClaimNext, nextAvailable, claimBusy }) {
  const update = useUpdatePolicy()
  const navigate = useNavigate()
  const claimedByMe = p.assigned_fulfillment_id === profile?.id
  const canEdit = claimedByMe
  const canViewIntake = claimedByMe || isAdmin
  const done = p.fulfillment_stage === 'Complete'
  const { data: intake, isLoading: intakeLoading } = usePolicyFulfillmentDetails(p.id, canViewIntake)

  const [confirmation, setConfirmation] = useState(p.cancellation_confirmation || '')
  const [notes, setNotes] = useState(p.cancellation_notes || '')
  const [saved, setSaved] = useState(false)
  const [showIntake, setShowIntake] = useState(true)
  const [confirmingRelease, setConfirmingRelease] = useState(false)

  const dirty = confirmation !== (p.cancellation_confirmation || '') || notes !== (p.cancellation_notes || '')

  function saveRecord() {
    update.mutate(
      { id: p.id, cancellation_confirmation: confirmation.trim() || null, cancellation_notes: notes.trim() || null },
      { onSuccess: () => { setSaved(true); setTimeout(() => setSaved(false), 2000) } },
    )
  }

  function setSubstatus(value) {
    update.mutate({ id: p.id, cancellation_substatus: value })
  }

  function markCancelled() {
    update.mutate({
      id: p.id,
      fulfillment_stage: 'Complete',
      status: 'In Effect',
      cancellation_confirmation: confirmation.trim() || null,
      cancellation_notes: notes.trim() || null,
    })
  }

  function release() {
    update.mutate({ id: p.id, assigned_fulfillment_id: null, fulfillment_stage: 'Pending' }, { onSuccess: onBack })
  }

  const callback = fmtCallback(p.scheduled_call_at)
  const callerIdOn = agentCallerIdOn(p)
  const canBridge = callerIdOn && (claimedByMe || isAdmin)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <button onClick={onBack} style={{ ...ghostBtn, width: 'fit-content' }}>
        <ArrowLeft size={12} /> Back to desk
      </button>

      {/* Header — who, how to reach them, what the deal was */}
      <div style={{ ...card, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 18 }}>
        <div style={{ flex: '1 1 240px', minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <p style={{ margin: 0, fontSize: 20, fontWeight: 700, color: 'var(--text-primary)' }}>{fullName(p)}</p>
            {done
              ? <Pill tone="success" icon={CheckCircle2}>Cancelled</Pill>
              : <Pill tone="info">{SUBSTATUS_LABEL[p.cancellation_substatus] || 'In progress'}</Pill>}
            <FlagPills p={p} now={now} />
          </div>
          <p style={{ margin: '4px 0 0', fontSize: 11.5, color: 'var(--text-muted)' }}>
            New policy: {[p.carrier_name, p.product_name, p.state].filter(Boolean).join(' · ') || '—'}
            {' · '}<span style={{ fontFamily: MONO }}>{money(p.monthly_premium)}/mo</span>
          </p>
          <p style={{ margin: '2px 0 0', fontSize: 11.5, color: 'var(--text-muted)' }}>
            Submitted by {p.agent?.full_name || 'unknown agent'} · {ago(p.created_at, now)}
            {!claimedByMe && p.assigned && <> · claimed by {p.assigned.full_name}</>}
          </p>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-start' }}>
          <ClientCallAction p={p} canBridge={canBridge} />
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, color: 'var(--text-secondary)' }}>
            <Clock size={11} /> {callback ? `Callback ${callback}` : 'No callback time set'}
          </span>
          <button onClick={() => navigate(`/messages?thread=${p.id}`)} style={ghostBtn}>
            <MessageCircleMore size={13} /> {isAdmin ? 'Open conversation' : 'Message agent'}
          </button>
        </div>
      </div>

      {canBridge && p.client_phone && !done && <OnBehalfHint p={p} profile={profile} />}

      {/* The one thing this team exists to cancel */}
      {canViewIntake && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', borderRadius: 8,
          background: 'var(--warning-dim)', border: '1px solid var(--warning-bd)',
        }}>
          <ShieldAlert size={16} style={{ color: 'var(--warning)', flexShrink: 0 }} />
          <div>
            <p style={{ ...fieldLabel, margin: 0, color: 'var(--warning)' }}>Cancel with</p>
            <p style={{ margin: '2px 0 0', fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>
              {intakeLoading ? 'Loading…' : (intake?.current_carrier || 'Current carrier not recorded')}
            </p>
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(320px, 100%), 1fr))', gap: 16, alignItems: 'start' }}>
        {/* Steps */}
        <div style={card}>
          <p style={cardTitle}>Work this cancellation</p>

          <Step n={1} title="Client authorization">
            <AuthorizationStatus />
          </Step>

          <Step n={2} title="Call the carrier" done={done}>
            {done ? (
              <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)' }}>Carrier call finished.</p>
            ) : (
              <>
                <Segmented
                  size="sm"
                  style={{ flexWrap: 'wrap', maxWidth: '100%' }}
                  options={SUBSTATUS}
                  value={p.cancellation_substatus || 'calling'}
                  onChange={v => canEdit && setSubstatus(v)}
                />
                <p style={{ margin: '8px 0 0', fontSize: 11, color: 'var(--text-muted)' }}>
                  Keep this current — it's what the rest of the team sees on your row.
                </p>
              </>
            )}
          </Step>

          <Step n={3} title="Record the result" done={done && !!p.cancellation_confirmation}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div>
                <p style={fieldLabel}>Carrier confirmation / reference #</p>
                <input
                  value={confirmation}
                  onChange={e => setConfirmation(e.target.value)}
                  disabled={!canEdit || done}
                  placeholder="e.g. CXL-48213"
                  style={{ ...control, fontFamily: MONO }}
                />
              </div>
              <div>
                <p style={fieldLabel}>Notes</p>
                <textarea
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  disabled={!canEdit || done}
                  rows={4}
                  placeholder="Who you spoke with, what they needed, anything the next person should know"
                  style={{ ...control, height: 'auto', padding: '8px 10px', resize: 'vertical', lineHeight: 1.5 }}
                />
              </div>
              {canEdit && !done && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <button onClick={saveRecord} disabled={!dirty || update.isPending} style={{ ...ghostBtn, opacity: !dirty ? 0.5 : 1 }}>
                    Save
                  </button>
                  <SavedTick show={saved} />
                </div>
              )}
            </div>
          </Step>

          <Step n={4} title={done ? 'Cancelled' : 'Mark it cancelled'} done={done} last>
            {done ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <p style={{ margin: 0, fontSize: 12, color: 'var(--text-secondary)' }}>
                  Done {ago(p.fulfillment_completed_at || p.updated_at, now)}
                  {p.assigned?.full_name && <> by {p.assigned.full_name}</>}.
                </p>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <NotifyAgentButton />
                  {claimedByMe && nextAvailable && (
                    <button
                      onClick={onClaimNext}
                      disabled={claimBusy}
                      style={{ ...primaryBtn, display: 'inline-flex', alignItems: 'center', gap: 6, opacity: claimBusy ? 0.6 : 1 }}
                    >
                      Claim next <ArrowRight size={13} />
                    </button>
                  )}
                </div>
              </div>
            ) : canEdit ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {!confirmation.trim() && (
                  <p style={{ margin: 0, fontSize: 11, color: 'var(--warning)' }}>
                    No confirmation # yet — you can still finish, but record one if the carrier gave it.
                  </p>
                )}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <button
                    onClick={markCancelled}
                    disabled={update.isPending}
                    style={{ ...primaryBtn, display: 'inline-flex', alignItems: 'center', gap: 6, opacity: update.isPending ? 0.6 : 1 }}
                  >
                    <CircleCheckBig size={14} /> Mark cancelled
                  </button>
                  {confirmingRelease ? (
                    <>
                      <span style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>Put it back in the queue?</span>
                      <button onClick={release} style={{ ...ghostBtn, color: 'var(--danger)' }}>Release</button>
                      <button onClick={() => setConfirmingRelease(false)} style={ghostBtn}>Keep</button>
                    </>
                  ) : (
                    <button onClick={() => setConfirmingRelease(true)} style={ghostBtn}>
                      <Undo2 size={12} /> Release to queue
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)' }}>
                Only {p.assigned?.full_name || 'the rep who claimed this'} can finish it.
              </p>
            )}
            {update.isError && (
              <p style={{ margin: '8px 0 0', fontSize: 11.5, color: 'var(--danger)' }}>
                Couldn't save — {update.error?.message || 'try again'}.
              </p>
            )}
          </Step>
        </div>

        {/* Intake */}
        <div style={card}>
          <button
            onClick={() => setShowIntake(s => !s)}
            style={{ ...cardTitle, border: 'none', background: 'transparent', padding: 0, width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: showIntake ? '0 0 16px' : 0 }}
          >
            Client intake {showIntake ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
          {showIntake && (
            !canViewIntake ? (
              <p style={{ margin: 0, fontSize: 11.5, color: 'var(--text-muted)', fontStyle: 'italic' }}>
                Only the rep who claimed this can see the intake.
              </p>
            ) : intakeLoading ? (
              <p style={{ margin: 0, fontSize: 11.5, color: 'var(--text-muted)' }}>Loading intake…</p>
            ) : !intake ? (
              <p style={{ margin: 0, fontSize: 11.5, color: 'var(--danger)' }}>
                No intake details found — the agent's submission may not have completed cleanly.
              </p>
            ) : (
              <IntakeGrid data={intake} />
            )
          )}
          {p.notes && (
            <div style={{ marginTop: 16, paddingTop: 14, borderTop: 'var(--border-w) solid var(--border)' }}>
              <p style={fieldLabel}>Agent's note</p>
              <p style={{ margin: 0, fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>{p.notes}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── history ─────────────────────────────────────────────────────────────────

function HistoryList({ rows, now, profile, onOpen }) {
  const [who, setWho] = useState('mine')
  const list = who === 'mine' ? rows.filter(p => p.assigned_fulfillment_id === profile?.id) : rows
  return (
    <div style={card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <p style={{ ...cardTitle, margin: 0 }}>Cancelled</p>
        <Segmented size="sm" value={who} onChange={setWho} options={[{ value: 'mine', label: 'Mine' }, { value: 'team', label: 'Whole team' }]} />
      </div>
      {list.length === 0 ? (
        <EmptyNote>Nothing cancelled yet.</EmptyNote>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {list.map(p => (
            <RowShell key={p.id} onClick={() => onOpen(p.id)}>
              <div style={{ flex: '1 1 200px', minWidth: 0 }}>
                <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>{fullName(p)}</p>
                <p style={{ margin: '2px 0 0', fontSize: 11, color: 'var(--text-muted)' }}>
                  {p.assigned?.full_name || '—'} · {ago(p.fulfillment_completed_at || p.updated_at, now)}
                </p>
              </div>
              <span style={{ fontSize: 11.5, fontFamily: MONO, color: p.cancellation_confirmation ? 'var(--text-secondary)' : 'var(--text-muted)' }}>
                {p.cancellation_confirmation ? `# ${p.cancellation_confirmation}` : 'no conf #'}
              </span>
              <AuthorizationStatus compact />
              <span onClick={e => e.stopPropagation()}><NotifyAgentButton /></span>
            </RowShell>
          ))}
        </div>
      )}
    </div>
  )
}

// ── page ────────────────────────────────────────────────────────────────────

export default function FulfillmentQueue() {
  const { profile } = useAuth()
  const isAdmin = profile?.role === 'admin'
  const { data: rows = [], isLoading } = useFulfillmentQueue()
  const claim = useClaimCancellation()
  const now = useNow()
  const [view, setView] = useState('desk')
  const [workingId, setWorkingId] = useState(null)
  const myId = profile?.id

  const g = useMemo(() => {
    const open = rows.filter(p => p.fulfillment_stage !== 'Complete')
    const done = rows
      .filter(p => p.fulfillment_stage === 'Complete')
      .sort((a, b) => new Date(b.fulfillment_completed_at || b.updated_at) - new Date(a.fulfillment_completed_at || a.updated_at))
    // Waiting: overdue callbacks first, then soonest callback, then oldest.
    const waiting = open.filter(p => !p.assigned_fulfillment_id).sort((a, b) => {
      const ta = a.scheduled_call_at ? new Date(a.scheduled_call_at).getTime() : Infinity
      const tb = b.scheduled_call_at ? new Date(b.scheduled_call_at).getTime() : Infinity
      return ta - tb || new Date(a.created_at) - new Date(b.created_at)
    })
    const mine = open.filter(p => p.assigned_fulfillment_id === myId)
    const team = open.filter(p => p.assigned_fulfillment_id && p.assigned_fulfillment_id !== myId)
    const attention = open.filter(p => { const f = flagsFor(p, now); return f.overdue || f.stale })
    const doneToday = done.filter(p => isToday(p.fulfillment_completed_at, now))
    const myDoneToday = doneToday.filter(p => p.assigned_fulfillment_id === myId)
    return { waiting, mine, team, done, attention, doneToday, myDoneToday }
  }, [rows, myId, now])

  const working = workingId ? rows.find(p => p.id === workingId) : null

  function claimAndOpen(p) {
    claim.mutate({ id: p.id, profileId: profile.id }, { onSuccess: () => setWorkingId(p.id) })
  }

  function claimNext() {
    const next = g.waiting[0]
    if (next) claimAndOpen(next)
  }

  function open(id) {
    setWorkingId(id)
  }

  if (isLoading) {
    return <p style={{ margin: 0, fontSize: 12.5, color: 'var(--text-muted)' }}>Loading cancellations…</p>
  }

  if (working) {
    return (
      <div style={{ maxWidth: 1100 }}>
        {/* keyed so "Claim next" opens the new item with fresh field state */}
        <WorkView
          key={working.id}
          p={working}
          now={now}
          profile={profile}
          isAdmin={isAdmin}
          onBack={() => setWorkingId(null)}
          onClaimNext={claimNext}
          nextAvailable={g.waiting.length > 0}
          claimBusy={claim.isPending}
        />
        {claim.isError && (
          <p style={{ margin: '10px 0 0', fontSize: 11.5, color: 'var(--danger)' }}>{claim.error?.message}</p>
        )}
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 1100, display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Status strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
        <StatTile icon={Inbox} label="Waiting to claim" value={g.waiting.length} tone={g.waiting.length ? 'accent' : 'neutral'}
          sub={g.waiting[0] ? `oldest ${ago(g.waiting.reduce((a, b) => (new Date(a.created_at) < new Date(b.created_at) ? a : b)).created_at, now)}` : 'queue is clear'} />
        <StatTile icon={Briefcase} label="On your desk" value={g.mine.length} tone={g.mine.length ? 'info' : 'neutral'}
          sub={`${g.team.length} with the rest of the team`} />
        <StatTile icon={AlertTriangle} label="Needs attention" value={g.attention.length} tone={g.attention.length ? 'danger' : 'neutral'}
          sub="overdue callbacks or stale" />
        <StatTile icon={CircleCheckBig} label="Cancelled today" value={isAdmin ? g.doneToday.length : g.myDoneToday.length} tone="success"
          sub={isAdmin ? 'whole team' : `${g.doneToday.length} across the team`} />
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <Segmented value={view} onChange={setView} options={[{ value: 'desk', label: 'Desk' }, { value: 'history', label: `Cancelled (${g.done.length})` }]} />
        {view === 'desk' && g.waiting.length > 0 && (
          <button
            onClick={claimNext}
            disabled={claim.isPending}
            style={{ ...primaryBtn, display: 'inline-flex', alignItems: 'center', gap: 6, opacity: claim.isPending ? 0.6 : 1 }}
          >
            Claim next <ArrowRight size={13} />
          </button>
        )}
      </div>

      {claim.isError && (
        <p style={{ margin: 0, fontSize: 11.5, color: 'var(--danger)' }}>{claim.error?.message}</p>
      )}

      {view === 'history' ? (
        <HistoryList rows={g.done} now={now} profile={profile} onOpen={open} />
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(340px, 100%), 1fr))', gap: 16, alignItems: 'start' }}>
            <div style={card}>
              <p style={cardTitle}>On your desk</p>
              {g.mine.length === 0 ? (
                <EmptyNote>
                  {g.waiting.length ? 'Nothing claimed — take the next one from Up next.' : 'Nothing on your desk and nothing waiting.'}
                </EmptyNote>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {g.mine.map(p => <DeskRow key={p.id} p={p} now={now} onOpen={open} />)}
                </div>
              )}
            </div>

            <div style={card}>
              <p style={cardTitle}>Up next</p>
              {g.waiting.length === 0 ? (
                <EmptyNote>Queue is clear — every submission has someone on it.</EmptyNote>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {g.waiting.map(p => (
                    <WaitingRow key={p.id} p={p} now={now} onClaim={claimAndOpen} busy={claim.isPending} />
                  ))}
                </div>
              )}
            </div>
          </div>

          {g.team.length > 0 && (
            <div style={card}>
              <p style={cardTitle}>With the team</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {g.team.map(p => <TeamRow key={p.id} p={p} now={now} onOpen={isAdmin ? open : undefined} />)}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
