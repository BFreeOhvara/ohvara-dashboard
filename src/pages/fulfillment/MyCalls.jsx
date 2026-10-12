import { useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Check, ChevronLeft, ChevronRight, CornerDownLeft } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { useFulfillmentQueue, assignUnassigned } from '../../hooks/usePolicies'
import { useCallOutcomes } from '../../hooks/useRepCallEvents'
import { ClientDrawer, OvSelect } from '../../components/agent/AgentUI'
import { CallDrawer, CallButton, CallStatus } from '../../components/fulfillment/CallDrawer'
import { ResultFixBar } from '../../components/fulfillment/ResultFixBar'
import { useResultFix } from '../../hooks/useResultFix'
import { useCallActions, useClientCall } from '../../hooks/useCallActions'
import { agentCallerIdOn, callHint, clientTimeText } from '../../lib/fulfillmentCall'
import { useCarriers } from '../../hooks/useCarriers'
import { bookingCarrier } from '../../lib/carriers'
import { isLive, useNow } from '../../lib/agentBookings'
import { addDaysStr } from '../../lib/scheduling'
import { slideOut } from '../../lib/daySlide'
import { DEFAULT_TIMEZONE, zonedDateStr } from '../../lib/timezones'
import {
  CALL_TONE, buildCalls, dayBounds, dayLong, dayShort, dayTally, dayWord, daysBetween, weekdayLong, hourOf, inLabel, relDay,
  timeParts, timeText, todayBadge, callDayOf,
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

function FocusCard({ c, now: pageNow, tz, profile, isAdmin, team, onOpen, onResult }) {
  const { p } = c
  const live = c.tone === 'live'
  const secNow = useNow(live ? 1e3 : 60e3)
  const now = live ? secNow : pageNow
  const { data: carriers } = useCarriers()
  const act = useCallActions(p)
  const mine = p.assigned_fulfillment_id === profile?.id
  const canWork = mine && p.fulfillment_stage !== 'Complete'
  const canBridge = agentCallerIdOn(p) && mine
  const call = useClientCall(p, { canBridge, onCall: canWork ? act.start : undefined })
  const carrier = bookingCarrier(carriers, p)
  const late = !live && c.ms <= now

  let ring
  let tag
  if (live) {
    const secs = Math.max(0, Math.floor((now - c.ms) / 1e3))
    ring = { big: `${Math.floor(secs / 60)}:${pad(secs % 60)}`, small: 'on the call', arc: Math.min(360, (secs / (45 * 60)) * 360) }
    tag = `ON A CALL · ${Math.floor(secs / 60)} MIN`
  } else if (late) {
    const mins = Math.max(0, Math.round((now - c.ms) / 6e4))
    ring = { big: mins >= 60 ? `${Math.floor(mins / 60)}:${pad(mins % 60)}` : String(mins), small: mins >= 60 ? 'hr · min late' : 'min late', arc: 360 }
    tag = 'TIME PASSED'
  } else {
    const mins = Math.max(0, Math.round((c.ms - now) / 6e4))
    ring = {
      big: mins >= 60 ? `${Math.floor(mins / 60)}:${pad(mins % 60)}` : String(mins),
      small: mins >= 60 ? 'hr · min' : 'min',
      arc: Math.max(0, Math.min(360, (1 - mins / 120) * 360)),
    }
    tag = `UP NEXT · ${inLabel(c.ms, now).toUpperCase()}`
  }
  const tone = live ? 'live' : late ? 'late' : c.tone === 'noAnswer' ? 'noAnswer' : 'booked'
  const t = CALL_TONE[tone === 'noAnswer' ? 'booked' : tone]
  const { time, period } = timeParts(c.at, tz)
  const theirs = clientTimeText(p, c.at, tz)
  const hint = callHint(p, canBridge)
  const stop = fn => e => { e.stopPropagation(); fn() }

  return (
    <div className={`mc-focus${live ? ' is-live' : ''}`} style={{ '--mc-c': t.fg, '--mc-t': t.tint, '--mc-e': t.edge }}
      onClick={() => onOpen(c)}>
      <span className="mc-focus-dot" />
      <div className="mc-focus-top">
        <span className="mc-ring" style={{ background: `conic-gradient(var(--mc-c) 0 ${ring.arc}deg, var(--ov-stub) ${ring.arc}deg 360deg)` }}>
          <span><b>{ring.big}</b><span>{ring.small}</span></span>
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span className="mc-tag">{tag}</span>
            {theirs && <span style={{ fontSize: 12.5, color: 'var(--ov-mute)' }}>{theirs}</span>}
          </div>
          <div className="mc-focus-when">
            <span className="mc-focus-time">{time}<span>{period}</span></span>
            <span className="mc-focus-name">{c.name}</span>
          </div>
          <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <span className="mc-chip mc-chip-amber">
              <b>Cancel with</b>{carrierOf(p)}{carrier?.service_phone && <> · <span style={{ fontFamily: 'var(--font-mono)' }}>{carrier.service_phone}</span></>}
            </span>
            <span className="mc-chip">From {team ? `${p.agent?.full_name || 'an agent'} · ${p.assigned?.full_name || 'Unassigned'}` : p.agent?.full_name || 'an agent'}</span>
            {c.tone === 'noAnswer' && <span className="mc-chip">No answer before · try {c.attempt}</span>}
          </div>
        </div>
      </div>
      {live ? (
        <div className="mc-focus-actions">
          {mine && (
            <button type="button" className="mc-btn mc-btn-ok" disabled={act.busy} onClick={stop(() => act.cancelled(undefined, { onSuccess: () => onResult(p, 'cancelled') }))}>
              <Check size={17} strokeWidth={2.6} /> Cancelled
            </button>
          )}
          {mine && <button type="button" className="mc-btn ov-ghost" disabled={act.busy} onClick={stop(() => act.noAnswer({ onSuccess: () => onResult(p, 'no_answer') }))}>No answer</button>}
          <button type="button" className="mc-btn mc-btn-quiet" onClick={stop(() => onOpen(c))}>Open details</button>
          <span className="mc-focus-note" style={{ color: 'var(--ov-live)' }}>{mine ? 'Hung up? Mark how it went.' : `${p.assigned?.full_name || 'The rep'} is on this call.`}</span>
        </div>
      ) : (
        <div className="mc-focus-actions">
          {canWork && p.client_phone && <CallButton p={p} call={call} className="mc-btn ov-solid mc-btn-call">Call client</CallButton>}
          <button type="button" className="mc-btn ov-ghost" onClick={stop(() => onOpen(c))}>Open details</button>
          <span className="mc-focus-note">
            {!canWork ? (isAdmin ? `${p.assigned?.full_name || 'The assigned rep'} calls this client.` : '')
              : Array.isArray(hint) ? <>{hint[0]}<br />{hint[1]}</> : hint}
          </span>
        </div>
      )}
      <CallStatus p={p} call={call} style={{ marginTop: 10 }} />
      {act.error && <p className="mc-callnote" style={{ color: 'var(--danger)', marginTop: 10 }}>Couldn't save — {act.error.message || 'try again'}.</p>}
    </div>
  )
}

// ── rows ────────────────────────────────────────────────────────────────────

// A retry's or past no answer's second line: "No answer at 11:45 AM · try 2".
function retrySub(c, tz) {
  const { p } = c
  return p.last_call_at && new Date(p.last_call_at).getTime() < c.ms
    ? `No answer at ${timeText(p.last_call_at, tz)} · try ${c.attempt}`
    : `No answer · try ${c.attempt}`
}

function CallRow({ c, tz, sub, subTone, tag, onOpen }) {
  const { time, period } = timeParts(c.at, tz)
  const dot = c.done ? CALL_TONE[c.tone].fg : c.late ? CALL_TONE.late.fg : c.tone === 'noAnswer' ? CALL_TONE.noAnswer.fg : CALL_TONE.booked.fg
  return (
    <button type="button" className="mc-row" onClick={() => onOpen(c)}>
      <span className="mc-row-dot" style={{ background: dot }} />
      <span className="mc-row-time">{time}<span>{period}</span></span>
      <span className="mc-row-who">
        <span className="nm">{tag && <span className="mc-first">{tag}</span>}{c.name}</span>
        <span className="ln" style={subTone ? { color: subTone } : undefined}>{sub}</span>
      </span>
      <span className="mc-row-carrier">{carrierOf(c.p)}</span>
      <ChevronRight size={15} strokeWidth={2.3} className="mc-chev" />
    </button>
  )
}

// ── page ────────────────────────────────────────────────────────────────────

export default function MyCalls() {
  const { profile } = useAuth()
  const isAdmin = profile?.role === 'admin'
  const qc = useQueryClient()
  const { data: queue = [], isLoading } = useFulfillmentQueue()
  const now = useNow(30e3)
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
  const { data: events = [], isLoading: eventsLoading } = useCallOutcomes(iso(startMs), iso(endMs), { enabled: started, live: anyLive })
  const calls = useMemo(
    () => buildCalls(scope, now, tz, { from: day, to: day, events: started ? events : null }),
    [scope, now, tz, day, started, events],
  )
  const busy = isLoading || !profile || (started && eventsLoading)
  const t = dayTally(calls)

  const done = calls.filter(c => c.done && c.tone !== 'live')
  const liveCall = isToday ? calls.find(c => c.tone === 'live') || null : null
  const upcoming = calls.filter(c => !c.done)
  const focus = isToday ? (liveCall || upcoming[0] || null) : null
  const later = isToday ? (liveCall ? upcoming : upcoming.slice(1)) : []
  const nextKey = isToday ? (liveCall ? upcoming.find(c => !c.late)?.key : focus?.key) : null

  // The next day after this one with calls on it (the footer line).
  const nextDay = useMemo(() => {
    const list = buildCalls(scope, now, tz, { from: addDaysStr(day, 1), to: addDaysStr(day, 120) })
    if (!list.length) return null
    const d = list[0].date
    const on = list.filter(c => c.date === d)
    return { date: d, n: on.length, first: on[0] }
  }, [scope, now, tz, day])

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
  const dayLine = busy ? 'Loading the day…'
    : !t.total ? 'No calls'
      : isToday ? (liveCall ? `${plural(t.total, 'call')} · ${t.done} done · on the ${timeParts(liveCall.at, tz).time} now` : `${plural(t.total, 'call')} · ${t.done} done · ${t.toGo + t.live} to go`)
        : ahead ? `${plural(t.total, 'call')} booked`
          : [plural(t.total, 'call'), `${t.cancelled} cancelled`, `${t.noAnswer} no answer`, t.late && `${t.late} not called`].filter(Boolean).join(' · ')
  const toGo = t.toGo + t.live
  const deg = n => (t.total ? (n / t.total) * 360 : 0)
  const ringStops = { cx: deg(t.cancelled), na: deg(t.cancelled + t.noAnswer) }
  const rel = relDay(day, todayStr)

  const subFor = c => {
    const who = team ? `${c.p.assigned?.full_name || 'Unassigned'} · ` : ''
    if (c.done) {
      if (c.tone === 'cancelled') return { sub: `${who}Cancelled`, tone: CALL_TONE.cancelled.fg }
      return { sub: `${who}No answer${c.attempt > 1 ? ` · try ${c.attempt}` : ''}`, tone: CALL_TONE.noAnswer.fg }
    }
    if (c.tone === 'noAnswer') return { sub: `${who}${retrySub(c, tz)}`, tone: CALL_TONE.noAnswer.fg }
    if (c.late) return { sub: `${who}${past ? 'Not called' : 'Time passed'} · From ${c.p.agent?.full_name || 'an agent'}`, tone: CALL_TONE.late.fg }
    return { sub: `${who}From ${c.p.agent?.full_name || 'an agent'}` }
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
  const nextLine = nextDay && (
    <button type="button" className="mc-then" onClick={() => goDay(nextDay.date)}>
      <span className="mc-then-dot" />
      Then {dayWord(nextDay.date, todayStr)}: {plural(nextDay.n, 'call')}, first at {timeText(nextDay.first.at, tz)}
      <b> · See {seeDay(nextDay.date)}</b>
    </button>
  )

  let timeline
  if (busy) {
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
          {focus && <FocusCard c={focus} now={now} tz={tz} profile={profile} isAdmin={isAdmin} team={team} onOpen={openCall} onResult={fix.show} />}
          {later.length > 0 && <div className="mc-label" style={{ margin: '18px 0 6px' }}>Later today · {later.length}</div>}
          {later.map((c, i) => {
            const s = subFor(c)
            const isNext = liveCall && i === 0 && !c.late
            return <CallRow key={c.key} c={c} tz={tz} onOpen={openCall}
              sub={isNext ? `Next · ${s.sub.replace(/^From/, 'from')}` : s.sub} subTone={isNext ? 'var(--ov-data-a)' : s.tone} />
          })}
          {!focus && !later.length && <p className="mc-quiet">That's everything for today.</p>}
          {nextLine}
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
          {nextLine}
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

      <div className="ov-slide-frame">
        <section key={day} data-day-slide="" className={`ov-card mc-day ${slideClass}`} aria-label={`${dayLong(day)} calls`}>
          <div className="mc-day-head">
            <div style={{ flex: 1, minWidth: 0 }}>
              <h2>{isAdmin ? 'The day' : 'Your day'}</h2>
              <div className="mc-day-line">{dayLine}</div>
            </div>
            <div className="mc-legend">
              <span><i style={{ background: CALL_TONE.cancelled.fg }} />Cancelled <b>{t.cancelled}</b></span>
              <span><i style={{ background: CALL_TONE.noAnswer.fg }} />No answer <b>{t.noAnswer}</b></span>
              <span><i style={{ background: CALL_TONE.booked.fg }} />{past ? 'Not called' : 'To go'} <b>{toGo}</b></span>
            </div>
            <span className="mc-mini" style={{
              background: `conic-gradient(${CALL_TONE.cancelled.fg} 0 ${ringStops.cx}deg, ${CALL_TONE.noAnswer.fg} ${ringStops.cx}deg ${ringStops.na}deg, color-mix(in srgb, var(--ov-st-booked) 22%, transparent) ${ringStops.na}deg 360deg)`,
            }}>
              <span>{t.done}/{t.total}</span>
            </span>
          </div>
          {timeline}
        </section>
      </div>

      {openId && (openRow ? (
        <CallDrawer
          key={openRow.id} p={openRow} scope={isAdmin ? queue : scope}
          now={now} tz={tz} profile={profile} isAdmin={isAdmin}
          onClose={closeCall} onOpenCall={openOther} fix={fix}
        />
      ) : !isLoading && (
        <ClientDrawer name="Call not found" meta={`This call isn't on ${isAdmin ? 'the' : 'your'} calendar any more.`} onClose={closeCall} />
      ))}
      {!openRow && <ResultFixBar ctl={fix} />}
    </div>
  )
}
