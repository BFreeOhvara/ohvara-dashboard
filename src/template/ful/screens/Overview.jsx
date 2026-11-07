import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowUpRight, Check, Clock, PhoneCall, PhoneIncoming, LifeBuoy, MessageSquare, CalendarClock } from 'lucide-react'
import { useFulDay, useFulPay, useFulAgents, minutesOf } from '../data'
import { Avatar } from '../../kit'
import { CountUp, usd } from '../../motion'
import { fp } from '../paths'
import { CALL_WORD, CALL_TONE, KIND } from '../words'
import { TrainingNudge } from '../../../fulshell/training/Training'

// P845 — the VA Overview. Same Solvik shape as the agent's (head stats, one dominant tile, a right column, colour
// carried by a few filled tiles) but VA content: the dominant tile is the next call with a live countdown and the
// whole day's calls; the right column is the queue as stage-coloured cards; under the hero, Servicing due today
// (butter) and This week's pay (sage); along the bottom, the agents this VA serves. Sample info only.
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

// mm:ss to the next call, ticking; past the hour it reads 1 h 58 min.
function useCountdown(at) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!at) return undefined
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [at])
  if (!at) return null
  const s = Math.max(0, Math.round((at - now) / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (h) return { big: `${h}h ${String(m).padStart(2, '0')}`, unit: 'min', s }
  return { big: `${m}:${String(s % 60).padStart(2, '0')}`, unit: 'min', s }
}

// P847 — movement that fits a VA's day. The next call's ring empties as the call gets closer (the last hour, one
// tick a second); the day ring fills as today's calls get done; a calls-per-hour line draws in. Reduced motion: still.
const R = 44
const LEN = 2 * Math.PI * R
function CountRing({ s, children }) {
  const left = Math.min(1, (s ?? 0) / 3600)
  return (
    <span className="fs-cring">
      <svg className="fs-cring-svg" viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r={R} className="fs-cring-track" />
        <circle cx="50" cy="50" r={R} className="fs-cring-arc" transform="rotate(-90 50 50)" style={{ strokeDasharray: LEN, strokeDashoffset: LEN * (1 - left) }} /></svg>
      {children}
    </span>
  )
}
function DayRing({ done, of }) {
  const r = 22
  const len = 2 * Math.PI * r
  const pct = of ? done / of : 0
  return (
    <span className="fx-ring fs-dring" role="img" aria-label={`${done} of ${of} calls done today`}>
      <svg viewBox="0 0 56 56"><circle cx="28" cy="28" r={r} className="fx-ring-track" /><circle cx="28" cy="28" r={r} className="fx-ring-arc" transform="rotate(-90 28 28)" style={{ strokeDasharray: len, '--len': len, '--to': len * (1 - pct) }} /></svg>
      <span className="fx-ring-mid"><b className="tp-num"><CountUp value={done} /></b></span>
    </span>
  )
}
const HOURS = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17]
function HourSpark({ calls }) {
  const n = HOURS.map(h => calls.filter(k => Math.floor(minutesOf(k.time) / 60) === h).length)
  const top = Math.max(2, ...n)
  const x = i => 4 + i * (192 / (HOURS.length - 1))
  const y = v => 44 - (v / top) * 36
  const line = n.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ')
  return (
    <svg className="fs-spark" viewBox="0 0 200 52" role="img" aria-label={`Calls per hour today: ${HOURS.map((h, i) => `${h % 12 || 12}${h < 12 ? 'am' : 'pm'} ${n[i]}`).join(', ')}`}>
      <path d={`${line} L${x(HOURS.length - 1)} 48 L${x(0)} 48 Z`} className="fs-spark-area" />
      <path d={line} pathLength="1" className="fx-line-draw fs-spark-line" />
      {n.map((v, i) => v > 0 && <circle key={HOURS[i]} cx={x(i)} cy={y(v)} r="3" className="fs-spark-dot" style={{ '--i': i }} />)}
    </svg>
  )
}

function QueueCard({ l, i }) {
  const due = l.bucket === 'callback_due'
  const tone = due ? 'warn' : 'blue'
  return (
    <article className={`fx-card fx-ncard is-${tone}`} style={{ '--i': i }}>
      <Link to={fp('queue', l.id)} className="fx-cover" aria-label={`Open ${l.name}`} />
      <span className="fx-ncard-k">{due ? <Clock size={13} aria-hidden="true" /> : <PhoneIncoming size={13} aria-hidden="true" />}{due ? 'Callback due' : 'New'}</span>
      <h3>{l.name}</h3>
      <p>{l.type} · {l.city}, {l.state}</p>
      <div className="fx-ncard-bot"><span className="fx-when">{due ? l.callback.replace('Today, ', '') : l.came.replace('Today, ', 'Came ')}</span><Avatar name={l.name} tone={tone} /></div>
    </article>
  )
}

export default function Overview() {
  const { data: day } = useFulDay()
  const { data: pay } = useFulPay()
  const { data: agents } = useFulAgents()
  const next = day.next
  const cd = useCountdown(next?.at)
  const money = usd()
  const queue = [...day.queue.callback_due, ...day.queue.new]
  const servToday = [...day.tasks.overdue, ...day.tasks.today]
  const top = Math.max(3, ...pay.byDay.map(d => d.verified + d.checking))

  return (
    <div className="tp-page fx-page fx-ovl fs-ov">
      <TrainingNudge />
      <div className="fx-ovl-main">
        <Tile className="fs-ov-hero" i={0} title="Next call" sub={next ? `Cancellation call for ${next.agent}'s client` : 'No more calls today'} to={fp('schedule')} label="Open Schedule">
          {next ? (
            <div className="fs-next">
              <div className="fs-next-l">
                <div className="fs-count-row">
                  <CountRing s={cd?.s}><PhoneCall size={20} aria-hidden="true" /></CountRing>
                  <b className="fx-huge fs-count" aria-live="off">{cd?.big}<small>{cd?.unit}</small></b>
                </div>
                <span className="fs-next-at"><CalendarClock size={14} aria-hidden="true" />Starts at {next.time}</span>
                <span className="fx-next-who"><Avatar name={next.name} tone={CALL_TONE[next.status]} /><span><b>{next.name}</b><small>Closing {next.old_carrier} · new policy {next.carrier}</small></span></span>
                <div className="tp-row tp-wrap fx-next-acts">
                  <Link to={fp('schedule', next.id)} className="tp-primary sm fx-accent"><PhoneCall size={14} />Open the call</Link>
                  <Link to={fp('messages')} className="fx-pillbtn"><MessageSquare size={14} />Message {next.agent.split(' ')[0]}</Link>
                </div>
              </div>
              <div className="fs-day-r">
              <div className="fs-daypulse">
                <DayRing done={day.done.length} of={day.today.length} />
                <span className="tp-grow"><b>{day.done.length} of {day.today.length} done today</b><small>Calls per hour</small></span>
                <HourSpark calls={day.today} />
              </div>
              <ol className="fs-dayline" aria-label="Today's calls">
                {day.today.map((k, i) => (
                  <li key={k.id} style={{ '--i': i }} className={`is-${CALL_TONE[k.status]}${k.id === next.id ? ' is-next' : ''}`}>
                    <Link to={fp('schedule', k.id)}>
                      <small className="tp-num">{k.time}</small>
                      <span className="tp-grow"><b>{k.name}</b><small>{k.agent}</small></span>
                      <span className="fs-st">{k.id === next.id ? 'Next' : CALL_WORD[k.status]}</span>
                    </Link>
                  </li>
                ))}
              </ol>
              </div>
            </div>
          ) : <p className="fx-calm"><Check size={16} aria-hidden="true" />Every call today is done. Tomorrow has {day.tomorrow.length}.</p>}
        </Tile>

        <div className="fx-ovl-pair">
          <Tile className="is-fill is-teal fs-ov-serv" i={1} title="Servicing due today" sub={`${day.tasks.overdue.length} overdue · ${day.tasks.today.length} today`} to={fp('servicing')} label="Open Servicing">
            <b className="fx-huge tp-num"><CountUp value={servToday.length} /><small>steps</small></b>
            <ul className="fx-later">
              {servToday.slice(0, 4).map(t => <li key={t.id}><Link to={fp('servicing', t.id)}><LifeBuoy size={13} aria-hidden="true" />{KIND[t.kind]}<b>{t.name}</b></Link></li>)}
            </ul>
          </Tile>

          <Tile className="is-fill is-green fs-ov-pay" i={2} title="This week's pay" sub={`Paid ${pay.payday} · ${money(pay.rate)} a cancellation`} to={fp('pay')} label="Open Pay">
            <b className="fx-huge tp-money"><CountUp value={pay.earned} format={money} /></b>
            <div className="fs-minibars" role="img" aria-label={pay.byDay.map(d => `${d.name} ${d.verified + d.checking}`).join(', ')}>
              {pay.byDay.map(d => (
                <span key={d.day} className={d.later ? 'is-later' : ''}>
                  <i style={{ '--h': (d.verified + d.checking) / top }}><em style={{ '--h': d.verified / Math.max(1, d.verified + d.checking) }} /></i>
                  <small>{d.name}</small>
                </span>
              ))}
            </div>
            <small className="fs-paynote">{money(pay.verified)} verified · {money(pay.checking)} checking</small>
          </Tile>
        </div>
      </div>

      <div className="fx-ovl-side">
        <section className="fx-tile is-deep fx-ovl-needs" style={{ '--i': 4 }} aria-label="Queue">
          <div className="fx-ovl-needs-in">
            <header className="fx-tile-h">
              <span className="tp-grow"><h2>Queue</h2><p>{day.queue.callback_due.length} callbacks due · {day.queue.new.length} new</p></span>
              <Link to={fp('queue')} className="fx-open" aria-label="Open Queue"><ArrowUpRight size={16} /></Link>
            </header>
            {queue.length > 0
              ? <div className="fx-ncards">{queue.map((l, i) => <QueueCard key={l.id} l={l} i={i} />)}</div>
              : <p className="fx-calm"><Check size={16} aria-hidden="true" />No one is waiting.</p>}
          </div>
        </section>
      </div>

      <Tile className="fx-ovl-week fs-ov-agents" i={6} title="Your agents" sub={`${agents.length} agents · ${agents.reduce((n, a) => n + a.clients, 0)} clients`} to={fp('clients')} label="Open Clients">
        <ul className="fs-agents">
          {agents.map(a => (
            <li key={a.id}>
              <Avatar name={a.name} />
              <span className="tp-grow"><b>{a.name}</b><small>{a.city} · {a.hours}</small></span>
              <span className="fs-agent-n"><b className="tp-num">{a.clients}</b><small>clients</small></span>
              <span className={`fx-delta is-${a.duty ? 'up' : 'mute'}`}>{a.duty ? 'Taking live calls' : 'Booking only'}</span>
            </li>
          ))}
        </ul>
      </Tile>
    </div>
  )
}
