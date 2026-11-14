import { useEffect, useState } from 'react'
import { LogIn, LogOut, Mic, Volume2, BellRing, Wifi, Check, Coffee, CalendarOff, CalendarCheck, CalendarX, Undo2, Clock3 } from 'lucide-react'
import { useFulShift, useFulSource } from '../../ful/data'
import { useDayOffActions } from '../../../hooks/useVaShiftsShell'
import { companyDay, dateLabel } from '../../../lib/vaShifts'
import { clockInCheck, DEVICE_CHECKS, deviceOk, STATUSES, statusOf, PICKABLE, breakState, mmss, OPEN_FOR_ME, HOLIDAYS } from '../../ful/p879'
import { useNote } from '../../kit'
import { BottomSheet, rise } from '../AppKit'

// P1002 — the rest of the desktop Schedule on the phone (ful/screens/Schedule.jsx, ful/Clock879.jsx): the clock (clock
// in and out, the device check, status, breaks), time off with Take it back, open shifts and the holidays. Same rules
// and the same sample data as the desktop. Like the desktop, the clock is a door until time tracking goes live (real
// data says so), and open shifts and holidays are sample only.
const ICON = { mic: Mic, speaker: Volume2, push: BellRing, network: Wifi }
const SHIFT_START = 8 * 60
const wallMs = () => Date.now()
const clk = { in: false, at: null, status: 'offline', breakAt: null, breakKind: null, pending: false } // this visit (kept across screens)

export function ClockCard() {
  const real = useFulSource() === 'real'
  return real ? <NotYet /> : <ClockSample />
}

function NotYet() {
  return (
    <section className="ma-glass ma-pad va-clock ma-rise" aria-label="Clock in and out">
      <div className="va-clock-h"><span className="ma-grow"><b>Clock in and out</b><small>Starts when time tracking goes live. Until then your shift is on the rota.</small></span><em className="va-tag">Not connected yet</em></div>
    </section>
  )
}

// Clock in only within 15 minutes of the shift (else an admin approves); clock-in runs the device check and routing
// stays off if any part fails; statuses (only Available is rung); Break/Lunch with a timer, "break after this call",
// paid or unpaid, and the admin alerted at 5 minutes over.
function ClockSample() {
  const note = useNote()
  const [s, setS] = useState({ ...clk })
  const [checking, setChecking] = useState(false)
  const [dev, setDev] = useState({})
  const [after, setAfter] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const put = o => { Object.assign(clk, o); setS({ ...clk }) }
  useEffect(() => { if (!s.breakAt) return undefined; const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t) }, [s.breakAt])
  useEffect(() => {
    if (!checking) return undefined
    const ts = DEVICE_CHECKS.map(([k], i) => setTimeout(() => setDev(d => ({ ...d, [k]: true })), 350 * (i + 1)))
    return () => ts.forEach(clearTimeout)
  }, [checking])
  const [word] = statusOf(s.status).slice(1)
  const br = s.breakAt ? breakState(s.breakKind, s.breakAt, now) : null
  const ok = deviceOk(dev)
  const clockIn = () => {
    const c = clockInCheck(SHIFT_START + 2, SHIFT_START) // sample: 8:02 AM on clock-in
    if (!c.ok) { put({ pending: true }); setChecking(false); note('Outside the 15-minute window: an admin approves it'); return }
    put({ in: true, at: '8:02 AM', status: 'available' }); setChecking(false); note('Clocked in. Calls can ring you now.')
  }
  const setStatus = k => {
    if (k === 'break' || k === 'lunch') put({ status: k, breakAt: wallMs(), breakKind: k })
    else put({ status: k, breakAt: null, breakKind: null })
  }
  return (
    <section className="ma-glass ma-pad va-clock ma-rise" aria-label="Clock and status">
      <div className="va-clock-h">
        <span className="ma-grow"><b>{s.in ? `Clocked in at ${s.at}` : 'Not clocked in'}</b><small>Shift 8:00 AM to 6:00 PM · clock in up to 15 minutes either side</small></span>
        <em className={`va-tag${s.in ? ' is-on' : ''}`}>{word}</em>
      </div>
      {!s.in && (
        <>
          <button type="button" className="ma-btn is-solid is-tall va-wide ma-press" onClick={() => { setDev({}); setChecking(true) }}><LogIn size={18} aria-hidden="true" />Clock in</button>
          {s.pending && <p className="ma-hint">Waiting on an admin to approve.</p>}
        </>
      )}
      {s.in && (
        <>
          <p className="ma-cap is-out">Status</p>
          <div className="va-chips" role="radiogroup" aria-label="Status">
            {STATUSES.filter(x => PICKABLE.includes(x[0])).map(([k, w]) => (
              <button key={k} type="button" role="radio" aria-checked={s.status === k} className={`ma-chip va-tap ma-press${s.status === k ? ' is-solid' : ''}`} onClick={() => setStatus(k)}>{w}</button>
            ))}
          </div>
          <p className="ma-hint">{s.status === 'available' ? 'The next call rings you.' : 'Calls skip you until you are Available. On call and Wrap-up are set by the call.'}</p>
          {br && (
            <p className={`va-band${br.over ? ' is-warn' : ''}`} role="status"><Coffee size={16} aria-hidden="true" />
              <span><b className="tp-num">{br.over ? `${mmss(-br.leftS)} over` : `${mmss(br.leftS)} left`}</b><small>{s.breakKind === 'lunch' ? 'Lunch' : 'Break'} · {br.paid ? 'paid' : 'unpaid'}{br.alert ? ' · the team has been told' : ' · the team is told at 5 minutes over'}</small></span>
            </p>
          )}
          <label className="va-checkrow"><input type="checkbox" checked={after} onChange={e => { setAfter(e.target.checked); if (e.target.checked) note('Break starts when this call ends') }} /><span>Break after this call</span></label>
          <button type="button" className="ma-btn is-soft is-tall va-wide ma-press" onClick={() => { put({ in: false, status: 'offline', breakAt: null }); note('Clocked out at 6:00 PM') }}><LogOut size={18} aria-hidden="true" />Clock out</button>
        </>
      )}
      <BottomSheet open={checking && !s.in} onClose={() => setChecking(false)} label="Quick device check">
        <p className="ma-sheet-t">Quick device check</p>
        <p className="ma-sheet-s">Calls can&apos;t ring you until every part passes</p>
        <div className="ma-glass ma-list">
          {DEVICE_CHECKS.map(([k, w]) => {
            const Icon = ICON[k]
            return (
              <div key={k} className="ma-row"><span className="ma-sym is-sky" aria-hidden="true"><Icon size={16} /></span><span className="ma-grow"><b>{w}</b></span>{dev[k] ? <em className="va-tag is-on">Works</em> : <em className="va-tag">Checking</em>}</div>
            )
          })}
        </div>
        <button type="button" className="ma-btn is-solid is-tall va-wide ma-press" disabled={!ok} onClick={clockIn}><Check size={18} aria-hidden="true" />Clock in</button>
      </BottomSheet>
    </section>
  )
}

// Time off: the month's allowance, the days asked (a day still ahead can be taken back), and Request a day off (the caller's button).
export function TimeOffCard({ onAsk }) {
  const { data: s } = useFulShift()
  const { cancel, check } = useDayOffActions()
  const note = useNote()
  const todayIso = s.live ? companyDay() : s.days.flat().find(d => d.today)?.date || ''
  const room = check({ date: todayIso })
  const left = Math.max(0, room.allowance - room.used)
  const mine = (s.dayOffs || []).filter(o => o.date >= todayIso).sort((a, b) => String(a.date).localeCompare(String(b.date)))
  const takeBack = o => cancel(o).then(() => note(`Took back your day off on ${dateLabel(o.date)}`), e => note(e?.message || 'That did not save. Try again.'))
  return (
    <section className="ma-glass ma-pad va-timeoff ma-rise" aria-label="Time off">
      <p className="ma-cap">Time off</p>
      <div className="va-to-big"><b className="tp-num">{left}</b><span><b>{left === 1 ? 'day' : 'days'} left this month</b><small>{room.used} of {room.allowance} used · the team covers your shift</small></span></div>
      {mine.length > 0
        ? (
          <ul className="va-offs" aria-label="Your days off">
            {mine.map(o => (
              <li key={o.id || o.date}>
                <CalendarOff size={16} aria-hidden="true" />
                <span className="ma-grow">{dateLabel(o.date)}{o.why ? ` · ${o.why}` : ''}{o.status === 'declined' ? '. The team said no, so you are on.' : ''}</span>
                {o.date > todayIso && <button type="button" className="ma-chip va-tap ma-press" onClick={() => takeBack(o)}><Undo2 size={14} aria-hidden="true" />Take it back</button>}
              </li>
            ))}
          </ul>
        )
        : <p className="va-calm"><CalendarCheck size={16} aria-hidden="true" />No days off booked.</p>}
      <button type="button" className="ma-btn is-solid is-tall va-wide ma-press" disabled={s.notSet} onClick={onAsk}><CalendarOff size={18} aria-hidden="true" />Request a day off</button>
    </section>
  )
}

// Open shifts (first to accept; an admin confirms) and the holidays. Sample only, as on the desktop.
export function OpenShifts({ i = 0 }) {
  const note = useNote()
  const [taken, setTaken] = useState([])
  return (
    <>
      <p className="ma-cap is-out">Open shifts</p>
      <div className="ma-glass ma-list ma-rise" style={rise(i)}>
        {OPEN_FOR_ME.map(x => (
          <div key={x.id} className="ma-row">
            <span className="ma-sym is-butter" aria-hidden="true"><CalendarX size={16} /></span>
            <span className="ma-grow"><b>Open: {x.day}</b><small className="tp-num">{x.hours} · {x.why}</small></span>
            {taken.includes(x.id)
              ? <em className="va-tag is-on">Yours once confirmed</em>
              : <button type="button" className="ma-chip va-tap is-solid ma-press" onClick={() => { setTaken([...taken, x.id]); note('You took it. An admin confirms it on the rota.') }}><Check size={14} aria-hidden="true" />Take it</button>}
          </div>
        ))}
      </div>
      <p className="ma-hint">An admin confirms every change.</p>
    </>
  )
}

export function Holidays({ i = 0 }) {
  return (
    <>
      <p className="ma-cap is-out">Holidays</p>
      <div className="ma-glass ma-list ma-rise" style={rise(i)}>
        {HOLIDAYS.map(h => (
          <div key={h.id} className="ma-row"><span className="ma-sym is-stone" aria-hidden="true"><Clock3 size={16} /></span><span className="ma-grow"><b>{h.date} · {h.name}</b><small>{h.what}</small></span></div>
        ))}
      </div>
      <p className="ma-hint">Closed and reduced days, and carrier holidays.</p>
    </>
  )
}
