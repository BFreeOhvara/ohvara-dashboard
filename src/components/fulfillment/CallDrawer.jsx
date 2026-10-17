import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, Check, Loader2, Lock, MessageCircleMore, MessageSquare, Phone, PhoneCall, ShieldAlert, Shuffle, Undo2 } from 'lucide-react'
import { dmId } from '../../hooks/useDirectMessages'
import { useCarriers } from '../../hooks/useCarriers'
import { useClientCall, useCallActions, useCallLock } from '../../hooks/useCallActions'
import { useCorrectResult } from '../../hooks/usePolicies'
import { ResultFixBar } from './ResultFixBar'
import { usePortalPhone } from '../../contexts/portalPhone'
import { ClientDrawer } from '../agent/AgentUI'
import { usePhoneLayout } from '../../hooks/usePhoneLayout'
import { PhoneDrawerSheet } from './phone/PhoneDrawerSheet'
import { Segmented } from '../ui/Segmented'
import { SavedTick } from '../ui/SavedTick'
import { LiveDot } from '../ui/LiveDot'
import { control, MONO, DISPLAY } from '../../lib/exportStyles'
import { fullName } from '../../lib/policyFormat'
import { isLive, stageOf, recoveryLabel, isMissedHold, MISSED_LABEL } from '../../lib/agentBookings'
import { bookingCarrier } from '../../lib/carriers'
import { zonedDateStr } from '../../lib/timezones'
import { CALL_TONE, buildCalls, dayShort, whenShort } from '../../lib/fulfillmentDay'
import { addDaysStr } from '../../lib/scheduling'
import { RESULT_TEXT, agentCallerIdOn, callHint, callTone, carrierOpenText, changeableResult, clientTimeText, firstName, initialsOf, otherResult, telHref } from '../../lib/fulfillmentCall'

// Prompt 748 — a call on My calls opens in this drawer (My Pipeline's
// ClientDrawer shell) instead of a page of its own. It carries every action
// the old desk had (P684 / P689 / P695 / P747): call the client (bridged with
// the agent's number, or a plain tel:), the live call's two outcomes, the
// optional No answer reason, notes, Mark cancelled, Pass it on / Reassign and
// Message agent. Client intake, the new policy line and the agent's note are
// gone from the call (Brayden: "we're not even going to have that
// information"); the intake data and its RLS are untouched.
// Admin reads other reps' calls and can only reassign them.
// Prompt 773 — on a rep's phone layout the same content opens as a bottom
// sheet (PhoneDrawerSheet), every field and action unchanged.

const SUBSTATUS = [
  { value: 'waiting_carrier', label: 'Waiting on carrier' },
  { value: 'waiting_client',  label: 'Waiting on client' },
]
const SUBSTATUS_LABEL = Object.fromEntries(SUBSTATUS.map(s => [s.value, s.label]))

// The button itself, whichever path it takes. `children` is its label.
// Prompt 756: for the rep who can work the call it stays locked (grey, lock
// icon) until 5 minutes before the call; a tap only says when it opens.
export function CallButton({ p, call, className, style, children, icon = true }) {
  const lock = useCallLock(call.onCall ? p : null)
  if (!p.client_phone) return null
  if (lock.locked) {
    return (
      <button type="button" aria-disabled="true" title={`Unlocks at ${lock.opens}`} className={`${className} mc-locked`} style={style}
        onClick={e => { e.stopPropagation(); lock.tell() }}>
        {icon && <Lock size={17} strokeWidth={2.1} />}{children}
      </button>
    )
  }
  const calling = call.state.phase === 'calling'
  const Icon = call.canBridge || call.portal ? PhoneCall : Phone
  const inner = <>{icon && (calling ? <Loader2 size={17} className="animate-spin" /> : <Icon size={17} strokeWidth={2.1} />)}{children}</>
  if (call.portal) {
    return <button type="button" onClick={e => { e.stopPropagation(); call.openPhone() }} className={className} style={style}>{inner}</button>
  }
  if (!call.canBridge) {
    return <a href={telHref(p.client_phone)} onClick={e => { e.stopPropagation(); call.onCall?.() }} className={className} style={style}>{inner}</a>
  }
  return (
    <button type="button" onClick={e => { e.stopPropagation(); call.bridge() }} disabled={calling} className={className} style={{ ...style, opacity: calling ? 0.6 : 1 }}>
      {inner}
    </button>
  )
}

// What happened after the click: ringing, or why it fell back to a direct dial.
export function CallStatus({ p, call, style }) {
  const { phase, message } = call.state
  if (phase === 'ringing') {
    return <p className="mc-callnote" style={{ color: 'var(--ov-st-cancelled)', ...style }}>Ringing your phone now. Pick up and you'll be connected to {p.client_first_name || 'the client'}.</p>
  }
  if (phase !== 'fallback' && phase !== 'error') return null
  return (
    <p className="mc-callnote" style={{ color: phase === 'error' ? 'var(--danger)' : 'var(--ov-warn)', ...style }}>
      {message}{' '}
      <a href={telHref(p.client_phone)} onClick={e => { e.stopPropagation(); call.onCall?.() }} style={{ color: 'var(--accent)', fontWeight: 600 }}>Dial directly instead</a>
      {' '}(shows your own number).
    </p>
  )
}

function StatusPill({ p, now }) {
  const tone = callTone(p, now)
  const t = CALL_TONE[tone]
  let text = { cancelled: 'Cancelled', late: 'Time passed', booked: 'Booked' }[tone]
  if (tone === 'booked' && isMissedHold(p)) text = `Priority · ${MISSED_LABEL}`
  if (tone === 'live') text = `On a call · ${Math.max(0, Math.floor((now - new Date(p.call_live_since)) / 6e4))} min`
  if (tone === 'noAnswer') {
    const reason = SUBSTATUS_LABEL[p.cancellation_substatus]
    const flow = recoveryLabel(p)
    text = `No answer${p.call_attempts > 1 ? ` · try ${p.call_attempts}` : ''}${reason ? ` · ${reason.toLowerCase()}` : ''}${flow ? ` · ${flow}` : ''}`
  }
  return (
    <span className="mc-pill" style={{ '--mc-c': t.fg, '--mc-t': t.tint, '--mc-e': t.edge }}>
      {tone === 'live' && <LiveDot size={8} />}
      {text}
    </span>
  )
}

// Prompt 750 — "Change result" in the footer: Cancelled ↔ No answer, with a
// two-choice confirm. Shown while the user may still change it
// (changeableResult: the rep the same day, admin any time).
function ChangeResult({ p, result }) {
  const [asking, setAsking] = useState(false)
  const correct = useCorrectResult()
  const to = otherResult(result)
  if (!asking) {
    return <button type="button" className="mc-link" onClick={() => setAsking(true)}><Undo2 size={13} /> Change result</button>
  }
  return (
    <div className="mc-change">
      <div className="mc-change-row">
        <button type="button" className="mc-link" style={{ color: 'var(--ov-data-a)' }} disabled={correct.isPending}
          onClick={() => correct.mutate({ id: p.id, to }, { onSuccess: () => setAsking(false) })}>
          {correct.isPending ? 'Changing…' : `Change to ${RESULT_TEXT[to]}`}
        </button>
        <button type="button" className="mc-link" onClick={() => { setAsking(false); correct.reset() }}>Keep it</button>
      </div>
      {to === 'no_answer' && <p>The agent will get a note that it isn't cancelled yet.</p>}
      {correct.error && <p style={{ color: 'var(--danger)' }}>Couldn't change it: {correct.error.message || 'try again'}</p>}
    </div>
  )
}

export function CallDrawer({ p, scope, now, tz, profile, isAdmin, onClose, onOpenCall, fix }) {
  const navigate = useNavigate()
  const Shell = usePhoneLayout() ? PhoneDrawerSheet : ClientDrawer
  const { data: carriers } = useCarriers()
  const phone = usePortalPhone()
  const onPhone = phone.activeId === p.id
  const act = useCallActions(p)
  const mine = p.assigned_fulfillment_id === profile?.id
  const done = p.fulfillment_stage === 'Complete'
  const live = isLive(p)
  const stage = stageOf(p)
  const tone = callTone(p, now)
  const t = CALL_TONE[tone]
  const canWork = mine && !done
  const canBridge = agentCallerIdOn(p) && mine
  const call = useClientCall(p, { canBridge, onCall: canWork ? act.start : undefined })
  const lock = useCallLock(canWork ? p : null)
  const fixing = fix?.fix?.id === p.id
  const result = fixing ? null : changeableResult(p, { isAdmin, mine, tz, now })
  const changeLink = result ? <ChangeResult key={result} p={p} result={result} /> : null
  const marked = r => ({ onSuccess: () => fix?.show(p, r) })

  const [notes, setNotes] = useState(p.cancellation_notes || '')
  const [saved, setSaved] = useState(false)
  const [confirmingPass, setConfirmingPass] = useState(false)
  const dirty = notes !== (p.cancellation_notes || '')

  // The next call still to make after this one, any day ahead.
  const nextUp = useMemo(() => {
    const today = zonedDateStr(now, tz)
    const ahead = buildCalls(scope, now, tz, { from: today, to: addDaysStr(today, 120) })
    return ahead.find(c => !c.done && c.ms > now && c.id !== p.id) || null
  }, [scope, now, tz, p.id])

  const agent = p.agent?.full_name || 'the agent'
  const rep = p.assigned?.full_name || 'the assigned rep'
  const leaving = p.current_carrier || p.carrier_name
  const carrier = bookingCarrier(carriers, p)
  const openText = carrierOpenText(carrier, now, tz)
  const theirTime = clientTimeText(p, live ? now : p.scheduled_call_at, tz)
  const attempts = p.call_attempts || 0
  const bookedOn = p.created_at ? dayShort(zonedDateStr(new Date(p.created_at).getTime(), tz)) : null
  const doneAt = p.fulfillment_completed_at || p.updated_at
  const message = () => navigate(`/messages?dm=${dmId(p.agent_id, isAdmin ? 'admin' : profile?.id)}`)
  const pass = () => act.passOn({ onSuccess: onClose })
  const name = fullName(p)

  const btn = 'mc-btn'
  const passLink = canWork ? (
    confirmingPass ? (
      <span className="mc-pass">
        Hand this to another rep?
        <button type="button" onClick={pass} disabled={act.passing} className="mc-link" style={{ color: 'var(--danger)' }}>{act.passing ? 'Passing…' : 'Pass it on'}</button>
        <button type="button" onClick={() => setConfirmingPass(false)} className="mc-link">Keep it</button>
      </span>
    ) : (
      <button type="button" onClick={() => setConfirmingPass(true)} className="mc-link"><Shuffle size={13} /> Pass to another rep</button>
    )
  ) : null

  let footer
  if (!mine) {
    footer = (
      <div className="mc-foot-row">
        <span>{done ? `Cancelled ${whenShort(doneAt, now, tz)} by ${rep}.` : `Only ${rep} calls this client.`}</span>
        {isAdmin && !done && (
          <button type="button" onClick={pass} disabled={act.passing} className="mc-link"><Shuffle size={13} /> {act.passing ? 'Reassigning…' : 'Reassign'}</button>
        )}
        {changeLink}
      </div>
    )
  } else if (done) {
    footer = (
      <div className="mc-foot-row">
        <span><Check size={14} strokeWidth={2.4} style={{ color: 'var(--ov-st-cancelled)', verticalAlign: -2 }} /> Cancelled {whenShort(doneAt, now, tz).replace(/^Today /, '')} by {rep}</span>
        {nextUp && (
          <button type="button" className={`${btn} ov-ghost`} style={{ height: 40, padding: '0 16px' }} onClick={() => onOpenCall(nextUp.id, nextUp.date)}>
            Next call <ArrowRight size={15} strokeWidth={2.3} />
          </button>
        )}
        {changeLink}
      </div>
    )
  } else if (live && onPhone) {
    footer = (
      <div className="mc-foot-row">
        <span>You're on this call in the portal phone. Record how it went there when it ends.</span>
        <button type="button" className="mc-link" onClick={() => phone.open(p)}><PhoneCall size={13} /> Show phone</button>
      </div>
    )
  } else if (live) {
    footer = (
      <>
        <p className="mc-hung"><span />Hung up? Mark how it went.</p>
        <div className="mc-grid2">
          <button type="button" onClick={() => act.cancelled(notes, marked('cancelled'))} disabled={act.busy} className={`${btn} mc-btn-ok`} style={{ height: 48 }}>
            <Check size={17} strokeWidth={2.6} /> Cancelled
          </button>
          <button type="button" onClick={() => act.noAnswer(marked('no_answer'))} disabled={act.busy} className={`${btn} ov-ghost`} style={{ height: 48 }}>No answer</button>
        </div>
        <div className="mc-foot-row" style={{ marginTop: 12 }}>
          <span>Reached them but it needs another call? Pick No answer.</span>
          {passLink}
        </div>
      </>
    )
  } else {
    footer = (
      <>
        <div className="mc-grid2">
          {p.client_phone
            ? <CallButton p={p} call={call} className={`${btn} ov-solid`} style={{ height: 48 }}>Call client</CallButton>
            : <span className={`${btn} ov-ghost`} style={{ height: 48, opacity: 0.6 }}>No number</span>}
          <button type="button" onClick={() => act.cancelled(notes, marked('cancelled'))} disabled={act.saving} className={`${btn} ov-ghost`} style={{ height: 48 }}>
            <Check size={16} strokeWidth={2.4} /> Mark cancelled
          </button>
        </div>
        <CallStatus p={p} call={call} style={{ marginTop: 10 }} />
        <div className="mc-foot-row" style={{ marginTop: 12 }}>
          <span>{canWork && lock.locked ? `Call client unlocks at ${lock.opens}.` : [callHint(p, canBridge)].flat().join(' ')}</span>
          {!phone.voiceLive && p.client_phone && (
            <button type="button" className="mc-link" onClick={() => phone.open(p)}><PhoneCall size={13} /> Preview the portal phone</button>
          )}
          {passLink}
          {changeLink}
        </div>
      </>
    )
  }

  return (
    <Shell
      name={name} onClose={onClose}
      header={{
        style: { background: `radial-gradient(ellipse 90% 80% at 100% 0%, ${t.tint} 0%, transparent 70%)` },
        title: (
          <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 600, color: 'var(--ov-mute)' }}>
            Call{p.scheduled_call_at ? ` · ${whenShort(live ? p.call_live_since : p.scheduled_call_at, now, tz)}` : ''}
          </span>
        ),
        body: (
          <>
            <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 14, minWidth: 0 }}>
              <span className="mc-avatar" style={{ '--mc-c': t.fg, '--mc-t': t.tint, '--mc-e': t.edge }}>{initialsOf(name)}</span>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontFamily: DISPLAY, fontSize: 24, fontWeight: 600, letterSpacing: '-0.02em', lineHeight: 1.15, color: 'var(--ov-hi)', overflowWrap: 'anywhere' }}>{name}</div>
                <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <StatusPill p={p} now={now} />
                  {theirTime && <span style={{ fontSize: 13, color: 'var(--ov-mute)' }}>{theirTime}</span>}
                </div>
              </div>
            </div>
            <div className="mc-grid2" style={{ marginTop: 18 }}>
              {!p.client_phone ? (
                <span className={`${btn} ov-ghost`} style={{ opacity: 0.6 }}>No number</span>
              ) : canWork && !live ? (
                <CallButton p={p} call={call} className={`${btn} ov-solid`}>
                  <span style={{ fontFamily: MONO, fontSize: 13.5 }}>{p.client_phone}</span>
                </CallButton>
              ) : (
                <a href={telHref(p.client_phone)} className={`${btn} ov-solid`}>
                  <Phone size={16} strokeWidth={2.2} /><span style={{ fontFamily: MONO, fontSize: 13.5 }}>{p.client_phone}</span>
                </a>
              )}
              <button type="button" onClick={message} className={`${btn} ov-ghost`}>
                <MessageSquare size={16} strokeWidth={2} style={{ flexShrink: 0 }} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>Message {agent}</span>
              </button>
            </div>
          </>
        ),
      }}
      footer={<>{fix?.fix && <ResultFixBar ctl={fix} inline />}{footer}</>}
      footerStyle={live && mine ? { background: 'color-mix(in srgb, var(--ov-live) 5%, transparent)' } : undefined}
    >
      {canBridge && p.client_phone && !done && (
        <div className="mc-note">
          <MessageCircleMore size={17} strokeWidth={2} style={{ flexShrink: 0, marginTop: 2, color: 'var(--ov-st-booked)' }} />
          <p>
            <b>The client sees {firstName(agent) || 'the agent'}'s number. You're calling on behalf of {agent}. Never say you are them.</b>{' '}
            <i>"Hi {p.client_first_name || 'there'}, this is {firstName(profile?.full_name) || 'your name'} calling on behalf of {agent}. We spoke with you about getting your old policy cancelled."</i>
          </p>
        </div>
      )}

      <div className="mc-carrier">
        <span className="mc-carrier-ic"><ShieldAlert size={19} strokeWidth={2} /></span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ov-warn)' }}>Cancel with</div>
          <div style={{ fontFamily: DISPLAY, fontSize: 20, fontWeight: 600, letterSpacing: '-0.01em', color: 'var(--ov-hi)', overflowWrap: 'anywhere' }}>{leaving || 'Current carrier not recorded'}</div>
        </div>
        {(carrier?.service_phone || openText) && (
          <div style={{ textAlign: 'right' }}>
            {carrier?.service_phone && <div style={{ fontFamily: MONO, fontSize: 13.5, color: 'var(--ov-hi)' }}>{carrier.service_phone}</div>}
            {openText && <div style={{ marginTop: 2, fontSize: 12.5, color: 'var(--ov-soft)' }}>{openText}</div>}
          </div>
        )}
      </div>

      <div className="mc-grid2">
        <div className="mc-tile"><div>Booked by</div><div>{agent}{bookedOn ? ` · ${bookedOn}` : ''}</div></div>
        <div className="mc-tile"><div>Calls so far</div><div>{live ? `${Math.max(attempts, 1)}, this one` : attempts ? attempts : 'None yet'}</div></div>
      </div>

      {done && (p.cancellation_confirmation || p.cancellation_effective_date) && (
        <div className="mc-grid2">
          <div className="mc-tile"><div>Confirmation</div><div style={{ fontFamily: MONO, overflowWrap: 'anywhere' }}>{p.cancellation_confirmation || 'Not recorded'}</div></div>
          <div className="mc-tile">
            <div>Takes effect</div>
            <div>{p.cancellation_effective_date ? dayShort(p.cancellation_effective_date) : 'Not recorded'}{p.drafts_stopped ? ' · drafts stopped' : ''}</div>
          </div>
        </div>
      )}

      {(mine || p.cancellation_notes) && (
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ov-mute)', marginBottom: 8 }}>Notes</div>
          {canWork ? (
            <>
              <textarea
                value={notes} onChange={e => setNotes(e.target.value)} rows={3} aria-label="Notes"
                placeholder="Who you spoke with, what the carrier needed, anything the next person should know"
                style={{ ...control, height: 'auto', padding: '12px 14px', borderRadius: 14, resize: 'vertical', lineHeight: 1.5 }}
              />
              <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 10 }}>
                <button type="button" onClick={() => act.saveNotes(notes, { onSuccess: () => { setSaved(true); setTimeout(() => setSaved(false), 2000) } })}
                  disabled={!dirty || act.saving} className={`${btn} ov-ghost`} style={{ height: 36, padding: '0 14px', fontSize: 13.5 }}>
                  Save notes
                </button>
                <SavedTick show={saved} />
              </div>
            </>
          ) : (
            <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: p.cancellation_notes ? 'var(--ov-soft)' : 'var(--ov-faint)', whiteSpace: 'pre-wrap' }}>
              {p.cancellation_notes || 'No notes.'}
            </p>
          )}
        </div>
      )}

      {stage === 'noAnswer' && canWork && (
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ov-mute)', marginBottom: 8 }}>Why it needs another call <span style={{ fontWeight: 500, color: 'var(--ov-faint)' }}>· optional</span></div>
          <Segmented size="sm" style={{ flexWrap: 'wrap', maxWidth: '100%' }} options={SUBSTATUS} value={p.cancellation_substatus || null} onChange={act.reason} />
          <p style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--ov-faint)' }}>If you reached them. Tap again to clear.</p>
        </div>
      )}

      {act.error && (
        <p style={{ margin: 0, fontSize: 12.5, color: 'var(--danger)' }}>Couldn't save — {act.error.message || 'try again'}.</p>
      )}
    </Shell>
  )
}
