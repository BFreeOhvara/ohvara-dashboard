import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'
import { useAuth } from '../../../hooks/useAuth'
import { useInbounds, useInboundEvents } from '../../../hooks/useInbounds'
import { useAgentBookings } from '../../../hooks/useAgentBookings'
import { PortalV2Layout, Ico, Skel, ErrorCard } from '../../../components/agent/PortalV2Nav'
import { leadName, appointmentAt, timeText, dayKey, telHref, clockParts } from '../../../lib/portalV2'
import { fullName } from '../../../lib/policyFormat'
import { placeOf, useNow } from '../../../lib/agentBookings'
import { DEFAULT_TIMEZONE, zonedDateStr } from '../../../lib/timezones'

// Calendar (/agent/calendar, v2 portal only): every appointment, whoever booked it. Two sources:
// inbound appointments (the booked step in inbound_events, as Today reads it) and the agent's
// cancellation calls (policies.scheduled_call_at, read through useAgentBookings like Clients).
// Desktop: Week (default) or Day with ‹ Today ›, and a side panel for the picked appointment.
// Phones: an agenda grouped by day, each row a link to the inbound or the client.
// Mockup: ohvara/mockups/build-calendar-clients-and-plan-billing-.html.

const BY = {
  you: { label: 'Booked by you', short: 'You', key: 'pv-k-you' },
  va: { label: 'Booked by an Ohvara VA', short: 'Ohvara VA', key: 'pv-k-va' },
  cl: { label: 'They picked the time', short: 'They picked the time', key: 'pv-k-cl' },
}
const WHAT = { booked_appointment: 'Appointment', live_call: 'Live call booked' }

// Who booked an inbound appointment, from its booked step: the agent, the client (a reschedule
// link: detail.booked_by = 'client'), else an Ohvara VA.
function bookedBy(e) {
  if (e?.actor_role === 'agent') return 'you'
  if (e?.actor_role === 'client' || e?.detail?.booked_by === 'client') return 'cl'
  return 'va'
}

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

// ── Data ─────────────────────────────────────────────────────────────────────
function useAppointments(tz) {
  const { profile } = useAuth()
  const inb = useInbounds()
  const evs = useInboundEvents()
  const bk = useAgentBookings(profile?.id, { enabled: !!profile?.id })
  const list = useMemo(() => {
    const out = []
    for (const l of inb.data || []) {
      const lev = evs.data?.get(l.lead_id) || []
      const at = appointmentAt(lev)
      if (!at) continue
      const booked = lev.filter(e => e.kind === 'booked' && e.state !== 'skipped' && (e.detail?.appointment_at === at || e.at === at))[0]
      out.push({
        id: `i-${l.lead_id}`, at, name: leadName(l), what: WHAT[l.inbound_product] || 'Appointment', by: bookedBy(booked),
        phone: l.phone, open: `/agent/inbounds/${l.lead_id}`, openLabel: 'Open inbound', change: null, clientTz: null, place: null,
        reminders: lev.filter(e => e.kind === 'reminder' && e.state !== 'skipped').sort((a, b) => new Date(a.at) - new Date(b.at)),
      })
    }
    for (const p of bk.data || []) {
      if (!p.scheduled_call_at) continue
      out.push({
        id: `p-${p.id}`, at: p.scheduled_call_at, name: fullName(p), what: 'Cancellation call', by: 'you',
        phone: p.client_phone, open: `/agent/clients?open=${p.id}`, openLabel: 'Open client',
        change: p.fulfillment_stage === 'Complete' ? null : `/agent/book?change=${p.id}`,
        clientTz: p.client_timezone && p.client_timezone !== tz ? p.client_timezone : null, place: placeOf(p) || null, reminders: [],
      })
    }
    return out.sort((a, b) => new Date(a.at) - new Date(b.at))
  }, [inb.data, evs.data, bk.data, tz])
  return {
    list,
    loading: inb.isLoading || evs.isLoading || bk.isLoading,
    error: inb.isError || evs.isError || bk.isError,
    retry: () => { inb.refetch(); evs.refetch(); bk.refetch() },
  }
}

// ── Pieces ───────────────────────────────────────────────────────────────────
function Legend() {
  return (
    <div className="pv-legend">
      {Object.values(BY).map(b => <span key={b.key}><i className={b.key} />{b.label}</span>)}
    </div>
  )
}

function WeekGrid({ days, items, today, tz, nowMs, selId, onPick }) {
  // 8 AM to 6 PM in half-hour rows, grown to fit earlier or later appointments (each drawn an hour tall).
  const mins = items.map(a => minsOf(a.at, tz))
  const start = Math.min(8, ...mins.map(m => Math.floor(m / 60)))
  const end = Math.max(18, ...mins.map(m => Math.min(24, Math.ceil((m + 60) / 60))))
  const rows = (end - start) * 2
  const rowOf = m => 2 + Math.floor((m - start * 60) / 30)
  const colOf = d => 2 + days.indexOf(d)
  // Side by side when two appointments overlap on the same day.
  const lanes = items.map((a, i) => {
    const d = dayKey(a.at, tz)
    const peers = items.map((b, j) => j).filter(j => dayKey(items[j].at, tz) === d && Math.abs(mins[j] - mins[i]) < 60)
    return { n: peers.length, k: peers.indexOf(i) }
  })
  const nowMins = minsOf(new Date(nowMs).toISOString(), tz)
  const showNow = days.includes(today) && nowMins >= start * 60 && nowMins < end * 60
  return (
    <div className="pv-wk pv-only-desk" style={{ gridTemplateRows: `48px repeat(${rows}, 28px)` }} aria-label={`Week of ${dayFmt(days[0], { month: 'short', day: 'numeric' })}`}>
      <div style={{ gridColumn: 1, gridRow: 1 }} />
      {days.map(d => (
        <div key={d} className={`pv-wk-day${d === today ? ' today' : ''}`} style={{ gridColumn: colOf(d) }}>
          {dayFmt(d, { weekday: 'short' })}<b>{Number(d.slice(8))}</b>
        </div>
      ))}
      {Array.from({ length: end - start }, (_, i) => (
        <span key={i} className="pv-wk-hr" style={{ gridRow: 2 + i * 2 }}>{hourLabel(start + i)}</span>
      ))}
      {days.map(d => <div key={d} className={`pv-wk-col${d === today ? ' today' : ''}`} style={{ gridColumn: colOf(d) }} />)}
      {items.map((a, i) => {
        const { n, k } = lanes[i]
        const lane = n > 1 ? { justifySelf: 'start', width: `calc((100% - 6px) / ${n})`, marginLeft: `calc(3px + (100% - 6px) * ${k / n})`, marginRight: 0 } : null
        return (
          <button
            key={a.id} type="button" onClick={() => onPick(a.id)} aria-pressed={selId === a.id}
            className={`pv-ev2 ${a.by}${new Date(a.at).getTime() < nowMs ? ' past' : ''}${selId === a.id ? ' sel' : ''}`}
            style={{ gridColumn: colOf(dayKey(a.at, tz)), gridRow: `${rowOf(mins[i])} / span ${Math.min(2, rows + 2 - rowOf(mins[i]))}`, ...lane }}
          >
            <b>{a.name}</b><span>{timeText(a.at, tz)}</span>
          </button>
        )
      })}
      {showNow && (
        <div className="pv-wk-now" style={{ gridColumn: colOf(today), gridRow: rowOf(nowMins), marginTop: ((nowMins - start * 60) % 30) / 30 * 28 }}
          aria-label={`Now, ${timeText(new Date(nowMs).toISOString(), tz)}`} />
      )}
    </div>
  )
}

function AgendaRow({ a, tz, nowMs, link, sel, onPick }) {
  const [t, ampm] = clockParts(a.at, tz)
  const body = (
    <>
      <span className="t tab">{t}<small>{ampm}</small></span>
      <i className={`bar ${BY[a.by].key}`} />
      <div className="pv-grow"><h4>{a.name}</h4><p className="who">{a.what} &middot; {BY[a.by].label}</p></div>
      {link && <Ico icon={ChevronRight} size={16} />}
    </>
  )
  const cls = `pv-ag-row${new Date(a.at).getTime() < nowMs ? ' past' : ''}${sel ? ' sel' : ''}`
  return link
    ? <Link className={cls} to={a.open}>{body}</Link>
    : <button type="button" className={cls} onClick={() => onPick(a.id)} aria-pressed={sel}>{body}</button>
}

function dayHeading(d, today) {
  const n = Math.round((noon(d) - noon(today)) / 864e5)
  if (n === 0) return ['Today', dayFmt(d, { weekday: 'short', month: 'short', day: 'numeric' })]
  if (n === 1) return ['Tomorrow', dayFmt(d, { weekday: 'short', month: 'short', day: 'numeric' })]
  return [dayFmt(d, { weekday: 'long' }), dayFmt(d, { month: 'short', day: 'numeric' })]
}

function Agenda({ days, items, today, tz, nowMs, onNext }) {
  // The current week starts at today; past days of it are left out.
  const shown = days.includes(today) ? days.filter(d => d >= today) : days
  return (
    <div className="pv-ag pv-only-phone">
      {shown.map(d => {
        const list = items.filter(a => dayKey(a.at, tz) === d)
        const [h, sub] = dayHeading(d, today)
        return (
          <div key={d} className="pv-ag">
            <p className="pv-ag-day">{h} <span>{sub}</span></p>
            {list.length ? list.map(a => <AgendaRow key={a.id} a={a} tz={tz} nowMs={nowMs} link />) : <p className="pv-ag-empty">Nothing booked.</p>}
          </div>
        )
      })}
      <button type="button" className="ov-ghost pv-btn" style={{ marginTop: 8 }} onClick={onNext}>Show next week</button>
    </div>
  )
}

function remindersText(a, tz, nowMs) {
  if (!a.reminders.length) return null
  return a.reminders.map(e => (e.state === 'done' || new Date(e.at).getTime() < nowMs ? `Sent ${timeText(e.at, tz)}` : `${timeText(e.at, tz)}, scheduled`)).join(' · ')
}

function Panel({ a, isNext, tz, nowMs, today }) {
  const call = telHref(a.phone)
  const d = dayKey(a.at, tz)
  const [h] = dayHeading(d, today)
  const when = `${h === 'Today' || h === 'Tomorrow' ? h : dayFmt(d, { weekday: 'short', month: 'short', day: 'numeric' })}, ${timeText(a.at, tz)}`
  const rem = remindersText(a, tz, nowMs)
  return (
    <section className="ov-card pv-card pv-appt" aria-label="Selected appointment">
      <div className="pv-chips">
        <span className="pv-chip b">{a.what}</span>
        {isNext && <span className="pv-chip">Next up</span>}
        {!isNext && new Date(a.at).getTime() < nowMs && <span className="pv-chip">Done</span>}
      </div>
      <h3>{a.name}</h3>
      <p className="pv-sub">{when}</p>
      <div className="pv-tiles" style={{ marginTop: 14 }}>
        <div className="pv-itile"><span>Booked by</span><b>{BY[a.by].short}</b></div>
        {a.clientTz
          ? <div className="pv-itile"><span>Their time</span><b>{timeText(a.at, a.clientTz)}{a.place ? `, ${a.place}` : ''}</b></div>
          : a.place ? <div className="pv-itile"><span>Where they live</span><b>{a.place}</b></div> : null}
        {rem && <div className="pv-itile full"><span>Reminders</span><b>{rem}</b></div>}
      </div>
      <div className="pv-acts2">
        <Link className="ov-primary full" to={a.open}>{a.openLabel}</Link>
        {call && <a className="ov-ghost pv-btn" href={call}>Call</a>}
        {a.change && <Link className="ov-ghost pv-btn" to={a.change}>Change time</Link>}
      </div>
    </section>
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
  const { list, loading, error, retry } = useAppointments(tz)

  const monday = mondayOf(anchor)
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i))
  const inWeek = list.filter(a => days.includes(dayKey(a.at, tz)))
  const inView = view === 'day' ? list.filter(a => dayKey(a.at, tz) === anchor) : inWeek
  const next = list.find(a => new Date(a.at).getTime() >= nowMs) || null
  const sel = list.find(a => a.id === picked) || inView.find(a => a === next) || inView.find(a => new Date(a.at).getTime() >= nowMs) || inView[inView.length - 1] || next
  const laterToday = list.filter(a => dayKey(a.at, tz) === today && new Date(a.at).getTime() >= nowMs)

  const step = view === 'day' ? 1 : 7
  const go = n => { setAnchor(n === 0 ? today : addDays(anchor, n * step)); setPicked(null) }
  const label = view === 'day' ? dayFmt(anchor, { weekday: 'short', month: 'short', day: 'numeric' }) : rangeLabel(days[0], days[6])

  let body
  if (error) {
    body = <ErrorCard title="We couldn't load your calendar" text="Your appointments are safe. Check your connection and try again." onRetry={retry} />
  } else if (loading) {
    body = (
      <section className="ov-card pv-card" aria-busy="true">
        <Skel w={160} h={20} />
        {[0, 1, 2].map(i => <Skel key={i} w="100%" h={64} style={{ marginTop: i ? 8 : 14, borderRadius: 16 }} />)}
      </section>
    )
  } else {
    body = (
      <section className="ov-card pv-card">
        <div className="pv-cal-bar">
          <span className="range">{label}</span>
          <div className="pv-seg pv-only-desk" role="group" aria-label="View">
            {['day', 'week'].map(v => (
              <button key={v} type="button" className={view === v ? 'on' : undefined} aria-pressed={view === v}
                onClick={() => { setView(v); setPicked(null) }}>{v === 'day' ? 'Day' : 'Week'}</button>
            ))}
          </div>
          <div className="pv-arrows">
            <button type="button" className="ov-ghost pv-btn sq" aria-label={view === 'day' ? 'Previous day' : 'Previous week'} onClick={() => go(-1)}><Ico icon={ChevronLeft} /></button>
            <button type="button" className="ov-ghost pv-btn" onClick={() => go(0)}>Today</button>
            <button type="button" className="ov-ghost pv-btn sq" aria-label={view === 'day' ? 'Next day' : 'Next week'} onClick={() => go(1)}><Ico icon={ChevronRight} /></button>
          </div>
        </div>
        <Legend />
        {inWeek.length === 0 ? (
          <div className="pv-empty" style={{ padding: '14px 0 4px' }}>
            <h3>Nothing booked this week</h3>
            <p className="pv-sub">Appointments show up here as soon as anyone books one: you, an Ohvara VA, or the client.</p>
            <button type="button" className="ov-ghost pv-btn" onClick={() => setAnchor(addDays(monday, 7))}>Go to next week</button>
          </div>
        ) : (
          <>
            {view === 'week'
              ? <WeekGrid days={days} items={inWeek} today={today} tz={tz} nowMs={nowMs} selId={sel?.id} onPick={setPicked} />
              : (
                <div className="pv-ag pv-only-desk">
                  {inView.length ? inView.map(a => <AgendaRow key={a.id} a={a} tz={tz} nowMs={nowMs} sel={sel?.id === a.id} onPick={setPicked} />)
                    : <p className="pv-ag-empty">Nothing booked.</p>}
                </div>
              )}
            <Agenda days={days} items={inWeek} today={today} tz={tz} nowMs={nowMs} onNext={() => setAnchor(addDays(monday, 7))} />
          </>
        )}
      </section>
    )
  }

  return (
    <PortalV2Layout active="calendar" title="Calendar" icon={CalendarDays}>
      <div className="pv-grid2 cal">
        <div className="pv-col2">{body}</div>
        {!error && !loading && (
          <aside className="pv-col2 pv-only-desk" aria-label="Appointment">
            {sel && <Panel a={sel} isNext={sel === next} tz={tz} nowMs={nowMs} today={today} />}
            <section className="ov-card pv-card">
              <div className="pv-hd" style={{ marginBottom: 6 }}><h2>Later today</h2><span className="pv-sub">{laterToday.length} left</span></div>
              {laterToday.length ? (
                <div className="pv-mini">
                  {laterToday.map(a => (
                    <button key={a.id} type="button" onClick={() => { setAnchor(today); setPicked(a.id) }}>
                      <span className="t tab">{timeText(a.at, tz)}</span><span className="pv-grow">{a.name}</span><span className="pv-chip b">{a.what}</span>
                    </button>
                  ))}
                </div>
              ) : <p className="pv-sub">Nothing else today.</p>}
            </section>
          </aside>
        )}
      </div>
    </PortalV2Layout>
  )
}
