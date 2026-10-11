import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft, ArrowRight, CheckCircle2, Clock, Phone, Eye, EyeOff,
  ShieldAlert, AlertTriangle, CircleCheckBig, Send,
  ChevronDown, ChevronUp, PhoneCall, MessageCircleMore, Loader2,
  CalendarClock, Shuffle, PhoneMissed,
} from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { dmId } from '../../hooks/useDirectMessages'
import {
  useFulfillmentQueue, useUpdatePolicy, useStartCall, useEndCall, useSetRescheduleReason, usePassOnCancellation, assignUnassigned,
} from '../../hooks/usePolicies'
import { usePolicyFulfillmentDetails } from '../../hooks/useFulfillmentDetails'
import { useCarriers } from '../../hooks/useCarriers'
import { control, MONO, DISPLAY } from '../../lib/exportStyles'
import { IconChip } from '../../components/agent/AgentUI'
import { Segmented } from '../../components/ui/Segmented'
import { SavedTick } from '../../components/ui/SavedTick'
import { money, fullName, formatDate, maskLast4 } from '../../lib/policyFormat'
import { invokeCallerId, FALLBACK_CODES } from '../../lib/callerId'
import { flagsFor, overlapsFor } from '../../lib/fulfillmentFlags'
import { STAGE, TONE, stageOf, isLive, recoveryLabel, useNow } from '../../lib/agentBookings'
import { bookingCarrier, DAYS, toMin } from '../../lib/carriers'
import { DEFAULT_TIMEZONE, zonedDateStr, zonedTimeToUtcIso, timezoneLabel } from '../../lib/timezones'
import { CALL_TONE, buildCalls, addMonths, dayShort, timeParts, timeText } from '../../lib/fulfillmentDay'
import { LiveDot } from '../../components/ui/LiveDot'
import FulfillmentCalendar from './FulfillmentCalendar'

// Fulfillment (Prompt 684 desk, rebuilt as a calendar in Prompt 747).
//
// Nobody claims anything: the database assigns every booking to a rep the
// moment the agent books it (migration 116). The page is the rep's month
// calendar (FulfillmentCalendar.jsx); a day slides in its calls, and a call
// opens the call view below (?open=<id>, which the Overview, Pipeline and
// notifications also link to). The call view is the old desk's work for one
// client, re-homed: calling them front and centre, the carrier to cancel with,
// then the steps. Every action, guard and side effect is the desk's.
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

// "just now", "5 minutes ago", "3 hours ago", "2 days ago" for the header.
function agoLong(iso, now) {
  if (!iso) return ''
  const m = Math.max(0, Math.round((now - new Date(iso)) / 60e3))
  const say = (n, w) => `${n} ${w}${n === 1 ? '' : 's'} ago`
  if (m < 1) return 'just now'
  if (m < 60) return say(m, 'minute')
  const h = Math.round(m / 60)
  if (h < 48) return say(h, 'hour')
  return say(Math.round(h / 24), 'day')
}

function fmtTime(iso) {
  return new Date(iso).toLocaleString('en-US', { hour: 'numeric', minute: '2-digit' })
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

// The header's status pill, coloured from the calendar's one status map.
const STAGE_CALL_TONE = { booked: 'booked', inProgress: 'live', noAnswer: 'noAnswer', cancelled: 'cancelled' }

function StatusPill({ p }) {
  const stage = stageOf(p)
  const t = CALL_TONE[STAGE_CALL_TONE[stage]]
  const reason = stage === 'noAnswer' && SUBSTATUS_LABEL[p.cancellation_substatus]
  const flow = recoveryLabel(p)
  return (
    <span className="fc-pill" style={{ '--fc-c': t.fg, '--fc-t': t.tint, ...(stage === 'inProgress' ? { border: `1px solid ${t.edge}` } : null) }}>
      {stage === 'inProgress' && <LiveDot size={8} />}
      {STAGE[stage].label}{reason ? ` · ${reason.toLowerCase()}` : ''}{flow ? ` · ${flow}` : ''}
    </span>
  )
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

// Prompt 661 placeholder, carried forward unchanged in meaning: there is no
// e-signature provider behind this yet.
function AuthorizationStatus() {
  return (
    <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.5, color: 'var(--ov-mute)' }}>
      Not yet collected. E-signature collection is coming soon, nothing to do here yet.
    </p>
  )
}

// Prompt 661 placeholder: honest disabled state, no external ping wired.
function NotifyAgentButton() {
  return (
    <button
      disabled
      title="Coming soon — automatic status ping back to the submitting agent"
      className="ov-ghost fc-pillbtn"
    >
      <Send size={13} /> Notify agent · soon
    </button>
  )
}

// ── intake ──────────────────────────────────────────────────────────────────

const NOT_GIVEN = 'Not given'

// Prompt 419 — driver's license/routing/account numbers default masked
// (last 4 visible) with an explicit per-field reveal.
function MaskedField({ label, value, revealed, onToggleReveal }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd className={value ? undefined : 'is-missing'} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontFamily: value ? MONO : undefined }}>{value ? (revealed ? value : maskLast4(value)) : NOT_GIVEN}</span>
        {value && (
          <button
            onClick={onToggleReveal}
            title={revealed ? 'Hide' : 'Reveal'}
            aria-label={revealed ? `Hide ${label}` : `Reveal ${label}`}
            style={{ border: 'none', background: 'transparent', color: 'var(--ov-mute)', display: 'inline-flex', padding: 2, cursor: 'pointer' }}
          >
            {revealed ? <EyeOff size={13} /> : <Eye size={13} />}
          </button>
        )}
      </dd>
    </div>
  )
}

function PlainField({ label, value, mono }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd className={value ? undefined : 'is-missing'} style={{ fontFamily: mono && value ? MONO : undefined }}>{value || NOT_GIVEN}</dd>
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
    <dl className="fc-kv">
      <PlainField label="Full legal name" value={data.full_legal_name} />
      <PlainField label="Date of birth" value={data.date_of_birth ? formatDate(data.date_of_birth) : null} />
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
    </dl>
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
    return <span style={{ fontSize: 13, color: 'var(--ov-mute)' }}>No client phone on file. Message the agent for one.</span>
  }

  const big = { width: 'auto', height: 48, padding: '0 26px' }
  const note = { fontSize: 12, color: 'var(--ov-mute)', textAlign: 'right' }
  const directLink = (label, className, style) => (
    <a href={telHref(p.client_phone)} onClick={onCall} className={className} style={style}>
      <Phone size={17} strokeWidth={2.1} /> {label}
    </a>
  )

  if (!canBridge) {
    return (
      <>
        {directLink('Call client', 'ov-primary', big)}
        <span style={note}>
          <span style={{ fontFamily: MONO }}>{p.client_phone}</span> · dials from your phone, shows your own number
        </span>
      </>
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
    <>
      <button onClick={call} disabled={state.phase === 'calling'} className="ov-primary" style={{ ...big, opacity: state.phase === 'calling' ? 0.6 : 1 }}>
        {state.phase === 'calling' ? <Loader2 size={17} className="animate-spin" /> : <PhoneCall size={17} strokeWidth={2.1} />}
        Call client
      </button>
      <span style={note}>
        <span style={{ fontFamily: MONO }}>{p.client_phone}</span> · rings your phone first, shows {agent}'s number
      </span>
      {state.phase === 'ringing' && (
        <span style={{ ...note, color: 'var(--success)', maxWidth: 320 }}>
          Ringing your phone now. Pick up and you'll be connected to {p.client_first_name || 'the client'}.
        </span>
      )}
      {(state.phase === 'fallback' || state.phase === 'error') && (
        <span style={{ ...note, maxWidth: 320, color: state.phase === 'error' ? 'var(--danger)' : 'var(--warning)', lineHeight: 1.5 }}>
          {state.message}{' '}
          {directLink('Dial directly instead', undefined, { color: 'var(--accent)', display: 'inline-flex', alignItems: 'center', gap: 4 })}
          {' '}(shows your own number).
        </span>
      )}
    </>
  )
}

// Same "read this" hint pattern as Book a call. The client sees the agent's
// number, so the rep has to be clear they're calling for the agent, never as them.
function OnBehalfHint({ p, profile }) {
  const agent = p.agent?.full_name || 'the agent'
  const me = firstName(profile?.full_name) || 'your name'
  return (
    <div className="ov-card" style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '12px 16px', borderRadius: 16 }}>
      <MessageCircleMore size={15} style={{ color: 'var(--ov-st-booked)', flexShrink: 0, marginTop: 2 }} />
      <p style={{ margin: 0, fontSize: 13, color: 'var(--ov-soft)', lineHeight: 1.55 }}>
        <b style={{ color: 'var(--ov-hi)', fontStyle: 'normal' }}>
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
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', padding: '14px 18px', borderRadius: 16,
      background: 'var(--danger-dim)', border: '1px solid var(--danger-bd)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: '1 1 200px', minWidth: 0 }}>
        <LiveDot size={11} />
        <div>
          <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: 'var(--danger)' }}>Live call</p>
          <p style={{ margin: '2px 0 0', fontSize: 12.5, color: 'var(--ov-soft)' }}>
            Started {fmtTime(p.call_live_since)}{mins >= 1 ? ` · ${mins}m` : ''}. How did it go?
          </p>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {canCancel && (
          <button onClick={onCancelled} disabled={busy} className="ov-primary fc-pillbtn">
            <CircleCheckBig size={15} /> Cancelled
          </button>
        )}
        <button onClick={onNoAnswer} disabled={busy} className="ov-ghost fc-pillbtn">
          <PhoneMissed size={15} /> No answer
        </button>
      </div>
    </div>
  )
}

// ── the call view ───────────────────────────────────────────────────────────

function Step({ n, title, done, current, children }) {
  return (
    <div className="fc-step" style={{ display: 'flex', gap: 14, padding: '14px 0' }}>
      <span className={`fc-steps-num${done ? ' is-done' : current ? ' is-cur' : ''}`}>
        {done ? <CheckCircle2 size={14} /> : n}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <h3 style={{ margin: '3px 0 8px', fontSize: 15, fontWeight: 700, color: 'var(--ov-hi)' }}>{title}</h3>
        {children}
      </div>
    </div>
  )
}

const stepText = { margin: 0, fontSize: 13.5, lineHeight: 1.5, color: 'var(--ov-mute)' }
const cardTitle = { margin: 0, fontFamily: DISPLAY, fontSize: 19, fontWeight: 600, letterSpacing: '-0.01em', color: 'var(--ov-hi)' }

// "Open until 7:00 PM your time" from the carrier's saved hours (Prompt 728),
// only when they were found (not the 9-5 stand-in) and the line is open now.
function carrierOpenText(carrier, nowMs, tz) {
  if (!carrier?.hours || !carrier.hours_tz || !['verified', 'ai'].includes(carrier.hours_status)) return null
  const date = zonedDateStr(nowMs, carrier.hours_tz)
  const [y, m, d] = date.split('-').map(Number)
  const key = DAYS[(new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7]
  const h = carrier.hours[key]
  if (!h) return 'Closed today'
  const at = hhmm => new Date(zonedTimeToUtcIso(`${date}T${hhmm}`, carrier.hours_tz)).getTime()
  const open = at(h.open)
  const close = at(h.close)
  if (!(toMin(h.close) > toMin(h.open))) return null
  if (nowMs < open) return `Opens at ${timeText(open, tz)} your time`
  if (nowMs < close) return `Open until ${timeText(close, tz)} your time`
  return 'Closed for today'
}

function CallView({ p, rows, scope, now, tz, todayStr, profile, isAdmin, backDay, onBack, onOpenCall }) {
  const update = useUpdatePolicy()
  const startCall = useStartCall()
  const endCall = useEndCall()
  const setReason = useSetRescheduleReason()
  const passOn = usePassOnCancellation()
  const navigate = useNavigate()
  const { data: carriers } = useCarriers()
  const mine = p.assigned_fulfillment_id === profile?.id
  const canEdit = mine
  const canViewIntake = mine || isAdmin
  const done = p.fulfillment_stage === 'Complete'
  const live = isLive(p)
  const stage = stageOf(p)
  const canCall = (mine || isAdmin) && !done
  const { data: intake, isLoading: intakeLoading } = usePolicyFulfillmentDetails(p.id, canViewIntake)

  const [notes, setNotes] = useState(p.cancellation_notes || '')
  const [saved, setSaved] = useState(false)
  const [showIntake, setShowIntake] = useState(true)
  const [confirmingPass, setConfirmingPass] = useState(false)

  const dirty = notes !== (p.cancellation_notes || '')

  // Opened from the calendar further down the page: start at the top.
  useEffect(() => { window.scrollTo(0, 0) }, [])

  // "Call client" (either path) puts the item on a live call.
  function onCall() {
    if (canCall && !live) startCall.mutate(p.id)
  }

  function saveRecord() {
    update.mutate(
      { id: p.id, cancellation_notes: notes.trim() || null },
      { onSuccess: () => { setSaved(true); setTimeout(() => setSaved(false), 2000) } },
    )
  }

  // The call ended without a cancellation: No answer.
  function finishCall(outcome) {
    endCall.mutate({ id: p.id, outcome })
  }

  function pickReason(value) {
    setReason.mutate({ id: p.id, reason: p.cancellation_substatus === value ? null : value })
  }

  function markCancelled() {
    update.mutate({
      id: p.id,
      fulfillment_stage: 'Complete',
      status: 'In Effect',
      cancellation_notes: notes.trim() || null,
    })
  }

  function passToAnother() {
    passOn.mutate(p.id, { onSuccess: onBack })
  }

  // The next call still to make on the calendar, after this one.
  const nextUp = useMemo(() => {
    const ahead = buildCalls(scope, now, tz, { from: todayStr, to: `${addMonths(todayStr.slice(0, 7), 4)}-01` })
    return ahead.find(c => !c.done && c.ms > now && c.id !== p.id) || null
  }, [scope, now, tz, todayStr, p.id])

  const callerIdOn = agentCallerIdOn(p)
  const canBridge = callerIdOn && (mine || isAdmin)
  const callAt = p.scheduled_call_at
  const callDay = callAt ? zonedDateStr(new Date(callAt).getTime(), tz) : null
  const err = update.error || startCall.error || endCall.error || setReason.error || passOn.error
  const leaving = intake?.current_carrier || p.current_carrier || p.carrier_name
  const carrier = bookingCarrier(carriers, p)
  const openText = carrierOpenText(carrier, now, tz)
  const clientLocal = callAt && p.client_timezone && timeText(callAt, p.client_timezone) !== timeText(callAt, tz)
    ? `${timeText(callAt, p.client_timezone)} for the client (${timezoneLabel(p.client_timezone)})` : null
  const nextLabel = nextUp && (nextUp.date === todayStr ? timeParts(nextUp.at, tz) : null)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <button type="button" className="fc-back" onClick={onBack}>
          <ArrowLeft size={18} strokeWidth={2.2} /> Calendar · {dayShort(backDay)}
        </button>
      </div>

      {/* Header — who, when, and the call */}
      <section className="ov-card" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '18px 24px', padding: '24px 26px' }}>
        <div style={{ flex: '1 1 300px', minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <h1 style={{ margin: 0, fontFamily: DISPLAY, fontSize: 28, fontWeight: 600, letterSpacing: '-0.02em', color: 'var(--ov-hi)', overflowWrap: 'anywhere' }}>{fullName(p)}</h1>
            <StatusPill p={p} />
            <FlagPills p={p} now={now} rows={rows} />
          </div>
          <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: '6px 18px', fontSize: 13.5, color: 'var(--ov-soft)' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Clock size={15} />
              {callAt ? (
                <span>
                  <b style={{ color: 'var(--ov-hi)' }}>{timeText(callAt, tz)} {callDay === todayStr ? 'today' : `· ${dayShort(callDay)}`}</b>
                  {clientLocal && <span style={{ color: 'var(--ov-mute)' }}> · {clientLocal}</span>}
                </span>
              ) : 'No call time booked'}
            </span>
            <span>Booked by {p.agent?.full_name || 'unknown agent'} · {agoLong(p.created_at, now)}</span>
          </div>
          <p style={{ margin: '6px 0 0', fontSize: 12.5, color: 'var(--ov-mute)' }}>
            New policy: {[p.product_name, p.state].filter(Boolean).join(' · ') || 'not given'}
            {' · '}<span style={{ fontFamily: MONO }}>{money(p.monthly_premium)}/mo</span>
          </p>
        </div>
        {!done && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'flex-end' }}>
            {(mine || isAdmin)
              ? (live
                ? <span style={{ fontSize: 13, color: 'var(--ov-soft)', maxWidth: 260, lineHeight: 1.5, textAlign: 'right' }}>
                    Call in progress. When you hang up, mark how it went just below.
                  </span>
                : <ClientCallAction p={p} canBridge={canBridge} onCall={onCall} />)
              : <span style={{ fontSize: 13, color: 'var(--ov-mute)' }}>Only {p.assigned?.full_name || 'the assigned rep'} calls this client.</span>}
            <button onClick={() => navigate(`/messages?dm=${dmId(p.agent_id, isAdmin ? 'admin' : profile?.id)}`)} className="ov-ghost fc-pillbtn">
              <MessageCircleMore size={15} /> Message agent
            </button>
          </div>
        )}
      </section>

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
        <div className="fc-carrier">
          <IconChip icon={ShieldAlert} color="var(--warning)" tint="var(--warning-dim)" iconSize={18} />
          <div style={{ flex: '1 1 160px', minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--warning)' }}>Cancel with</div>
            <div style={{ fontFamily: DISPLAY, fontSize: 19, fontWeight: 600, color: 'var(--ov-hi)' }}>
              {intakeLoading ? 'Loading…' : (leaving || 'Current carrier not recorded')}
            </div>
          </div>
          {(carrier?.service_phone || openText) && (
            <div style={{ textAlign: 'right', fontSize: 13, color: 'var(--ov-soft)' }}>
              {carrier?.service_phone && <div style={{ fontFamily: MONO, color: 'var(--ov-hi)' }}>{carrier.service_phone}</div>}
              {openText && <div>{openText}</div>}
            </div>
          )}
        </div>
      )}

      <div className="fc-two">
        {/* Steps */}
        <section className="ov-card" style={{ padding: '22px 24px 10px' }}>
          <h2 style={{ ...cardTitle, marginBottom: 4 }}>Work this call</h2>

          <Step n={1} title="Client authorization">
            <AuthorizationStatus />
          </Step>

          <Step n={2} title="Call the client" done={done} current={!done && stage !== 'noAnswer'}>
            {done ? (
              <p style={stepText}>Carrier call finished.</p>
            ) : live ? (
              <p style={{ ...stepText, color: 'var(--ov-soft)' }}>
                On a call right now. Mark how it went in the red box above when you hang up.
              </p>
            ) : stage === 'booked' ? (
              <p style={stepText}>
                No call yet. Tap Call client up top to start{leaving ? `, then bring ${leaving} onto the line` : ''}. You'll mark how it went when you hang up.
              </p>
            ) : (
              <>
                <p style={{ ...stepText, color: 'var(--ov-soft)' }}>
                  Last call: no answer.
                  {' '}{p.call_attempts || 1} call{(p.call_attempts || 1) === 1 ? '' : 's'} so far · {ago(p.last_call_at, now)}. Call again when you’re ready.
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
                    <p style={{ ...stepText, margin: '8px 0 0', fontSize: 12 }}>
                      Optional: if you reached them, why it needs another call. Tap again to clear.
                    </p>
                  </>
                )}
              </>
            )}
          </Step>

          <Step n={3} title="Record the result" done={done && !!p.cancellation_notes}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                disabled={!canEdit || done}
                rows={4}
                aria-label="Notes"
                placeholder="Notes: who you spoke with, what they needed, anything the next person should know"
                style={{ ...control, height: 'auto', padding: '10px 12px', borderRadius: 12, resize: 'vertical', lineHeight: 1.5 }}
              />
              {canEdit && !done && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <button onClick={saveRecord} disabled={!dirty || update.isPending} className="ov-ghost fc-pillbtn">
                    Save notes
                  </button>
                  <SavedTick show={saved} />
                </div>
              )}
            </div>
          </Step>

          <Step n={4} title={done ? 'Cancelled' : 'Mark it cancelled'} done={done}>
            {done ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <p style={{ ...stepText, color: 'var(--ov-soft)' }}>
                  Done {ago(p.fulfillment_completed_at || p.updated_at, now)}
                  {p.assigned?.full_name && <> by {p.assigned.full_name}</>}.
                </p>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <NotifyAgentButton />
                  {mine && (
                    <button
                      onClick={() => (nextUp ? onOpenCall(nextUp.id, nextUp.date) : onBack())}
                      className="ov-primary fc-pillbtn"
                    >
                      {nextUp ? <>Next: {nextUp.name}</> : 'Back to the calendar'} <ArrowRight size={14} />
                    </button>
                  )}
                </div>
              </div>
            ) : canEdit ? (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <button
                  onClick={markCancelled}
                  disabled={update.isPending}
                  className="ov-primary fc-pillbtn"
                >
                  <CircleCheckBig size={15} /> Mark cancelled
                </button>
                {confirmingPass ? (
                  <>
                    <span style={{ fontSize: 12.5, color: 'var(--ov-soft)' }}>Hand this to another rep?</span>
                    <button onClick={passToAnother} disabled={passOn.isPending} className="ov-ghost fc-pillbtn" style={{ color: 'var(--danger)' }}>
                      {passOn.isPending ? 'Passing…' : 'Pass it on'}
                    </button>
                    <button onClick={() => setConfirmingPass(false)} className="ov-ghost fc-pillbtn">Keep it</button>
                  </>
                ) : (
                  <button onClick={() => setConfirmingPass(true)} className="ov-ghost fc-pillbtn">
                    <Shuffle size={13} /> Pass to another rep
                  </button>
                )}
              </div>
            ) : isAdmin ? (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <p style={stepText}>
                  {p.assigned?.full_name || 'The assigned rep'} finishes this one.
                </p>
                <button onClick={passToAnother} disabled={passOn.isPending} className="ov-ghost fc-pillbtn">
                  <Shuffle size={13} /> {passOn.isPending ? 'Reassigning…' : 'Reassign'}
                </button>
              </div>
            ) : (
              <p style={stepText}>
                Only {p.assigned?.full_name || 'the assigned rep'} can finish it.
              </p>
            )}
            {err && (
              <p style={{ margin: '8px 0 0', fontSize: 12.5, color: 'var(--danger)' }}>
                Couldn't save — {err.message || 'try again'}.
              </p>
            )}
          </Step>
        </section>

        {/* Intake */}
        <section className="ov-card" style={{ padding: '22px 24px' }}>
          <button
            type="button"
            onClick={() => setShowIntake(s => !s)}
            aria-expanded={showIntake}
            style={{ border: 'none', background: 'transparent', padding: 0, width: '100%', display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', font: 'inherit', textAlign: 'left' }}
          >
            <h2 style={{ ...cardTitle, flex: 1 }}>Client intake</h2>
            <span style={{ fontSize: 12.5, color: 'var(--ov-mute)' }}>From the agent's booking</span>
            {showIntake ? <ChevronUp size={16} color="var(--ov-mute)" /> : <ChevronDown size={16} color="var(--ov-mute)" />}
          </button>
          {showIntake && (
            !canViewIntake ? (
              <p style={{ ...stepText, marginTop: 14, fontStyle: 'italic' }}>
                Only the rep it's assigned to can see the intake.
              </p>
            ) : intakeLoading ? (
              <p style={{ ...stepText, marginTop: 14 }}>Loading intake…</p>
            ) : !intake ? (
              <p style={{ margin: '14px 0 0', fontSize: 13, color: 'var(--danger)' }}>
                No intake details found — the agent's submission may not have completed cleanly.
              </p>
            ) : (
              <IntakeGrid data={intake} />
            )
          )}
          {p.notes && (
            <div style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid var(--ov-line)' }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ov-mute)' }}>Agent's note</div>
              <p style={{ margin: '4px 0 0', fontSize: 14, color: 'var(--ov-soft)', lineHeight: 1.5 }}>{p.notes}</p>
            </div>
          )}
        </section>
      </div>

      {nextUp && (
        <section className="ov-card" style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '10px 14px', padding: '14px 18px 14px 22px' }}>
          <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ov-mute)' }}>Next on {isAdmin ? 'the' : 'your'} calendar</span>
          <span className="fc-time" style={{ width: 'auto', minWidth: 52, height: 40, padding: '0 8px', '--fc-c': CALL_TONE[nextUp.tone].fg, '--fc-t': CALL_TONE[nextUp.tone].tint }}>
            {nextLabel
              ? <><b style={{ fontSize: 14 }}>{nextLabel.time}</b><s>{nextLabel.period}</s></>
              : <><b style={{ fontSize: 12.5 }}>{dayShort(nextUp.date).split(',')[0]}</b><s>{timeText(nextUp.at, tz)}</s></>}
          </span>
          <span style={{ flex: '1 1 160px', minWidth: 0, fontSize: 14.5, fontWeight: 600, color: 'var(--ov-hi)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {nextUp.name} <span style={{ fontWeight: 500, color: 'var(--ov-mute)' }}>· {nextUp.p.current_carrier || 'Carrier not noted'}</span>
          </span>
          <button type="button" className="ov-ghost fc-pillbtn" onClick={() => onOpenCall(nextUp.id, nextUp.date)}>
            Next call <ArrowRight size={15} strokeWidth={2.3} />
          </button>
        </section>
      )}
    </div>
  )
}

// ── page ────────────────────────────────────────────────────────────────────

export default function FulfillmentQueue() {
  const { profile } = useAuth()
  const isAdmin = profile?.role === 'admin'
  const qc = useQueryClient()
  const { data: queue = [], isLoading } = useFulfillmentQueue()
  const now = useNow(30e3)
  const tz = profile?.timezone || DEFAULT_TIMEZONE
  const todayStr = zonedDateStr(now, tz)
  // The URL holds where the rep is: ?day=<YYYY-MM-DD> (that day's drawer is
  // open) or ?open=<id>&from=<day> (a call, and the day to go back to). The
  // Overview, Pipeline and notifications link straight to ?open=<id>.
  const [params, setParams] = useSearchParams()
  const openId = params.get('open')
  const day = /^\d{4}-\d{2}-\d{2}$/.test(params.get('day') || '') ? params.get('day') : null
  const from = /^\d{4}-\d{2}-\d{2}$/.test(params.get('from') || '') ? params.get('from') : null
  const [rep, setRep] = useState('all')
  const myId = profile?.id

  // Anything booked while no rep was active has no one on it; place it now.
  useEffect(() => {
    if (!myId) return
    assignUnassigned()
      .then(n => { if (n > 0) qc.invalidateQueries({ queryKey: ['policies'] }) })
      .catch(() => {})
  }, [myId, qc])

  const scope = useMemo(
    () => (isAdmin ? (rep === 'all' ? queue : queue.filter(p => p.assigned_fulfillment_id === rep)) : queue.filter(p => p.assigned_fulfillment_id === myId)),
    [queue, isAdmin, rep, myId],
  )
  const reps = useMemo(() => [
    { value: 'all', label: 'All reps' },
    ...[...new Map(queue.filter(p => p.assigned).map(p => [p.assigned.id, p.assigned.full_name || 'Unnamed rep'])).entries()]
      .sort((a, b) => a[1].localeCompare(b[1]))
      .map(([value, label]) => ({ value, label })),
  ], [queue])

  const openDay = d => setParams({ day: d })
  const closeDay = () => setParams({}, { replace: true })
  const openCall = (id, d) => setParams(d ? { open: id, from: d } : { open: id })

  if (openId) {
    if (isLoading || !profile) {
      return <p style={{ margin: 0, fontSize: 13.5, color: 'var(--ov-mute)' }}>Loading the call…</p>
    }
    const p = queue.find(x => x.id === openId)
    const backDay = (p && isLive(p)) ? todayStr
      : from || (p?.scheduled_call_at ? zonedDateStr(new Date(p.scheduled_call_at).getTime(), tz) : todayStr)
    const back = () => openDay(backDay)
    if (!p) {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div>
            <button type="button" className="fc-back" onClick={back}>
              <ArrowLeft size={18} strokeWidth={2.2} /> Calendar · {dayShort(backDay)}
            </button>
          </div>
          <div className="ov-card fc-empty">This call isn't on {isAdmin ? 'the' : 'your'} calendar any more.</div>
        </div>
      )
    }
    return (
      // keyed so moving to the next client resets the field state
      <CallView
        key={p.id} p={p} rows={queue} scope={isAdmin ? queue : scope}
        now={now} tz={tz} todayStr={todayStr} profile={profile} isAdmin={isAdmin}
        backDay={backDay} onBack={back} onOpenCall={openCall}
      />
    )
  }

  return (
    <FulfillmentCalendar
      rows={scope} team={isAdmin} tz={tz} now={now} todayStr={todayStr} loading={isLoading || !profile}
      day={day} onOpenDay={openDay} onCloseDay={closeDay} onOpenCall={openCall}
      reps={reps} rep={rep} onRep={setRep}
    />
  )
}
