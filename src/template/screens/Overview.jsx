import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowUpRight, Check, Clock, CalendarDays } from 'lucide-react'
import { rangeWords } from '../spendPlan'
import { useDeliveredPace } from '../useDeliveredPace'
import { countByStatus } from '../agentView'
import { useDataSource, useSampleOverview, useSampleClients, useSampleLeads, useSampleAppointments, useSampleNeeds, useSampleSettings, useWeek, AGENT_TZ, onAgentClock } from '../data'
import { dateOf } from '../../lib/callSlots'
import { clockNow } from '../leadLifecycle'
import { agentCallLook, evClass, minsOf } from '../cal958'
import { CallDrawer } from './Calendar'
import '../cal947.css'
import '../cal958.css'
import { Avatar, Empty } from '../kit'
import { CountUp } from '../motion'
import { SetupProgress } from '../SetupProgress'
import { useLaunchView } from '../launchView'
import { AddLeadsCard } from '../Products955'
import { useProducts } from '../useProducts'
import { NeedCard } from '../NeedsNow'
import { useNeedAction } from '../needAction'
import { laneOf, LANES } from '../stages'
import { clientStatusOf, clientStatus } from '../../lib/clientCheck.js'
import { useCheckSettings, todayFor } from '../checkSettings'
import { paths } from '../paths'
import '../p893.css'
import Chart from '../Chart'
import { Area, ReferenceDot, ReferenceLine } from 'recharts'

// P841: a little more page. Next up is the second colour-filled tile (the Booked blue); under the pair, a This week
// strip of the working week's calls (leads blue, clients yellow, as on Calendar); under Needs you, a Lead mix tile
// (one bar split by lane, Solvik's stage mix).
// P840: Solvik's Overview shape. Left two thirds: one dominant tile (this week's bookings against the budget
// range, with the weekly chart), under it Your book (the one colour-filled tile) and Next up. Right third: a
// full-height Needs you column of stage-coloured cards, 2-up, scrolling inside itself. The page head carries
// clients, booked this week and the weekly budget. Sample data only. P923: the hero is Delivered this week.
const apptTo = a => (a.kind === 'client' ? paths.client(a.ref) : paths.lead(a.ref))
// P899: the agent's client statuses (lib/clientCheck.js); Closed clients are left out of the book.
const BOOK = [['working', 'Working'], ['needs_attention', 'Needs attention'], ['protected', 'Protected']]

function Tile({ className = '', i, title, sub, to, label, children, ...rest }) {
  return (
    <section className={`fx-tile ${className}`} style={{ '--i': i }} aria-label={title} {...rest}>
      <header className="fx-tile-h">
        <span className="tp-grow"><h2>{title}</h2>{sub && <p>{sub}</p>}</span>
        {to && <Link to={to} className="fx-open" aria-label={label || `Open ${title}`}><ArrowUpRight size={16} /></Link>}
      </header>
      {children}
    </section>
  )
}

// P844: the chart follows how long the agent has been on Ohvara (see data/index.js bookedChart). Weeks: a smooth area
// over the expected range band (dashed edges). Days (first 2 weeks): one rounded bar per day this week.
// P936: drawn by the one chart (../Chart.jsx); days still to come are a faint label, never an empty bar.
// P949: back to this (Brayden: the P942 area chart is for the admin Overview only).
const DL_SERIES = [{ key: 'v', label: 'Delivered', color: 'var(--ox-1)' }]
// P991: this week is still running, so it never dives: the solid line stops at last week, a dashed line runs to a
// hollow "so far" point, and a faint point above it is where the week ends at this pace ("on pace for ~9").
function SoFarDot({ cx, cy, payload }) {
  if (!payload?.today || cx == null || cy == null) return <g />
  return (
    <g className="fx-sofar">
      <circle cx={cx} cy={cy} r={5} className="fx-sofar-dot" />
      <text x={cx - 9} y={cy + 17} textAnchor="end" className="fx-sofar-lbl">so far</text>
    </g>
  )
}
function BookedChart({ chart, lo, hi, total, pace }) {
  const { points, mode } = chart
  const days = mode === 'days'
  const lastIdx = days ? points.findIndex(p => p[2]) - 1 : points.length - 1
  const nowAt = days ? (lastIdx < 0 ? points.length - 1 : lastIdx) : points.length - 1
  const running = !days && !pace.closed
  const cur = points.length - 1
  const data = points.map(([w, v, later], i) => ({
    name: !days && i === cur ? 'This week' : days && i === nowAt ? 'Today' : w,
    full: days ? w : i === cur && running ? `Week of ${w}, so far` : `Week of ${w}`, later: !!later, today: i === nowAt,
    v: running && i === cur ? null : v,
    ...(running && i === cur ? { so: total } : running && i === cur - 1 ? { so: v } : {}),
  }))
  const proj = running ? pace.projected : null
  const tip = running ? row => (row.today ? [['So far', String(total), 'var(--ox-1)'], ...(proj != null ? [['On pace for', `about ${proj}`]] : [])] : [['Delivered', String(row.v ?? 0), 'var(--ox-1)']]) : null
  const overlay = running ? [
    <Area key="so" type="linear" dataKey="so" stroke="var(--ox-1)" strokeWidth={2.5} strokeDasharray="6 5" fill="none" connectNulls
      dot={p => <SoFarDot key={p.index} {...p} />} activeDot={false} isAnimationActive={false} />,
    ...(proj != null ? [
      <ReferenceLine key="pl" segment={[{ x: 'This week', y: total }, { x: 'This week', y: proj }]} stroke="var(--ox-band-edge)" strokeDasharray="2 4" ifOverflow="extendDomain" />,
      <ReferenceDot key="pd" x="This week" y={proj} r={4.5} className="fx-proj-dot" fill="var(--ox-1)" fillOpacity={0.3} stroke="var(--ox-1)" strokeOpacity={0.6} strokeWidth={1.5} ifOverflow="extendDomain"
        label={{ value: `on pace for ~${proj}`, position: 'left', offset: 10, className: 'fx-proj-lbl' }} />,
    ] : []),
  ] : null
  const now = running ? ` This week so far ${total}${proj != null ? `, on pace for about ${proj}` : ''}.` : ''
  return (
    <Chart kind={days ? 'bar' : 'area'} data={data} series={DL_SERIES} legend={false} height={168} className="fx-dchart is-stretch"
      band={days ? null : { lo, hi }} overlay={overlay} reach={running ? Math.max(total, proj || 0) : 0} tip={tip}
      label={`Delivered per ${days ? 'day' : 'week'}: ${points.filter((p, i) => !p[2] && !(running && i === cur)).map(([w, v]) => `${w} ${v}`).join(', ')}.${now}${days ? '' : ` Expected at your spend ${lo} to ${hi} a week.`}`} />
  )
}

// The protected share of the book as a ring.
function Ring({ value, of }) {
  const r = 52
  const len = 2 * Math.PI * r
  const pct = of ? value / of : 0
  return (
    <div className="fx-ring" role="img" aria-label={`${value} of ${of} clients protected`}>
      <svg viewBox="0 0 120 120"><circle cx="60" cy="60" r={r} className="fx-ring-track" /><circle cx="60" cy="60" r={r} className="fx-ring-arc" transform="rotate(-90 60 60)" style={{ strokeDasharray: len, '--len': len, '--to': len * (1 - pct) }} /></svg>
      <span className="fx-ring-mid"><b className="tp-num">{Math.round(pct * 100)}%</b><small>protected</small></span>
    </div>
  )
}

// The working week, Mon to Fri, one column per day with its calls; today is marked. P893: all five days always show,
// a day with nothing booked keeps its (empty) box.
// P992: works like the Calendar. The week is the current one (Mon to Fri holding today, on the agent's clock, the same
// useWeek the Calendar reads); today carries the Calendar's "Today" pill. Every call keeps its place; its look is the
// Calendar's own (cal958 agentCallLook + evClass): blue lead, teal client, and once a lead's call has ended, the lead's
// result colour dimmed, or the "Mark result" dot while it's still to mark. It follows the lead's status live and
// re-checks the clock every minute. A call opens the Calendar's pop-up (CallDrawer).
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
function useWeekCalls() {
  const week = useWeek()
  const { data: raw } = useSampleAppointments()
  const { data: settings } = useSampleSettings()
  const tz = settings.timeZone || AGENT_TZ
  return useMemo(() => {
    const events = raw.map(e => (e.iso ? { ...e, ...onAgentClock(e.iso, tz), on: dateOf(e.iso, tz) } : { ...e, on: week.isoOf(e.date) }))
    return week.days.map(([day, n]) => {
      const iso = week.isoOf(n)
      const list = events.filter(e => e.on === iso).sort((x, y) => (minsOf(x.time) ?? 0) - (minsOf(y.time) ?? 0))
      return { day, date: n, mon: MON[Number(iso.slice(5, 7)) - 1], iso, today: n === week.today, list }
    })
  }, [raw, tz, week])
}

function WeekStrip({ days, onPick }) {
  const { data: leads } = useSampleLeads()
  const [, tick] = useState(0)
  useEffect(() => { const t = setInterval(() => tick(n => n + 1), 60000); return () => clearInterval(t) }, [])
  const now = clockNow()
  return (
    <ol className="fx-wk" aria-label="Calls this week">
      {days.map(d => (
        <li key={d.iso} className={`${d.today ? 'is-today' : ''}${d.list.length ? '' : ' is-empty'}`.trim() || undefined}>
          <span className="fx-wk-d"><b>{d.day}</b><small>{d.mon} {d.date}</small>{d.today && <small className="fx-wk-today">Today</small>}<i className="tp-num">{d.list.length}</i></span>
          {d.list.map(e => {
            const look = agentCallLook(e, e.kind === 'lead' ? leads.find(l => l.id === e.ref) : null, now)
            return (
              <button key={e.id} type="button" className={`fx-wk-ev ${evClass(look)}`} onClick={() => onPick(e)}
                aria-label={`${e.time}, ${e.who}, ${e.label}${look.done ? ', done' : look.mark ? ', mark the result' : ''}`}>
                <small>{e.time}</small><b>{e.who.split(' ')[0]}</b>
                {look.mark && <i className="ev958-mark" title="Mark result" aria-hidden="true" />}
              </button>
            )
          })}
          {!d.list.length && <span className="fx-wk-none">Nothing booked</span>}
        </li>
      ))}
    </ol>
  )
}

// Every open lead in one bar, split by the agent's five statuses (P898: Booked, No show, Follow up, Not interested, Sold),
// with a count per status. Leads our team is still calling aren't a status; the tile's sub line counts them.
// P923: the board is what was delivered to the agent; leads the team is still trying aren't delivered yet.
const mixSub = by => {
  const open = LANES.reduce((t, l) => t + by[l.key], 0)
  return `${open} delivered lead${open === 1 ? '' : 's'} on your board${by.team ? ` · ${by.team} our team is still trying` : ''}`
}
function LeadMix({ leads }) {
  const by = countByStatus(leads)
  const rows = LANES.map(l => ({ ...l, n: by[l.key] }))
  const total = rows.reduce((t, r) => t + r.n, 0) || 1
  return (
    <>
      <div className="fx-mix" role="img" aria-label={rows.map(r => `${r.label} ${r.n}`).join(', ')}>
        {rows.filter(r => r.n).map(r => <i key={r.key} className={`is-${r.tone}`} style={{ flexGrow: r.n / total }} />)}
      </div>
      <ul className="fx-mix-key">
        {rows.map(r => <li key={r.key} className={`is-${r.tone}`}><span className="fx-keyi"><i aria-hidden="true" /><span>{r.label}</span><b className="tp-num">{r.n}</b></span></li>)}
      </ul>
    </>
  )
}

export default function Overview() {
  const { data: o } = useSampleOverview()
  const { data: all } = useSampleClients()
  const source = useDataSource()
  const checks = useCheckSettings()
  const checkDay = todayFor(source)
  const stOf = c => clientStatusOf(c, checkDay, checks)
  const clients = all.filter(c => stOf(c) !== 'closed')
  const { data: leads } = useSampleLeads()
  // P923: Delivered this week = booked appointments + live calls that reached the agent; the range and chart too.
  // P991: judged by pace while the week runs (Ahead of pace / On pace / Behind pace), by the full range once it closes.
  const { wk, dl, pace, last } = useDeliveredPace()
  const next = o.nextAppt
  // P843: the person's avatar takes their current stage colour (a client's stage, or a lead's lane).
  const toneOfAppt = a => (a.kind === 'client' ? clientStatus(stOf(clients.find(c => c.id === a.ref))).tone : laneOf(leads.find(l => l.id === a.ref)).tone)
  const later = o.todayAppts.filter(a => a.id !== next?.id)
  const soon = o.upNext.filter(a => a.date > o.todayAppts[0]?.date).slice(0, 2)
  const nBy = k => clients.filter(c => stOf(c) === k).length
  const prot = nBy('protected')
  const chart = o.bookedChart
  // P910: Your to-dos (calls to mark, the monthly check), each with its action; live calls pinned above them.
  const { data: needs } = useSampleNeeds()
  const act = useNeedAction()
  const weekDays = useWeekCalls()
  const weekCalls = weekDays.reduce((n, d) => n + d.list.length, 0)
  const [call, setCall] = useState(null)
  // P941: until their leads are live, the setup steps (the admin's Setup ticket, in the same words) lead the page.
  const setup = useLaunchView()
  // P955: the setup steps are the Leads setup: only with Leads. Without it, one small Add Leads card.
  const { has } = useProducts()

  return (
    <div className="tp-page fx-page fx-ovl">
      <div className="fx-ovl-main">
        {has('leads') && setup && !setup.live && <section className="fx-tile fx-ovl-setup" style={{ '--i': 0 }} aria-label="Getting your leads live"><SetupProgress view={setup} compact /></section>}
        {/* P867: the hero fills the window (data-fold) so the Your book / Next up / Lead mix row peeks a third */}
        <Tile className="fx-ovl-hero" i={0} data-fold data-fold-next=".fx-ovl-book" title="Delivered this week" sub={`Your lead spend delivers about ${rangeWords(wk)} a week: booked calls and live calls`} to={paths.calendar()} label="Open Calendar">
          {/* P843: the number is the hero; the range already sits in the subtitle, so the side line only says what it is */}
          <div className="fx-chart-head fx-bk-head">
            <b className="tp-num fx-bk-num" aria-label={`${dl.total} delivered: ${dl.booked} booked, ${dl.live} live calls`}><CountUp value={dl.total} /></b>
            <span className="fx-bk-side"><b>Delivered</b><small className="fx-dl-split"><span className="tp-num">{dl.booked}</span> booked · <span className="tp-num">{dl.live}</span> live call{dl.live === 1 ? '' : 's'}</small>{last && <small className="fx-dl-last">{last}</small>}<i className={`fx-delta is-${pace.tone}`}>{pace.word}</i></span>
          </div>
          <div className="fx-key">
            <span><i className="is-line" />{chart.mode === 'days' ? 'Delivered per day' : 'Delivered per week'}</span>
            {chart.mode === 'weeks' && <span><i className="is-dash" />Expected at your spend</span>}
            <span className="fx-key-range">{chart.range}</span>
          </div>
          {chart.empty
            ? <Empty title="Nothing delivered yet" sub="Your first booked calls and live calls show up here as soon as they reach you." />
            : <BookedChart chart={chart} lo={wk.low} hi={wk.high} total={dl.total} pace={pace} />}
        </Tile>

        <div className="fx-ovl-pair">
          <Tile className="fx-ovl-book is-fill is-green" i={1} title="Your book" sub={`${clients.length} clients`} to={paths.clients()} label="Open Clients">
            <Ring value={prot} of={clients.length} />
            <ul className="fx-ringstats">
              {BOOK.map(([k, label]) => <li key={k}><span className="fx-stat"><small>{label}</small><b className="tp-num">{nBy(k)}</b></span></li>)}
            </ul>
          </Tile>

          <Tile className="fx-ovl-next is-fill is-blue" i={2} title="Next up" sub={next ? `${next.label}, ${next.inText}` : 'Nothing else on today'} to={next ? apptTo(next) : paths.calendar()} label={next ? `Open ${next.who}` : 'Open Calendar'}>
            {next ? (
              <>
                <b className="fx-huge">{next.time.replace(/ (AM|PM)/, '')}<small>{next.time.slice(-2)}</small></b>
                <span className="fx-next-who"><Avatar name={next.who} tone={toneOfAppt(next)} /><span><b>{next.who}</b><small>{next.label} · today</small></span></span>
                <div className="tp-row tp-wrap fx-next-acts">
                  <Link to={paths.calendar()} className="tp-primary sm fx-accent"><CalendarDays size={14} />Calendar</Link>
                </div>
              </>
            ) : <p className="fx-calm">The team books new appointments inside your hours.</p>}
            <ul className="fx-later">
              {later.map(a => <li key={a.id}><span className="fx-chipi"><Clock size={13} aria-hidden="true" />{a.time}<b>{a.who}</b></span></li>)}
              {soon.map(a => <li key={a.id}><span className="fx-chipi"><CalendarDays size={13} aria-hidden="true" />{a.day} {a.time}<b>{a.who}</b></span></li>)}
            </ul>
          </Tile>
        </div>
      </div>

      <div className="fx-ovl-side">
        <AddLeadsCard />
        {/* P917: no live-call cards here; a live call waiting for its result is a to-do (and pinned on Leads) */}
        <section className="fx-tile is-deep fx-ovl-needs" style={{ '--i': 4 }} aria-label="Your to-dos">
          <div className="fx-ovl-needs-in">
            <header className="fx-tile-h">
              <span className="tp-grow"><h2>Your to-dos</h2><p>{needs.now.length ? `${needs.now.length} for you` : 'Nothing waiting'}</p></span>
              <Link to={paths.leads()} className="fx-open" aria-label="Open Leads"><ArrowUpRight size={16} /></Link>
            </header>
            {needs.now.length > 0
              ? <div className="fx-ncards">{needs.now.map((r, i) => <NeedCard key={r.id} item={r} i={i} onAct={act} />)}</div>
              : <p className="fx-calm" data-empty="todos"><Check size={16} aria-hidden="true" />You{'’'}re all caught up.</p>}
          </div>
        </section>

        <Tile className="fx-ovl-mix" i={5} title="Lead mix" sub={mixSub(countByStatus(leads))} to={paths.leads()} label="Open Leads">
          <LeadMix leads={leads} />
        </Tile>
      </div>

      <Tile className="fx-ovl-week" i={6} title="This week" sub={`${weekCalls} calls, Mon to Fri`} to={paths.calendar()} label="Open Calendar">
        <WeekStrip days={weekDays} onPick={setCall} />
      </Tile>
      <CallDrawer open={call} onClose={() => setCall(null)} />
    </div>
  )
}
