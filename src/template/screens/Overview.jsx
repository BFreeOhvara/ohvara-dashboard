import { Link } from 'react-router-dom'
import { ArrowUpRight, Check, Clock, CalendarDays, Phone, PhoneIncoming, TriangleAlert } from 'lucide-react'
import { planRange, rangeText } from '../../lib/planPricing'
import { useSampleOverview, useSampleClients, useSampleBilling } from '../data'
import { Avatar } from '../kit'
import { CountUp } from '../motion'
import { stageChip } from '../LeadOutcome'
import { laneOf } from '../stages'
import { paths } from '../paths'

// P840: Solvik's Overview shape. Left two thirds: one dominant tile (this week's bookings against the budget
// range, with the weekly chart), under it Your book (the one colour-filled tile) and Next up. Right third: a
// full-height Needs you column of stage-coloured cards, 2-up, scrolling inside itself. The page head carries
// clients, booked this week and the weekly budget. Sample data only.
const apptTo = a => (a.kind === 'client' ? paths.client(a.ref) : paths.lead(a.ref))
const BOOK = [['setting_up', 'Setting up'], ['needs_attention', 'Needs you'], ['requests', 'Requests']]

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

// Booked per week as a smooth line that draws itself in, over the budget range band (dashed edges).
function WeeksChart({ weeks, lo, hi }) {
  const top = Math.max(hi + 2, ...weeks.map(w => w[1]))
  const W = 640
  const H = 210
  const x = i => (i / (weeks.length - 1)) * W
  const y = v => H - (v / top) * (H - 12) - 2
  const pts = weeks.map(([, v], i) => [x(i), y(v)])
  const line = pts.reduce((d, [px, py], i) => {
    if (i === 0) return `M${px},${py}`
    const [qx, qy] = pts[i - 1]
    const cx = (qx + px) / 2
    return `${d} C${cx},${qy} ${cx},${py} ${px},${py}`
  }, '')
  const last = pts[pts.length - 1]
  return (
    <div className="fx-chart fx-wchart">
      <div className="fx-wchart-y" aria-hidden="true">{[top, hi, lo, 0].map(v => <span key={v} style={{ top: `${(y(v) / H) * 100}%` }}>{v}</span>)}</div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`Booked per week: ${weeks.map(([w, v]) => `${w} ${v}`).join(', ')}. Budget range ${lo} to ${hi}.`}>
        <defs><linearGradient id="fx-warea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style={{ stopColor: 'var(--ov-data-a)', stopOpacity: 0.34 }} /><stop offset="1" style={{ stopColor: 'var(--ov-data-a)', stopOpacity: 0 }} /></linearGradient></defs>
        <rect x="0" width={W} y={y(hi)} height={y(lo) - y(hi)} className="fx-band" />
        <line x1="0" x2={W} y1={y(hi)} y2={y(hi)} className="fx-target" />
        <line x1="0" x2={W} y1={y(lo)} y2={y(lo)} className="fx-target" />
        <path d={`${line} L${W},${H} L0,${H} Z`} fill="url(#fx-warea)" className="fx-area" />
        <path d={line} pathLength="1" className="fx-line-draw" />
        <circle cx={last[0]} cy={last[1]} r="5" className="fx-pt is-now" style={{ '--i': 3 }} />
      </svg>
      <div className="fx-xs">{weeks.map(([w], i) => <span key={w} className={i === weeks.length - 1 ? 'is-now' : ''}>{i === weeks.length - 1 ? 'This week' : w}</span>)}</div>
    </div>
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

function NeedCard({ r, i }) {
  return (
    <article className={`fx-card fx-ncard is-${r.tone}`} style={{ '--i': i }}>
      <Link to={r.to} className="fx-cover" aria-label={`Open ${r.name}`} />
      <span className="fx-ncard-k"><r.Icon size={13} aria-hidden="true" />{r.kind}</span>
      <h3>{r.name}</h3>
      <p>{r.what}</p>
      <div className="fx-ncard-bot"><span className="fx-when">{r.when}</span><Avatar name={r.name} /></div>
    </article>
  )
}

export default function Overview() {
  const { data: o } = useSampleOverview()
  const { data: clients } = useSampleClients()
  const { data: bill } = useSampleBilling()
  const wk = planRange(bill.budget.weekly, bill.budget.mode).week
  const next = o.nextAppt
  const later = o.todayAppts.filter(a => a.id !== next?.id)
  const soon = o.upNext.filter(a => a.date > o.todayAppts[0]?.date).slice(0, 2)
  const nBy = k => clients.filter(c => c.stage === k).length
  const prot = nBy('protected')
  const weeks = o.bookedByWeek
  const prev = weeks[weeks.length - 2][1]
  const status = bill.booked < wk.low ? ['Below range so far', 'mute'] : bill.booked > wk.high ? ['Above range', 'up'] : ['In range', 'up']
  const needs = [
    ...o.newLeads.filter(l => l.stage !== 'booked').map(l => ({ id: l.id, to: paths.lead(l.id), name: l.name, what: stageChip(l.stage)[1], tone: laneOf(l.stage).tone, Icon: PhoneIncoming, kind: l.kind === 'live_call' ? 'Live call' : 'Lead', when: l.stage === 'ringing' ? 'Now' : 'Today' })),
    ...o.attention.map(c => ({ id: c.id, to: paths.client(c.id), name: `${c.client_first_name} ${c.client_last_name}`, what: c.attention, tone: 'warn', Icon: TriangleAlert, kind: 'Client', when: 'Today' })),
  ]

  return (
    <div className="tp-page fx-page fx-ovl">
      <div className="fx-ovl-main">
        <Tile className="fx-ovl-hero" i={0} title="Booked this week" sub={`Your weekly budget books ${rangeText(wk)}`} to={paths.calendar()} label="Open Calendar">
          <div className="fx-chart-head">
            <b className="tp-num fx-huge"><CountUp value={bill.booked} /></b>
            <span className="fx-hero-sub">booked · range <b>{rangeText(wk)}</b> · {prev} last week</span>
            <i className={`fx-delta is-${status[1]}`}>{status[0]}</i>
          </div>
          <div className="fx-key"><span><i className="is-line" />Booked per week</span><span><i className="is-dash" />Budget range</span></div>
          <WeeksChart weeks={weeks} lo={wk.low} hi={wk.high} />
        </Tile>

        <div className="fx-ovl-pair">
          <Tile className="fx-ovl-book is-fill is-green" i={1} title="Your book" sub={`${clients.length} clients`} to={paths.clients()} label="Open Clients">
            <Ring value={prot} of={clients.length} />
            <ul className="fx-ringstats">
              {BOOK.map(([k, label]) => <li key={k}><Link to={paths.clients(k)}><small>{label}</small><b className="tp-num">{nBy(k)}</b></Link></li>)}
            </ul>
          </Tile>

          <Tile className="fx-ovl-next" i={2} title="Next up" sub={next ? `${next.label}, ${next.inText}` : 'Nothing else on today'} to={next ? apptTo(next) : paths.calendar()} label={next ? `Open ${next.who}` : 'Open Calendar'}>
            {next ? (
              <>
                <b className="fx-huge">{next.time.replace(/ (AM|PM)/, '')}<small>{next.time.slice(-2)}</small></b>
                <span className="fx-next-who"><Avatar name={next.who} /><span><b>{next.who}</b><small>{next.label} · today</small></span></span>
                <div className="tp-row tp-wrap fx-next-acts">
                  <Link to={apptTo(next)} className="tp-primary sm fx-accent"><Phone size={14} />Call {next.who.split(' ')[0]}</Link>
                  <Link to={paths.calendar()} className="fx-pillbtn"><CalendarDays size={14} />Calendar</Link>
                </div>
              </>
            ) : <p className="fx-calm">The team books new appointments inside your hours.</p>}
            <ul className="fx-later">
              {later.map(a => <li key={a.id}><Link to={apptTo(a)}><Clock size={13} aria-hidden="true" />{a.time}<b>{a.who}</b></Link></li>)}
              {soon.map(a => <li key={a.id}><Link to={apptTo(a)}><CalendarDays size={13} aria-hidden="true" />{a.day} {a.time}<b>{a.who}</b></Link></li>)}
            </ul>
          </Tile>
        </div>
      </div>

      <section className="fx-tile is-deep fx-ovl-needs" style={{ '--i': 3 }} aria-label="Needs you">
        <div className="fx-ovl-needs-in">
          <header className="fx-tile-h">
            <span className="tp-grow"><h2>Needs you</h2><p>{needs.length ? `${needs.length} waiting on you` : 'All caught up'}</p></span>
            <Link to={paths.leads()} className="fx-open" aria-label="Open Leads"><ArrowUpRight size={16} /></Link>
          </header>
          {needs.length > 0
            ? <div className="fx-ncards">{needs.map((r, i) => <NeedCard key={r.id} r={r} i={i} />)}</div>
            : <p className="fx-calm"><Check size={16} aria-hidden="true" />No one is waiting on you.</p>}
        </div>
      </section>
    </div>
  )
}
