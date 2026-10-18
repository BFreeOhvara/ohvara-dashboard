import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Check, Info, Phone, ChevronRight } from 'lucide-react'
import { useAuth } from '../../../hooks/useAuth'
import { useFulfillmentQueue, assignUnassigned } from '../../../hooks/usePolicies'
import { useCallOutcomes } from '../../../hooks/useRepCallEvents'
import { useCarriers } from '../../../hooks/useCarriers'
import { useCallActions, useCallLock, useClientCall } from '../../../hooks/useCallActions'
import { usePortalPhone } from '../../../contexts/portalPhone'
import { CallButton, CallDrawer, CallStatus } from '../CallDrawer'
import { NotificationBell } from '../../notifications/NotificationBell'
import { Avatar } from '../../ui/Avatar'
import { PhoneSheet } from '../../agent/phone/PhoneSheet'
import { LoadError } from '../../agent/AgentUI'
import { clientSub } from '../../agent/phone/phoneBits'
import { agentCallerIdOn, carrierOpenText, firstName } from '../../../lib/fulfillmentCall'
import { bookingCarrier } from '../../../lib/carriers'
import { isLive, isMissedHold, placeOf, useNow } from '../../../lib/agentBookings'
import { addDaysStr } from '../../../lib/scheduling'
import { DEFAULT_TIMEZONE, zonedDateStr } from '../../../lib/timezones'
import { CALL_TONE, buildCalls, dayBounds, dayShort, dayTally, inLabel, timeParts, timeText } from '../../../lib/fulfillmentDay'

// Prompt 773 — Today, the phone version of My calls with the Overview folded
// in (mockup FulToday.dc.html): date chip, bell (full screen), avatar (to
// More); the greeting and the day's count; the next-call card (locked until 5
// minutes before, then "Call <first name>", red with "Back to the call" while
// the portal phone is on it); Today's score; Later today. Every row and the
// card's (i) open the call's details as a bottom sheet (?open=<id>, the same
// link My calls uses). The tab bar's Call button lands here with
// `focusNext`, which scrolls to the card and lights it up for a moment.
// Same data and rules as My calls (buildCalls, dayTally, useCallLock).

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`
const iso = ms => new Date(ms).toISOString()
const pad = n => String(n).padStart(2, '0')
const lateLabel = mins => (mins >= 60 ? `${Math.floor(mins / 60)} hr ${mins % 60 ? `${mins % 60} min ` : ''}late` : `${mins} min late`)
const retrySub = c => (c.attempt === 2 ? 'Second try' : `Try ${c.attempt}`)

function greetingFor(nowMs, tz, name) {
  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hourCycle: 'h23' }).format(nowMs))
  const first = firstName(name)
  return `${hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'}${first ? `, ${first}` : ''}`
}

// The carrier's hours as a chip: "Globe Life open until 7:00 PM".
function hoursChip(carrier, nowMs, tz) {
  const text = carrierOpenText(carrier, nowMs, tz)
  if (!text) return null
  const words = text.replace(/ your time$/, '')
  return { text: `${carrier.name} ${words[0].toLowerCase()}${words.slice(1)}`, open: words.startsWith('Open until') }
}

function NextCard({ c, now: pageNow, tz, profile, carriers, onOpen, lit, cardRef }) {
  const { p } = c
  const live = c.tone === 'live'
  const secNow = useNow(live ? 1e3 : 60e3)
  const now = live ? secNow : pageNow
  const phone = usePortalPhone()
  const act = useCallActions(p)
  const mine = p.assigned_fulfillment_id === profile?.id
  const canWork = mine && p.fulfillment_stage !== 'Complete'
  const call = useClientCall(p, { canBridge: agentCallerIdOn(p) && mine, onCall: canWork ? act.start : undefined })
  const lock = useCallLock(canWork ? p : null)
  const late = !live && c.ms <= now
  const onPortal = phone.activeId === p.id
  const first = p.client_first_name || firstName(c.name) || 'client'
  const state = live ? 'live' : canWork && lock.locked ? 'locked' : 'ready'

  let tag
  let when
  if (live) {
    const secs = Math.max(0, Math.floor((now - c.ms) / 1e3))
    tag = 'ON A CALL'
    when = `${Math.floor(secs / 60)}:${pad(secs % 60)} on the call`
  } else if (late) {
    tag = 'TIME PASSED'
    when = lateLabel(Math.max(0, Math.round((now - c.ms) / 6e4)))
  } else {
    tag = state === 'locked' ? 'UP NEXT' : 'READY'
    when = inLabel(c.ms, now)
  }
  const chip = hoursChip(bookingCarrier(carriers, p), now, tz)
  const leaving = p.current_carrier || p.carrier_name
  const sub = [leaving ? `Cancel with ${leaving}` : 'Carrier not noted', placeOf(p)].filter(Boolean).join(' · ')

  let action
  if (live && onPortal) {
    action = (
      <button type="button" className="ph-nc-btn is-live" onClick={() => phone.show()}>
        <Phone size={18} strokeWidth={2.2} aria-hidden="true" />Back to the call
      </button>
    )
  } else if (live && mine) {
    action = (
      <span className="ph-nc-two">
        <button type="button" className="ph-nc-btn is-ok" disabled={act.busy} onClick={() => act.cancelled()}>
          <Check size={18} strokeWidth={2.6} aria-hidden="true" />Cancelled
        </button>
        <button type="button" className="ph-nc-btn is-ghost" disabled={act.busy} onClick={() => act.noAnswer()}>No answer</button>
      </span>
    )
  } else if (live) {
    action = <span className="ph-nc-btn is-off">{p.assigned?.full_name || 'The rep'} is on this call</span>
  } else if (!canWork) {
    action = <span className="ph-nc-btn is-off">{p.assigned?.full_name || 'Another rep'} calls this client</span>
  } else if (!p.client_phone) {
    action = <span className="ph-nc-btn is-off">No number on file</span>
  } else {
    action = (
      <CallButton p={p} call={call} className={`ph-nc-btn${lock.locked ? ' is-locked' : ''}`}>
        {lock.locked ? `Unlocks at ${lock.opens}` : `Call ${first}`}
      </CallButton>
    )
  }

  const { time, period } = timeParts(c.at, tz)
  return (
    <section ref={cardRef} className={`ov-hero ph-nc${lit ? ' is-lit' : ''}`} data-state={state} aria-label={`Next call: ${c.name}`}>
      <div className="ph-nc-top">
        <span className="ph-nc-tag"><i aria-hidden="true" />{tag}</span>
        <span style={{ flex: 1 }} />
        <span className="ph-nc-when">{when}</span>
      </div>
      <div className="ph-nc-time">{time} {period}</div>
      <div className="ph-nc-name">{c.name}</div>
      <div className="ph-nc-sub">{sub}</div>
      {(chip || isMissedHold(p)) && (
        <div className="ph-nc-chips">
          {isMissedHold(p) && <span className="ph-nc-chip is-warn"><i aria-hidden="true" />Priority · missed by us</span>}
          {chip && <span className={`ph-nc-chip${chip.open ? ' is-open' : ' is-warn'}`}><i aria-hidden="true" />{chip.text}</span>}
        </div>
      )}
      <div className="ph-nc-actions">
        {action}
        <button type="button" className="ph-nc-info" onClick={() => onOpen(c)} aria-label={`${first}'s details`}>
          <Info size={20} strokeWidth={2} />
        </button>
      </div>
      <CallStatus p={p} call={call} style={{ marginTop: 12 }} />
      {act.error && <p className="ph-nc-err">Couldn't save: {act.error.message || 'try again'}.</p>}
    </section>
  )
}

export function PhoneToday() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const qc = useQueryClient()
  const queueQ = useFulfillmentQueue()
  const { data: queue = [], isLoading } = queueQ
  const { data: carriers } = useCarriers()
  const now = useNow(15e3)
  const tz = profile?.timezone || DEFAULT_TIMEZONE
  const today = zonedDateStr(now, tz)
  const [params, setParams] = useSearchParams()
  const openId = params.get('open')
  const myId = profile?.id

  // Same as My calls: anything booked while no rep was active gets placed.
  useEffect(() => {
    if (!myId) return
    assignUnassigned()
      .then(n => { if (n > 0) qc.invalidateQueries({ queryKey: ['policies'] }) })
      .catch(() => {})
  }, [myId, qc])

  const mine = useMemo(() => queue.filter(p => p.assigned_fulfillment_id === myId), [queue, myId])
  const { startMs, endMs } = dayBounds(today, tz)
  const anyLive = mine.some(isLive)
  const eventsQ = useCallOutcomes(iso(startMs), iso(endMs), { live: anyLive })
  const { data: events = [], isLoading: eventsLoading } = eventsQ
  // P779 — a failed load isn't "no calls today".
  const failed = (queueQ.isError && !queueQ.data) || (eventsQ.isError && !eventsQ.data)
  const calls = useMemo(() => buildCalls(mine, now, tz, { from: today, to: today, events }), [mine, now, tz, today, events])
  const busy = isLoading || !profile || eventsLoading || failed
  const t = dayTally(calls)
  const liveCall = calls.find(c => c.tone === 'live') || null
  const upcoming = calls.filter(c => !c.done)
  const focus = liveCall || upcoming[0] || null
  const later = liveCall ? upcoming : upcoming.slice(1)
  const hasFocus = !!focus
  const nextDay = useMemo(() => {
    if (hasFocus) return null
    const list = buildCalls(mine, now, tz, { from: addDaysStr(today, 1), to: addDaysStr(today, 120) })
    return list[0] || null
  }, [hasFocus, mine, now, tz, today])

  // The tab bar's Call button: scroll to the next-call card, light it up.
  const cardRef = useRef(null)
  const [lit, setLit] = useState(false)
  const focusNext = location.state?.focusNext
  useEffect(() => {
    if (!focusNext) return
    const el = cardRef.current
    if (!el) return
    const smooth = !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    el.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'center' })
    setLit(true)
    const timer = setTimeout(() => setLit(false), 1600)
    return () => clearTimeout(timer)
  }, [focusNext, busy])

  const open = c => setParams({ open: c.id }, { replace: false })
  const close = () => setParams({}, { replace: true })
  const openRow = openId ? queue.find(p => p.id === openId) : null

  const chip = new Date(now).toLocaleDateString('en-US', { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric' })
  const toGo = t.toGo + t.live
  const sub = failed ? 'Couldn’t load your calls.' : busy ? 'Loading your day…'
    : t.total ? `${plural(t.total, 'call')} today. ${t.done} done, ${toGo} to go.`
      : 'Nothing on your calendar today.'
  const score = [
    { l: 'Cancelled', n: t.cancelled, c: CALL_TONE.cancelled.fg },
    { l: 'No answer', n: t.noAnswer, c: CALL_TONE.noAnswer.fg },
    { l: 'To go', n: toGo, c: CALL_TONE.booked.fg },
  ]

  return (
    <div className="ph-stack">
      <div className="ph-top">
        <span className="ph-chip"><span className="ph-chip-dot" aria-hidden="true" />{chip}</span>
        <span style={{ flex: 1 }} />
        {profile?.id && <NotificationBell profileId={profile.id} full />}
        <button type="button" className="ph-avatar" onClick={() => navigate('/fulfillment/more')} aria-label="Your account">
          <Avatar profile={profile} size={44} />
        </button>
      </div>

      <div>
        <h1 className="ph-h1" style={{ fontSize: 31, letterSpacing: '-0.035em' }}>{greetingFor(now, tz, profile?.full_name)}</h1>
        <p style={{ margin: '6px 0 0', fontSize: 15, color: 'var(--ov-soft)' }}>{sub}</p>
      </div>

      {failed ? (
        <LoadError what="your calls" onRetry={() => { queueQ.refetch(); eventsQ.refetch() }} />
      ) : busy ? (
        <div className="ov-card ph-card ph-empty">Loading your day…</div>
      ) : focus ? (
        <NextCard c={focus} now={now} tz={tz} profile={profile} carriers={carriers} onOpen={open} lit={lit} cardRef={cardRef} />
      ) : (
        <section ref={cardRef} className={`ov-card ph-card ph-nc-none${lit ? ' is-lit' : ''}`}>
          <b>{t.total ? "That's everything for today." : 'No calls today.'}</b>
          <span>{nextDay ? `Next call: ${dayShort(nextDay.date)} at ${timeText(nextDay.at, tz)}, ${nextDay.name}.` : 'New calls show here as agents book them.'}</span>
        </section>
      )}

      <section className="ov-card ph-score" aria-label="Today's score">
        <div className="ph-score-head">
          <span className="ph-h2" style={{ fontSize: 17 }}>Today's score</span>
          <span className="ph-mute">{busy ? '—' : `${t.done} of ${t.total} done`}</span>
        </div>
        <div className="ph-score-bar" aria-hidden="true">
          {t.total === 0 ? <span style={{ flex: 1, background: 'var(--ph-tile-bg)' }} /> : <>
            {t.cancelled > 0 && <span style={{ flex: t.cancelled, background: CALL_TONE.cancelled.fg }} />}
            {t.noAnswer > 0 && <span style={{ flex: t.noAnswer, background: CALL_TONE.noAnswer.fg }} />}
            {toGo > 0 && <span style={{ flex: toGo, background: CALL_TONE.booked.tint }} />}
          </>}
        </div>
        <div className="ph-score-cols">
          {score.map(s => (
            <span key={s.l}><b style={{ color: s.c }}>{s.l}</b><span>{busy ? '—' : s.n}</span></span>
          ))}
        </div>
      </section>

      {!busy && later.length > 0 && (
        <section aria-labelledby="ph-later">
          <div className="ph-sechead">
            <h2 id="ph-later" className="ph-h2">Later today</h2>
            <span style={{ flex: 1 }} />
            <button type="button" className="ph-seclink" onClick={() => navigate('/fulfillment/pipeline')}>See all</button>
          </div>
          <div className="ov-card ph-card">
            {later.map(c => {
              const { time, period } = timeParts(c.at, tz)
              const note = isMissedHold(c.p) ? ['Priority', 'var(--ov-st-needs)']
                : c.late ? ['Time passed', CALL_TONE.late.fg]
                  : c.tone === 'noAnswer' ? [retrySub(c), CALL_TONE.noAnswer.fg] : null
              return (
                <button key={c.key} type="button" className="ph-row" onClick={() => open(c)}>
                  <span className="ph-ltime"><b>{time}</b><small>{period}</small></span>
                  <span className="ph-row-main">
                    <span className="ph-row-title" style={{ fontSize: 15 }}>{c.name}</span>
                    <span className="ph-row-sub">{clientSub(c.p)}</span>
                  </span>
                  {note ? <span className="ph-lnote" style={{ color: note[1] }}>{note[0]}</span> : <ChevronRight size={16} strokeWidth={2.2} className="ph-chev" aria-hidden="true" />}
                </button>
              )
            })}
          </div>
        </section>
      )}

      {openId && (openRow ? (
        <CallDrawer key={openRow.id} p={openRow} scope={mine} now={now} tz={tz} profile={profile} isAdmin={false}
          onClose={close} onOpenCall={id => setParams({ open: id }, { replace: true })} />
      ) : !isLoading && !failed && (
        <PhoneSheet label="Call not found" head={<b style={{ fontSize: 17 }}>Call not found</b>} onClose={close}>
          <p className="ph-empty" style={{ textAlign: 'left', padding: '12px 0 8px' }}>This call isn't on your calendar any more.</p>
        </PhoneSheet>
      ))}
    </div>
  )
}
