import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft, ArrowRight, CheckCircle2, Clock, Phone, User, Eye, EyeOff,
  ShieldAlert, Inbox, Briefcase, AlertTriangle, CircleCheckBig, Send,
  FileSignature, ChevronDown, ChevronUp, PhoneCall, MessageCircleMore, Loader2,
  CalendarClock, Shuffle, PhoneMissed,
} from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import {
  useFulfillmentQueue, useUpdatePolicy, useStartCall, useEndCall, useSetRescheduleReason, usePassOnCancellation, assignUnassigned,
} from '../../hooks/usePolicies'
import { usePolicyFulfillmentDetails } from '../../hooks/useFulfillmentDetails'
import { card, cardTitle, primaryBtn, ghostBtn, fieldLabel, control, MONO } from '../../lib/exportStyles'
import { Segmented } from '../../components/ui/Segmented'
import { SavedTick } from '../../components/ui/SavedTick'
import { money, fullName, formatDate, maskLast4 } from '../../lib/policyFormat'
import { invokeCallerId, FALLBACK_CODES } from '../../lib/callerId'
import { flagsFor, overlapsFor } from '../../lib/fulfillmentFlags'
import { STAGE, stageOf, isLive, recoveryLabel } from '../../lib/agentBookings'
import { LiveDot } from '../../components/ui/LiveDot'

// Fulfillment desk (Prompt 684 rebuild of the Prompt 663 claim desk).
//
// Nobody claims anything any more: the database assigns every booking to a
// rep the moment the agent books it (migration 116 — least-loaded rep who
// isn't already on a call in that half hour). So the desk is just the work:
// the one client you should be on right now, with calling them front and
// centre, then the carrier steps, then "Mark cancelled" → the next one.
// Pipeline (Prompt 681) is where you go to look across everything.
//
// Prompt 689 — status is Booked → In progress (a call is live RIGHT NOW) →
// Cancelled / No answer. "Call client" starts the live call
// (there's no end-of-call signal from the phone, so the rep declares it), and
// when it ends the rep marks the outcome. No answer loops back toward another
// call rather than being a dead end (Prompt 695: Rescheduling merged into it,
// "reached them but couldn't cancel" is a No answer with an optional reason).

// Optional reason on a No answer.
const SUBSTATUS = [
  { value: 'waiting_carrier', label: 'Waiting on carrier' },
  { value: 'waiting_client',  label: 'Waiting on client' },
]
const SUBSTATUS_LABEL = Object.fromEntries(SUBSTATUS.map(s => [s.value, s.label]))

const TONE = {
  neutral: { color: 'var(--text-secondary)', dim: 'var(--bg-elevated)', bd: 'var(--border)' },
  accent:  { color: 'var(--accent)',  dim: 'var(--accent-dim)',  bd: 'var(--accent-border)' },
  purple:  { color: 'var(--purple)', dim: 'var(--purple-dim)', bd: 'var(--purple-bd)' },
  pink:    { color: 'var(--pink)',   dim: 'var(--pink-dim)',   bd: 'var(--pink-bd)' },
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

function fmtCallback(iso) {
  if (!iso) return null
  return new Date(iso).toLocaleString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  })
}

function fmtTime(iso) {
  return new Date(iso).toLocaleString('en-US', { hour: 'numeric', minute: '2-digit' })
}

function isToday(iso, now) {
  if (!iso) return false
  return new Date(iso).toDateString() === new Date(now).toDateString()
}

function useNow(intervalMs = 60e3) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(t)
  }, [intervalMs])
  return now
}

const DUE_SOON_MS = 15 * 60e3

// What to work next, in order:
//   0. a call that's live right now
//   1. calls that are due — booked time passed or within 15 min, soonest first
//   2. No answer — owed another call, longest-waiting first
//   3. later calls, soonest first
//   4. no call time at all, oldest booking first
function priority(p, now) {
  const at = p.scheduled_call_at ? new Date(p.scheduled_call_at).getTime() : null
  const stage = stageOf(p)
  if (stage === 'inProgress') return [0, 0]
  if (stage === 'noAnswer') {
    return [2, new Date(p.last_call_at || p.fulfillment_started_at || p.updated_at).getTime()]
  }
  if (at != null && at <= now + DUE_SOON_MS) return [1, at]
  if (at != null) return [3, at]
  return [4, new Date(p.created_at).getTime()]
}

function byPriority(now) {
  return (a, b) => {
    const pa = priority(a, now), pb = priority(b, now)
    return pa[0] - pb[0] || pa[1] - pb[1]
  }
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

function StatusPill({ p }) {
  if (p.fulfillment_stage === 'Complete') return <Pill tone="success" icon={CheckCircle2}>Cancelled</Pill>
  const stage = stageOf(p)
  if (stage === 'inProgress') return <Pill tone={STAGE.inProgress.tone} icon={LiveDot}>{STAGE.inProgress.label}</Pill>
  const reason = stage === 'noAnswer' && SUBSTATUS_LABEL[p.cancellation_substatus]
  const flow = recoveryLabel(p)
  return <Pill tone={STAGE[stage].tone}>{STAGE[stage].label}{reason ? ` · ${reason.toLowerCase()}` : ''}{flow ? ` · ${flow}` : ''}</Pill>
}

function FlagPills({ p, now, rows }) {
  const { overdue, stale, liveStale } = flagsFor(p, now)
  const overlaps = rows ? overlapsFor(p, rows).length : 0
  return (
    <>
      {overdue && <Pill tone="danger" icon={AlertTriangle}>Call time passed</Pill>}
      {liveStale && <Pill tone="danger" icon={Clock}>Call still open? Mark how it went</Pill>}
      {!overdue && stale && <Pill tone="warning" icon={Clock}>Stale</Pill>}
      {overlaps > 0 && <Pill tone="warning" icon={CalendarClock}>Overlaps another call</Pill>}
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

function QueueRow({ p, now, rows, onOpen, showRep }) {
  return (
    <div
      onClick={() => onOpen(p.id)}
      style={{
        padding: '11px 14px', borderRadius: 7, cursor: 'pointer',
        background: 'var(--bg-elevated)', border: 'var(--border-w) solid var(--border)',
        display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
      }}
    >
      <span style={{ width: 92, flexShrink: 0, fontFamily: MONO, fontSize: 12, color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
        {p.scheduled_call_at
          ? (isToday(p.scheduled_call_at, now) ? fmtTime(p.scheduled_call_at)
            : new Date(p.scheduled_call_at).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' }))
          : 'No time'}
      </span>
      <div style={{ flex: '1 1 180px', minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>{fullName(p)}</p>
          <FlagPills p={p} now={now} rows={rows} />
        </div>
        <p style={{ margin: '2px 0 0', fontSize: 11, color: 'var(--text-muted)' }}>
          {p.agent?.full_name || 'unknown agent'}
          {showRep && <> · <User size={10} style={{ verticalAlign: '-1px' }} /> {p.assigned?.full_name || 'no rep yet'}</>}
        </p>
      </div>
      <StatusPill p={p} />
      <ArrowRight size={13} style={{ color: 'var(--text-muted)' }} />
    </div>
  )
}

// ── intake ──────────────────────────────────────────────────────────────────

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
// sees the agent's number. Off or unverified → a plain tel: link.
function agentCallerIdOn(p) {
  return !!(p.agent?.caller_id_verified_at && p.agent?.caller_id_enabled)
}

// "Call client" rings the rep's own phone first (Twilio), then connects them
// to the client showing the agent's number. If Twilio can't place it (no
// number bought yet, agent switched it off since the page loaded), it says
// why and offers the direct dial instead — the rep is never stuck.
// `onCall` fires once the call is actually under way (either path), which is
// what flips the item to a live call (In progress).
function ClientCallAction({ p, canBridge, onCall }) {
  const [state, setState] = useState({ phase: 'idle' })
  const agent = firstName(p.agent?.full_name) || 'the agent'

  if (!p.client_phone) {
    return <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>No client phone on file — message the agent for one.</span>
  }

  const big = { ...primaryBtn, height: 44, padding: '0 20px', fontSize: 14, display: 'inline-flex', alignItems: 'center', gap: 9, textDecoration: 'none' }
  const directLink = (label, style) => (
    <a href={telHref(p.client_phone)} onClick={onCall} style={style}>
      <Phone size={15} /> {label}
    </a>
  )

  if (!canBridge) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-start' }}>
        {directLink('Call client', big)}
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          <span style={{ fontFamily: MONO }}>{p.client_phone}</span> · dials from your phone, shows your own number
        </span>
      </div>
    )
  }

  async function call() {
    setState({ phase: 'calling' })
    try {
      await invokeCallerId('start-agent-caller-id-call', { policy_id: p.id })
      setState({ phase: 'ringing' })
      onCall?.()
    } catch (e) {
      setState({ phase: FALLBACK_CODES.has(e.code) ? 'fallback' : 'error', message: e.message })
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-start', maxWidth: 340 }}>
      <button onClick={call} disabled={state.phase === 'calling'} style={{ ...big, opacity: state.phase === 'calling' ? 0.6 : 1 }}>
        {state.phase === 'calling' ? <Loader2 size={15} className="animate-spin" /> : <PhoneCall size={15} />}
        Call client
      </button>
      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
        <span style={{ fontFamily: MONO }}>{p.client_phone}</span> · rings your phone first, shows {agent}'s number
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

// Same "read this" hint pattern as Book a call. The client sees the agent's
// number, so the rep has to be clear they're calling for the agent, never as them.
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

// Shown while a call is live. The two outcomes are the only ways out of
// "In progress": nothing sits there as an idle bucket.
function LiveCallPanel({ p, now, busy, canCancel, onCancelled, onNoAnswer }) {
  const mins = Math.max(0, Math.floor((now - new Date(p.call_live_since)) / 60e3))
  const btn = { ...ghostBtn, height: 38, padding: '0 14px', display: 'inline-flex', alignItems: 'center', gap: 7, opacity: busy ? 0.6 : 1 }
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', padding: '14px 18px', borderRadius: 10,
      background: 'var(--danger-dim)', border: '1px solid var(--danger-bd)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: '1 1 200px', minWidth: 0 }}>
        <LiveDot size={11} />
        <div>
          <p style={{ margin: 0, fontSize: 13.5, fontWeight: 700, color: 'var(--danger)' }}>Live call</p>
          <p style={{ margin: '2px 0 0', fontSize: 11.5, color: 'var(--text-secondary)' }}>
            Started {fmtTime(p.call_live_since)}{mins >= 1 ? ` · ${mins}m` : ''}. How did it go?
          </p>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {canCancel && (
          <button onClick={onCancelled} disabled={busy} style={{ ...primaryBtn, height: 38, display: 'inline-flex', alignItems: 'center', gap: 7, opacity: busy ? 0.6 : 1 }}>
            <CircleCheckBig size={14} /> Cancelled
          </button>
        )}
        <button onClick={onNoAnswer} disabled={busy} style={btn}>
          <PhoneMissed size={14} /> No answer
        </button>
      </div>
    </div>
  )
}

// ── the record you're working ───────────────────────────────────────────────

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

function WorkView({ p, rows, now, profile, isAdmin, pinned, onBack, onPin, onNext, nextUp, position }) {
  const update = useUpdatePolicy()
  const startCall = useStartCall()
  const endCall = useEndCall()
  const setReason = useSetRescheduleReason()
  const passOn = usePassOnCancellation()
  const navigate = useNavigate()
  const mine = p.assigned_fulfillment_id === profile?.id
  const canEdit = mine
  const canViewIntake = mine || isAdmin
  const done = p.fulfillment_stage === 'Complete'
  const live = isLive(p)
  const stage = stageOf(p)
  const canCall = (mine || isAdmin) && !done
  const { data: intake, isLoading: intakeLoading } = usePolicyFulfillmentDetails(p.id, canViewIntake)

  const [confirmation, setConfirmation] = useState(p.cancellation_confirmation || '')
  const [notes, setNotes] = useState(p.cancellation_notes || '')
  const [saved, setSaved] = useState(false)
  const [showIntake, setShowIntake] = useState(true)
  const [confirmingPass, setConfirmingPass] = useState(false)

  const dirty = confirmation !== (p.cancellation_confirmation || '') || notes !== (p.cancellation_notes || '')

  // Once the rep acts on the record, keep it on screen (pinned in the URL):
  // otherwise setting "Waiting on carrier" would drop its priority and swap
  // a different client in under them.
  function hold() {
    if (!pinned) onPin(p.id)
  }

  // "Call client" (either path) puts the item on a live call.
  function onCall() {
    hold()
    if (canCall && !live) startCall.mutate(p.id)
  }

  function saveRecord() {
    hold()
    update.mutate(
      { id: p.id, cancellation_confirmation: confirmation.trim() || null, cancellation_notes: notes.trim() || null },
      { onSuccess: () => { setSaved(true); setTimeout(() => setSaved(false), 2000) } },
    )
  }

  // The call ended without a cancellation: No answer.
  function finishCall(outcome) {
    hold()
    endCall.mutate({ id: p.id, outcome })
  }

  function pickReason(value) {
    hold()
    setReason.mutate({ id: p.id, reason: p.cancellation_substatus === value ? null : value })
  }

  function markCancelled() {
    // Pinned so the rep sees it land instead of the desk jumping straight on.
    hold()
    update.mutate({
      id: p.id,
      fulfillment_stage: 'Complete',
      status: 'In Effect',
      cancellation_confirmation: confirmation.trim() || null,
      cancellation_notes: notes.trim() || null,
    })
  }

  function passToAnother() {
    passOn.mutate(p.id, { onSuccess: onBack })
  }

  const callerIdOn = agentCallerIdOn(p)
  const canBridge = callerIdOn && (mine || isAdmin)
  const callAt = p.scheduled_call_at
  const err = update.error || startCall.error || endCall.error || setReason.error || passOn.error

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        {pinned && (
          <button onClick={onBack} style={{ ...ghostBtn, width: 'fit-content' }}>
            <ArrowLeft size={12} /> {isAdmin && !mine ? 'Back to the desk' : 'Back to what’s next'}
          </button>
        )}
        <span style={{ ...fieldLabel, margin: 0 }}>
          {done ? 'Just finished' : mine ? (position ? `Now working · ${position}` : 'Now working') : `On ${p.assigned?.full_name || 'nobody'}’s desk`}
        </span>
      </div>

      {/* Header — who, when, and the call */}
      <div style={{ ...card, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 20 }}>
        <div style={{ flex: '1 1 260px', minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <p style={{ margin: 0, fontSize: 22, fontWeight: 700, color: 'var(--text-primary)' }}>{fullName(p)}</p>
            <StatusPill p={p} />
            <FlagPills p={p} now={now} rows={rows} />
          </div>
          <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--text-secondary)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Clock size={13} />
            {callAt ? `Call booked ${fmtCallback(callAt)}` : 'No call time booked'}
          </p>
          <p style={{ margin: '4px 0 0', fontSize: 11.5, color: 'var(--text-muted)' }}>
            New policy: {[p.carrier_name, p.product_name, p.state].filter(Boolean).join(' · ') || '—'}
            {' · '}<span style={{ fontFamily: MONO }}>{money(p.monthly_premium)}/mo</span>
          </p>
          <p style={{ margin: '2px 0 0', fontSize: 11.5, color: 'var(--text-muted)' }}>
            Booked by {p.agent?.full_name || 'unknown agent'} · {ago(p.created_at, now)}
          </p>
        </div>
        {!done && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'flex-start' }}>
            {(mine || isAdmin)
              ? (live
                ? <span style={{ fontSize: 12, color: 'var(--text-secondary)', maxWidth: 260, lineHeight: 1.5 }}>
                    Call in progress. When you hang up, mark how it went just below.
                  </span>
                : <ClientCallAction p={p} canBridge={canBridge} onCall={onCall} />)
              : <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Only {p.assigned?.full_name || 'the assigned rep'} calls this client.</span>}
            <button onClick={() => navigate(`/messages?thread=${p.id}`)} style={ghostBtn}>
              <MessageCircleMore size={13} /> {isAdmin ? 'Open conversation' : 'Message agent'}
            </button>
          </div>
        )}
      </div>

      {live && canCall && (
        <LiveCallPanel
          p={p} now={now} busy={endCall.isPending || update.isPending}
          canCancel={canEdit}
          onCancelled={markCancelled}
          onNoAnswer={() => finishCall('no_answer')}
        />
      )}

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

          <Step n={2} title="Call the client" done={done}>
            {done ? (
              <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)' }}>Carrier call finished.</p>
            ) : live ? (
              <p style={{ margin: 0, fontSize: 12, color: 'var(--text-secondary)' }}>
                On a call right now. Mark how it went in the red box above when you hang up.
              </p>
            ) : stage === 'booked' ? (
              <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)' }}>
                No call yet. Tap Call client up top to start. You'll mark how it went when you hang up.
              </p>
            ) : (
              <>
                <p style={{ margin: 0, fontSize: 12, color: 'var(--text-secondary)' }}>
                  Last call: no answer.
                  {' '}{p.call_attempts || 1} call{(p.call_attempts || 1) === 1 ? '' : 's'} so far · {ago(p.last_call_at, now)}. Call again when you\u2019re ready.
                </p>
                {stage === 'noAnswer' && canCall && (
                  <>
                    <Segmented
                      size="sm"
                      style={{ flexWrap: 'wrap', maxWidth: '100%', marginTop: 10 }}
                      options={SUBSTATUS}
                      value={p.cancellation_substatus || null}
                      onChange={pickReason}
                    />
                    <p style={{ margin: '8px 0 0', fontSize: 11, color: 'var(--text-muted)' }}>
                      Optional: if you reached them, why it needs another call. Tap again to clear.
                    </p>
                  </>
                )}
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
                  {mine && (
                    <button
                      onClick={onNext}
                      style={{ ...primaryBtn, display: 'inline-flex', alignItems: 'center', gap: 6 }}
                    >
                      {nextUp ? <>Next: {fullName(nextUp)}</> : 'Back to the desk'} <ArrowRight size={13} />
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
                  {confirmingPass ? (
                    <>
                      <span style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>Hand this to another rep?</span>
                      <button onClick={passToAnother} disabled={passOn.isPending} style={{ ...ghostBtn, color: 'var(--danger)' }}>
                        {passOn.isPending ? 'Passing…' : 'Pass it on'}
                      </button>
                      <button onClick={() => setConfirmingPass(false)} style={ghostBtn}>Keep it</button>
                    </>
                  ) : (
                    <button onClick={() => setConfirmingPass(true)} style={ghostBtn}>
                      <Shuffle size={12} /> Pass to another rep
                    </button>
                  )}
                </div>
              </div>
            ) : isAdmin ? (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)' }}>
                  {p.assigned?.full_name || 'The assigned rep'} finishes this one.
                </p>
                <button onClick={passToAnother} disabled={passOn.isPending} style={ghostBtn}>
                  <Shuffle size={12} /> {passOn.isPending ? 'Reassigning…' : 'Reassign'}
                </button>
              </div>
            ) : (
              <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)' }}>
                Only {p.assigned?.full_name || 'the assigned rep'} can finish it.
              </p>
            )}
            {err && (
              <p style={{ margin: '8px 0 0', fontSize: 11.5, color: 'var(--danger)' }}>
                Couldn't save — {err.message || 'try again'}.
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
                Only the rep it's assigned to can see the intake.
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
            <div
              key={p.id}
              onClick={() => onOpen(p.id)}
              style={{
                padding: '12px 14px', borderRadius: 7, cursor: 'pointer',
                background: 'var(--bg-elevated)', border: 'var(--border-w) solid var(--border)',
                display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
              }}
            >
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
            </div>
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
  const qc = useQueryClient()
  const { data: rows = [], isLoading } = useFulfillmentQueue()
  const now = useNow()
  const [view, setView] = useState('desk')
  // The open item lives in the URL (?open=<id>) so Overview, Pipeline and
  // notifications can link straight to it. With nothing pinned, the desk
  // shows whatever's next in your queue.
  const [params, setParams] = useSearchParams()
  const pinnedId = params.get('open')
  const setPinned = id => setParams(id ? { open: id } : {}, { replace: !id })
  const myId = profile?.id

  // Anything booked while no rep was active has no one on it; place it now.
  useEffect(() => {
    if (!myId) return
    assignUnassigned()
      .then(n => { if (n > 0) qc.invalidateQueries({ queryKey: ['policies'] }) })
      .catch(() => {})
  }, [myId, qc])

  const g = useMemo(() => {
    const open = rows.filter(p => p.fulfillment_stage !== 'Complete')
    const done = rows
      .filter(p => p.fulfillment_stage === 'Complete')
      .sort((a, b) => new Date(b.fulfillment_completed_at || b.updated_at) - new Date(a.fulfillment_completed_at || a.updated_at))
    const mine = open.filter(p => p.assigned_fulfillment_id === myId).sort(byPriority(now))
    const team = open.slice().sort(byPriority(now))
    const unassigned = open.filter(p => !p.assigned_fulfillment_id)
    const scope = isAdmin ? team : mine
    const attention = scope.filter(p => { const f = flagsFor(p, now); return f.overdue || f.stale })
    const callsToday = scope.filter(p => !isLive(p) && isToday(p.scheduled_call_at, now))
    const nextCall = callsToday.filter(p => new Date(p.scheduled_call_at) >= now - DUE_SOON_MS)[0]
    const doneToday = done.filter(p => isToday(p.fulfillment_completed_at, now))
    const myDoneToday = doneToday.filter(p => p.assigned_fulfillment_id === myId)
    return { open, done, mine, team, unassigned, attention, callsToday, nextCall, doneToday, myDoneToday }
  }, [rows, myId, isAdmin, now])

  const pinned = pinnedId ? rows.find(p => p.id === pinnedId) : null
  // A rep always has the top of their queue on screen; admin only when they open one.
  const active = pinned || (!isAdmin ? g.mine[0] : null)
  const rest = (isAdmin ? g.team : g.mine).filter(p => p.id !== active?.id)
  const nextUp = g.mine.find(p => p.id !== active?.id)
  const position = active && !pinned && g.mine.length > 1 ? `1 of ${g.mine.length}` : null

  if (isLoading) {
    return <p style={{ margin: 0, fontSize: 12.5, color: 'var(--text-muted)' }}>Loading your desk…</p>
  }

  const tiles = (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
      <StatTile
        icon={Briefcase} label={isAdmin ? 'Open across the team' : 'On your desk'}
        value={isAdmin ? g.team.length : g.mine.length}
        tone={(isAdmin ? g.team.length : g.mine.length) ? 'info' : 'neutral'}
        sub={isAdmin
          ? (g.unassigned.length ? `${g.unassigned.length} with no rep yet` : 'every one has a rep')
          : `${g.mine.filter(isLive).length} on a call · ${g.mine.filter(p => stageOf(p) === 'noAnswer').length} owed another call · ${g.mine.filter(p => stageOf(p) === 'booked').length} booked`}
      />
      <StatTile
        icon={CalendarClock} label="Calls left today" value={g.callsToday.length}
        tone={g.callsToday.length ? 'accent' : 'neutral'}
        sub={g.nextCall ? `next at ${fmtTime(g.nextCall.scheduled_call_at)}` : 'none still to make'}
      />
      <StatTile
        icon={AlertTriangle} label="Needs attention" value={g.attention.length}
        tone={g.attention.length ? 'danger' : 'neutral'} sub="call time passed, or stuck"
      />
      <StatTile
        icon={CircleCheckBig} label="Cancelled today" value={isAdmin ? g.doneToday.length : g.myDoneToday.length}
        tone="success" sub={isAdmin ? 'whole team' : `${g.doneToday.length} across the team`}
      />
    </div>
  )

  return (
    <div style={{ maxWidth: 1100, display: 'flex', flexDirection: 'column', gap: 16 }}>
      {tiles}

      <Segmented
        value={view} onChange={setView}
        options={[{ value: 'desk', label: 'Desk' }, { value: 'history', label: `Cancelled (${g.done.length})` }]}
        style={{ width: 'fit-content' }}
      />

      {view === 'history' ? (
        <HistoryList rows={g.done} now={now} profile={profile} onOpen={id => { setPinned(id); setView('desk') }} />
      ) : (
        <>
          {active ? (
            // keyed so moving to the next client resets the field state
            <WorkView
              key={active.id}
              p={active}
              rows={rows}
              now={now}
              profile={profile}
              isAdmin={isAdmin}
              pinned={!!pinned}
              position={position}
              nextUp={nextUp}
              onBack={() => setPinned(null)}
              onPin={setPinned}
              onNext={() => setPinned(null)}
            />
          ) : !isAdmin && (
            <div style={card}>
              <EmptyNote>
                Nothing on your desk. New bookings land here on their own, no need to claim them.
              </EmptyNote>
            </div>
          )}

          {rest.length > 0 && (
            <div style={card}>
              <p style={cardTitle}>{isAdmin ? 'Everyone’s desks' : 'Up next on your desk'}</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {rest.map(p => <QueueRow key={p.id} p={p} now={now} rows={rows} onOpen={setPinned} showRep={isAdmin} />)}
              </div>
            </div>
          )}

          {isAdmin && rest.length === 0 && !active && (
            <div style={card}>
              <EmptyNote><Inbox size={14} style={{ verticalAlign: '-2px' }} /> Nothing open across the team.</EmptyNote>
            </div>
          )}
        </>
      )}
    </div>
  )
}
