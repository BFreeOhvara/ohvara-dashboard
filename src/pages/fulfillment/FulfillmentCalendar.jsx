import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'
import { CalendarDays, ChevronRight, Phone } from 'lucide-react'
import { DayHero, ClientDrawer, IconChip, OvSelect } from '../../components/agent/AgentUI'
import { LiveCallStrips } from '../../components/fulfillment/FulfillUI'
import { useCallOutcomes } from '../../hooks/useRepCallEvents'
import { isLive } from '../../lib/agentBookings'
import { DISPLAY } from '../../lib/exportStyles'
import { timezoneLabel } from '../../lib/timezones'
import {
  CALL_TONE, LEGEND, buildCalls, monthFrame, addMonths, monthTitle, monthShort, dayLong, dayShort, timeParts, timeText,
} from '../../lib/fulfillmentDay'

// Prompt 747 — the Fulfillment page is a month calendar. A rep's work is calls
// at set times, so the page is those calls laid out by day: Activity's coloured
// day hero for a month (edge arrows and ← / → change month), the month grid
// (Sunday first, only that month's days, up to 3 status chips a day), and a
// click on a day slides in its drawer (My Pipeline's ClientDrawer shell) with
// the day's calls in time order. A call opens the call view
// (FulfillmentQueue.jsx). Every call comes from buildCalls (lib/fulfillmentDay.js),
// the same rules as the Overview's Your day, over the visible month, with how
// past calls ended read from policy_events (one range fetch per month).
// The open day is in the URL (?day=YYYY-MM-DD). Admin sees every rep's calls,
// with a rep picker in the hero.

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`
const isTyping = el => el instanceof HTMLElement && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))
const toneVars = tone => ({ '--fc-c': CALL_TONE[tone].fg, '--fc-t': CALL_TONE[tone].tint, '--fc-e': CALL_TONE[tone].edge })
const HERO_DOT = { booked: 'var(--fc-hero-booked)', live: 'var(--fc-hero-live)', noAnswer: 'var(--fc-hero-noanswer)', cancelled: 'var(--fc-hero-cancelled)' }

// "Test Client Sample Data 14" → "Sample 14" on the tiny day chips only.
const chipName = name => name.replace(/^Test Client Sample Data\b/, 'Sample')

// Tallies for a list of calls: what's done, what's live, what's still to call.
function tally(calls) {
  const t = { total: calls.length, cancelled: 0, noAnswer: 0, live: 0, toCall: 0, late: 0 }
  for (const c of calls) {
    if (c.tone === 'live') t.live++
    else if (c.done && c.tone === 'cancelled') t.cancelled++
    else if (c.done) t.noAnswer++
    else {
      t.toCall++
      if (c.late) t.late++
    }
  }
  return t
}

// The drawer row's second line: what a rep needs before dialling.
function subLine(c, { tz, team, nowMs }) {
  const { p } = c
  const rep = team ? `${p.assigned?.full_name || 'Unassigned'} · ` : ''
  const carrier = p.current_carrier || 'Carrier not noted'
  const from = `${carrier} · from ${p.agent?.full_name || 'an agent'}`
  const sameDay = iso => iso && new Date(iso).toLocaleDateString('en-CA', { timeZone: tz }) === c.date
  const when = iso => (sameDay(iso) ? timeText(iso, tz) : `${dayShort(new Date(iso).toLocaleDateString('en-CA', { timeZone: tz }))} ${timeText(iso, tz)}`)
  if (c.retry) {
    return `${rep}${carrier} · ${p.last_call_at ? `No answer at ${when(p.last_call_at)} · ` : ''}try ${c.attempt}`
  }
  if (c.done && c.tone === 'noAnswer') {
    const retryAhead = !isLive(p) && p.fulfillment_stage !== 'Complete' && p.last_call_outcome === 'no_answer'
      && p.scheduled_call_at && new Date(p.scheduled_call_at).getTime() > Math.max(c.ms, nowMs)
    return `${rep}${retryAhead ? `${carrier} · retry at ${when(p.scheduled_call_at)}` : from}`
  }
  if (c.tone === 'booked' && p.client_timezone && timeText(c.at, p.client_timezone) !== timeText(c.at, tz)) {
    return `${rep}${carrier} · ${timeText(c.at, p.client_timezone)} for the client (${timezoneLabel(p.client_timezone)})`
  }
  return `${rep}${from}`
}

// The drawer row's pill: its words and its colour.
function pillOf(c, { nowMs, upNextKey }) {
  if (c.tone === 'live') return { text: `On a call · ${Math.max(0, Math.floor((nowMs - c.ms) / 6e4))} min`, tone: 'live', live: true }
  if (c.tone === 'cancelled') return { text: 'Cancelled', tone: 'cancelled' }
  if (c.tone === 'noAnswer') return { text: c.retry || c.attempt > 1 ? `No answer · try ${c.attempt}` : 'No answer', tone: 'noAnswer' }
  if (c.late) return { text: 'Time passed', tone: 'late' }
  return { text: c.key === upNextKey ? 'Up next' : 'Booked', tone: 'booked' }
}

export default function FulfillmentCalendar({ rows, team, tz, now, todayStr, loading, day, onOpenDay, onCloseDay, onOpenCall, reps, rep, onRep }) {
  const [month, setMonth] = useState(() => (day || todayStr).slice(0, 7))
  const [dir, setDir] = useState(null)
  // A drawer opened for another month (Go to today, Back) brings its month along.
  const dayMonth = day?.slice(0, 7)
  const [seenDayMonth, setSeenDayMonth] = useState(dayMonth)
  if (dayMonth !== seenDayMonth) {
    setSeenDayMonth(dayMonth)
    if (dayMonth && dayMonth !== month) { setDir(null); setMonth(dayMonth) }
  }

  const frame = useMemo(() => monthFrame(month, tz), [month, tz])
  const anyLive = rows.some(isLive)
  const { data: events = [], isLoading: eventsLoading } = useCallOutcomes(
    new Date(frame.startMs).toISOString(), new Date(frame.endMs).toISOString(),
    { enabled: frame.startMs <= now, live: anyLive },
  )
  const busy = loading || eventsLoading

  const calls = useMemo(
    () => buildCalls(rows, now, tz, { from: frame.from, to: frame.to, events }),
    [rows, now, tz, frame, events],
  )
  const byDay = useMemo(() => {
    const m = new Map()
    for (const c of calls) {
      if (!m.has(c.date)) m.set(c.date, [])
      m.get(c.date).push(c)
    }
    return m
  }, [calls])
  const totals = useMemo(() => tally(calls), [calls])

  // The next call still to make, any day from now (not only this month).
  const next = useMemo(() => {
    const ahead = buildCalls(rows, now, tz, { from: todayStr, to: `${addMonths(todayStr.slice(0, 7), 4)}-01` })
    return ahead.find(c => !c.done && c.ms > now) || null
  }, [rows, now, tz, todayStr])
  const live = useMemo(() => rows.filter(isLive), [rows])

  const goMonth = n => {
    setDir(n > 0 ? 'next' : 'prev')
    setMonth(m => addMonths(m, n))
  }
  const onArrowKey = useEffectEvent(e => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    if (day || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || isTyping(e.target)) return
    e.preventDefault()
    goMonth(e.key === 'ArrowLeft' ? -1 : 1)
  })
  useEffect(() => {
    const h = e => onArrowKey(e)
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])

  const thisMonth = month === todayStr.slice(0, 7)
  const slideClass = dir === 'next' ? 'ov-slide-from-right' : dir === 'prev' ? 'ov-slide-from-left' : ''
  const where = thisMonth ? 'this month' : `in ${monthTitle(month).split(' ')[0]}`
  const nextLabel = next ? (next.date === todayStr ? timeText(next.at, tz) : `${dayShort(next.date).split(',')[0]} ${timeText(next.at, tz)}`) : ''

  const stats = busy
    ? <span>Loading the calendar…</span>
    : (
      <span className="fc-stats">
        <span><b>{totals.total}</b>{totals.total === 1 ? 'call' : 'calls'} {where}</span>
        {totals.live > 0 && <span><i style={{ background: HERO_DOT.live }} /><b>{totals.live}</b>on a call</span>}
        <span><i style={{ background: HERO_DOT.cancelled }} /><b>{totals.cancelled}</b>cancelled</span>
        <span><i style={{ background: HERO_DOT.noAnswer }} /><b>{totals.noAnswer}</b>no answer</span>
        <span><i style={{ background: HERO_DOT.booked }} /><b>{totals.toCall}</b>still to call</span>
      </span>
    )

  const actions = (
    <div className="mt-3 sm:mt-5" style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center', gap: '10px 22px' }}>
      {team && (
        <div style={{ width: 210, textAlign: 'left', color: 'var(--ov-hi)' }}>
          <OvSelect value={rep} onChange={onRep} options={reps} aria-label="Whose calls" placement="down" />
        </div>
      )}
      {next && (
        <button type="button" className="ov-hero-btn" onClick={() => onOpenCall(next.id, next.date)}
          style={{ height: 44, padding: '0 22px', fontSize: 14.5 }}>
          <Phone size={17} strokeWidth={2.1} />
          <span className="hidden sm:inline">{team ? 'Open the next call' : 'Open your next call'} · {nextLabel}</span>
          <span className="sm:hidden">Next call · {nextLabel}</span>
        </button>
      )}
      <button type="button" className="ov-hero-link" onClick={() => onOpenDay(todayStr)}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 14, height: 36, color: '#FFFFFF' }}>
        <CalendarDays size={16} strokeWidth={2} /> Go to today
      </button>
    </div>
  )

  const cells = [
    ...Array.from({ length: frame.lead }, (_, i) => <div key={`b${i}`} className="fc-blank" aria-hidden="true" />),
    ...frame.dates.map(date => {
      const list = byDay.get(date) || []
      const isToday = date === todayStr
      const cls = `fc-day${date < todayStr ? ' is-past' : ''}${isToday ? ' is-today' : ''}${date === day ? ' is-sel' : ''}`
      return (
        <button key={date} type="button" className={cls} onClick={() => onOpenDay(date)}
          aria-label={`${dayLong(date)}${isToday ? ', today' : ''}, ${plural(list.length, 'call')}`}>
          <span className="fc-top">
            <span className="fc-n">{Number(date.slice(8))}</span>
            {isToday && <span className="fc-tl">Today</span>}
            {list.length > 0 && <span className="fc-tot">{plural(list.length, 'call')}</span>}
          </span>
          {list.slice(0, 3).map(c => (
            <span key={c.key} className="fc-ev" style={toneVars(c.tone)} title={team ? `${c.name} · ${c.p.assigned?.full_name || 'Unassigned'}` : c.name}>
              <span className="tm">{timeParts(c.at, tz).time}</span>
              <span className="nm">{chipName(c.name)}</span>
            </span>
          ))}
          {list.length > 3 && <span className="fc-more">+{list.length - 3} more</span>}
        </button>
      )
    }),
  ]

  return (
    <div className="flex flex-col gap-[14px] sm:gap-5">
      <LiveCallStrips live={live} now={now} team={team} onOpen={id => onOpenCall(id, todayStr)} />

      <DayHero
        dayKey={month} slideClass={slideClass}
        tag={thisMonth ? 'This month' : null}
        dateLong={monthTitle(month)} dateShort={monthShort(month)}
        summary={stats}
        summaryShort={busy ? 'Loading…' : `${plural(totals.total, 'call')} · ${totals.toCall} to call`}
        canNext onPrev={() => goMonth(-1)} onNext={() => goMonth(1)}
        arrowLabels={['Previous month', 'Next month']}
        actions={actions}
      />

      <section className="ov-card fc-month" aria-label={`${monthTitle(month)} calendar`}>
        <div className="fc-dow" aria-hidden="true">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => <span key={d}>{d}</span>)}
        </div>
        <div className="ov-slide-frame">
          <div key={month} className={`fc-days ${slideClass}`}>{cells}</div>
        </div>
        <div className="fc-legend">
          {LEGEND.map(k => <span key={k}><i style={{ background: CALL_TONE[k].fg }} />{CALL_TONE[k].label}</span>)}
          <span className="fc-zone">Times are {team ? 'in your zone' : 'yours'} ({timezoneLabel(tz)})</span>
        </div>
      </section>

      {day && (
        <DayDrawer
          key={day} date={day} calls={byDay.get(day) || (day.slice(0, 7) === month ? [] : null)}
          rows={rows} events={events} tz={tz} now={now} todayStr={todayStr} team={team} loading={busy}
          onClose={onCloseDay} onOpenCall={onOpenCall}
        />
      )}
    </div>
  )
}

// ── the day drawer ──────────────────────────────────────────────────────────

function DayDrawer({ date, calls: monthCalls, rows, events, tz, now, todayStr, team, loading, onClose, onOpenCall }) {
  // A day outside the visible month (a stale URL) is worked out on its own.
  const calls = useMemo(
    () => monthCalls || buildCalls(rows, now, tz, { from: date, to: date, events: date <= todayStr ? events : null }),
    [monthCalls, rows, now, tz, date, events, todayStr],
  )
  const closeRef = useRef(null)
  const pending = useRef(null)
  const isToday = date === todayStr
  const past = date < todayStr
  const t = tally(calls)
  const nextCall = calls.find(c => !c.done && c.ms > now) || null
  const upNextKey = isToday && nextCall?.tone === 'booked' ? nextCall.key : null

  const summary = loading ? 'Loading…'
    : !t.total ? 'No calls'
      : isToday ? [plural(t.total, 'call'), `${t.cancelled + t.noAnswer} done`, t.live && `${t.live} on a call`, `${t.toCall} to go`].filter(Boolean).join(' · ')
        : past ? [plural(t.total, 'call'), t.cancelled && `${t.cancelled} cancelled`, t.noAnswer && `${t.noAnswer} no answer`, t.late && `${t.late} time passed`].filter(Boolean).join(' · ')
          : `${plural(t.total, 'call')} booked`
  const segs = ['cancelled', 'noAnswer', 'live', 'booked'].map(k => [k, calls.filter(c => c.tone === k).length]).filter(([, n]) => n)

  // A row (or the footer) slides the drawer out first, then opens the call.
  const open = c => {
    pending.current = c
    closeRef.current?.()
  }
  const finish = () => {
    const c = pending.current
    if (c) onOpenCall(c.id, date)
    else onClose()
  }

  const nowIdx = isToday ? calls.findIndex(c => c.ms > now) : -1
  const nowLine = <div key="now" className="fc-nowline">Now · {timeText(now, tz)}</div>

  return (
    <ClientDrawer
      name={dayLong(date)} closeRef={closeRef} onClose={finish}
      header={{
        title: (
          <>
            <IconChip icon={CalendarDays} color="var(--ov-st-booked)" tint="var(--ov-st-booked-tint)" iconSize={18} />
            <h2 style={{ flex: 1, minWidth: 0, margin: 0, fontFamily: DISPLAY, fontSize: 21, fontWeight: 600, letterSpacing: '-0.01em', color: 'var(--ov-hi)' }}>
              {dayLong(date)}{isToday && <span className="fc-today-tag">Today</span>}
            </h2>
          </>
        ),
        body: (
          <>
            <p className="fc-dsum">{summary}</p>
            {!loading && t.total > 0 && (
              <div className="fc-prog" aria-hidden="true">
                {segs.map(([k, n]) => <i key={k} style={{ flex: n, background: CALL_TONE[k].fg }} />)}
              </div>
            )}
          </>
        ),
      }}
      footer={nextCall && !loading ? (
        <>
          <button type="button" className="ov-primary" onClick={() => open(nextCall)}>
            <Phone size={17} strokeWidth={2.1} /> Open the next call · {timeText(nextCall.at, tz)}
          </button>
          <p className="fc-foot-note">Click any call to work it.</p>
        </>
      ) : null}
    >
      <div className="fc-rows -mx-5 sm:-mx-[26px]" style={{ marginTop: -22, marginBottom: -22 }}>
        {loading ? (
          <div className="fc-empty">Loading the day…</div>
        ) : !calls.length ? (
          <div className="fc-empty">
            Nothing booked on {dayShort(date)}.<br />New calls show up here as agents book them.
          </div>
        ) : (
          <>
            {calls.flatMap((c, i) => {
              const { time, period } = timeParts(c.at, tz)
              const pill = pillOf(c, { nowMs: now, upNextKey })
              const row = (
                <button key={c.key} type="button" className={`fc-row${c.done && c.tone !== 'live' ? ' is-done' : ''}`} onClick={() => open(c)}>
                  <span className="fc-time" style={toneVars(c.tone)}><b>{time}</b><s>{period}</s></span>
                  <span className="fc-who">
                    <span className="nm">{c.name}</span>
                    <span className="ln">{subLine(c, { tz, team, nowMs: now })}</span>
                  </span>
                  <span className={`fc-pill${pill.live ? ' is-live' : ''}`} style={toneVars(pill.tone)}>{pill.text}</span>
                  <ChevronRight size={16} strokeWidth={2.2} className="fc-chev" />
                </button>
              )
              return i === nowIdx ? [nowLine, row] : [row]
            })}
            {isToday && nowIdx === -1 && nowLine}
          </>
        )}
      </div>
    </ClientDrawer>
  )
}
