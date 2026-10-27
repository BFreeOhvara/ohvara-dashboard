import { useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Check, ChevronLeft, ChevronRight, CornerDownLeft } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { useFulfillmentQueue, assignUnassigned } from '../../hooks/usePolicies'
import { useCallOutcomes } from '../../hooks/useRepCallEvents'
import { ClientDrawer, OvSelect, LoadError } from '../../components/agent/AgentUI'
import { CallDrawer, CallButton, CallStatus } from '../../components/fulfillment/CallDrawer'
import { ResultFixBar } from '../../components/fulfillment/ResultFixBar'
import { CancelNumber } from '../../components/fulfillment/CancelNumber'
import { PhoneToday } from '../../components/fulfillment/phone/PhoneToday'
import VaDesk from '../../components/fulfillment/VaDesk'
import { usePhoneLayout } from '../../hooks/usePhoneLayout'
import { useResultFix } from '../../hooks/useResultFix'
import { useCallActions, useCallLock, useClientCall } from '../../hooks/useCallActions'
import { agentCallerIdOn } from '../../lib/fulfillmentCall'
import { isLive, isMissedHold, MISSED_LABEL, useNow } from '../../lib/agentBookings'
import { addDaysStr } from '../../lib/scheduling'
import { slideOut } from '../../lib/daySlide'
import { DEFAULT_TIMEZONE, zonedDateStr } from '../../lib/timezones'
import {
  CALL_TONE, buildCalls, dayBounds, dayLong, dayShort, dayTally, dayWord, daysBetween, weekdayLong, hourOf, inLabel, relDay,
  timeParts, timeText, todayBadge, callDayOf, thisWeek, weekScore,
} from '../../lib/fulfillmentDay'

// Prompt 748 — "My calls": the rep's day, one day at a time (replaces P747's
// month calendar and the separate call page). A gradient day header (edge
// arrows, Today chip or Today button, the date, a count) with a day track (a
// pin per call on a 9 AM–7 PM bar, the next call's bubble, today's now
// needle); below it the "Your day" timeline (Done, Now, the focus card for the
// next call, Later today, the next day with calls). Every row opens the call
// in a drawer (components/fulfillment/CallDrawer.jsx).
// URL: ?day=YYYY-MM-DD is the day shown (none = today in the profile zone);
// ?open=<id> opens the drawer over that day, and an ?open= link with no ?day=
// shows the day of that call. Calls come from buildCalls (lib/fulfillmentDay.js),
// past outcomes from policy_events (one fetch per day). Admin sees every rep's
// calls, with a rep picker in the header.
// Prompt 756: full width (the Overview's container). Below the header, the
// timeline on the left and a 340px side column (Today's score, Booked this
// week + Cancel rate, Tomorrow); stacked under 1100px. The Up next card is
// time, name, "Cancel with" and the buttons; Call client unlocks 5 minutes
// before the call (useCallLock; the server's too_early backs it).
// Prompt 773 — on a rep's phone layout this route is Today (PhoneToday), so
// ?open=<id> links (notifications, the phone's result) open the call's sheet.

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`
const isTyping = el => el instanceof HTMLElement && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))
const carrierOf = p => p.current_carrier || p.carrier_name || 'Carrier not noted'
const iso = ms => new Date(ms).toISOString()

// ── the day track ───────────────────────────────────────────────────────────

// 9 AM to 7 PM, widened to the hour before the earliest call / after the latest.
function trackRange(calls, tz) {
  let start = 9
  let end = 19
  for (const c of calls) {
    const h = hourOf(c.at, tz)
    start = Math.min(start, Math.max(0, Math.ceil(h) - 1))
    end = Math.max(end, Math.min(24, Math.floor(h) + 1))
  }
  return { start, end }
}

const hourLabel = h => `${h % 12 || 12} ${h % 24 >= 12 ? 'PM' : 'AM'}`

function DayTrack({ calls, tz, now, isToday, ahead, focusKey, nextKey, liveCall }) {
  const { start, end } = trackRange(calls, tz)
  const pct = h => `${((Math.min(end, Math.max(start, h)) - start) / (end - start)) * 100}%`
  const hours = Array.from({ length: end - start + 1 }, (_, i) => start + i)
  const nowH = isToday ? hourOf(iso(now), tz) : null

  const lead = liveCall || (ahead ? calls[0] : calls.find(c => c.key === focusKey))
  let bubble = null
  if (liveCall) {
    bubble = { cls: 'is-live', text: `● On the ${timeParts(liveCall.at, tz).time} · ${Math.max(0, Math.floor((now - liveCall.ms) / 6e4))} min` }
  } else if (lead && ahead) {
    bubble = { cls: 'is-ahead', text: `First · ${timeParts(lead.at, tz).time} ${lead.name}` }
  } else if (lead && isToday) {
    bubble = { cls: '', text: `Next · ${timeParts(lead.at, tz).time} ${lead.name}` }
  }

  // The bubble sits over its pin, kept inside the bar.
  const trackRef = useRef(null)
  const bubbleRef = useRef(null)
  const [bx, setBx] = useState(null)
  const leadH = lead ? hourOf(lead.at, tz) : null
  useLayoutEffect(() => {
    const tr = trackRef.current
    const b = bubbleRef.current
    if (!tr || !b || leadH == null) return
    const w = tr.offsetWidth
    const x = ((Math.min(end, Math.max(start, leadH)) - start) / (end - start)) * w
    setBx(Math.round(Math.min(Math.max(0, x - b.offsetWidth / 2), Math.max(0, w - b.offsetWidth))))
    // Phones scroll the track sideways: bring the lead call into view.
    const frame = tr.parentElement?.parentElement
    if (frame && frame.scrollWidth > frame.clientWidth) frame.scrollLeft = Math.max(0, x - frame.clientWidth / 2)
  }, [leadH, start, end, bubble?.text])

  return (
    <div ref={trackRef} className="mc-track" aria-hidden="true">
      {hours.map(h => {
        const labelled = (h - start) % 2 === 0
        return (
          <span key={h}>
            <span className="mc-tick" style={{ left: pct(h), height: labelled ? 6 : 10 }} />
            {labelled && <span className="mc-hour" style={{ left: pct(h) }}>{hourLabel(h)}</span>}
          </span>
        )
      })}
      <span className="mc-bar" />
      {nowH != null && <span className="mc-fill" style={{ width: pct(nowH) }} />}
      {calls.map(c => {
        const kind = c.tone === 'live' ? 'live'
          : c.done ? (c.tone === 'cancelled' ? 'cx' : 'na')
            : c.key === nextKey ? 'next' : c.late ? 'late' : 'bk'
        return (
          <span key={c.key} className={`mc-pin is-${kind}`} style={{ left: pct(hourOf(c.at, tz)) }}>
            {kind === 'cx' && <Check size={10} strokeWidth={4} />}
          </span>
        )
      })}
      {nowH != null && <span className="mc-needle" style={{ left: pct(nowH) }} />}
      {bubble && (
        <span ref={bubbleRef} className={`mc-bubble ${bubble.cls}`} style={{ left: bx ?? 0, visibility: bx == null ? 'hidden' : undefined }}>
          {bubble.text}
        </span>
      )}
    </div>
  )
}

// ── the focus card ──────────────────────────────────────────────────────────

const pad = n => String(n).padStart(2, '0')
const lateLabel = mins => (mins >= 60 ? `${Math.floor(mins / 60)} hr ${mins % 60 ? `${mins % 60} min ` : ''}late` : `${mins} min late`)

function FocusCard({ c, now: pageNow, tz, profile, isAdmin, onOpen, onResult }) {
  const { p } = c
  const live = c.tone === 'live'
  const secNow = useNow(live ? 1e3 : 60e3)
  const now = live ? secNow : pageNow
  const act = useCallActions(p)
  const [askNumber, setAskNumber] = useState(false) // P784
  const mine = p.assigned_fulfillment_id === profile?.id
  const canWork = mine && p.fulfillment_stage !== 'Complete'
  const canBridge = agentCallerIdOn(p) && mine
  const call = useClientCall(p, { canBridge, onCall: canWork ? act.start : undefined })
  const lock = useCallLock(canWork ? p : null)
  const late = !live && c.ms <= now

  let tag
  let when
  if (live) {
    const secs = Math.max(0, Math.floor((now - c.ms) / 1e3))
    tag = 'ON A CALL'
    when = `${Math.floor(secs / 60)}:${pad(secs % 60)}`
  } else if (late) {
    tag = 'TIME PASSED'
    when = lateLabel(Math.max(0, Math.round((now - c.ms) / 6e4)))
  } else {
    tag = 'UP NEXT'
    when = inLabel(c.ms, now)
  }
  const t = CALL_TONE[live ? 'live' : late ? 'late' : 'booked']
  const { time, period } = timeParts(c.at, tz)
  const stop = fn => e => { e.stopPropagation(); fn() }

  return (
    <div className={`mc-focus${live ? ' is-live' : ''}`} style={{ '--mc-c': t.fg, '--mc-t': t.tint, '--mc-e': t.edge }}
      onClick={() => onOpen(c)}>
      <span className="mc-focus-dot" />
      <div className="mc-focus-head">
        <span className="mc-tag">{tag}</span>
        <span className="mc-focus-in">{when}</span>
      </div>
      <div className="mc-focus-when">
        <span className="mc-focus-time">{time}<span>{period}</span></span>
        <span className="mc-focus-name">{c.name}</span>
      </div>
      <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {isMissedHold(p) && <span className="mc-chip mc-chip-pri"><b>Priority</b>{MISSED_LABEL}</span>}
        <span className="mc-chip"><b>Cancel with</b>{carrierOf(p)}</span>
      </div>
      {live ? (
        <div className="mc-focus-actions">
          {mine && askNumber && (
            <CancelNumber carrier={carrierOf(p)} busy={act.busy}
              onSave={num => act.cancelled(undefined, { onSuccess: () => onResult(p, 'cancelled') }, num)} onBack={() => setAskNumber(false)} />
          )}
          {mine && !askNumber && (
            <button type="button" className="mc-btn mc-btn-ok" disabled={act.busy}
              onClick={stop(() => (act.needsNumber ? setAskNumber(true) : act.cancelled(undefined, { onSuccess: () => onResult(p, 'cancelled') })))}>
              <Check size={17} strokeWidth={2.6} /> Cancelled
            </button>
          )}
          {mine && <button type="button" className="mc-btn ov-ghost" disabled={act.busy} onClick={stop(() => act.noAnswer({ onSuccess: () => onResult(p, 'no_answer') }))}>No answer</button>}
          <button type="button" className="mc-btn mc-btn-quiet" onClick={stop(() => onOpen(c))}>Open details</button>
          <span className="mc-focus-note" style={{ color: 'var(--mc-hung)' }}>{mine ? 'Hung up? Mark how it went.' : `${p.assigned?.full_name || 'The rep'} is on this call.`}</span>
        </div>
      ) : (
        <div className="mc-focus-actions">
          {canWork && p.client_phone && <CallButton p={p} call={call} className="mc-btn ov-solid mc-btn-call">Call client</CallButton>}
          <button type="button" className="mc-btn ov-ghost" onClick={stop(() => onOpen(c))}>Open details</button>
          <span className="mc-focus-note">
            {canWork ? (lock.locked && p.client_phone ? `Unlocks at ${lock.opens}` : '')
              : isAdmin ? `${p.assigned?.full_name || 'The assigned rep'} calls this client.` : ''}
          </span>
        </div>
      )}
      <CallStatus p={p} call={call} style={{ marginTop: 10 }} />
      {act.error && <p className="mc-callnote" style={{ color: 'var(--danger)', marginTop: 10 }}>Couldn't save — {act.error.message || 'try again'}.</p>}
    </div>
  )
}

// ── the side column ─────────────────────────────────────────────────────────

const pctText = n => `${Math.round(n * 100)}%`

function SideColumn({ title, t, past, week, next, onSee }) {
  const deg = n => (t.total ? (n / t.total) * 360 : 0)
  const cx = deg(t.cancelled)
  const na = deg(t.cancelled + t.noAnswer)
  const tally = [
    { l: 'Cancelled', n: t.cancelled, c: CALL_TONE.cancelled.fg },
    { l: 'No answer', n: t.noAnswer, c: CALL_TONE.noAnswer.fg },
    { l: past ? 'Not called' : 'To go', n: t.toGo + t.live, c: CALL_TONE.booked.fg },
  ]
  return (
    <aside className="mc-side">
      <section className="ov-card mc-side-card">
        <div className="mc-side-head"><h2>{title}</h2><span>{plural(t.total, 'call')}</span></div>
        <div className="mc-score">
          <span className="mc-score-ring" style={{
            background: `conic-gradient(${CALL_TONE.cancelled.fg} 0 ${cx}deg, ${CALL_TONE.noAnswer.fg} ${cx}deg ${na}deg, color-mix(in srgb, var(--ov-st-booked) 22%, transparent) ${na}deg 360deg)`,
          }}>
            <span><b>{t.done}/{t.total}</b><span>finished</span></span>
          </span>
          <div className="mc-score-list">
            {tally.map(k => (
              <div key={k.l}><i style={{ background: k.c }} /><span>{k.l}</span><b>{k.n}</b></div>
            ))}
          </div>
        </div>
      </section>

      <div className="mc-side-tiles">
        <div className="ov-card mc-stat">
          <div>Booked this week</div>
          <b>{week ? week.booked : '–'}</b>
          <div>on your calendar</div>
        </div>
        <div className="ov-card mc-stat">
          <div>Cancel rate</div>
          <b style={week?.rate != null ? { color: CALL_TONE.cancelled.fg } : undefined}>{week?.rate != null ? pctText(week.rate) : '—'}</b>
          <div>this week</div>
        </div>
      </div>

      <section className="ov-card mc-side-card mc-side-next">
        <div className="mc-side-head">
          <h2>{next.title}</h2>
          <button type="button" className="mc-see" onClick={onSee}>See {next.see}</button>
        </div>
        {next.calls.length ? (
          <>
            <div className="mc-next-line">{plural(next.calls.length, 'call')} · starts at {timeText(next.calls[0].at, next.tz)}</div>
            <div className="mc-next-tl">
              {next.calls.map(c => {
                const { time, period } = timeParts(c.at, next.tz)
                return (
                  <div key={c.key} className="mc-next-row">
                    <span className="mc-next-dot" style={{ background: c.done ? CALL_TONE[c.tone].fg : c.tone === 'noAnswer' ? CALL_TONE.noAnswer.fg : CALL_TONE.booked.fg }} />
                    <span className="mc-next-time">{time} <span>{period}</span></span>
                    <span className="mc-next-name">{c.name}</span>
                    <span className="mc-next-carrier">{carrierOf(c.p)}</span>
                  </div>
                )
              })}
            </div>
          </>
        ) : (
          <div className="mc-next-line">Nothing booked yet.</div>
        )}
      </section>
    </aside>
  )
}

// ── rows ────────────────────────────────────────────────────────────────────

// A No answer retry's second line: "Second try" / "Try 3".
const retrySub = c => (c.attempt === 2 ? 'Second try' : `Try ${c.attempt}`)

function CallRow({ c, tz, sub, subTone, tag, onOpen }) {
  const { time, period } = timeParts(c.at, tz)
  const dot = c.done ? CALL_TONE[c.tone].fg : c.late ? CALL_TONE.late.fg : c.tone === 'noAnswer' ? CALL_TONE.noAnswer.fg : CALL_TONE.booked.fg
  return (
    <button type="button" className="mc-row" onClick={() => onOpen(c)}>
      <span className="mc-row-dot" style={{ background: dot }} />
      <span className="mc-row-time">{time}<span>{period}</span></span>
      <span className="mc-row-who">
        <span className="nm">
          {isMissedHold(c.p) && !c.done && <span className="mc-first mc-pri">Priority</span>}
          {tag && <span className="mc-first">{tag}</span>}{c.name}
        </span>
        {sub && <span className="ln" style={subTone ? { color: subTone } : undefined}>{sub}</span>}
      </span>
      <span className="mc-row-carrier">{carrierOf(c.p)}</span>
      <ChevronRight size={15} strokeWidth={2.3} className="mc-chev" />
    </button>
  )
}

// ── page ────────────────────────────────────────────────────────────────────

// Prompt 797 — a switch at the top: My calls (the day) or Qualify a call (the
// VA's inbound policy-help screen, /fulfillment/desk/qualify; ?mode=qualify
// still works).
export default function MyCalls({ qualifyRoute = false }) {
  const phone = usePhoneLayout()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const qualify = qualifyRoute || params.get('mode') === 'qualify'
  const setMode = m => navigate(m === 'qualify' ? '/fulfillment/desk/qualify' : '/fulfillment/desk', { replace: true })
  const opts = [{ value: 'calls', label: 'My calls' }, { value: 'qualify', label: 'Qualify a call' }]
  return (
    <>
      <div className="ov-range ov-book-switch" role="group" aria-label="Desk" style={{ marginBottom: 14 }}>
        {opts.map(o => {
          const on = (o.value === 'qualify') === qualify
          return (
            <button key={o.value} type="button" aria-pressed={on} className={on ? 'is-on' : ''}
              onClick={() => !on && setMode(o.value)} style={{ height: 40, padding: '0 18px', fontSize: 14.5 }}>
              {o.label}
            </button>
          )
        })}
      </div>
      {qualify ? <VaDesk /> : phone ? <PhoneToday /> : <DeskMyCalls />}
    </>
  )
}

function DeskMyCalls() {
  const { profile } = useAuth()
  const isAdmin = profile?.role === 'admin'
  const qc = useQueryClient()
  const queueQ = useFulfillmentQueue()
  const { data: queue = [], isLoading } = queueQ
  const now = useNow(15e3)
  const tz = profile?.timezone || DEFAULT_TIMEZONE
  const todayStr = zonedDateStr(now, tz)
  const [params, setParams] = useSearchParams()
  const openId = params.get('open')
  const dayParam = DAY_RE.test(params.get('day') || '') ? params.get('day') : null
  const [rep, setRep] = useState('all')
  const myId = profile?.id
  const rootRef = useRef(null)
  const [nav, setNav] = useState(null)
  const fix = useResultFix()

  // Anything booked while no rep was active has no one on it; place it now.
  useEffect(() => {
    if (!myId) return
    assignUnassigned()
      .then(n => { if (n > 0) qc.invalidateQueries({ queryKey: ['policies'] }) })
      .catch(() => {})
  }, [myId, qc])

  const team = isAdmin && rep === 'all'
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

  const openRow = openId ? queue.find(x => x.id === openId) : null
  const day = dayParam || (openRow ? callDayOf(openRow, now, tz) : todayStr)
  const isToday = day === todayStr
  const past = day < todayStr
  const ahead = day > todayStr

  // ── the day's calls ──
  const { startMs, endMs } = dayBounds(day, tz)
  const anyLive = scope.some(isLive)
  const started = startMs <= now
  const eventsQ = useCallOutcomes(iso(startMs), iso(endMs), { enabled: started, live: anyLive })
  const { data: events = [], isLoading: eventsLoading } = eventsQ
  // P779 — a failed load isn't "nothing on your calendar".
  const failed = (queueQ.isError && !queueQ.data) || (started && eventsQ.isError && !eventsQ.data)
  const calls = useMemo(
    () => buildCalls(scope, now, tz, { from: day, to: day, events: started ? events : null }),
    [scope, now, tz, day, started, events],
  )
  const busy = isLoading || !profile || (started && eventsLoading) || failed
  const t = dayTally(calls)

  const done = calls.filter(c => c.done && c.tone !== 'live')
  const liveCall = isToday ? calls.find(c => c.tone === 'live') || null : null
  const upcoming = calls.filter(c => !c.done)
  const focus = isToday ? (liveCall || upcoming[0] || null) : null
  const later = isToday ? (liveCall ? upcoming : upcoming.slice(1)) : []
  const nextKey = isToday ? (liveCall ? upcoming.find(c => !c.late)?.key : focus?.key) : null

  // The next day after this one with calls on it (the empty day's link).
  const nextDay = useMemo(() => {
    const list = buildCalls(scope, now, tz, { from: addDaysStr(day, 1), to: addDaysStr(day, 120) })
    return list.length ? { date: list[0].date } : null
  }, [scope, now, tz, day])

  // ── the side column: this Mon–Sun (with its outcomes) and the day after ──
  const wk = thisWeek(now, tz)
  const { data: weekEvents, isLoading: weekLoading } = useCallOutcomes(iso(wk.startMs), iso(wk.endMs), { live: anyLive })
  const week = useMemo(() => (weekLoading || !weekEvents ? null : weekScore(scope, now, tz, weekEvents)), [scope, now, tz, weekEvents, weekLoading])
  const after = addDaysStr(day, 1)
  const afterCalls = useMemo(() => buildCalls(scope, now, tz, { from: after, to: after }), [scope, now, tz, after])

  // ── moving between days ──
  const setUrl = (next, replace = true) => setParams(next, { replace })
  const goDay = target => {
    if (target === day) return
    const d = target > day ? 'next' : 'prev'
    slideOut(rootRef.current, d)
    setNav({ day: target, dir: d })
    setUrl(target === todayStr ? {} : { day: target })
  }
  const onArrowKey = useEffectEvent(e => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    if (openId || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey || isTyping(e.target) || e.target.closest?.('[role="dialog"], [role="listbox"]')) return
    e.preventDefault()
    goDay(addDaysStr(day, e.key === 'ArrowLeft' ? -1 : 1))
  })
  useEffect(() => {
    const onKey = e => onArrowKey(e)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  const slideClass = nav?.day === day ? (nav.dir === 'next' ? 'ov-slide-from-right' : 'ov-slide-from-left') : ''

  // ── the drawer ──
  const dayParams = d => (d === todayStr ? {} : { day: d })
  const openCall = c => setUrl({ ...dayParams(day), open: c.id }, false)
  const openOther = (id, d) => { setNav(null); setUrl({ ...dayParams(d), open: id }) }
  const closeCall = () => setUrl(dayParams(day))

  // ── header copy ──
  const firstAt = upcoming[0] || calls[0]
  const count = busy ? null
    : isToday ? { n: t.toGo, word: 'to go', line: liveCall ? `${plural(t.total, 'call')} · ${t.done} done · on a call` : `${plural(t.total, 'call')} today · ${t.done} done` }
      : ahead ? { n: t.total, word: 'booked', line: firstAt ? `first at ${timeText(firstAt.at, tz)}` : 'nothing yet' }
        : { n: t.total, word: t.total === 1 ? 'call' : 'calls', line: `${t.cancelled} cancelled · ${t.noAnswer} no answer` }
  const dayLine = failed ? 'Couldn’t load the day' : busy ? 'Loading the day…'
    : !t.total ? 'No calls'
      : isToday ? (liveCall ? `${plural(t.total, 'call')} · ${t.done} done · on the ${timeParts(liveCall.at, tz).time} now` : `${plural(t.total, 'call')} · ${t.done} done · ${t.toGo + t.live} to go`)
        : ahead ? `${plural(t.total, 'call')} booked`
          : [plural(t.total, 'call'), `${t.cancelled} cancelled`, `${t.noAnswer} no answer`, t.late && `${t.late} not called`].filter(Boolean).join(' · ')
  const rel = relDay(day, todayStr)

  // P756: a row's second line only when it adds something (no "From <agent>").
  const subFor = c => {
    const who = team ? c.p.assigned?.full_name || 'Unassigned' : ''
    const line = (text, tone) => ({ sub: [who, text].filter(Boolean).join(' · '), tone })
    if (c.done) {
      if (c.tone === 'cancelled') return line('Cancelled', CALL_TONE.cancelled.fg)
      return line(`No answer${c.attempt > 1 ? ` · try ${c.attempt}` : ''}`, CALL_TONE.noAnswer.fg)
    }
    // Prompt 771 — a retry held after a missed call.
    if (isMissedHold(c.p) && !c.late) return line(MISSED_LABEL, 'var(--ov-st-needs)')
    if (c.tone === 'noAnswer') return line(retrySub(c), CALL_TONE.noAnswer.fg)
    if (c.late) return line(past ? 'Not called' : 'Time passed', CALL_TONE.late.fg)
    return line('')
  }
  // A done no answer's result: "No answer · again at 5:30 PM" while a retry waits.
  const doneResult = c => {
    if (c.tone === 'cancelled') return 'Cancelled'
    const p = c.p
    const retry = !isLive(p) && p.fulfillment_stage !== 'Complete' && p.last_call_outcome === 'no_answer'
      && p.scheduled_call_at && new Date(p.scheduled_call_at).getTime() > c.ms
    if (!retry) return 'No answer'
    const d = zonedDateStr(new Date(p.scheduled_call_at).getTime(), tz)
    return `No answer · again ${d === c.date ? 'at ' : `${dayWord(d, todayStr)} `}${timeText(p.scheduled_call_at, tz)}`
  }

  // "Sunday" within the week ahead, "Tue, Oct 20" further out.
  const seeDay = d => {
    const n = daysBetween(todayStr, d)
    return n === 0 ? 'today' : n > 0 && n < 7 ? weekdayLong(d) : dayShort(d)
  }
  const afterWord = dayWord(after, todayStr)
  const afterN = daysBetween(todayStr, after)
  const next = {
    title: afterN >= 7 || afterN < -1 ? dayShort(after) : afterWord[0].toUpperCase() + afterWord.slice(1),
    see: seeDay(after), calls: afterCalls, tz,
  }

  let timeline
  if (failed) {
    timeline = <LoadError what={isAdmin ? 'the calls' : 'your calls'} onRetry={() => { queueQ.refetch(); eventsQ.refetch() }} style={{ margin: '4px 0' }} />
  } else if (busy) {
    timeline = <div className="mc-empty">Loading the day…</div>
  } else if (!calls.length) {
    timeline = (
      <div className="mc-empty">
        Nothing on {isAdmin ? 'the' : 'your'} calendar {isToday ? 'today' : 'this day'}.
        {nextDay && (
          <button type="button" className="mc-link" style={{ marginTop: 10 }} onClick={() => goDay(nextDay.date)}>
            Next calls: {seeDay(nextDay.date)} <ChevronRight size={14} strokeWidth={2.4} />
          </button>
        )}
      </div>
    )
  } else if (isToday) {
    timeline = (
      <div className="mc-tl">
        {done.length > 0 && (
          <>
            <div className="mc-label">Done · {done.length}</div>
            {done.map(c => (
              <button key={c.key} type="button" className="mc-done" onClick={() => openCall(c)}>
                <span className="mc-done-dot" style={{ borderColor: CALL_TONE[c.tone].fg }} />
                <span className="mc-done-time">{timeText(c.at, tz)}</span>
                <span className="mc-done-name">{c.name} · {carrierOf(c.p)}{team ? ` · ${c.p.assigned?.full_name || 'Unassigned'}` : ''}</span>
                <span className="mc-done-res" style={{ color: CALL_TONE[c.tone].fg }}>{doneResult(c)}</span>
              </button>
            ))}
          </>
        )}
        <div className="mc-tl-rest">
          <div className="mc-now"><span className="mc-now-dot"><span /></span>Now · {timeText(now, tz)}<i /></div>
          {focus && <FocusCard c={focus} now={now} tz={tz} profile={profile} isAdmin={isAdmin} onOpen={openCall} onResult={fix.show} />}
          {later.length > 0 && <div className="mc-label" style={{ margin: '18px 0 6px' }}>Later today · {later.length}</div>}
          {later.map((c, i) => {
            const s = subFor(c)
            const isNext = liveCall && i === 0 && !c.late
            return <CallRow key={c.key} c={c} tz={tz} onOpen={openCall}
              sub={isNext ? ['Next', s.sub].filter(Boolean).join(' · ') : s.sub} subTone={isNext ? 'var(--ov-data-a)' : s.tone} />
          })}
          {!focus && !later.length && <p className="mc-quiet">That's everything for today.</p>}
        </div>
      </div>
    )
  } else {
    timeline = (
      <div className={`mc-tl${ahead ? ' is-ahead' : ''}`}>
        <div className={ahead ? 'mc-tl-rest' : undefined}>
          {calls.map((c, i) => {
            const s = c.done ? { sub: `${team ? `${c.p.assigned?.full_name || 'Unassigned'} · ` : ''}${doneResult(c)}`, tone: CALL_TONE[c.tone].fg } : subFor(c)
            return <CallRow key={c.key} c={c} tz={tz} onOpen={openCall} sub={s.sub} subTone={s.tone} tag={ahead && i === 0 ? 'First' : null} />
          })}
        </div>
      </div>
    )
  }

  return (
    <div ref={rootRef} className="mc-page">
      <section className="ov-hero mc-hero">
        <div className="mc-top">
          <button type="button" className="mc-arrow" aria-label="Previous day" onClick={() => goDay(addDaysStr(day, -1))}>
            <ChevronLeft size={20} strokeWidth={2.2} />
          </button>
          <div className="ov-slide-frame mc-top-frame">
            <div key={day} data-day-slide="" className={`mc-top-mid ${slideClass}`}>
              <div className="mc-date">
                {isToday ? (
                  <span className="ov-hero-chip"><span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--ov-hero-dot)' }} />Today</span>
                ) : (
                  <button type="button" className="mc-today" onClick={() => goDay(todayStr)}>
                    <CornerDownLeft size={15} strokeWidth={2.4} />Today<span>{todayBadge(todayStr)}</span>
                  </button>
                )}
                <h1>{dayLong(day)}</h1>
                {rel && <span className="mc-rel">{rel}</span>}
              </div>
              {isAdmin && (
                <div className="mc-rep">
                  <OvSelect value={rep} onChange={setRep} options={reps} aria-label="Whose calls" placement="down" />
                </div>
              )}
              <div className="mc-count">
                {count ? <><div>{count.n}<span>{count.word}</span></div><div>{count.line}</div></> : <div className="mc-count-load">Loading…</div>}
              </div>
            </div>
          </div>
          <button type="button" className="mc-arrow" aria-label="Next day" onClick={() => goDay(addDaysStr(day, 1))}>
            <ChevronRight size={20} strokeWidth={2.2} />
          </button>
        </div>
        <div className="ov-slide-frame mc-track-frame">
          <div key={day} data-day-slide="" className={slideClass}>
            <DayTrack calls={busy ? [] : calls} tz={tz} now={now} isToday={isToday} ahead={ahead}
              focusKey={focus?.key} nextKey={nextKey} liveCall={liveCall} />
          </div>
        </div>
      </section>

      <div className="mc-cols">
        <div className="ov-slide-frame mc-main">
          <section key={day} data-day-slide="" className={`ov-card mc-day ${slideClass}`} aria-label={`${dayLong(day)} calls`}>
            <div className="mc-day-head">
              <div style={{ flex: 1, minWidth: 0 }}>
                <h2>{isAdmin ? 'The day' : 'Your day'}</h2>
                <div className="mc-day-line">{dayLine}</div>
              </div>
            </div>
            {timeline}
          </section>
        </div>
        <SideColumn
          title={isToday ? "Today's score" : `${weekdayLong(day)}'s score`} t={t} past={past}
          week={week} next={next} onSee={() => goDay(after)}
        />
      </div>

      {openId && (openRow ? (
        <CallDrawer
          key={openRow.id} p={openRow} scope={isAdmin ? queue : scope}
          now={now} tz={tz} profile={profile} isAdmin={isAdmin}
          onClose={closeCall} onOpenCall={openOther} fix={fix}
        />
      ) : !isLoading && !failed && (
        <ClientDrawer name="Call not found" meta={`This call isn't on ${isAdmin ? 'the' : 'your'} calendar any more.`} onClose={closeCall} />
      ))}
      {!openRow && <ResultFixBar ctl={fix} />}
    </div>
  )
}
