import { Link } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { useSampleClients, useSampleLeads, useWeek } from '../data'
import { SetupProgress } from '../SetupProgress'
import { useLaunchView } from '../launchView'
import { useProducts } from '../useProducts'
import { useClientStatusOf } from '../checkSettings'
import { countByStatus } from '../agentView'
import { paths } from '../paths'
import { useApp } from './AppKit'
import { useCalendarEvents } from './ACalendar'
import { LANES, LANE_TONE, weekOf } from './p1002'
import './p1002.css'

// P1002 — the Home tiles the desktop Overview has and the phone lacked (scr/Overview.jsx): Getting your leads live, Lead
// mix, This week (Mon to Fri) and Your book. Same data, same words; drawn the phone's way.

// Until their leads are live, the setup steps lead the page (desktop: only with the Leads product).
export function SetupTile() {
  const { has } = useProducts()
  const setup = useLaunchView()
  if (!has('leads') || !setup || setup.live) return null
  return <section className="ma-glass ma-pad ma-embed ma-tile" aria-label="Getting your leads live"><SetupProgress view={setup} compact /></section>
}

// A tile's title row: its name and line, and an arrow to the page it opens (a 44 px target).
function TileHead({ title, sub, to, label, state }) {
  return (
    <header className="ma-tile-h">
      <span className="ma-grow"><h2>{title}</h2>{sub && <small>{sub}</small>}</span>
      <Link to={to} state={state} className="ma-ib ma-press" aria-label={label}><ChevronRight size={20} aria-hidden="true" /></Link>
    </header>
  )
}

// Leads the team is still calling aren't a status; the line counts them (desktop mixSub).
const mixSub = by => {
  const open = LANES.reduce((t, l) => t + by[l.key], 0)
  return `${open} delivered lead${open === 1 ? '' : 's'} on your board${by.team ? ` · ${by.team} our team is still trying` : ''}`
}

// Every open lead in one bar, split by the agent's five statuses, with a count per status.
export function LeadMixTile() {
  const { data: leads } = useSampleLeads()
  const by = countByStatus(leads)
  const rows = LANES.map(l => ({ ...l, n: by[l.key] }))
  const total = rows.reduce((t, r) => t + r.n, 0) || 1
  return (
    <section className="ma-glass ma-pad ma-tile" aria-label="Lead mix">
      <TileHead title="Lead mix" sub={mixSub(by)} to={paths.leads()} label="Open Leads" state={{ tab: 'home' }} />
      <div className="ma-mix" role="img" aria-label={rows.map(r => `${r.label} ${r.n}`).join(', ')}>
        {rows.filter(r => r.n).map(r => <i key={r.key} className={`is-${LANE_TONE[r.key]}`} style={{ flexGrow: r.n / total }} />)}
      </div>
      <ul className="ma-mixkey">
        {rows.map(r => <li key={r.key} className={`is-${LANE_TONE[r.key]}`}><i aria-hidden="true" /><span>{r.label}</span><b className="tp-num">{r.n}</b></li>)}
      </ul>
    </section>
  )
}

// The working week, Mon to Fri: a column per day with its count and calls; today is marked. A call opens its person,
// "+N" and a day's header open the Calendar.
const SHOW = 2
export function WeekStripTile() {
  const app = useApp()
  const week = useWeek()
  const events = useCalendarEvents()
  const days = weekOf(week, 'this').map(d => ({ ...d, today: d.date === week.today, list: events.filter(e => e.on === d.iso) }))
  const calls = days.reduce((n, d) => n + d.list.length, 0)
  return (
    <section className="ma-glass ma-pad ma-tile" aria-label="This week">
      <TileHead title="This week" sub={`${calls} calls, Mon to Fri`} to={paths.calendar()} label="Open Calendar" state={{ tab: 'home' }} />
      <ol className="ma-wk" aria-label="Calls this week">
        {days.map(d => (
          <li key={d.iso} className={`${d.today ? 'is-today' : ''}${d.list.length ? '' : ' is-empty'}`.trim() || undefined}>
            <button type="button" className="ma-wk-d ma-press" aria-label={`${d.day} ${d.mon} ${d.date}${d.today ? ', today' : ''}, ${d.list.length} call${d.list.length === 1 ? '' : 's'}. Open the calendar`} onClick={() => app.goTab('calendar')}>
              <b>{d.day}</b><small>{d.mon} {d.date}</small>{d.today && <em>Today</em>}<i className="tp-num">{d.list.length}</i>
            </button>
            {d.list.slice(0, SHOW).map(e => (
              <Link key={e.id} to={e.kind === 'client' ? paths.client(e.ref) : paths.lead(e.ref)} state={{ tab: 'home' }} className={`ma-wk-ev is-${e.tone} ma-press`} aria-label={`${e.time}, ${e.who}, ${e.label}`}>
                <small>{e.time.replace(/ (AM|PM)/, '')}</small><b>{e.who.split(' ')[0]}</b>
              </Link>
            ))}
            {d.list.length > SHOW && <button type="button" className="ma-wk-more ma-press" onClick={() => app.goTab('calendar')}>+{d.list.length - SHOW}</button>}
            {!d.list.length && <span className="ma-wk-none">Nothing booked</span>}
          </li>
        ))}
      </ol>
    </section>
  )
}

const BOOK = [['working', 'Working', 'sky'], ['needs_attention', 'Needs attention', 'apricot'], ['protected', 'Protected', 'sage']]

// The protected share of the book as a ring, with the three client statuses beside it (Closed clients are left out).
export function BookTile() {
  const { data: all } = useSampleClients()
  const statusOf = useClientStatusOf()
  const clients = all.filter(c => statusOf(c) !== 'closed')
  const nBy = k => clients.filter(c => statusOf(c) === k).length
  const prot = nBy('protected')
  const r = 52
  const len = 2 * Math.PI * r
  const pct = clients.length ? prot / clients.length : 0
  return (
    <section className="ma-glass ma-pad ma-tile" aria-label="Your book">
      <TileHead title="Your book" sub={`${clients.length} clients`} to={paths.clients()} label="Open Clients" state={{ tab: 'home' }} />
      <div className="ma-book">
        <div className="ma-ring is-sage" role="img" aria-label={`${prot} of ${clients.length} clients protected`}>
          <svg viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r={r} className="ma-ring-track" /><circle cx="60" cy="60" r={r} className="ma-ring-arc" transform="rotate(-90 60 60)" style={{ strokeDasharray: len, strokeDashoffset: len * (1 - pct) }} /></svg>
          <span className="ma-ring-mid"><b className="tp-num">{Math.round(pct * 100)}%</b><small>protected</small></span>
        </div>
        <ul className="ma-bookkey">
          {BOOK.map(([k, label, tone]) => <li key={k} className={`is-${tone}`}><i aria-hidden="true" /><span>{label}</span><b className="tp-num">{nBy(k)}</b></li>)}
        </ul>
      </div>
    </section>
  )
}
