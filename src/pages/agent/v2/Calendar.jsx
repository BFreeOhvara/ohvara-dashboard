import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowRight, CalendarClock, CalendarDays, CalendarPlus, ChevronLeft, ChevronRight, CircleAlert, Inbox, MessageSquare, Phone, X,
} from 'lucide-react'
import { useAuth } from '../../../hooks/useAuth'
import { useInbounds, useInboundEvents } from '../../../hooks/useInbounds'
import { useAgentBookings } from '../../../hooks/useAgentBookings'
import { PortalV2Layout, Ico, Skel } from '../../../components/agent/PortalV2Nav'
import {
  leadName, appointmentAt, timeText, dayKey, telHref, clockParts, dayLabel, phoneDisplay, stateName, stageOf as inboundStage,
} from '../../../lib/inbounds'
import { fullName } from '../../../lib/policyFormat'
import { placeOf, useNow, isLive, stageOf as bookingStage } from '../../../lib/agentBookings'
import { DEFAULT_TIMEZONE, zonedDateStr, inferTimezoneFromState, timezoneLabel } from '../../../lib/timezones'
import './calendarExtra.css'

// Calendar (/agent/calendar, v2 portal only): every appointment, whoever booked it. Two sources:
// inbound appointments (the booked step in inbound_events, as Today reads it) and the agent's
// cancellation calls (policies.scheduled_call_at, read through useAgentBookings like Clients).
// Desktop: Week (default) or Day (opened from a day header), a side panel for the picked appointment, and
// a rail with the week's tally and what is next. Phones: an agenda grouped by day, each row a link to the
// inbound or the client. Nothing here writes: the panel only links out (tel:, sms:, the inbound, the
// client, Book a call's change mode). Reads migration 180 (agent_inbounds, inbound_events).
// Mockup: ohvara/mockups/update-the-existing-calendar-page-filled.html.
//
// Dev only: /agent/calendar?sample=1 swaps in made-up data from src/lib/calendarSample.js (&empty=1 for an
// empty calendar, &fail=1 for the error card). The import sits inside an import.meta.env.DEV branch, so a
// production build has neither the file nor the flags, and the query cache never sees the sample.

// ── Tones: status colours from the --ov-st-* vars, teal for a call happening now ─────────────────────
const KIND = {
  i: { icon: Inbox, word: 'Inbound', label: 'Inbound appointment', open: 'Open inbound' },
  c: { icon: Phone, word: 'Booked call', label: 'Cancellation call', open: 'Open booking' },
}
const KEYS = [
  { tone: 'up', label: 'Booked' },
  { tone: 'live', label: 'Live now' },
  { tone: 'done', label: 'Cancelled or sold' },
  { tone: 'na', label: 'No answer or not sold' },
]

// ── Day strings (YYYY-MM-DD in the agent's zone) ─────────────────────────────
const noon = d => new Date(`${d}T12:00:00Z`)
const addDays = (d, n) => { const x = noon(d); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10) }
const mondayOf = d => addDays(d, -((noon(d).getUTCDay() + 6) % 7))
const dayFmt = (d, opts) => noon(d).toLocaleDateString('en-US', { timeZone: 'UTC', ...opts })
const minsOf = (iso, tz) => {
  const [h, m] = new Date(iso).toLocaleTimeString('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).split(':').map(Number)
  return (h % 24) * 60 + m
}
function rangeLabel(from, to) {
  const a = dayFmt(from, { month: 'short', day: 'numeric' })
  const sameMonth = from.slice(0, 7) === to.slice(0, 7)
  return `${a} – ${sameMonth ? dayFmt(to, { day: 'numeric' }) : dayFmt(to, { month: 'short', day: 'numeric' })}`
}
const hourLabel = h => `${h % 12 || 12} ${h < 12 || h === 24 ? 'AM' : 'PM'}`
const dur = m => (m < 1 ? 'under a minute' : m < 60 ? `${m} min` : m < 1440 ? `${Math.floor(m / 60)} hr${m % 60 ? ` ${m % 60} min` : ''}` : `${Math.round(m / 1440)} day${Math.round(m / 1440) === 1 ? '' : 's'}`)

// ── Dev-only sample switches (always null in a production build) ─────────────
function sampleFlags() {
  if (!import.meta.env.DEV) return null
  const q = new URLSearchParams(window.location.search)
  return q.get('sample') === '1' ? { empty: q.get('empty') === '1', fail: q.get('fail') === '1' } : null
}

// ── Data ─────────────────────────────────────────────────────────────────────
// One appointment, from either source. tone: up (blue), done (green), na (grey), live (teal).
function inboundItem(l, at, tz, nowMs) {
  const st = inboundStage(l)
  const past = new Date(at).getTime() < nowMs
  const stage = l.inbound_stage
  let tone = 'up', label = st.label, short = null, pill = st.pill, mark = false
  if (stage === 'sold') tone = 'done'
  else if (stage === 'follow_up') tone = 'na'
  else if (stage === 'lost') { tone = 'na'; label = l.outcome === 'not_interested' ? 'Not interested' : 'Lost' }
  else if ((stage === 'booked' || stage === 'met') && past) { mark = true; label = 'Mark the outcome'; short = 'Mark outcome'; pill = 'booked' }
  return {
    id: `i-${l.lead_id}`, kind: 'i', at, ms: new Date(at).getTime(), name: leadName(l), tone, pill, label, short, mark, live: false, since: null,
    phone: l.phone, state: stateName(l.state) || null, place: null,
    clientTz: l.state ? inferTimezoneFromState(l.state) : null,
    open: `/agent/leads/${l.lead_id}`, change: null, day: dayKey(at, tz),
  }
}

function bookingItem(p, tz, nowMs) {
  const stage = bookingStage(p)
  const live = isLive(p)
  const ms = new Date(p.scheduled_call_at).getTime()
  let tone = 'up', pill = 'booked', label = 'Booked'
  if (live) { tone = 'live'; pill = 'contacting'; label = 'On a call' }
  else if (stage === 'cancelled') { tone = 'done'; pill = 'sold'; label = 'Cancelled' }
  else if (stage === 'noAnswer') { tone = 'na'; pill = 'new'; label = 'No answer' }
  const place = placeOf(p)
  // Reschedule only where a flow already exists: Book a call's change mode, for a call that hasn't been worked or is a no answer.
  const canChange = !live && p.fulfillment_stage !== 'Complete' && (stage === 'noAnswer' || ms >= nowMs)
  return {
    id: `p-${p.id}`, kind: 'c', at: p.scheduled_call_at, ms, name: fullName(p), tone, pill, label, short: null, mark: false, live, since: live ? p.call_live_since : null,
    phone: p.client_phone, state: p.client_city ? place : stateName(p.state) || null, place: place || null,
    clientTz: p.client_timezone || (p.state ? inferTimezoneFromState(p.state) : null),
    open: `/agent/clients?open=${p.id}`, change: canChange ? `/agent/book?change=${p.id}` : null, day: dayKey(p.scheduled_call_at, tz),
  }
}

function useAppointments(tz, nowMs) {
  const { profile } = useAuth()
  const inb = useInbounds()
  const evs = useInboundEvents()
  const bk = useAgentBookings(profile?.id, { enabled: !!profile?.id })
  const flags = sampleFlags()
  const [fx, setFx] = useState(null)
  const [recovered, setRecovered] = useState(false)
  const sampleOn = !!flags
  const wantFx = sampleOn && !flags.empty
  useEffect(() => {
    if (import.meta.env.DEV && wantFx) {
      let live = true
      import('../../../lib/calendarSample').then(m => { if (live) setFx(m.sampleCalendar({ tz })) })
      return () => { live = false }
    }
    return undefined
  }, [wantFx, tz])

  // The fixture, when asked for, replaces what the hooks returned; the hooks and their keys are untouched.
  const src = sampleOn
    ? { inbounds: flags.empty ? [] : fx?.inbounds, events: flags.empty ? new Map() : fx?.events, bookings: flags.empty ? [] : fx?.bookings }
    : { inbounds: inb.data, events: evs.data, bookings: bk.data }

  const list = useMemo(() => {
    const out = []
    for (const l of src.inbounds || []) {
      const at = appointmentAt(src.events?.get(l.lead_id) || [])
      if (at) out.push(inboundItem(l, at, tz, nowMs))
    }
    for (const p of src.bookings || []) {
      if (p.scheduled_call_at) out.push(bookingItem(p, tz, nowMs))
    }
    return out.sort((a, b) => a.ms - b.ms)
  }, [src.inbounds, src.events, src.bookings, tz, nowMs])

  if (sampleOn) {
    return {
      list,
      loading: !flags.empty && !fx,
      error: flags.fail && !recovered,
      retry: () => setRecovered(true),
    }
  }
  return {
    list,
    loading: inb.isLoading || evs.isLoading || bk.isLoading,
    error: inb.isError || evs.isError || bk.isError,
    retry: () => { inb.refetch(); evs.refetch(); bk.refetch() },
  }
}

// ── Week layout: rows are half hours; a block is one hour tall, or stops where the next one starts ───
function layoutWeek(items, tz) {
  const mins = new Map(items.map(a => [a.id, minsOf(a.at, tz)]))
  const all = [...mins.values()]
  const start = Math.min(8, ...all.map(m => Math.floor(m / 60)))
  const end = Math.min(24, Math.max(19, ...all.map(m => Math.ceil((m + 60) / 60))))
  const rows = (end - start) * 2
  const rowOf = m => 2 + Math.floor((m - start * 60) / 30)
  const place = new Map()
  const byDay = new Map()
  for (const a of items) byDay.set(a.day, [...(byDay.get(a.day) || []), a])
  for (const list of byDay.values()) {
    const slots = new Map()
    for (const a of list) {
      const r = rowOf(mins.get(a.id))
      slots.set(r, [...(slots.get(r) || []), a])
    }
    const rs = [...slots.keys()].sort((x, y) => x - y)
    rs.forEach((r, ri) => {
      const next = rs[ri + 1]
      const span = Math.max(1, Math.min(next && next - r < 2 ? next - r : 2, rows + 2 - r))
      const group = slots.get(r)
      group.forEach((a, k) => place.set(a.id, { row: r, span, n: group.length, k }))
    })
  }
  return { start, end, rows, rowOf, place, mins }
}

// ── Pieces ───────────────────────────────────────────────────────────────────
function Key() {
  return (
    <div className="cal-key" aria-label="Key">
      {KEYS.map(k => <span key={k.tone} className={`cal-t-${k.tone}`}><i />{k.label}</span>)}
      <u className="kinds" />
      <span className="kinds"><Ico icon={Inbox} size={13} />Inbound</span>
      <span className="kinds"><Ico icon={Phone} size={13} />Booked call</span>
    </div>
  )
}

function LiveBadge() {
  return <span className="cal-live"><i />Live now</span>
}

function StagePill({ a }) {
  return a.live ? <LiveBadge /> : <span className={`pv-pill pv-p-${a.pill}`}>{a.label}</span>
}

function Bar({ view, label, isToday, showKey, onPrev, onNext, onToday, onView }) {
  const unit = view === 'day' ? 'day' : 'week'
  return (
    <div className="cal-bar pv-only-desk">
      <button type="button" className="ov-ghost sq" aria-label={`Previous ${unit}`} onClick={onPrev}><Ico icon={ChevronLeft} /></button>
      <button type="button" className="ov-ghost" onClick={onToday}>Today</button>
      <button type="button" className="ov-ghost sq" aria-label={`Next ${unit}`} onClick={onNext}><Ico icon={ChevronRight} /></button>
      <span className="cal-range">{label}{isToday && <span className="pv-pill pv-p-booked">Today</span>}</span>
      {showKey ? <Key /> : <span className="cal-gap" />}
      <div className="cal-seg" role="group" aria-label="View">
        {['week', 'day'].map(v => (
          <button key={v} type="button" className={view === v ? 'on' : undefined} aria-pressed={view === v} onClick={() => onView(v)}>{v === 'day' ? 'Day' : 'Week'}</button>
        ))}
      </div>
    </div>
  )
}

// The grid's frame, with or without appointments on it. `children` sits over it (empty and error messages).
function WeekGrid({ days, items, today, tz, nowMs, selId, onPick, onDay, children }) {
  const { start, end, rows, rowOf, place } = layoutWeek(items, tz)
  const nowMins = minsOf(new Date(nowMs).toISOString(), tz)
  const showNow = days.includes(today) && nowMins >= start * 60 && nowMins < end * 60
  const nowRow = rowOf(nowMins)
  const nowTop = `${((nowMins - start * 60) % 30) / 30 * 100}%`
  return (
    <section className="ov-card cal-week" aria-label={`Week of ${dayFmt(days[0], { month: 'short', day: 'numeric' })}`}>
      <div className="cal-wk" style={{ '--rows': rows, '--hrs': end - start }}>
        <div style={{ gridColumn: 1, gridRow: 1, borderBottom: '1px solid var(--ov-line)' }} />
        {days.map((d, i) => (
          <button key={d} type="button" className={`cal-wk-dh${d === today ? ' today' : ''}`} style={{ gridColumn: i + 2 }} onClick={() => onDay?.(d)}
            aria-label={`Open ${dayFmt(d, { weekday: 'long', month: 'short', day: 'numeric' })}`}>
            <span>{dayFmt(d, { weekday: 'short' })}</span><b>{Number(d.slice(8))}</b>
          </button>
        ))}
        {days.map((d, i) => <div key={d} className={`cal-wk-col${d === today ? ' today' : ''}`} style={{ gridColumn: i + 2 }} />)}
        {Array.from({ length: end - start }, (_, i) => (showNow && Math.abs(nowMins - (start + i) * 60) < 25
          ? null
          : <span key={i} className="cal-wk-hr" style={{ gridRow: 2 + i * 2 }}>{hourLabel(start + i)}</span>))}
        {items.map(a => {
          const { row, span, n, k } = place.get(a.id)
          const K = KIND[a.kind]
          const short = span === 1
          const lane = n > 1 ? { justifySelf: 'start', width: `calc((100% - 8px) / ${n})`, marginLeft: `calc(4px + (100% - 8px) * ${k / n})`, marginRight: 0 } : null
          const sel = selId === a.id
          const cls = `cal-ev cal-t-${a.tone}${a.ms < nowMs && !a.live ? ' past' : ''}${sel ? ' sel' : ''}${short ? ' short' : ''}`
          const style = { gridColumn: days.indexOf(a.day) + 2, gridRow: `${row} / span ${span}`, ...lane }
          if (short) {
            return (
              <button key={a.id} type="button" className={cls} style={style} aria-pressed={sel} onClick={() => onPick(a.id)} title={`${timeText(a.at, tz)}, ${a.name}`}>
                <span className="tm">{clockParts(a.at, tz)[0]}</span><span className="nm">{a.name}</span>
              </button>
            )
          }
          return (
            <button key={a.id} type="button" className={cls} style={style} aria-pressed={sel} onClick={() => onPick(a.id)}>
              <span className="ki"><Ico icon={K.icon} size={12} /></span>
              <span className="tm">{timeText(a.at, tz)}</span><span className="nm">{a.name}</span>
              <span className="ln">{a.live && <i />}{a.live ? 'Live now' : a.tone === 'up' && !a.mark ? K.word : a.short || a.label}</span>
            </button>
          )
        })}
        {showNow && (
          <>
            <div className="cal-wk-nowall" style={{ gridColumn: '2 / -1', gridRow: nowRow }}><i style={{ top: nowTop }} /></div>
            <div className="cal-wk-now" style={{ gridColumn: days.indexOf(today) + 2, gridRow: nowRow }}><i style={{ top: nowTop }} /></div>
            <div className="cal-wk-dot" style={{ gridColumn: days.indexOf(today) + 2, gridRow: nowRow }}><i style={{ top: nowTop }} /></div>
            <div className="cal-wk-nowl" style={{ gridRow: nowRow }}><em style={{ top: nowTop }}>{timeText(new Date(nowMs).toISOString(), tz)}</em></div>
          </>
        )}
      </div>
      {children}
    </section>
  )
}

function DayGrid({ day, items, today, tz, nowMs, selId, onPick, children }) {
  // The same 8 AM to 7 PM range as the week (wider for early or late appointments), a row per half hour.
  const mins = items.map(a => minsOf(a.at, tz))
  const start = Math.min(8, ...mins.map(m => Math.floor(m / 60)))
  const end = Math.min(24, Math.max(19, ...mins.map(m => Math.ceil((m + 60) / 60))))
  const rows = (end - start) * 2
  const slotOf = m => Math.floor((m - start * 60) / 30)
  const nowMins = minsOf(new Date(nowMs).toISOString(), tz)
  const showNow = day === today && nowMins >= start * 60 && nowMins < end * 60
  const bySlot = new Map()
  items.forEach((a, i) => bySlot.set(slotOf(mins[i]), [...(bySlot.get(slotOf(mins[i])) || []), a]))
  const cells = []
  const covered = new Set()
  for (let s = 0; s < rows; s++) {
    if (covered.has(s)) continue
    const here = bySlot.get(s)
    const label = (() => { const t = start * 60 + s * 30; const h = Math.floor(t / 60); return `${h % 12 || 12}:${String(t % 60).padStart(2, '0')} ${h < 12 || h === 24 ? 'AM' : 'PM'}` })()
    if (here) {
      // An appointment takes two rows, or one when the next half hour has another.
      const span = bySlot.has(s + 1) ? 1 : 2
      if (span === 2) covered.add(s + 1)
      cells.push(<span key={`t${s}`} className={`cal-dg-t on${s === 0 ? ' first' : ''}`} style={{ gridRow: `${s + 1} / span ${span}` }}>{label}</span>)
      here.forEach((a, k) => {
        const K = KIND[a.kind]
        const sel = selId === a.id
        cells.push(
          <button key={a.id} type="button" className={`cal-dv cal-t-${a.tone}${a.ms < nowMs && !a.live ? ' past' : ''}${sel ? ' sel' : ''}`} aria-pressed={sel}
            style={{ gridRow: `${s + 1} / span ${span}`, ...(here.length > 1 ? { justifySelf: 'start', width: `calc((100% - 6px) / ${here.length})`, marginLeft: `calc((100% - 6px) * ${k / here.length})` } : null) }}
            onClick={() => onPick(a.id)}>
            <div className="who"><b>{a.name}</b><span><Ico icon={K.icon} size={13} />{K.label}</span></div>
            <StagePill a={a} />
          </button>,
        )
      })
    } else {
      // A free half hour is one quiet row. Nothing books from here.
      cells.push(<span key={`t${s}`} className={`cal-dg-t${s === 0 ? ' first' : ''}`} style={{ gridRow: s + 1 }}>{label}</span>)
      cells.push(<span key={`o${s}`} className="cal-dg-o" style={{ gridRow: s + 1 }}>Open</span>)
    }
  }
  const nowRow = slotOf(nowMins) + 1
  const nowTop = `${((nowMins - start * 60) % 30) / 30 * 100}%`
  return (
    <section className="ov-card cal-day" aria-label={dayFmt(day, { weekday: 'long', month: 'short', day: 'numeric' })}>
      <div className="cal-dg" style={{ '--rows': rows }}>
        {cells}
        {showNow && (
          <>
            <div className="cal-dg-now" style={{ gridRow: nowRow }}><i style={{ top: nowTop }} /></div>
            <div className="cal-dg-nowl" style={{ gridRow: nowRow }}><em style={{ top: nowTop }}>{timeText(new Date(nowMs).toISOString(), tz)}</em></div>
          </>
        )}
      </div>
      {children}
    </section>
  )
}

function Tally({ items }) {
  const n = f => items.filter(f).length
  const rows = [
    ['up', 'Booked', n(a => a.tone === 'up' && !a.mark && !a.live)],
    ['live', 'Live now', n(a => a.live)],
    ['up', 'To mark the outcome', n(a => a.mark)],
    ['done', 'Cancelled or sold', n(a => a.tone === 'done')],
    ['na', 'No answer or not sold', n(a => a.tone === 'na')],
  ]
  return (
    <section className="ov-card cal-tally" aria-label="This week">
      <div className="cal-tally-top"><h3>This week</h3><b>{items.length}</b></div>
      {rows.map(([t, l, c]) => <div key={l} className={`cal-trow cal-t-${t}`}><i />{l}<b>{c}</b></div>)}
    </section>
  )
}

function NextUp({ upcoming, tz, nowMs, onPick, hint }) {
  return (
    <section className="ov-card cal-next">
      <h3>Next up</h3>
      {upcoming.length ? (
        <div className="cal-list">
          {upcoming.map(a => (
            <button key={a.id} type="button" className="cal-mini" onClick={() => onPick(a)}>
              <span className="t">{timeText(a.at, tz)}<small>{dayLabel(a.at, tz, nowMs)}</small></span>
              <b>{a.name}</b><Ico icon={KIND[a.kind].icon} size={14} />
            </button>
          ))}
        </div>
      ) : <p className="cal-nonext">Nothing else coming up.</p>}
      {hint && upcoming.length > 0 && <p className="cal-hint">Click any appointment to see the phone number, both time zones and what to do next.</p>}
    </section>
  )
}

function whenWords(a, nowMs) {
  if (a.live) return `On the call for ${dur(Math.max(0, Math.round((nowMs - new Date(a.since || a.at).getTime()) / 60000)))}`
  const m = Math.round((a.ms - nowMs) / 60000)
  return m >= 0 ? `in ${dur(m)}` : `${dur(-m)} ago`
}

function Panel({ a, tz, nowMs, today, onClose }) {
  const call = telHref(a.phone)
  const text = call ? call.replace(/^tel:/, 'sms:') : null
  const K = KIND[a.kind]
  const [h] = dayHeading(a.day, today)
  const when = `${h === 'Today' || h === 'Tomorrow' ? h : dayFmt(a.day, { weekday: 'short', month: 'short', day: 'numeric' })}, ${timeText(a.at, tz)}`
  const same = !a.clientTz || timezoneLabel(a.clientTz) === timezoneLabel(tz)
  return (
    <section className="ov-card cal-panel" aria-label="Selected appointment">
      <div className="cal-ptop">
        <span className="cal-kind"><Ico icon={K.icon} size={14} />{K.label}</span>
        {a.live && <LiveBadge />}
        <button type="button" className="cal-x" aria-label="Close" onClick={onClose}><Ico icon={X} size={16} /></button>
      </div>
      <div>
        <h2>{a.name}</h2>
        <p className="cal-when">{when}<small>{whenWords(a, nowMs)}</small></p>
      </div>
      <div className="cal-rows">
        <div className="cal-row">
          <span>Phone</span>
          {call ? <a className="v" href={call}>{phoneDisplay(a.phone)}</a> : <span className="v">No number on file</span>}
          {text && <a className="ov-ghost cal-mi" href={text}><Ico icon={MessageSquare} size={14} />Text</a>}
        </div>
        {a.state && <div className="cal-row"><span>State</span><span className="v">{a.state}</span></div>}
        <div className="cal-row"><span>Stage</span><span className="v"><StagePill a={a} /></span></div>
      </div>
      <div className="cal-zones">
        <div><span>Your time</span><b>{timeText(a.at, tz)}</b><small>{timezoneLabel(tz)}</small></div>
        {a.clientTz && <div><span>Their time</span><b>{timeText(a.at, a.clientTz)}</b><small>{same ? 'Same as yours' : timezoneLabel(a.clientTz)}</small></div>}
      </div>
      <div className="cal-acts">
        <Link className="ov-solid" to={a.open}>{K.open}<Ico icon={ArrowRight} size={16} /></Link>
        {(call || a.change) && (
          <div className={call && a.change ? 'two' : undefined}>
            {call && <a className="ov-ghost" href={call}><Ico icon={Phone} size={15} />Call</a>}
            {a.change && <Link className="ov-ghost" to={a.change}><Ico icon={CalendarClock} size={15} />Reschedule</Link>}
          </div>
        )}
      </div>
      {a.mark && <p className="cal-note">After you meet, mark the outcome on the inbound: Sold, Follow up or Not interested.</p>}
    </section>
  )
}

function dayHeading(d, today) {
  const n = Math.round((noon(d) - noon(today)) / 864e5)
  if (n === 0) return ['Today', dayFmt(d, { weekday: 'short', month: 'short', day: 'numeric' })]
  if (n === 1) return ['Tomorrow', dayFmt(d, { weekday: 'short', month: 'short', day: 'numeric' })]
  return [dayFmt(d, { weekday: 'long' }), dayFmt(d, { month: 'short', day: 'numeric' })]
}

// ── Messages: empty, error, loading ──────────────────────────────────────────
function EmptyMessage({ title, text, full, keys = true }) {
  return (
    <section className="ov-card pv-card pv-empty cal-msg">
      <span className="pv-tile"><Ico icon={CalendarDays} size={20} /></span>
      <h3>{title}</h3>
      <p className="pv-sub">{text}</p>
      {keys && (
        <div className="cal-keys">
          <div><Ico icon={Phone} size={16} /><span><b>Booked calls</b>Cancellation calls you book for your clients.</span></div>
          <div><Ico icon={Inbox} size={16} /><span><b>Inbounds</b>People our VA books at your first open time.</span></div>
        </div>
      )}
      <Link className="ov-solid cal-cta" to="/agent/book" style={full ? { width: '100%' } : undefined}><Ico icon={CalendarPlus} size={17} />Book a call</Link>
    </section>
  )
}

function FailMessage({ onRetry }) {
  return (
    <section className="ov-card pv-card pv-empty cal-msg" role="alert">
      <span className="pv-tile err"><Ico icon={CircleAlert} size={20} /></span>
      <h3>We couldn’t load your calendar</h3>
      <p className="pv-sub">Your appointments are safe. Check your connection and try again.</p>
      <button type="button" className="ov-ghost pv-btn" onClick={onRetry}>Try again</button>
    </section>
  )
}

function Loading({ days, today }) {
  const at = [[0, 10], [0, 15], [1, 9], [1, 14], [2, 11], [3, 13], [4, 9], [4, 12], [4, 16], [5, 10]]
  return (
    <div className="cal-main pv-only-desk" aria-busy="true" aria-label="Loading your calendar">
      <section className="ov-card cal-week">
        <div className="cal-wk">
          <div style={{ gridColumn: 1, gridRow: 1, borderBottom: '1px solid var(--ov-line)' }} />
          {days.map((d, i) => (
            <div key={d} className={`cal-wk-dh${d === today ? ' today' : ''}`} style={{ gridColumn: i + 2 }}>
              <span>{dayFmt(d, { weekday: 'short' })}</span><b>{Number(d.slice(8))}</b>
            </div>
          ))}
          {days.map((d, i) => <div key={d} className="cal-wk-col" style={{ gridColumn: i + 2 }} />)}
          {Array.from({ length: 11 }, (_, i) => <span key={i} className="cal-wk-hr" style={{ gridRow: 2 + i * 2 }}>{hourLabel(8 + i)}</span>)}
          {at.map(([d, h]) => <span key={`${d}-${h}`} className="cal-skel" style={{ gridColumn: d + 2, gridRow: `${2 + (h - 8) * 2} / span 2` }} />)}
        </div>
      </section>
      <aside className="cal-rail" aria-hidden="true">
        <section className="ov-card cal-tally">
          <Skel w="45%" h={18} />
          {[0, 1, 2, 3, 4].map(i => <Skel key={i} w="100%" h={14} style={{ marginTop: 16 }} />)}
        </section>
        <section className="ov-card cal-next">
          <Skel w="35%" h={18} />
          {[0, 1, 2, 3].map(i => <Skel key={i} w="100%" h={30} style={{ marginTop: 16 }} />)}
        </section>
      </aside>
    </div>
  )
}

// ── Phone: strip of days and an agenda, every row a link ─────────────────────
function AgendaRow({ a, tz, nowMs }) {
  const [t, ampm] = clockParts(a.at, tz)
  const K = KIND[a.kind]
  return (
    <Link className={`ov-card cal-agr cal-t-${a.tone}${a.ms < nowMs && !a.live ? ' past' : ''}`} to={a.open}>
      <div className="t">{t}<small>{ampm}</small></div>
      <i className="bar" />
      <div className="who"><b>{a.name}</b><div className="info"><span><Ico icon={K.icon} size={13} />{K.word}</span><StagePill a={a} /></div></div>
      <span className="go"><Ico icon={ChevronRight} size={18} /></span>
    </Link>
  )
}

function Agenda({ days, items, from, today, tz, nowMs, onNext }) {
  return (
    <>
      {days.filter(d => d >= from).map(d => {
        const list = items.filter(a => a.day === d)
        const [h, sub] = dayHeading(d, today)
        const firstLater = d === today ? list.findIndex(a => a.ms > nowMs) : -1
        return (
          <div key={d} className="cal-ph-flow">
            <div className="cal-ag-day"><h2>{h}</h2><span>{sub}</span></div>
            {list.length ? list.map((a, i) => (
              <div key={a.id} className="cal-ph-flow">
                {i === firstLater && <div className="cal-ag-now">Now · {timeText(new Date(nowMs).toISOString(), tz)}</div>}
                <AgendaRow a={a} tz={tz} nowMs={nowMs} />
              </div>
            )) : <p className="cal-ag-empty"><b>Nothing booked</b>Booked calls and inbounds that book for this day show up here.</p>}
          </div>
        )
      })}
      <button type="button" className="ov-ghost cal-phmore" onClick={onNext}>Show next week</button>
    </>
  )
}

function Strip({ days, items, from, today, onPick, blank }) {
  return (
    <nav className="ov-card cal-strip" aria-label="Pick a day">
      {days.map(d => {
        const c = blank ? 0 : Math.min(3, items.filter(a => a.day === d).length)
        return (
          <button key={d} type="button" className={`${d === from ? 'on' : ''}${d === today ? ' today' : ''}`.trim() || undefined} aria-pressed={d === from}
            aria-label={dayFmt(d, { weekday: 'long', month: 'short', day: 'numeric' })} onClick={() => onPick(d)}>
            <span>{dayFmt(d, { weekday: 'short' })}</span><b>{Number(d.slice(8))}</b><i>{Array.from({ length: c }, (_, k) => <u key={k} />)}</i>
          </button>
        )
      })}
    </nav>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────────
export default function Calendar() {
  const { profile } = useAuth()
  const tz = profile?.timezone || DEFAULT_TIMEZONE
  const nowMs = useNow()
  const today = zonedDateStr(nowMs, tz)
  const [anchor, setAnchor] = useState(today)
  const [view, setView] = useState('week')
  const [picked, setPicked] = useState(null)
  const [phFrom, setPhFrom] = useState(null)
  const { list, loading, error, retry } = useAppointments(tz, nowMs)
  const railRef = useRef(null)

  const monday = mondayOf(anchor)
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i))
  const inWeek = list.filter(a => days.includes(a.day))
  const inDay = list.filter(a => a.day === anchor)
  const sel = list.find(a => a.id === picked) || null
  const upcoming = list.filter(a => a.ms >= nowMs && !a.live && a.id !== picked)
  const weekHasToday = days.includes(today)
  const from = phFrom && days.includes(phFrom) ? phFrom : weekHasToday ? today : monday

  const step = view === 'day' ? 1 : 7
  const go = n => { setAnchor(n === 0 ? today : addDays(anchor, n * step)); setPicked(null); setPhFrom(null) }
  const label = view === 'day' ? dayFmt(anchor, { weekday: 'long', month: 'short', day: 'numeric' }) : rangeLabel(days[0], days[6])
  const isToday = view === 'day' ? anchor === today : weekHasToday
  const openDay = d => { setAnchor(d); setView('day'); setPicked(null) }
  const pick = id => setPicked(id)
  const pickNext = a => { setAnchor(a.day); setPicked(a.id) }

  // Between 768 and 1179 the rail sits under the grid, so bring the panel into view when something is picked.
  useEffect(() => {
    if (picked && railRef.current && window.innerWidth < 1180) railRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [picked])

  const bar = (key) => (
    <Bar view={view} label={label} isToday={isToday} showKey={key} onPrev={() => go(-1)} onNext={() => go(1)} onToday={() => go(0)}
      onView={v => { setView(v); setPicked(null) }} />
  )
  const phBar = (
    <div className="cal-phbar pv-only-phone">
      <button type="button" className="ov-ghost sq" aria-label="Previous week" onClick={() => { setView('week'); setAnchor(addDays(monday, -7)); setPhFrom(null) }}><Ico icon={ChevronLeft} /></button>
      <button type="button" className="ov-ghost sq" aria-label="Next week" onClick={() => { setView('week'); setAnchor(addDays(monday, 7)); setPhFrom(null) }}><Ico icon={ChevronRight} /></button>
      <button type="button" className="ov-ghost" onClick={() => { setAnchor(today); setPhFrom(null) }}>Today</button>
      <span className="cal-range">{rangeLabel(days[0], days[6])}</span>
    </div>
  )

  const rail = (
    <aside className="cal-rail" aria-label="Appointment" ref={railRef}>
      {sel ? <Panel a={sel} tz={tz} nowMs={nowMs} today={today} onClose={() => setPicked(null)} /> : <Tally items={inWeek} />}
      <NextUp upcoming={upcoming} tz={tz} nowMs={nowMs} onPick={pickNext} hint={!sel} />
    </aside>
  )

  let body
  if (error) {
    body = (
      <>
        <div className="cal-main full pv-only-desk"><WeekGrid days={days} items={[]} today={today} tz={tz} nowMs={nowMs} onPick={pick}><div className="cal-over"><FailMessage onRetry={retry} /></div></WeekGrid></div>
        <div className="cal-ph-flow pv-only-phone"><Strip days={days} items={[]} from={from} today={today} onPick={setPhFrom} blank /><FailMessage onRetry={retry} /></div>
      </>
    )
  } else if (loading) {
    body = (
      <>
        <Loading days={days} today={today} />
        <div className="cal-ph-flow pv-only-phone" aria-busy="true" aria-label="Loading your calendar">
          <Strip days={days} items={[]} from={from} today={today} onPick={setPhFrom} blank />
          <Skel w={90} h={18} />
          {[0, 1, 2].map(i => (
            <div key={i} className="ov-card cal-agr" aria-hidden="true"><Skel w={44} h={36} /><div className="who"><Skel w="65%" h={15} /><Skel w="45%" h={13} /></div></div>
          ))}
        </div>
      </>
    )
  } else {
    const weekEmpty = inWeek.length === 0
    const dayName = anchor === today ? 'today' : `on ${dayFmt(anchor, { weekday: 'long' })}`
    const desk = view === 'day' ? (
      <div className={`cal-main pv-only-desk${weekEmpty ? ' full' : ''}`}>
        <DayGrid day={anchor} items={inDay} today={today} tz={tz} nowMs={nowMs} selId={sel?.id} onPick={pick}>
          {inDay.length === 0 && (
            <div className="cal-over day">
              <EmptyMessage title={`Nothing booked ${dayName}`} text="Booked calls and inbounds that book for this day show up here, with their phone number and both time zones." keys={false} />
            </div>
          )}
        </DayGrid>
        {!weekEmpty && rail}
      </div>
    ) : (
      <div className={`cal-main pv-only-desk${weekEmpty ? ' full' : ''}`}>
        <WeekGrid days={days} items={inWeek} today={today} tz={tz} nowMs={nowMs} selId={sel?.id} onPick={pick} onDay={openDay}>
          {weekEmpty && <div className="cal-over"><EmptyMessage title="Nothing booked this week" text="Booked calls and inbounds that book on your calendar show up here." /></div>}
        </WeekGrid>
        {!weekEmpty && rail}
      </div>
    )
    body = (
      <>
        {desk}
        <div className="cal-ph-flow pv-only-phone">
          <Strip days={days} items={inWeek} from={from} today={today} onPick={setPhFrom} blank={weekEmpty} />
          {weekEmpty
            ? <EmptyMessage title="Nothing booked this week" text="Booked calls and inbounds that book on your calendar show up here." full />
            : <Agenda days={days} items={inWeek} from={from} today={today} tz={tz} nowMs={nowMs} onNext={() => go(1)} />}
        </div>
      </>
    )
  }

  return (
    <PortalV2Layout active="calendar" title="Calendar" icon={CalendarDays}>
      <div className="cal-page">
        {bar(!error && !loading && view === 'week' && inWeek.length > 0)}
        {phBar}
        {body}
      </div>
    </PortalV2Layout>
  )
}
