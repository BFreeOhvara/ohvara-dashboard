import { Link } from 'react-router-dom'
import { ArrowUpRight, Check, Clock, FileUp, PhoneIncoming, TriangleAlert, CalendarDays } from 'lucide-react'
import { useSampleOverview, useSampleClients, useSampleActions } from '../data'
import { Avatar } from '../kit'
import { CountUp } from '../motion'
import { stageChip } from '../LeadOutcome'
import { laneOf } from '../stages'
import { paths } from '../paths'

// Today at a glance in six big tiles: what is next, the week's submissions, your book, last week's work,
// who needs you, and what is due. Each tile is one idea. Sample data only.
const apptTo = a => (a.kind === 'client' ? paths.client(a.ref) : paths.lead(a.ref))
const SERIES = [['packet', 'Packet checks'], ['review', 'Review calls'], ['cancel', 'Cancellations'], ['save', 'Saves']]
const BOOK = [['protected', 'Protected', 'green'], ['setting_up', 'Setting up', 'blue'], ['needs_attention', 'Needs attention', 'warn'], ['requests', 'Requests open', 'teal']]

function Tile({ className = '', i, title, sub, to, label, children }) {
  return (
    <section className={`fx-tile ${className}`} style={{ '--i': i }} aria-label={title}>
      <header className="fx-tile-h">
        <span className="tp-grow"><h2>{title}</h2>{sub && <p>{sub}</p>}</span>
        {to && <Link to={to} className="fx-open" aria-label={label || `Open ${title}`}><ArrowUpRight size={16} /></Link>}
      </header>
      {children}
    </section>
  )
}

// Steps done per day as an area that draws itself in.
function StepsChart({ days }) {
  const sums = days.map(d => SERIES.reduce((n, [k]) => n + d[k], 0))
  const top = Math.max(4, ...sums)
  const W = 600
  const H = 170
  const x = i => (i / (days.length - 1)) * W
  const y = v => H - (v / top) * (H - 16) - 4
  const pts = sums.map((v, i) => [x(i), y(v)])
  const line = pts.reduce((d, [px, py], i) => {
    if (i === 0) return `M${px},${py}`
    const [qx, qy] = pts[i - 1]
    const cx = (qx + px) / 2
    return `${d} C${cx},${qy} ${cx},${py} ${px},${py}`
  }, '')
  return (
    <div className="fx-chart">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`Steps done per day: ${sums.join(', ')}`}>
        <defs><linearGradient id="fx-area" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style={{ stopColor: 'var(--ov-data-a)', stopOpacity: 0.38 }} /><stop offset="1" style={{ stopColor: 'var(--ov-data-a)', stopOpacity: 0 }} /></linearGradient></defs>
        {[0.25, 0.5, 0.75].map(f => <line key={f} x1="0" x2={W} y1={H * f} y2={H * f} className="fx-grid" />)}
        <path d={`${line} L${W},${H} L0,${H} Z`} fill="url(#fx-area)" className="fx-area" />
        <path d={line} pathLength="1" className="fx-line-draw" />
        {pts.map(([px, py], i) => <circle key={days[i].day} cx={px} cy={py} r="4" className="fx-pt" style={{ '--i': i }} />)}
      </svg>
      <div className="fx-xs">{days.map((d, i) => <span key={d.day}><b>{sums[i]}</b>{d.day}</span>)}</div>
    </div>
  )
}

export default function Overview() {
  const { data: o } = useSampleOverview()
  const { data: clients } = useSampleClients()
  const { doneTask } = useSampleActions()
  const { used, cap } = o.submissions
  const next = o.nextAppt
  const ring = 2 * Math.PI * 70
  const total = o.doneByDay.reduce((n, d) => n + SERIES.reduce((m, [k]) => m + d[k], 0), 0)
  const bookN = BOOK.map(([k]) => clients.filter(c => c.stage === k).length)
  const bookAll = bookN.reduce((a, b) => a + b, 0) || 1
  const needs = [
    ...o.attention.map(c => ({ id: c.id, to: paths.client(c.id), name: `${c.client_first_name} ${c.client_last_name}`, what: c.attention, tone: 'warn', Icon: TriangleAlert })),
    ...o.newLeads.filter(l => l.stage !== 'booked').map(l => ({ id: l.id, to: paths.lead(l.id), name: l.name, what: stageChip(l.stage)[1], tone: laneOf(l.stage).tone, Icon: PhoneIncoming })),
  ]
  const later = o.todayAppts.filter(a => a.id !== next?.id)

  return (
    <div className="tp-page fx-page fx-grid fx-ov">
      <section className="fx-tile is-hero fx-s7" style={{ '--i': 0 }} aria-label="Next up">
        <header className="fx-tile-h"><span className="tp-grow"><h2>Next up</h2><p>{next ? `${next.label}, ${next.inText}` : 'Nothing else on today'}</p></span>
          {next && <Link to={apptTo(next)} className="fx-open" aria-label={`Open ${next.who}`}><ArrowUpRight size={16} /></Link>}</header>
        {next ? (
          <div className="fx-next">
            <b className="fx-huge">{next.time.replace(/ (AM|PM)/, '')}<small>{next.time.slice(-2)}</small></b>
            <span className="fx-next-who"><Avatar name={next.who} /><span><b>{next.who}</b><small>{next.label} · today</small></span></span>
          </div>
        ) : <p className="fx-calm">The team books new appointments inside your hours.</p>}
        <ul className="fx-later">
          {later.map(a => <li key={a.id}><Link to={apptTo(a)}><Clock size={13} aria-hidden="true" />{a.time}<b>{a.who}</b></Link></li>)}
          {o.upNext.filter(a => a.date > o.todayAppts[0]?.date).slice(0, 2).map(a => <li key={a.id}><Link to={apptTo(a)}><CalendarDays size={13} aria-hidden="true" />{a.day} {a.time}<b>{a.who}</b></Link></li>)}
        </ul>
      </section>

      <Tile className="fx-s5" i={1} title="Submissions" sub="This week · resets Monday" to={paths.billing()} label="Open Billing">
        <div className="fx-ringrow">
          <span className="fx-ring">
            <svg viewBox="0 0 160 160" aria-hidden="true">
              <circle cx="80" cy="80" r="70" className="fx-ring-track" />
              <circle cx="80" cy="80" r="70" className="fx-ring-arc" style={{ '--len': ring, '--to': ring * (1 - Math.min(1, used / cap)) }} strokeDasharray={ring} transform="rotate(-90 80 80)" />
            </svg>
            <span className="fx-ring-mid"><b className="tp-num"><CountUp value={used} /></b><small>of {cap}</small></span>
          </span>
          <span className="fx-ringside">
            <b className="tp-num fx-big2"><CountUp value={cap - used} /></b><span>left this week</span>
            <Link to={paths.submit()} className="tp-primary fx-accent"><FileUp size={16} />Submit a policy</Link>
          </span>
        </div>
      </Tile>

      <Tile className="fx-s5" i={2} title="Your book" sub="Where every client stands" to={paths.clients()} label="Open Clients">
        <b className="tp-num fx-huge2"><CountUp value={clients.length} /><small> clients</small></b>
        <div className="fx-stack" role="img" aria-label={BOOK.map(([, l], i) => `${bookN[i]} ${l}`).join(', ')}>
          {BOOK.map(([k, , tone], i) => bookN[i] > 0 && <i key={k} className={`is-${tone}`} style={{ flexGrow: bookN[i], '--d': i }} />)}
        </div>
        <ul className="fx-legend">
          {BOOK.map(([k, label, tone], i) => <li key={k}><Link to={paths.clients(k)}><i className={`is-${tone}`} />{label}<b>{bookN[i]}</b><span>{Math.round((bookN[i] / bookAll) * 100)}%</span></Link></li>)}
        </ul>
      </Tile>

      <Tile className="fx-s7" i={3} title="Steps done" sub={`Last week, ${o.doneRange}`} to={paths.activity()} label="Open Activity">
        <div className="fx-chart-head"><b className="tp-num fx-huge2"><CountUp value={total} /></b><span className="fx-delta is-up">+3 on the week before</span></div>
        <StepsChart days={o.doneByDay} />
      </Tile>

      <Tile className="fx-s6" i={4} title="Needs you" sub={needs.length ? `${needs.length} waiting on you` : 'All caught up'} to={paths.leads()} label="Open Leads">
        <ul className="fx-rows">
          {needs.map(r => <li key={r.id}><Link to={r.to} className={`fx-row is-${r.tone}`}><span className="fx-row-ic"><r.Icon size={15} aria-hidden="true" /></span><span className="tp-grow"><b>{r.name}</b><small>{r.what}</small></span><ArrowUpRight size={15} aria-hidden="true" /></Link></li>)}
          {needs.length === 0 && <li className="fx-calm"><Check size={16} aria-hidden="true" />No one is waiting on you.</li>}
        </ul>
      </Tile>

      <Tile className="fx-s6" i={5} title="Coming up" sub={o.stepsOpen ? `${o.stepsOpen} steps due this week` : 'No steps due this week'} to={paths.calendar()} label="Open Calendar">
        <ul className="fx-rows">
          {o.dueSoon.map(t => (
            <li key={t.id} className={`fx-task${t.done ? ' is-done' : ''}`}>
              <span className="fx-date"><small>{t.day}</small><b>{t.date}</b></span>
              <Link to={paths.client(t.clientId)} className="tp-grow"><b>{t.label}</b><small>{t.clientName} · {t.dueAt.split(', ').pop()}</small></Link>
              {t.done ? <span className="fx-check is-on" aria-label="Done"><Check size={15} /></span> : <button type="button" className="fx-check" aria-label={`Mark ${t.label} for ${t.clientName} done`} onClick={() => doneTask(t.id)}><Check size={15} /></button>}
            </li>
          ))}
        </ul>
      </Tile>
    </div>
  )
}
