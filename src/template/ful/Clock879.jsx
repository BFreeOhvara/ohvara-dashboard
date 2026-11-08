import { useEffect, useState } from 'react'
import { Clock3, LogIn, LogOut, Mic, Volume2, BellRing, Wifi, Check, X, Coffee, Repeat, CalendarX, Star, Scale, ShieldCheck, Lock } from 'lucide-react'
import { Chip, Drawer, Field, PillTabs, SampleTag, useNote } from '../kit'
import { useFulSource } from './data'
import {
  clockInCheck, DEVICE_CHECKS, deviceOk, STATUSES, statusOf, PICKABLE, breakState, mmss, MY_SHEET, hoursOf, weekPay,
  MY_SWAPS, OPEN_FOR_ME, HOLIDAYS, MY_QA, canDispute, verifyOk,
} from './p879'
import './p879.css'

// P879 — the VA's clock, status and breaks; the hourly timesheet; swaps, open shifts and holidays; call quality; and
// the caller check. Sample only (852 wires clock records, routing and pay). Pay is hourly only (Q76).
const ICON = { mic: Mic, speaker: Volume2, push: BellRing, network: Wifi }
const SHIFT_START = 8 * 60
const clk = { in: false, at: null, status: 'offline', breakAt: null, breakKind: null, pending: false } // this visit

// N-F-02, N-F-04, N-F-05: clock in only within 15 minutes of the shift (else an admin approves); clock-in runs the
// device check and routing stays off if any part fails; statuses (only Available is rung); Break/Lunch with a timer,
// "break after this call", paid or unpaid, and the admin alerted at 5 minutes over.
function ClockTileSample({ className = '' }) {
  const note = useNote()
  const [s, setS] = useState({ ...clk })
  const [checking, setChecking] = useState(false)
  const [dev, setDev] = useState({})
  const [after, setAfter] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const put = o => { Object.assign(clk, o); setS({ ...clk }) }
  useEffect(() => { if (!s.breakAt) return undefined; const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t) }, [s.breakAt])
  const [word, tone] = statusOf(s.status).slice(1)
  const br = s.breakAt ? breakState(s.breakKind, s.breakAt, now) : null
  const sampleNow = SHIFT_START + 2 // sample: 8:02 AM on clock-in
  const runCheck = () => {
    setChecking(true); setDev({})
    DEVICE_CHECKS.forEach(([k], i) => setTimeout(() => setDev(d => ({ ...d, [k]: true })), 350 * (i + 1)))
  }
  const ok = deviceOk(dev)
  const clockIn = () => {
    const c = clockInCheck(sampleNow, SHIFT_START)
    if (!c.ok) { put({ pending: true }); note('Outside the 15-minute window: an admin approves it'); return }
    put({ in: true, at: '8:02 AM', status: 'available' }); setChecking(false); note('Clocked in. Calls can ring you now.')
  }
  const setStatus = k => {
    if (k === 'break' || k === 'lunch') put({ status: k, breakAt: Date.now(), breakKind: k })
    else put({ status: k, breakAt: null, breakKind: null })
  }
  return (
    <section className={`fx-tile v879-clock ${className}`.trim()} aria-label="Clock and status">
      <header className="fx-tile-h"><span className="tp-grow"><h2>{s.in ? `Clocked in at ${s.at}` : 'Not clocked in'}</h2><p>Shift 8:00 AM to 6:00 PM · clock in up to 15 minutes either side</p></span><Chip tone={tone}>{word}</Chip></header>
      {!s.in && (
        <div className="tp-row tp-wrap">
          <button type="button" className="tp-primary fx-accent" onClick={runCheck}><LogIn size={16} />Clock in</button>
          {s.pending && <small className="tp-sub">Waiting on an admin to approve.</small>}
        </div>
      )}
      {s.in && (<>
        <div className="tp-field"><span>Status</span>
          <PillTabs role="radiogroup" label="Status" className="fx-chips fs-wrap" itemClass="fx-chip" value={s.status} onChange={setStatus}
            items={STATUSES.filter(x => PICKABLE.includes(x[0])).map(([k, w]) => ({ key: k, label: <b>{w}</b> }))} />
          <small className="tp-sub">{s.status === 'available' ? 'The next call rings you.' : 'Calls skip you until you are Available. On call and Wrap-up are set by the call.'}</small>
        </div>
        {br && <p className={`v879-band${br.over ? ' is-warn' : ''}`} role="status"><Coffee size={16} aria-hidden="true" /><span><b className="tp-num">{br.over ? `${mmss(-br.leftS)} over` : `${mmss(br.leftS)} left`}</b><small>{s.breakKind === 'lunch' ? 'Lunch' : 'Break'} · {br.paid ? 'paid' : 'unpaid'}{br.alert ? ' · the team has been told' : ' · the team is told at 5 minutes over'}</small></span></p>}
        <div className="tp-row tp-wrap">
          <label className="fx-mrow v879-after"><input type="checkbox" checked={after} onChange={e => { setAfter(e.target.checked); if (e.target.checked) note('Break starts when this call ends') }} /><span>Break after this call</span></label>
          <span className="tp-grow" />
          <button type="button" className="tp-btn ov-ghost" onClick={() => { put({ in: false, status: 'offline', breakAt: null }); note('Clocked out at 6:00 PM') }}><LogOut size={15} />Clock out</button>
        </div>
      </>)}
      <Drawer open={checking && !s.in} center onClose={() => setChecking(false)} title="Quick device check" sub="Calls can't ring you until every part passes"
        footer={<button type="button" className="tp-primary fx-accent" disabled={!ok} onClick={clockIn}><Check size={16} />Clock in</button>}>
        <ul className="tp-list">{DEVICE_CHECKS.map(([k, w]) => {
          const Icon = ICON[k]
          return <li key={k} className="fx-mrow"><Icon size={16} aria-hidden="true" /><span className="tp-grow"><b>{w}</b></span>{dev[k] ? <Chip tone="green">Works</Chip> : <Chip tone="mute">Checking</Chip>}</li>
        })}</ul>
      </Drawer>
    </section>
  )
}

// N-F-23, N-G-24: this week's hours from clock in and out, breaks, flags, and hours × rate; ask for a correction.
function TimesheetRowsSample() {
  const note = useNote()
  const [ask, setAsk] = useState(null)
  const [why, setWhy] = useState('')
  const [asked, setAsked] = useState([])
  const t = weekPay()
  return (
    <div className="v879-sheet">
      <ul className="tp-list">{MY_SHEET.map(r => (
        <li key={r.day} className="fx-mrow"><b className="v879-day">{r.d}</b>
          <span className="tp-grow"><b className="tp-num">{r.in} to {r.out || 'now'}</b><small>{r.breakM} min break{r.flag ? ` · ${r.flag}` : ''}{asked.includes(r.day) ? ' · correction asked' : ''}</small></span>
          <b className="tp-num">{hoursOf(r).toFixed(2)} h</b>
          {!r.live && !asked.includes(r.day) && <button type="button" className="tp-btn sm ov-ghost" onClick={() => setAsk(r)}>Fix</button>}
        </li>
      ))}</ul>
      <p className="tp-sub"><Lock size={12} aria-hidden="true" /> {t.hours.toFixed(2)} h so far{t.ot ? `, ${t.ot.toFixed(1)} h overtime` : ''}. The week locks at Monday's pay run; only admins can change it after that.</p>
      <Drawer open={!!ask} center onClose={() => setAsk(null)} title="Ask for a correction" sub={ask ? `${ask.d} · ${ask.in} to ${ask.out}` : ''}
        footer={<button type="button" className="tp-primary fx-accent" disabled={!why.trim()} onClick={() => { setAsked([...asked, ask.day]); setAsk(null); setWhy(''); note('Sent. An admin approves it and it is logged.') }}><Check size={16} />Send</button>}>
        <Field label="What should it say, and why"><input value={why} placeholder="e.g. Clock out 6:00 PM, the app closed on a hold" onChange={e => setWhy(e.target.value)} /></Field>
      </Drawer>
    </div>
  )
}

// N-F-07, N-F-31: ask to swap a shift, take an open shift (first to accept, an admin confirms), and the holidays.
export function SwapsHolidays() {
  const note = useNote()
  const [taken, setTaken] = useState([])
  return (
    <div className="v879-two">
      <section className="fx-tile" aria-label="Swaps and open shifts">
        <header className="fx-tile-h"><span className="tp-grow"><h2>Swaps and open shifts</h2><p>An admin confirms every change</p></span></header>
        <ul className="tp-list">
          {MY_SWAPS.map(s => <li key={s.id} className="fx-mrow"><Repeat size={16} aria-hidden="true" /><span className="tp-grow"><b>Swap {s.day} with {s.with}</b><small>{s.status}</small></span><Chip tone="blue">Asked</Chip></li>)}
          {OPEN_FOR_ME.map(s => <li key={s.id} className="fx-mrow"><CalendarX size={16} aria-hidden="true" /><span className="tp-grow"><b>Open: {s.day}</b><small className="tp-num">{s.hours} · {s.why}</small></span>
            {taken.includes(s.id) ? <Chip tone="green">Yours once confirmed</Chip> : <button type="button" className="tp-primary sm fx-accent" onClick={() => { setTaken([...taken, s.id]); note('You took it. An admin confirms it on the rota.') }}><Check size={14} />Take it</button>}</li>)}
        </ul>
        <button type="button" className="tp-btn sm ov-ghost" onClick={() => note('Sample: pick a shift and a teammate once the backend is wired')}><Repeat size={14} />Ask to swap a shift</button>
      </section>
      <section className="fx-tile" aria-label="Holidays">
        <header className="fx-tile-h"><span className="tp-grow"><h2>Holidays</h2><p>Closed and reduced days, and carrier holidays</p></span></header>
        <ul className="tp-list">{HOLIDAYS.map(h => <li key={h.id} className="fx-mrow"><CalendarX size={16} aria-hidden="true" /><span className="tp-grow"><b>{h.date} · {h.name}</b><small>{h.what}</small></span></li>)}</ul>
      </section>
    </div>
  )
}

// N-F-20 (VA view), N-F-21: my scored calls, and a dispute once per score (another admin re-reviews).
function MyQualitySample({ className = '' }) {
  const note = useNote()
  const [rows, setRows] = useState(MY_QA)
  const [ask, setAsk] = useState(null)
  const [text, setText] = useState('')
  return (
    <section className={`fx-tile ${className}`.trim()} aria-label="My call reviews">
      <header className="fx-tile-h"><span className="tp-grow"><h2>My call reviews</h2><p>Scored by an admin on the rubric</p></span><SampleTag>Sample</SampleTag></header>
      <ul className="tp-list">{rows.map(r => (
        <li key={r.id} className="fx-mrow"><Star size={16} aria-hidden="true" />
          <span className="tp-grow"><b>{r.call}</b><small>{r.when} · {r.by}: {r.notes}{r.dispute ? ` · disputed ${r.dispute.at}, the other admin re-reviews` : ''}</small></span>
          <b className="tp-num">{r.score}%</b>
          {canDispute(r) && <button type="button" className="tp-btn sm ov-ghost" onClick={() => setAsk(r)}><Scale size={14} />Dispute</button>}
        </li>
      ))}</ul>
      <Drawer open={!!ask} center onClose={() => setAsk(null)} title="Dispute this score" sub="Once per score. The other admin re-reviews and both are kept."
        footer={<button type="button" className="tp-primary fx-accent" disabled={!text.trim()} onClick={() => { setRows(x => x.map(y => (y.id === ask.id ? { ...y, dispute: { at: 'Today', text } } : y))); setAsk(null); setText(''); note('Dispute sent') }}><Check size={16} />Send</button>}>
        <Field label="What was missed" hint="Say when in the call, e.g. 0:41"><input value={text} onChange={e => setText(e.target.value)} /></Field>
      </Drawer>
    </section>
  )
}

// N-E-61: before any policy detail, check the caller's name and date of birth; an unknown number is matched first.
export function VerifyCaller({ client }) {
  const [v, setV] = useState({ name: '', dob: '' })
  const [done, setDone] = useState(false)
  const target = { name: client.name, dob: client.dob || '1961-04-12' }
  const ok = verifyOk(v, target)
  if (done) return <p className="v879-band is-green"><ShieldCheck size={16} aria-hidden="true" /><span><b>Caller checked</b><small>You can talk about the policy now.</small></span></p>
  return (
    <section className="fx-blk" aria-label="Check the caller">
      <header><h3><ShieldCheck size={16} aria-hidden="true" />Check the caller first</h3><Chip tone="warn">Before policy details</Chip></header>
      <div className="fx-form-grid">
        <Field label="Full name they give"><input value={v.name} onChange={e => setV({ ...v, name: e.target.value })} /></Field>
        <Field label="Date of birth" hint="Sample: 1961-04-12"><input type="date" value={v.dob} onChange={e => setV({ ...v, dob: e.target.value })} /></Field>
      </div>
      <div className="tp-row tp-wrap">
        <button type="button" className="tp-primary sm fx-accent" disabled={!ok} onClick={() => setDone(true)}><Check size={14} />It's them</button>
        {v.name && v.dob && !ok && <small className="adm-warn-t v879-warn"><X size={12} aria-hidden="true" />Doesn't match. Don't share policy details.</small>}
      </div>
      <p className="tp-sub"><Clock3 size={12} aria-hidden="true" /> A number we don't know? Match it to the client by name and date of birth before anything else.</p>
    </section>
  )
}

// P852 — clock in/out, the timesheet and call reviews have no tables yet (time tracking and QA are doors), so on real
// data each says so plainly instead of showing the sample.
function NotYet({ className = '', title, sub }) {
  return (
    <section className={`fx-tile ${className}`.trim()} aria-label={title}>
      <header className="fx-tile-h"><span className="tp-grow"><h2>{title}</h2><p>{sub}</p></span><Chip tone="mute">Not connected yet</Chip></header>
    </section>
  )
}
export function ClockTile(props) {
  return useFulSource() === 'real' ? <NotYet className={props.className} title="Clock in and out" sub="Starts when time tracking goes live. Until then your shift is on the rota." /> : <ClockTileSample {...props} />
}
export function TimesheetRows() {
  return useFulSource() === 'real' ? <p className="fx-calm">Your timesheet fills in from clock in and out once time tracking goes live.</p> : <TimesheetRowsSample />
}
export function MyQuality(props) {
  return useFulSource() === 'real' ? null : <MyQualitySample {...props} />
}
