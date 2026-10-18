import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useSearchParams } from 'react-router-dom'
import { ChevronDown, ChevronLeft, ChevronRight, CornerDownLeft, X } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { useFulfillmentQueue, useGiveCalls } from '../../hooks/usePolicies'
import { useCallOutcomes } from '../../hooks/useRepCallEvents'
import { useAllProfiles } from '../../hooks/useProfiles'
import { ClientDrawer, LoadError } from '../../components/agent/AgentUI'
import { Avatar } from '../../components/ui/Avatar'
import { isLive, useNow } from '../../lib/agentBookings'
import { KIND, KEY_ORDER, NOBODY, canGive, deskDay, giveOptions, shiftOf } from '../../lib/adminDesk'
import { addDaysStr } from '../../lib/scheduling'
import { slideOut } from '../../lib/daySlide'
import { DEFAULT_TIMEZONE, zonedDateStr } from '../../lib/timezones'
import { dayBounds, dayLong, dayShort, hourOf, relDay, timeParts, timeText, todayBadge } from '../../lib/fulfillmentDay'
import { usePhoneLayout } from '../../hooks/usePhoneLayout'
import { useOneAtATime } from '../../hooks/useOneAtATime'
import { AdminPhoneDesk } from '../../components/admin/phone/AdminPhoneDesk'

// Admin Fulfillment (Prompt 760), ported from media/admin-redesign/admin-fulfillment.dc.html.
// The whole desk one day at a time: who is making calls and when, as dots (no
// client names). A gradient header (day arrows, the date, counts) with the
// day's track (every call on the desk as a coloured dot, today's now line),
// four boxes (done, cancelled, on a call now, need a hand) and the schedule
// (one row per Fulfillment person with calls that day, each call a dot at its
// time). A dot opens the call read-only. "Give to" is the only change admin
// makes here: it moves a stuck or not-started call to another Fulfillment
// person (admin_give_call, migration 142; refuses live and finished calls and
// a double-booked slot).
// Calls come from buildCalls (lib/fulfillmentDay.js) with the day's outcomes
// from policy_events, the same list My calls uses. A finished call sits on the
// row of the person who ended it (the event's actor), the rest on the person
// it is assigned to. URL: ?day=YYYY-MM-DD (none = today in the admin's zone).

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`
const isTyping = el => el instanceof HTMLElement && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))
const iso = ms => new Date(ms).toISOString()
const carrierOf = p => p.current_carrier || p.carrier_name || 'Not noted'

const short = (iso, tz) => {
  const { time, period } = timeParts(iso, tz)
  return `${time}${period === 'PM' ? 'p' : 'a'}`
}
const hourShort = h => `${h % 12 || 12}${h % 24 >= 12 ? 'p' : 'a'}`

// ── the day header's track ──────────────────────────────────────────────────

function Track({ calls, range, pct, nowH, live, tz, now, onOpen }) {
  const hours = Array.from({ length: range.last - range.start + 1 }, (_, i) => range.start + i)
  const nowPct = nowH == null ? null : pct(nowH)
  return (
    <div className="af-track">
      <span className="af-track-bar" />
      {nowPct != null && <span className="af-track-fill" style={{ width: `${nowPct}%` }} />}
      {hours.map(h => (
        <span key={h}>
          <span className="af-tick" style={{ left: `${pct(h)}%` }} />
          <span className="af-hour" style={{ left: `${pct(h)}%` }}>{hourShort(h)}</span>
        </span>
      ))}
      {calls.map(c => (
        <button key={c.key} type="button" className={`af-tdot is-${c.k}`} style={{ left: `${pct(c.h)}%` }}
          aria-label={`${timeText(c.at, tz)} · ${KIND[c.k].label}`} onClick={() => onOpen(c)} />
      ))}
      {nowPct != null && <>
        <span className="af-needle" style={{ left: `${nowPct}%` }} />
        <span className={`af-now${live ? ' is-live' : ''}`} style={{ left: `clamp(70px, ${nowPct}%, calc(100% - 70px))` }}>
          {live ? `● Now ${timeParts(iso(now), tz).time} · ${live} live` : `Now ${timeParts(iso(now), tz).time}`}
        </span>
      </>}
    </div>
  )
}

// ── Give to ─────────────────────────────────────────────────────────────────

function GivePicker({ calls, reps, rows, tz, onClose }) {
  const give = useGiveCalls()
  const giveOnce = useOneAtATime(give) // P780: a double-tap gives once
  const [err, setErr] = useState(null)
  const opts = useMemo(() => giveOptions(calls, reps, rows), [calls, reps, rows])
  const onKey = useEffectEvent(e => { if (e.key === 'Escape' && !give.isPending) onClose() })
  useEffect(() => {
    const h = e => onKey(e)
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])
  const one = calls.length === 1 ? calls[0] : null

  const pick = o => {
    setErr(null)
    giveOnce({ ids: o.ids, to: o.rep.id }, {
      onSuccess: onClose,
      onError: e => setErr(e?.message || 'That didn’t go through. Try again.'),
    })
  }
  const line = o => {
    const free = o.ids.length
    if (!free) return { text: one ? 'Has a call then' : 'Has calls at those times', tone: 'busy' }
    const off = o.offShift ? ` · ${o.offShift === free && one ? 'off shift then' : `${o.offShift} off shift`}` : ''
    return { text: (one ? `Free at ${timeText(one.at, tz)}` : `Free for ${free} of ${o.open}`) + off, tone: o.offShift ? 'warn' : 'free' }
  }

  return createPortal(
    <>
      <div className="ov-scrim af-modal-scrim" onClick={() => !give.isPending && onClose()} aria-hidden="true" />
      <div className="af-modal ov-card" role="dialog" aria-modal="true" aria-label="Give to">
        <div className="af-modal-head">
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2>{one ? 'Give this call to' : `Give ${plural(calls.length, 'call')} to`}</h2>
            <p>{one ? `${timeText(one.at, tz)} · now with ${one.p.assigned?.full_name || 'nobody'}` : calls.map(c => short(c.at, tz)).join(' · ')}</p>
          </div>
          <button type="button" className="ov-ghost af-x" onClick={onClose} aria-label="Close" disabled={give.isPending}><X size={16} /></button>
        </div>
        <div className="af-pick-list">
          {opts.length === 0 && <p className="af-pick-empty">No one else is on Fulfillment.</p>}
          {opts.map(o => {
            const l = line(o)
            return (
              <button key={o.rep.id} type="button" className="af-pick" disabled={!o.ids.length || give.isPending} onClick={() => pick(o)}>
                <Avatar profile={o.rep} size={36} />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <b>{o.rep.full_name || 'Unnamed'}</b>
                  <span className={`af-pick-line is-${l.tone}`}>{l.text}</span>
                </span>
                {give.isPending && give.variables?.to === o.rep.id ? <span className="af-pick-go">Giving…</span> : o.ids.length > 0 && <span className="af-pick-go">Give</span>}
              </button>
            )
          })}
        </div>
        {err && <p className="af-pick-err" role="alert">{err}</p>}
      </div>
    </>,
    document.body,
  )
}

// ── one call, read-only ─────────────────────────────────────────────────────

function CallPeek({ c, tz, now, onClose, onGive }) {
  const p = c.p
  const result = c.k === 'live' ? `On the call · ${Math.max(0, Math.floor((now - new Date(p.call_live_since).getTime()) / 6e4))} min`
    : c.k === 'cx' ? 'Cancelled'
      : c.k === 'na' ? `No answer${c.attempt > 1 ? ` · try ${c.attempt}` : ''}`
        : c.k === 'stuck' ? 'Past its time, not started'
          : c.retry ? `Still to call · try ${c.attempt}` : 'Still to call'
  const rows = [
    ['Fulfillment', c.ownerName],
    ['Booked by', p.agent?.full_name || 'Unknown'],
    ['Cancel with', carrierOf(p)],
    ['Result', result],
  ]
  return (
    <ClientDrawer
      p={null} name={`${timeText(c.at, tz)} call`} onClose={onClose}
      header={{
        title: (
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ov-mute)' }}>Call · view only</div>
            <div className="af-peek-time"><i className={`af-peek-dot is-${c.k}`} />{timeText(c.at, tz)}<span>{dayShort(zonedDateStr(c.ms, tz))}</span></div>
          </div>
        ),
      }}
      footer={canGive(c) ? (
        <button type="button" className="af-give-btn" style={{ width: '100%', height: 46 }} onClick={onGive}>Give to<ChevronDown size={14} strokeWidth={2.6} /></button>
      ) : null}
    >
      <dl className="af-peek">
        {rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
      </dl>
      {!canGive(c) && <p className="af-peek-note">{c.k === 'live' ? 'A live call can’t be given to someone else.' : 'This call is finished.'}</p>}
    </ClientDrawer>
  )
}

// ── page ────────────────────────────────────────────────────────────────────

// Prompt 774 — under 768px, inside the admin phone shell, the phone screen.
export default function AdminFulfillment() {
  return usePhoneLayout() ? <AdminPhoneDesk /> : <AdminFulfillmentDesktop />
}

function AdminFulfillmentDesktop() {
  const { profile } = useAuth()
  const queueQ = useFulfillmentQueue()
  const { data: queue = [], isLoading } = queueQ
  const profilesQ = useAllProfiles()
  const { data: profiles = [] } = profilesQ
  const now = useNow(15e3)
  const tz = profile?.timezone || DEFAULT_TIMEZONE
  const todayStr = zonedDateStr(now, tz)
  const [params, setParams] = useSearchParams()
  const dayParam = DAY_RE.test(params.get('day') || '') ? params.get('day') : null
  // Users' "View on the desk" (P762) lands here with ?rep=<id>: that row is marked and scrolled to.
  const repParam = params.get('rep')
  const day = dayParam || todayStr
  const isToday = day === todayStr
  const past = day < todayStr
  const rootRef = useRef(null)
  const [nav, setNav] = useState(null)
  const [peek, setPeek] = useState(null)
  const [giving, setGiving] = useState(null)

  const reps = useMemo(() => profiles.filter(r => r.role === 'fulfillment'), [profiles])
  const repById = useMemo(() => new Map(reps.map(r => [r.id, r])), [reps])
  const activeReps = useMemo(() => reps.filter(r => r.is_active).sort((a, b) => (a.full_name || '').localeCompare(b.full_name || '')), [reps])

  // ── the day's calls ──
  const { startMs, endMs } = dayBounds(day, tz)
  const started = startMs <= now
  const anyLive = queue.some(isLive)
  const eventsQ = useCallOutcomes(iso(startMs), iso(endMs), { enabled: started, live: anyLive })
  const { data: events = [], isLoading: eventsLoading } = eventsQ
  // P780 — a failed load says so instead of an empty desk.
  const failed = [queueQ, profilesQ, ...(started ? [eventsQ] : [])].some(q => q.isError && !q.data)
  const busy = isLoading || !profile || (started && eventsLoading) || failed
  const calls = useMemo(() => {
    if (busy) return []
    return deskDay(queue, now, tz, day, started ? events : null, repById)
  }, [busy, queue, now, tz, day, started, events, repById])

  const count = Object.fromEntries(KEY_ORDER.map(k => [k, calls.filter(c => c.k === k).length]))
  const finished = count.cx + count.na
  const stuck = calls.filter(c => c.k === 'stuck')

  // ── one row per person with calls that day ──
  const lanes = useMemo(() => {
    const by = new Map()
    for (const c of calls) {
      if (!by.has(c.owner)) by.set(c.owner, [])
      by.get(c.owner).push(c)
    }
    return [...by.entries()].map(([id, list]) => {
      const rep = repById.get(id) || null
      const name = rep?.full_name || list[0].p.assigned?.full_name || 'Nobody yet'
      return { id, rep, name, calls: list, shift: shiftOf(rep, day) }
    }).sort((a, b) => (a.id === NOBODY) - (b.id === NOBODY) || a.name.localeCompare(b.name))
  }, [calls, repById, day])
  const focusShown = lanes.some(l => l.id === repParam)
  useEffect(() => {
    if (focusShown) rootRef.current?.querySelector('.af-lane.is-focus')?.scrollIntoView({ block: 'center' })
  }, [focusShown, day])

  // The track runs from the desk's first hour to its last: 9 AM to 7 PM,
  // widened to the shifts of the people on it and to every call.
  const range = useMemo(() => {
    const hs = calls.map(c => c.h)
    for (const l of lanes) if (l.shift) hs.push(hourOf(iso(l.shift.startMs), tz), hourOf(iso(l.shift.endMs), tz) - 0.01)
    const start = Math.max(0, Math.min(9, ...hs.map(Math.floor)))
    const last = Math.min(23, Math.max(19, ...hs.map(Math.ceil)))
    return { start, last, end: last + 0.5 }
  }, [calls, lanes, tz])
  const pct = h => ((Math.min(range.end, Math.max(range.start, h)) - range.start) / (range.end - range.start)) * 100
  const nowH = isToday ? hourOf(iso(now), tz) : null
  const hours = Array.from({ length: range.last - range.start + 1 }, (_, i) => range.start + i)

  const liveCalls = isToday ? calls.filter(c => c.k === 'live') : []
  const laneStatus = l => {
    if (l.id === NOBODY) return { text: 'Not given to anyone', tone: 'warn' }
    if (l.rep && !l.rep.is_active) return { text: 'Off today', tone: 'mute' }
    if (past) return { text: 'Day done', tone: 'mute' }
    const ahead = l.calls.filter(c => !c.done && c.ms > now)
    if (!isToday) return ahead.length ? { text: `First at ${timeText(ahead[0].at, tz)}`, tone: 'next' } : { text: 'No calls left', tone: 'mute' }
    const lc = l.calls.find(c => c.k === 'live')
    if (lc) return { text: `On a call · ${Math.max(0, Math.floor((now - lc.ms) / 6e4))} min`, tone: 'live' }
    if (ahead.length) {
      const soon = ahead[0].ms - now <= 90 * 6e4
      return { text: `${soon ? 'Next at' : 'Free until'} ${timeText(ahead[0].at, tz)}`, tone: soon ? 'next' : 'free' }
    }
    if (l.shift && now < l.shift.endMs) return { text: 'Free, no more calls', tone: 'free' }
    return { text: 'Done for today', tone: 'mute' }
  }

  // ── moving between days ──
  const goDay = target => {
    if (target === day) return
    const d = target > day ? 'next' : 'prev'
    slideOut(rootRef.current, d)
    setNav({ day: target, dir: d })
    setParams(target === todayStr ? {} : { day: target }, { replace: true })
  }
  const onArrowKey = useEffectEvent(e => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    if (giving || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey || isTyping(e.target) || e.target.closest?.('[role="dialog"]')) return
    e.preventDefault()
    goDay(addDaysStr(day, e.key === 'ArrowLeft' ? -1 : 1))
  })
  useEffect(() => {
    const onKey = e => onArrowKey(e)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  const slideClass = nav?.day === day ? (nav.dir === 'next' ? 'ov-slide-from-right' : 'ov-slide-from-left') : ''
  const rel = relDay(day, todayStr)
  const dayWordShort = isToday ? 'today' : `on ${dayShort(day)}`

  // A peeked call is re-read from the list, so it shows its latest state (and
  // closes if it left the day).
  const peekCall = peek ? calls.find(c => c.key === peek) || null : null

  const onDesk = lanes.filter(l => l.id !== NOBODY).length
  const others = lanes.filter(l => l.id !== NOBODY && !liveCalls.some(c => c.owner === l.id)).length

  return (
    <div ref={rootRef} className="af-page">
      {failed && <LoadError what="the desk" onRetry={() => [queueQ, profilesQ, eventsQ].forEach(q => q.isError && q.refetch())} />}
      <section className="ov-hero af-hero">
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
              <div className="mc-count">
                {busy ? <div className="mc-count-load">Loading…</div> : <>
                  <div>{calls.length}<span>{calls.length === 1 ? 'call' : 'calls'} {dayWordShort}</span></div>
                  <div>{onDesk} {onDesk === 1 ? 'person' : 'people'} on the desk</div>
                </>}
              </div>
            </div>
          </div>
          <button type="button" className="mc-arrow" aria-label="Next day" onClick={() => goDay(addDaysStr(day, 1))}>
            <ChevronRight size={20} strokeWidth={2.2} />
          </button>
        </div>
        <div className="ov-slide-frame">
          <div key={day} data-day-slide="" className={slideClass}>
            <Track calls={calls} range={range} pct={pct} nowH={nowH} live={liveCalls.length} tz={tz} now={now} onOpen={c => setPeek(c.key)} />
            <div className="af-key">
              {KEY_ORDER.map(k => <span key={k}><i className={`af-key-dot is-${k}`} />{KIND[k].label} {count[k]}</span>)}
              <span className="af-key-fill" />
              <span className="af-key-note">Every call on the desk {dayWordShort}</span>
            </div>
          </div>
        </div>
      </section>

      <div className="af-boxes">
        <section className="ov-card af-box">
          <span className="af-box-l">Done {isToday ? 'today' : ''}</span>
          <span className="af-box-v"><b>{finished}</b><span>of {plural(calls.length, 'call')}</span></span>
          <span className="af-seg" aria-hidden="true">
            {[['cx', count.cx], ['na', count.na], ['live', count.live], ['rest', calls.length - finished - count.live]].map(([k, n]) => n > 0 && (
              <span key={k} style={{ flex: n, background: k === 'rest' ? 'var(--ov-stub)' : KIND[k].seg }} />
            ))}
            {calls.length === 0 && <span style={{ flex: 1, background: 'var(--ov-stub)' }} />}
          </span>
        </section>

        <section className="ov-card af-box">
          <span className="af-box-l">Cancelled {isToday ? 'today' : ''}</span>
          <span className="af-box-v"><b style={{ color: 'var(--ov-st-cancelled)' }}>{count.cx}</b>
            <span>{finished ? `${Math.round((count.cx / finished) * 100)}% of finished calls` : 'No finished calls yet'}</span></span>
          <span className="af-box-sub">{count.na} no answer</span>
        </section>

        <section className="ov-card af-box">
          <span className="af-box-l">On a call now</span>
          {!isToday ? (
            <span className="af-box-sub" style={{ fontSize: 13.5 }}>Live calls show on today.</span>
          ) : liveCalls.length ? (
            <span className="af-oncall">
              <Avatar profile={repById.get(liveCalls[0].owner)} name={liveCalls[0].ownerName} size={34} />
              <span style={{ minWidth: 0 }}>
                <b>{liveCalls[0].ownerName}</b>
                <span>Live · {Math.max(0, Math.floor((now - liveCalls[0].ms) / 6e4))} min{liveCalls.length > 1 ? ` · +${liveCalls.length - 1} more` : ''}</span>
              </span>
            </span>
          ) : (
            <span className="af-box-v"><span style={{ fontSize: 15, fontWeight: 600, color: 'var(--ov-hi)' }}>Nobody is on a call</span></span>
          )}
          {isToday && <span className="af-box-sub">{others ? `${plural(others, 'other')} free or between calls` : 'No one else on the desk'}</span>}
        </section>

        {stuck.length ? (
          <section className="ov-card af-box is-warn">
            <span className="af-box-l">Need a hand</span>
            <span className="af-box-v"><b style={{ color: 'var(--ov-warn)' }}>{stuck.length}</b><span>past their time</span></span>
            <button type="button" className="af-give-btn" onClick={() => setGiving(stuck.map(c => c.key))}>Give them to<ChevronDown size={13} strokeWidth={2.6} /></button>
          </section>
        ) : (
          <section className="ov-card af-box is-ok">
            <span className="af-box-l">Need a hand</span>
            <span className="af-box-v"><b style={{ color: 'var(--ov-st-cancelled)' }}>0</b><span>All calls on time</span></span>
            <span className="af-box-sub">Nothing past its time</span>
          </section>
        )}
      </div>

      <section className="ov-card af-sched" aria-label="The schedule">
        <div className="af-sched-scroll">
          <div className="af-sched-in">
            <div className="af-sched-head">
              <div className="af-who-h">On the desk · {onDesk}</div>
              <div className="af-grid">
                {hours.map(h => <span key={h} className="af-hh" style={{ left: `${pct(h)}%` }}>{hourShort(h)}</span>)}
                {nowH != null && <span className="af-hnow" style={{ left: `clamp(40px, ${pct(nowH)}%, calc(100% - 40px))` }}>Now {timeParts(iso(now), tz).time}</span>}
              </div>
            </div>
            {busy ? <p className="af-empty">{failed ? 'Couldn’t load the desk.' : 'Loading the desk…'}</p>
              : !lanes.length ? <p className="af-empty">No calls on the desk {dayWordShort}.</p>
                : lanes.map(l => {
                  const st = laneStatus(l)
                  const cx = l.calls.filter(c => c.k === 'cx').length
                  return (
                    <div key={l.id} className={`af-lane${l.id === repParam ? ' is-focus' : ''}`}>
                      <div className="af-who">
                        <div className="af-who-top">
                          <span className="af-av">
                            {l.rep ? <Avatar profile={l.rep} size={42} /> : <span className="af-av-none">?</span>}
                            <i className={`is-${st.tone}`} />
                          </span>
                          <span style={{ minWidth: 0 }}>
                            <b>{l.name}</b>
                            <span className={`af-st is-${st.tone}`}>{st.text}</span>
                          </span>
                        </div>
                        <div className="af-seg is-lane">{l.calls.map(c => <span key={c.key} style={{ flex: 1, background: KIND[c.k].seg }} />)}</div>
                        <span className="af-tally">{plural(l.calls.length, 'call')} · {cx} cancelled</span>
                      </div>
                      <div className="af-grid">
                        {hours.map(h => <span key={h} className="af-gl" style={{ left: `${pct(h)}%` }} />)}
                        {nowH != null && <span className="af-gnow" style={{ left: `${pct(nowH)}%` }} />}
                        <span className="af-rail" />
                        {l.calls.map(c => (
                          <span key={c.key}>
                            <button type="button" className={`af-dot is-${c.k}`} style={{ left: `${pct(c.h)}%` }}
                              aria-label={`${timeText(c.at, tz)} · ${KIND[c.k].label}`} onClick={() => setPeek(c.key)} />
                            <span className={`af-dot-t is-${c.k}`} style={{ left: `${pct(c.h)}%` }}>{c.k === 'live' ? 'LIVE' : short(c.at, tz)}</span>
                          </span>
                        ))}
                      </div>
                    </div>
                  )
                })}
          </div>
        </div>
      </section>

      {peekCall && !giving && (
        <CallPeek c={peekCall} tz={tz} now={now} onClose={() => setPeek(null)} onGive={() => setGiving([peekCall.key])} />
      )}
      {giving && (
        <GivePicker
          calls={calls.filter(c => giving.includes(c.key) && canGive(c))}
          reps={activeReps} rows={queue} tz={tz}
          onClose={() => { setGiving(null); setPeek(null) }}
        />
      )}
    </div>
  )
}
