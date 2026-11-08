import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowUpRight, Check, PhoneCall, LifeBuoy, MessageSquare, CalendarClock } from 'lucide-react'
import { useFulDay, useFulPay, useFulAgents, useFulSource, minutesOf } from '../data'
import { Avatar } from '../../kit'
import { CountUp, usd } from '../../motion'
import { fp } from '../paths'
import { CALL_WORD, CALL_TONE, KIND } from '../words'
import { TrainingNudge } from '../../../fulshell/training/Training'
import { ClockTile } from '../Clock879'
import { MY_SHEET, MY_RATE, hoursOf, weekPay } from '../p879'

// P845 — the VA Overview. Same Solvik shape as the agent's (head stats, one dominant tile, a right column, colour
// carried by a few filled tiles) but VA content. P907: the VA works in bookings. The dominant tile is the next booked
// call (any kind: hand-off, cancel the old policy, save, change, cancel request, callback, welcome, yearly review) with
// a live countdown and today's booked calls; the right column is a small "Next calls" box (a few rows) over the agents
// this VA serves; under the hero, Servicing booked today (teal) and This week's pay (sage). No queue, no call reviews.
// Peek rule (every VA page): when the page scrolls, the next section peeks in at the bottom; no tall box is cut off.
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

// One shape for a booked call whatever its source: the sample's Schedule items carry ref/word/label/tone; the real
// hooks still hand back cancellation call rows (the old shape), read here the same way.
const ref = k => k.ref || k.id
const toneOf = k => k.tone || CALL_TONE[k.status] || 'blue'
const wordOf = k => k.word || 'Cancel the old policy'
const labelOf = k => k.label || (k.old_carrier ? `Closing ${k.old_carrier} · new policy ${k.carrier}` : '')
const stateOf = k => (k.done ? 'Done' : k.state === 'no_answer' ? 'Try again' : CALL_WORD[k.status] && !k.word ? CALL_WORD[k.status] : 'Booked')
const isDone = k => (k.done != null ? k.done : k.status === 'cancelled' || k.status === 'passed')

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
    <span className="fx-ring fs-dring" role="img" aria-label={`${done} of ${of} booked calls done today`}>
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
    <svg className="fs-spark" viewBox="0 0 200 52" role="img" aria-label={`Booked calls per hour today: ${HOURS.map((h, i) => `${h % 12 || 12}${h < 12 ? 'am' : 'pm'} ${n[i]}`).join(', ')}`}>
      <path d={`${line} L${x(HOURS.length - 1)} 48 L${x(0)} 48 Z`} className="fs-spark-area" />
      <path d={line} pathLength="1" className="fx-line-draw fs-spark-line" />
      {n.map((v, i) => v > 0 && <circle key={HOURS[i]} cx={x(i)} cy={y(v)} r="3" className="fs-spark-dot" style={{ '--i': i }} />)}
    </svg>
  )
}

const NEXT_ROWS = 4
export default function Overview() {
  const { data: day } = useFulDay()
  const { data: pay } = useFulPay()
  const { data: agents } = useFulAgents()
  const real = useFulSource() === 'real'
  const next = day.next
  const cd = useCountdown(next?.at)
  const done = day.today.filter(isDone)
  const open = day.today.filter(k => !isDone(k))
  const upNext = (day.later || open.filter(k => !next || ref(k) !== ref(next))).slice(0, NEXT_ROWS)
  const moreToday = Math.max(0, (day.later || []).length - NEXT_ROWS)
  const servToday = [...day.tasks.overdue, ...day.tasks.today]
  const cents = usd(true)
  const hrs = weekPay()
  const hourDays = MY_SHEET.map(r => ({ day: r.day, name: r.d, h: hoursOf(r) }))
  const nextAgent = next?.agent ? next.agent.split(' ')[0] : ''

  return (
    <div className="tp-page fx-page fx-ovl fs-ov">
      <TrainingNudge />
      <div className="fx-ovl-main">
        <ClockTile />
        <Tile className="fs-ov-hero" i={0} title="Next call" sub={next ? `${wordOf(next)}${next.agent ? ` · ${nextAgent}'s client` : ''}` : 'No more booked calls today'} to={fp('schedule')} label="Open Schedule">
          {next ? (
            <div className="fs-next">
              <div className="fs-next-l">
                <div className="fs-count-row">
                  <CountRing s={cd?.s}><PhoneCall size={20} aria-hidden="true" /></CountRing>
                  <b className="fx-huge fs-count" aria-live="off">{cd?.big}<small>{cd?.unit}</small></b>
                </div>
                <span className="fs-next-at"><CalendarClock size={14} aria-hidden="true" />Booked for {next.time}</span>
                <span className="fx-next-who"><Avatar name={next.name} tone={toneOf(next)} /><span><b>{next.name}</b><small>{labelOf(next)}</small></span></span>
                <div className="tp-row tp-wrap fx-next-acts">
                  <Link to={fp('schedule', ref(next))} className="tp-primary sm fx-accent"><PhoneCall size={14} />Open the call</Link>
                  {nextAgent && <Link to={fp('messages')} className="fx-pillbtn"><MessageSquare size={14} />Message {nextAgent}</Link>}
                </div>
              </div>
              <div className="fs-day-r">
                <div className="fs-daypulse">
                  <DayRing done={done.length} of={day.today.length} />
                  <span className="tp-grow"><b>{done.length} of {day.today.length} done today</b><small>Booked calls per hour</small></span>
                  <HourSpark calls={day.today} />
                </div>
                <ol className="fs-dayline" aria-label="Today's booked calls">
                  {day.today.map((k, i) => (
                    <li key={ref(k)} style={{ '--i': i }} className={`is-${toneOf(k)}${ref(k) === ref(next) ? ' is-next' : ''}`}>
                      <Link to={fp('schedule', ref(k))}>
                        <small className="tp-num">{k.time}</small>
                        <span className="tp-grow"><b>{k.name}</b><small>{wordOf(k)}</small></span>
                        <span className="fs-st">{ref(k) === ref(next) ? 'Next' : stateOf(k)}</span>
                      </Link>
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          ) : <p className="fx-calm"><Check size={16} aria-hidden="true" />{day.today.length ? `Every booked call today is done.${day.tomorrow.length ? ` Tomorrow has ${day.tomorrow.length}.` : ''}` : real ? 'No booked calls today. The system books every call here: hand-offs, saves, changes, callbacks.' : `Every booked call today is done. Tomorrow has ${day.tomorrow.length}.`}</p>}
        </Tile>

        <div className="fx-ovl-pair fs-ov-pair">
          <Tile className="is-fill is-teal fs-ov-serv" i={1} title="Servicing today" sub={`${day.tasks.overdue.length} overdue · ${day.tasks.today.length} booked today`} to={fp('servicing')} label="Open Servicing">
            <b className="fx-huge tp-num"><CountUp value={servToday.length} /><small>steps</small></b>
            <ul className="fx-later">
              {servToday.slice(0, 3).map(t => <li key={t.id}><Link to={fp('servicing', t.id)}><LifeBuoy size={13} aria-hidden="true" />{KIND[t.kind]}<b>{t.name}</b></Link></li>)}
            </ul>
          </Tile>

          {/* P879 (Q76): pay is hourly, from clock in and out. */}
          {real ? (
            <Tile className="is-fill is-green fs-ov-pay" i={2} title="Pay" sub={`Next payday ${pay.payday}`} to={fp('pay')} label="Open Pay">
              <b className="fx-huge tp-money"><CountUp value={pay.lastWeek} format={cents} /></b>
              <small className="fs-paynote">{pay.payouts.length ? 'Your last payout' : 'No payouts yet'}. Hours from clock in and out show here once time tracking goes live.</small>
            </Tile>
          ) : (
            <Tile className="is-fill is-green fs-ov-pay" i={2} title="This week's pay" sub={`Paid ${pay.payday} · ${cents(MY_RATE)} an hour`} to={fp('pay')} label="Open Pay">
              <b className="fx-huge tp-money"><CountUp value={hrs.pay} format={cents} /></b>
              <div className="fs-minibars" role="img" aria-label={hourDays.map(d => `${d.name} ${d.h.toFixed(1)} hours`).join(', ')}>
                {hourDays.map(d => (
                  <span key={d.day}>
                    <i style={{ '--h': d.h / 11 }}><em style={{ '--h': 1 }} /></i>
                    <small>{d.name}</small>
                  </span>
                ))}
              </div>
              <small className="fs-paynote">{hrs.hours.toFixed(1)} hours so far this week</small>
            </Tile>
          )}
        </div>
      </div>

      <div className="fx-ovl-side fs-ov-side">
        {/* P907: the old Queue box, now small: today's next booked calls, a few rows. */}
        <Tile className="is-deep fs-ov-up" i={4} title="Next calls" sub={open.length ? `${open.length} still to call today` : 'Nothing left today'} to={fp('schedule')} label="Open Schedule">
          {upNext.length > 0 ? (
            <ul className="fs-uplist">
              {upNext.map(k => (
                <li key={ref(k)} className={`is-${toneOf(k)}`}>
                  <Link to={fp('schedule', ref(k))}>
                    <small className="tp-num">{k.time}</small>
                    <span className="tp-grow"><b>{k.name}</b><small>{wordOf(k)}</small></span>
                  </Link>
                </li>
              ))}
              {moreToday > 0 && <li className="fs-upmore"><Link to={fp('schedule')}>{moreToday} more today</Link></li>}
            </ul>
          ) : <p className="fx-calm"><Check size={16} aria-hidden="true" />{next ? 'Only the next call is left today.' : 'No more booked calls today.'}</p>}
        </Tile>

        <Tile className="fs-ov-agents" i={6} title="Your agents" sub={`${agents.length} agents · ${agents.reduce((n, a) => n + a.clients, 0)} clients`} to={fp('clients')} label="Open Clients">
          <ul className="fs-agents">
            {agents.map(a => (
              <li key={a.id}>
                <Avatar name={a.name} />
                <span className="tp-grow"><b>{a.name}</b><small>{[a.city, a.hours].filter(Boolean).join(' · ')}</small></span>
                <span className="fs-agent-n"><b className="tp-num">{a.clients}</b><small>clients</small></span>
              </li>
            ))}
          </ul>
        </Tile>
      </div>
    </div>
  )
}
