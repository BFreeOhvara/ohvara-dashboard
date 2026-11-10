import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowUpRight, Check, PhoneCall, MessageSquare, CalendarClock, GraduationCap, ArrowRight, Clock3, Wallet, CalendarOff, MessageSquareText, Building2, Target, Sparkles } from 'lucide-react'
import { useFulDay, useFulPay, useFulSource, useFulActions, minutesOf } from '../data'
import { Avatar, useAccount } from '../../kit'
import { CountUp, usd } from '../../motion'
import { fp } from '../paths'
import { CALL_TONE } from '../words'
import { useTraining, useLessons } from '../../../fulshell/training/store'
import { MY_SHEET, MY_RATE, hoursOf, weekPay } from '../p879'
import { StartCall } from '../StartCall'
import { whyLine } from '../callSteps'
import { useGate } from '../../docs886/data'
import { useTimeOff } from '../useTimeOff'
import { dateLabel } from '../../../lib/vaShifts'
import { TRAIN_FIRST } from '../../../lib/trainingGate.js'
import Chart from '../../Chart'
import '../../rowbtn936.css'
import './overview946.css'

const HOUR_SERIES = [{ key: 'h', label: 'Hours', color: 'var(--ox-1)' }]

// P946 — the VA Overview, reworked. The next call is the hero and uses the whole box: the countdown and Start call
// (on 5 minutes before) on the left; the client, why we're calling, the agent's note and the carrier on the right; the
// day's progress along the bottom. Training shows once, as one card, until it's finished. Under the hero three small
// tiles: hours this week, pay so far, time off left. On the right, today's calls as filled cards in the status colours
// the agent side uses (done ones go grey). Nothing scrolls inside a box: the page fits, or scrolls as a whole.
function Tile({ className = '', i, title, sub, icon: Icon, to, label, children }) {
  return (
    <section className={`fx-tile ${className}`} style={{ '--i': i }} aria-label={title}>
      <header className="fx-tile-h">
        {Icon && <span className="ov946-ic" aria-hidden="true"><Icon size={16} /></span>}
        <span className="tp-grow"><h2>{title}</h2>{sub && <p>{sub}</p>}</span>
        {to && <Link to={to} className="fx-open" aria-label={label || `Open ${title}`}><ArrowUpRight size={16} /></Link>}
      </header>
      {children}
    </section>
  )
}

// One shape for a booked call whatever its source: the sample's Calendar items carry ref/word/label/tone; the real
// hooks still hand back cancellation call rows (the old shape), read here the same way.
const ref_ = k => k.ref || k.id
const toneOf = k => k.tone || CALL_TONE[k.status] || 'blue'
const wordOf = k => k.word || 'Cancel the old policy'
const isDone = k => (k.done != null ? k.done : k.status === 'cancelled' || k.status === 'passed')
const rowOf = k => k.row || k
const first = n => String(n || '').split(' ')[0]

// mm:ss to the next call, ticking; past the hour it reads 1h 58.
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

// The next call's ring empties as the call gets closer (the last hour); the day ring fills as calls get done.
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
  const x = i => 4 + i * (392 / (HOURS.length - 1))
  const y = v => 44 - (v / top) * 36
  const line = n.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ')
  return (
    <svg className="fs-spark ov946-spark" viewBox="0 0 400 52" preserveAspectRatio="none" role="img" aria-label={`Booked calls per hour today: ${HOURS.map((h, i) => `${h % 12 || 12}${h < 12 ? 'am' : 'pm'} ${n[i]}`).join(', ')}`}>
      <path d={`${line} L${x(HOURS.length - 1)} 48 L${x(0)} 48 Z`} className="fs-spark-area" />
      <path d={line} pathLength="1" className="fx-line-draw fs-spark-line" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

// What the hero says about the client: why we're calling, the agent's note (P923: what they wrote on Submit for
// servicing, else the booking's own note) and the carrier (old to new on a cancellation).
function callFacts(next) {
  const r = rowOf(next)
  const c = r.client || {}
  const note = c.brief?.note || r.note || null
  const carrier = r.old_carrier ? `${r.old_carrier} to ${r.carrier || c.carrier_name}` : r.carrier || c.carrier_name || ''
  return { why: whyLine(r), note, carrier, phone: c.client_phone || '', place: [c.city, c.state].filter(Boolean).join(', ') }
}

// P946: training shows once. One clear card until every lesson is passed; then it's gone.
function TrainingCard({ sum, i }) {
  const lessons = useLessons()
  const next = lessons.find(l => l.id === sum.next)
  return (
    <section className="fx-tile is-fill is-blue ov946-train" style={{ '--i': i }} aria-label="Training">
      <span className="ov946-train-ic" aria-hidden="true"><GraduationCap size={22} /></span>
      <span className="tp-grow">
        <h2>{TRAIN_FIRST}</h2>
        <p>No calls are given or booked to you until it's done · {sum.passed} of {sum.total} lessons{next ? ` · next: ${next.title}` : ''}</p>
        <span className="ov946-bar" role="progressbar" aria-label="Training done" aria-valuemin={0} aria-valuemax={sum.total} aria-valuenow={sum.passed}><i style={{ '--p': sum.pct }} /></span>
      </span>
      <Link to={next ? fp('training', next.id) : fp('training')} className="tp-primary fx-accent">{sum.passed ? 'Keep going' : 'Start training'}<ArrowRight size={15} /></Link>
    </section>
  )
}

export default function Overview() {
  const { data: day } = useFulDay()
  const { data: pay } = useFulPay()
  const real = useFulSource() === 'real'
  const account = useAccount()
  const { sum: tr } = useTraining(account.name)
  const { showLive, startTask } = useFulActions()
  const off = useTimeOff()
  const next = day.next
  const cd = useCountdown(next?.at)
  const gate = useGate(next?.name || '')
  const done = day.today.filter(isDone)
  const open = day.today.filter(k => !isDone(k))
  const cents = usd(true)
  const hrs = weekPay()
  const hourDays = MY_SHEET.map(r => ({ name: r.d, h: hoursOf(r), live: r.live }))
  const agent = next?.agent ? first(next.agent) : ''
  const facts = next ? callFacts(next) : null
  const cancel = next && (next.kind === 'call' || next.type === 'cancel_old')
  // Start call (P918): on 5 minutes before the call; never before training is done; a cancellation also waits for
  // the new policy to be issued (P886). It starts the call on the phone like the Calendar's Start call.
  const start = () => {
    if (!next) return
    if (cancel) showLive(next.id)
    else { startTask?.(next.id); showLive({ kind: 'task', id: next.id }) }
  }
  const blocked = !tr.complete || (cancel && !gate.open)
  const blockWhy = !tr.complete ? TRAIN_FIRST : 'Waits for the new policy to be issued'

  return (
    <div className={`tp-page fx-page fx-ovl fs-ov ov946${tr.complete ? ' is-trained' : ''}`}>
      <div className="fx-ovl-main">
        <Tile className="ov946-hero" i={0} title="Next call" icon={PhoneCall}
          sub={next ? `${wordOf(next)}${agent ? ` · ${agent}'s client` : ''}` : 'No more booked calls today'} to={fp('calendar')} label="Open Calendar">
          {next ? (
            <div className="ov946-next">
              <div className="ov946-when">
                <div className="ov946-count">
                  <div className="fs-count-row">
                    <CountRing s={cd?.s}><PhoneCall size={22} aria-hidden="true" /></CountRing>
                    <b className="fx-huge fs-count" aria-live="off">{cd?.big}<small>{cd?.unit}</small></b>
                  </div>
                  <span className="fs-next-at"><CalendarClock size={14} aria-hidden="true" />Booked for {next.time}{next.when && next.when !== next.time ? ` · ${next.when.replace(next.time, '').replace(/^\s*·?\s*/, '')}` : ''}</span>
                </div>
                <div className="ov946-acts">
                  <StartCall iso={next.iso} blocked={blocked} why={blockWhy} onStart={start} className="tp-primary fx-accent ov946-start" />
                  <Link to={fp('calendar', ref_(next))} className="tp-btn ov-ghost">Open the call</Link>
                  {agent && <Link to={fp('messages')} className="fx-pillbtn"><MessageSquare size={14} />Message {agent}</Link>}
                </div>
                {blocked && <small className="ov946-why">{blockWhy}</small>}
              </div>
              <div className="ov946-who">
                <span className="fx-next-who ov946-client"><Avatar name={next.name} tone={toneOf(next)} />
                  <span className="tp-grow"><b>{next.name}</b><small>{[facts.place, facts.phone].filter(Boolean).join(' · ') || wordOf(next)}</small></span>
                </span>
                <dl className="ov946-facts">
                  <div><dt><Target size={14} aria-hidden="true" />Why we're calling</dt><dd>{facts.why}</dd></div>
                  <div className={facts.note ? '' : 'is-none'}><dt><MessageSquareText size={14} aria-hidden="true" />{agent ? `${agent}'s note` : 'Agent\'s note'}</dt><dd>{facts.note ? <q>{facts.note}</q> : 'No note on this one.'}</dd></div>
                  {facts.carrier && <div><dt><Building2 size={14} aria-hidden="true" />Carrier</dt><dd>{facts.carrier}</dd></div>}
                </dl>
              </div>
            </div>
          ) : (
            <p className="fx-calm ov946-calm"><Check size={16} aria-hidden="true" />{day.today.length ? `Every booked call today is done.${day.tomorrow.length ? ` Tomorrow has ${day.tomorrow.length}.` : ''}` : real ? 'No booked calls today. The system books every call on your Calendar: hand-offs, saves, changes, callbacks.' : `Every booked call today is done. Tomorrow has ${day.tomorrow.length}.`}</p>
          )}
          {day.today.length > 0 && (
            <div className="fs-daypulse ov946-pulse">
              <DayRing done={done.length} of={day.today.length} />
              <span className="ov946-pulse-t"><b>{done.length} of {day.today.length} done today</b><small>{open.length} still to call · booked calls per hour</small></span>
              <HourSpark calls={day.today} />
            </div>
          )}
        </Tile>

        {!tr.complete && (
          <TrainingCard sum={tr} i={1} />
        )}

        <div className="ov946-trio">
          {/* P879/P945: pay is hourly, on the scheduled hours minus days off. Real: shows once the rota is set. */}
          <Tile className="is-fill is-green ov946-hours" i={2} title="Hours this week" icon={Clock3} to={fp('schedule')} label="Open Schedule"
            sub={real ? 'Fills in from your rota' : `${MY_SHEET.length} shifts · 8 AM to 6 PM`}>
            {real ? <b className="fx-huge tp-num">0<small>hours</small></b> : <>
              <b className="fx-huge tp-num"><CountUp value={hrs.hours} format={n => n.toFixed(1)} /><small>hours</small></b>
              <Chart tone="fill" compact yAxis={false} legend={false} height={56} className="fs-hourchart ov946-chart"
                format={n => `${n.toFixed(1)} h`} series={HOUR_SERIES}
                label={hourDays.map(d => `${d.name} ${d.h.toFixed(1)} hours`).join(', ')}
                data={hourDays.map(d => ({ name: d.name, today: !!d.live, h: d.h }))} />
            </>}
          </Tile>
          <Tile className="is-fill is-teal ov946-pay" i={3} title="Pay so far" icon={Wallet} to={fp('pay')} label="Open Pay"
            sub={`${cents(MY_RATE)} an hour`}>
            <b className="fx-huge tp-money"><CountUp value={real ? 0 : hrs.pay} format={cents} /></b>
            <small className="ov946-foot">Next payday {pay.payday}</small>
          </Tile>
          <Tile className="ov946-off" i={4} title="Time off" icon={CalendarOff} to={fp('schedule')} label="Open Schedule"
            sub={`${off.allowance} days a month`}>
            <b className="fx-huge tp-num"><CountUp value={off.left} /><small>{off.left === 1 ? 'day left' : 'days left'}</small></b>
            <small className="ov946-foot">{off.notSet ? 'Shows once your rota is set' : off.next ? `Next off ${dateLabel(off.next.date)}` : 'No days off booked'}</small>
          </Tile>
        </div>
      </div>

      <div className="fx-ovl-side fs-ov-side">
        <Tile className="is-deep ov946-today" i={5} title="Today's calls" icon={Sparkles}
          sub={day.today.length ? `${open.length} to call · ${done.length} done` : 'Nothing booked today'} to={fp('calendar')} label="Open Calendar">
          {day.today.length > 0 ? (
            <ul className="ov946-cards">
              {day.today.map((k, i) => {
                const isNext = next && ref_(k) === ref_(next)
                return (
                  <li key={ref_(k)} style={{ '--i': i }}>
                    <Link to={fp('calendar', ref_(k))} className={`ov946-card is-${isDone(k) ? 'mute' : toneOf(k)}${isDone(k) ? ' is-done' : ''}${isNext ? ' is-next' : ''}`}
                      aria-label={`${k.time}, ${k.name}, ${wordOf(k)}${isDone(k) ? ', done' : isNext ? ', next' : ''}`}>
                      <b className="tp-num ov946-t">{k.time}</b>
                      <span className="tp-grow"><b>{k.name}</b><small>{wordOf(k)}</small></span>
                      {isDone(k) ? <span className="ov946-tag"><Check size={13} aria-hidden="true" />Done</span> : isNext ? <span className="ov946-tag is-next">Next</span> : null}
                    </Link>
                  </li>
                )
              })}
            </ul>
          ) : <p className="fx-calm"><Check size={16} aria-hidden="true" />No booked calls today.</p>}
        </Tile>
      </div>
    </div>
  )
}
