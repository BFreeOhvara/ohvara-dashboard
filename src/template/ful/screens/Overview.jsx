import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowUpRight, Check, PhoneCall, MessageSquare, CalendarClock } from 'lucide-react'
import { useFulDay, useFulPay, useFulSource, minutesOf } from '../data'
import { Avatar, useAccount } from '../../kit'
import { CountUp, usd } from '../../motion'
import { fp } from '../paths'
import { CALL_TONE } from '../words'
import { TrainingTile } from '../../../fulshell/training/Training'
import { useTraining } from '../../../fulshell/training/store'
import { MY_SHEET, MY_RATE, hoursOf, weekPay } from '../p879'

// P845 — the VA Overview. Same Solvik shape as the agent's (head stats, one dominant tile, a right column, colour
// carried by a few filled tiles) but VA content. P907: the VA works in bookings. The dominant tile is the next booked
// call (any kind: hand-off, cancel the old policy, save, change, cancel request, callback, welcome, yearly review) with
// a live countdown and the day's progress (the list of today's calls is the Next calls box, not repeated here); the right column is a small "Next calls" box (a few rows) over the agents
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
const ref_ = k => k.ref || k.id
const toneOf = k => k.tone || CALL_TONE[k.status] || 'blue'
const wordOf = k => k.word || 'Cancel the old policy'
const labelOf = k => k.label || (k.old_carrier ? `Closing ${k.old_carrier} · new policy ${k.carrier}` : '')
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

// P918 — no page scroll when nothing is below: on a desktop the Overview takes exactly the room the window has
// (the tiles stretch; Today's calls scrolls inside its box when the day is long). Re-fits on resize and when the
// training box goes away. Below 1000px the page is one column at its natural height.
const MIN_H = 460
function useFillScreen(ref, deps) {
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return undefined
    const fit = () => {
      el.style.removeProperty('--ov-h')
      if (window.innerWidth < 1000) return
      // The room = the window under the Overview's top, less what sits under it (the sample note, the frame's padding).
      const app = el.closest('.tp-app')
      const col = el.closest('.tp-col') || el.parentElement
      const r = el.getBoundingClientRect()
      const below = col.getBoundingClientRect().bottom - r.bottom + (parseFloat(app && getComputedStyle(app).paddingBottom) || 0)
      const h = Math.max(MIN_H, Math.floor(window.innerHeight - (r.top + window.scrollY) - below))
      el.style.setProperty('--ov-h', `${h}px`)
      const over = document.documentElement.scrollHeight - window.innerHeight
      if (over > 0) el.style.setProperty('--ov-h', `${Math.max(MIN_H, h - over)}px`)
    }
    fit()
    const t = [setTimeout(fit, 300), setTimeout(fit, 1200)]
    window.addEventListener('resize', fit)
    return () => { t.forEach(clearTimeout); window.removeEventListener('resize', fit); el.style.removeProperty('--ov-h') }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}

// P918 — Overview: today at a glance. The next call and its countdown, today's calls, hours this week, and training
// progress until training is done (then the hours box takes the whole row). Clock in and out, time off and the rota
// are on Schedule; every booked call is on the Calendar.
export default function Overview() {
  const { data: day } = useFulDay()
  const { data: pay } = useFulPay()
  const real = useFulSource() === 'real'
  const account = useAccount()
  const { sum: tr } = useTraining(account.name)
  const ref = useRef(null)
  const next = day.next
  const cd = useCountdown(next?.at)
  const done = day.today.filter(isDone)
  const open = day.today.filter(k => !isDone(k))
  const cents = usd(true)
  const hrs = weekPay()
  const hourDays = MY_SHEET.map(r => ({ day: r.day, name: r.d, h: hoursOf(r) }))
  const nextAgent = next?.agent ? next.agent.split(' ')[0] : ''
  useFillScreen(ref, [tr.complete, day.today.length])

  return (
    <div ref={ref} className={`tp-page fx-page fx-ovl fs-ov${tr.complete ? ' is-trained' : ''}`}>
      <div className="fx-ovl-main">
        <Tile className="fs-ov-hero" i={0} title="Next call" sub={next ? `${wordOf(next)}${next.agent ? ` · ${nextAgent}'s client` : ''}` : 'No more booked calls today'} to={fp('calendar')} label="Open Calendar">
          {next ? (
            <div className="fs-next">
              <div className="fs-next-l">
                <div className="fs-count-row">
                  <CountRing s={cd?.s}><PhoneCall size={20} aria-hidden="true" /></CountRing>
                  <b className="fx-huge fs-count" aria-live="off">{cd?.big}<small>{cd?.unit}</small></b>
                </div>
                <span className="fs-next-at"><CalendarClock size={14} aria-hidden="true" />Booked for {next.time}</span>
                <span className="fx-next-who"><Avatar name={next.name} tone={toneOf(next)} /><span><b>{next.name}</b><small>{labelOf(next)}</small></span></span>
              </div>
              <div className="fs-day-r">
                <div className="tp-row tp-wrap fx-next-acts">
                  <Link to={fp('calendar', ref_(next))} className="tp-primary sm fx-accent"><PhoneCall size={14} />Open the call</Link>
                  {nextAgent && <Link to={fp('messages')} className="fx-pillbtn"><MessageSquare size={14} />Message {nextAgent}</Link>}
                </div>
                <div className="fs-daypulse">
                  <DayRing done={done.length} of={day.today.length} />
                  <span className="tp-grow"><b>{done.length} of {day.today.length} done today</b><small>Booked calls per hour</small></span>
                  <HourSpark calls={day.today} />
                </div>
              </div>
            </div>
          ) : <p className="fx-calm"><Check size={16} aria-hidden="true" />{day.today.length ? `Every booked call today is done.${day.tomorrow.length ? ` Tomorrow has ${day.tomorrow.length}.` : ''}` : real ? 'No booked calls today. The system books every call on your Calendar: hand-offs, saves, changes, callbacks.' : `Every booked call today is done. Tomorrow has ${day.tomorrow.length}.`}</p>}
        </Tile>

        <div className="fx-ovl-pair fs-ov-pair">
          {/* P879 (Q76): pay is hourly, from clock in and out. */}
          {real ? (
            <Tile className="is-fill is-green fs-ov-pay" i={1} title="Hours this week" sub={`Next payday ${pay.payday}`} to={fp('schedule')} label="Open Schedule">
              <b className="fx-huge tp-money"><CountUp value={pay.lastWeek} format={cents} /></b>
              <small className="fs-paynote">{pay.payouts.length ? 'Your last payout' : 'No payouts yet'}. Hours from clock in and out show here once time tracking goes live.</small>
            </Tile>
          ) : (
            <Tile className="is-fill is-green fs-ov-pay" i={1} title="Hours this week" sub={`${cents(hrs.pay)} so far · ${cents(MY_RATE)} an hour · paid ${pay.payday}`} to={fp('schedule')} label="Open Schedule">
              <b className="fx-huge tp-num"><CountUp value={hrs.hours} format={n => n.toFixed(1)} /><small>hours</small></b>
              <div className="fs-minibars" role="img" aria-label={hourDays.map(d => `${d.name} ${d.h.toFixed(1)} hours`).join(', ')}>
                {hourDays.map(d => (
                  <span key={d.day}>
                    <i style={{ '--h': d.h / 11 }}><em style={{ '--h': 1 }} /></i>
                    <small>{d.name}</small>
                  </span>
                ))}
              </div>
            </Tile>
          )}
          <TrainingTile i={2} />
        </div>
      </div>

      <div className="fx-ovl-side fs-ov-side">
        <Tile className="is-deep fs-ov-up" i={3} title="Today's calls" sub={day.today.length ? `${open.length} to call · ${done.length} done` : 'Nothing booked today'} to={fp('calendar')} label="Open Calendar">
          {day.today.length > 0 ? (
            <ul className="fs-uplist">
              {day.today.map(k => (
                <li key={ref_(k)} className={`is-${toneOf(k)}${isDone(k) ? ' is-done' : ''}`}>
                  <Link to={fp('calendar', ref_(k))}>
                    <small className="tp-num">{k.time}</small>
                    <span className="tp-grow"><b>{k.name}</b><small>{wordOf(k)}</small></span>
                    {isDone(k) && <Check size={15} aria-label="Done" />}
                  </Link>
                </li>
              ))}
            </ul>
          ) : <p className="fx-calm"><Check size={16} aria-hidden="true" />No booked calls today.</p>}
        </Tile>
      </div>
    </div>
  )
}
