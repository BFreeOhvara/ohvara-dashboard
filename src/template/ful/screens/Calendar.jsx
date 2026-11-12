import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { Phone, MessageSquare, CalendarClock, CircleCheck, PhoneMissed, Forward, Users, ChevronRight } from 'lucide-react'
import { useFulCalls, useFulActions, useFulSchedule, useVaBooking, useFulClock, useFulSource, minutesOf, bookedText } from '../data'
import { Chip, Drawer, Empty, Field, useNote } from '../../kit'
import { DayBox, WeekList } from '../../DayBox'
import { CalBar } from '../../CalBar'
import { SlotPick } from '../../SlotPick'
import { useOpenDay, useStickyDay } from '../../useOpenDay'
import { useClientZone } from '../../useClientZone'
import { sampleSlots, hoursLine } from '../../carriers'
import { vaSlots, freeVa, zoneAbbr } from '../../../lib/callSlots'
import { RecordDrawer } from '../../Record'
import { TaskDrawer } from './Servicing'
import { StartCall } from '../StartCall'
import { fp } from '../paths'
import { CALL_WORD, CALL_TONE } from '../words'
import { HelpDot } from '../../../fulshell/training/HelpDot'
import { GateStep } from '../Docs886'
import { useGate } from '../../docs886/data'
import { CallBody } from '../CallPanel'
import { whyShort } from '../callSteps'
import { calLanes, boxMinutes } from '../../../lib/calLanes'
import { EV_MIN_PX, clientAt, evClass, evLine2, evLook, vaResultTone } from '../../cal958'
import { EvText } from '../../CalEv'
import { useDayFirst, useSettled } from '../../useCal958'
import { clientStatus, clientStatusOf } from '../../../lib/clientCheck.js'

// P918 — Calendar: every booked call (this was the Schedule page; Schedule is now the VA's own hours). This week ·
// Next week with a chip per call type beside it; no day buttons, no Show panel, no colour key. A call opens its view
// (client, agent, why, the short script, the steps, Start call), and Start call turns on only near the call's time.
// P846 — Schedule (it was Calls): the VA's week as the same calendar the agent has, with everything they have to do
// at a time on it (P907: booked calls only, see below). Any item opens its drawer at its own address
// (/fulfillment/schedule/<id>): a cancel-the-old-policy call keeps everything the Calls page had (client facts, the
// checklist, result buttons, notes, Move, Pass on); every other booking opens its servicing drawer. Under the calendar, the week's rota (who is on which day) and the Request a day off action. Sample only.
// P854: no Week/Day toggle. The week is full width; click a day (its header, a strip chip, or empty space in its
// column) and the page switches to that day with its box sliding in from the right (shared with the agent Calendar:
// ../../DayBox, ?day= in the URL). Blocks sit by their instant on the VA's clock, the client's time beside it when it
// differs. Move and Pass on obey the 30-minute rule (lib/callSlots): a taken time is greyed out.
// P907: the VA works in bookings. The Schedule is booked calls only, every one given its time by the system: hand-off
// calls after a sale, cancelling the old policy, save calls, change requests, cancel requests, callbacks (a missed
// incoming call or a reply that needs a person), welcome calls and yearly reviews. No queue, no appointments booked for
// agents. Colour = the kind of call (four families, legend below); done is grey. A cancellation opens its call drawer;
// every other booking opens its servicing drawer here, with Move.

const START = 8 // the grid runs 8:00 AM to 6:00 PM, the carriers' hours
const ROWS = 10
const SLOT = 30 // minutes an event block covers (a block is time over name), so close times sit side by side
const HOURS = Array.from({ length: ROWS }, (_, i) => START + i)
const label12 = h => `${((h + 11) % 12) + 1} ${h < 12 ? 'AM' : 'PM'}`
const SAMPLE_NOW = '1:32 PM' // sample clock: the next call is 28 minutes after it
const WEEK_LABEL = ['This week', 'Next week']

// A cancellation call (what the Calls page's drawer was, with every part kept). Start call opens the live-call overlay.
export function CallDrawer({ id, onClose, inline = false, center = false }) {
  const { data: calls } = useFulCalls()
  const { markCall, moveCall, showLive } = useFulActions()
  const note = useNote()
  const k = calls.find(x => x.id === id) || calls[0]
  const [panel, setPanel] = useState(null)
  const notes = k.notes
  const [endNote, setEndNote] = useState('')
  // P854: Move picks a new time on the client's clock; a slot is open when a VA on shift is free then (you first).
  const book = useVaBooking()
  const found = useClientZone(k.client.state, k.client.city)
  const zone = k.tz ? { ...found, tz: k.tz, auto: true } : found
  const { today: TODAY, nowIso: NOW_ISO, bookDays: BOOK_DAYS, dayName, dateText, isoOf } = useFulClock()
  const [mDay, setMDay] = useState(k.day > TODAY ? k.day : BOOK_DAYS[1][1])
  const [mTime, setMTime] = useState('')
  const clocks = useMemo(() => sampleSlots(isoOf(mDay), zone.tz, k.old_carrier), [mDay, zone.tz, k.old_carrier, isoOf])
  const slots = vaSlots({ date: isoOf(mDay), clocks, clientTz: zone.tz, team: book.team, calls: book.calls, load: book.load, prefer: book.me, exceptId: k.id })
  const mPick = slots.find(x => x.clock === mTime && x.open && x.iso >= NOW_ISO)
  // Pass on: to another VA on shift who is free at this call's time.
  const taker = freeVa({ iso: k.iso, team: book.team, calls: book.calls, load: book.load, skip: [book.me] })
  const tone = CALL_TONE[k.status]
  const first = k.name.split(' ')[0]
  const open = k.status === 'booked' || k.status === 'no_answer'
  // P886/P899: the old policy goes once the new one is issued, before the old one's next draft.
  const gate = useGate(k.name)
  return (
    <RecordDrawer inline={inline} center={center} label={`Call with ${k.name}`} kicker={<>Cancel the old policy · {dayName(k.day)}, {dateText(k.day)} <HelpDot lesson="carrier_call" inline /></>} tone={tone} onClose={onClose}
      hero={<>
        <div className="fx-hero-top"><span className="fx-when"><CalendarClock size={13} aria-hidden="true" />{k.day === TODAY ? 'Today' : `${dayName(k.day)}, ${dateText(k.day)}`} · {k.when}</span><Chip tone={tone}>{CALL_WORD[k.status]}</Chip></div>
        <h2>{k.name}</h2>
      </>}
      actions={open ? <>
        <StartCall iso={k.iso} done={!open} blocked={!gate.open} why="Waits for the new policy to be issued" onStart={() => showLive(k.id)} />
        <button type="button" className="tp-btn ov-ghost" disabled={!gate.open} onClick={() => setPanel('cancelled')}><CircleCheck size={15} />Cancelled</button>
        <button type="button" className="tp-btn ov-ghost" onClick={() => { markCall(k.id, 'no_answer', { notes: notes || 'No answer.' }); note(`No answer logged for ${first}`) }}><PhoneMissed size={15} />No answer</button>
        <span className="tp-grow" />
        <button type="button" className="tp-btn ov-ghost" onClick={() => setPanel('move')}><CalendarClock size={15} />Move</button>
        <button type="button" className="tp-btn ov-ghost" onClick={() => setPanel('pass')}><Forward size={15} />Pass on</button>
      </> : <>
        <Link to={fp('clients', k.client_id)} className="tp-btn ov-ghost"><Users size={15} />Open client</Link>
        <span className="tp-grow" />
        <Link to={fp('messages')} className="tp-btn ov-ghost"><MessageSquare size={14} />Message {k.agent.split(' ')[0]}</Link>
      </>}>
      {/* P947 (P918 rule): a finished cancel call shows no confirmation number, just when it was done and the VA's note. */}
      {k.status === 'cancelled' && (
        <section className="fx-blk fs-done"><header><h3><CircleCheck size={16} aria-hidden="true" />Old policy cancelled</h3></header>
          <p className="tp-mid">{dayName(k.day)}, {dateText(k.day)}</p>
          {k.notes?.trim() && <p className="tp-mid fs-done-note">{k.notes.trim()}</p>}
        </section>
      )}
      {/* P931: the call panel: why, the agent's note (P923), the client, the 3 steps of the real cancel call, Texts. */}
      <CallBody item={k} oldCarrier={k.old_carrier} cancelBy={gate.old_draft} done={k.status === 'cancelled'} now={open && gate.open} bookedWhen={bookedText(k.iso, k.tz)}
        gate={open && !gate.open ? <ol className="fs-steps cp-gatebox"><GateStep who={k.name} /></ol> : null} />

      <Drawer open={panel === 'cancelled'} center onClose={() => setPanel(null)} title="Old policy cancelled" sub={`${k.name} · ${k.old_carrier}`}
        footer={<button type="button" className="tp-primary fx-accent" onClick={() => { markCall(k.id, 'cancelled', { notes: [notes, endNote.trim()].filter(Boolean).join('\n') }); note(`Old policy cancelled for ${first}`); setPanel(null) }}><CircleCheck size={16} />Save</button>}>
        <Field label="Note" hint={`Optional. ${k.agent.split(' ')[0]} sees it`}><textarea className="tp-input fx-ta" rows={3} value={endNote} placeholder="Anything worth knowing about the call" onChange={e => setEndNote(e.target.value)} /></Field>
      </Drawer>
      <Drawer open={panel === 'move'} center onClose={() => setPanel(null)} title="Move this call" sub={`${k.name} · the client's time`}
        footer={<button type="button" className="tp-primary fx-accent" disabled={!mPick} onClick={() => {
          const mine = mPick.va.id === book.me
          moveCall(k.id, mPick.iso, mPick.va.id)
          note(`Moved to ${dayName(mDay)}, ${dateText(mDay)}, ${mTime} ${zoneAbbr(zone.tz, mPick.iso)}, their time. ${first} gets a text with the new time${mine ? '' : `. ${mPick.va.name} has it now`}`)
          setPanel(null)
        }}><CalendarClock size={16} />Move it</button>}>
        <SlotPick days={BOOK_DAYS} day={mDay} onDay={setMDay} slots={slots} value={mTime} onPick={setMTime} zone={zone} place={`${k.client.city}, ${k.client.state}`}
          viewerTz={book.viewerTz} mine={book.me} notBefore={NOW_ISO} showVa label="New time" hint={hoursLine(k.old_carrier)} />
      </Drawer>
      <Drawer open={panel === 'pass'} center onClose={() => setPanel(null)} title="Pass this call on?" sub={k.name}
        footer={<><button type="button" className="tp-primary fx-accent" disabled={!taker} onClick={() => { markCall(k.id, 'passed', { passed_to: taker.id }); note(`Passed on to ${taker.name}`); setPanel(null) }}><Forward size={16} />Pass it on</button><button type="button" className="tp-btn ov-ghost" onClick={() => setPanel(null)}>Keep it</button></>}>
        {taker
          ? <p className="tp-mid">{taker.name} takes it: on shift and free at {k.when}. Use this when you can't make the time.</p>
          : <p className="tp-mid">Nobody else on shift is free at {k.when}: each has a call within 30 minutes. Move it to another time instead.</p>}
      </Drawer>
    </RecordDrawer>
  )
}




// P931: one booked call on the grid, coloured by the client's status. Defined here (not inside Calendar) so a click
// that opens the details keeps every box as it is: no remount, no replayed pop-in. P958: two lines, time · name over
// type · client time; a call that has passed with a result takes the result's colour (Done green, Couldn't reach
// orange, Passed on grey), dimmed; passed with no result yet, a "Mark result" dot.
function Ev({ e, look, top, height, lane: [k, of], link, onPick }) {
  return (
    <Link {...link} onClick={ev => onPick(e, ev)} className={`tp-ev fs-ev ${evClass(look)}${of > 1 ? ' is-lane' : ''}`} aria-label={`${e.time}, ${e.name}, ${e.word}, ${look.done ? 'done' : e.st.label}${look.mark ? ', mark the result' : ''}`}
      style={{ top: `${top}%`, height: `${height}%`, left: `calc(${(k / of) * 100}% + ${of > 1 ? 2 : 4}px)`, width: `calc(${100 / of}% - ${of > 1 ? 4 : 8}px)` }}>
      <EvText l1={`${e.time} · ${e.name}`} l2={evLine2(e.word, e.client)} mark={look.mark} />
    </Link>
  )
}

// The client behind a Calendar item (a call row's client, a task row's client), for its status colour.
const clientOfItem = e => e.row?.client || e.client || null

export default function Calendar() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { data: raw } = useFulSchedule()
  const clock = useFulClock()
  const real = useFulSource() === 'real'
  const { today: TODAY, weeks: WEEKS, dayName, dateText, dayNum } = clock
  const ALL_DAYS = WEEKS.flat()
  // The red now-line: the sample clock (1:32 PM), or the real minute on the viewer's clock.
  const NOW = real ? new Date(clock.nowIso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: clock.tz }) : SAMPLE_NOW
  const [weekPick, setWeek] = useState(0)
  const location = useLocation()
  const { day, open, close, search } = useOpenDay(ALL_DAYS, { esc: !id, isoOf: clock.isoOf })
  const { view, leaving } = useStickyDay(day)
  // P931: a VA only talks to clients whose policy is sold. Each item carries its why line and its client's status.
  const todayIso = clock.isoOf(TODAY)
  const items = useMemo(() => raw.filter(i => !clientOfItem(i)?.lead).map(i => {
    const c = clientOfItem(i)
    return { ...i, why: whyShort(i), st: clientStatus(c ? clientStatusOf(c, todayIso) : 'working'), client: clientAt(i.iso, clock.tz, i.tz) }
  }), [raw, todayIso, clock.tz])
  // P958: how each box looks: ended with a result = the result's colour, dimmed; ended with none yet = the dot.
  const nowMs = Date.parse(clock.nowIso)
  const lookOf = e => {
    const past = Date.parse(e.iso) + SLOT * 60000 <= nowMs
    return evLook({ base: e.st.tone, past, result: vaResultTone(e), needs: !e.done })
  }
  const settled = useSettled()
  const dayFirst = useDayFirst()
  // An open day (from a link) shows its own week.
  const week = view != null ? (WEEKS[1].includes(view) ? 1 : 0) : weekPick
  const ofDay = d => items.filter(i => i.day === d)
  const days = WEEKS[week]
  const cols = view != null ? [view] : days
  // P947: a call (a box in the grid, a row in the day's list or in Rest of the week) opens its details in a centred
  // pop-up over the page, at the call's own address. What was behind it stays exactly as it was: the week, or the day's
  // panel (?day= is kept), and closing the pop-up comes back to it. (This replaces P946's call inside the day panel.)
  // P958: a call's address carries its own day (?day=), so the day list behind the details is always that call's day.
  const listUrl = () => ({ pathname: fp('calendar'), search })
  const searchOf = d => { const q = new URLSearchParams(search); q.set('day', clock.isoOf(d)); return `?${q}` }
  const linkOf = e => ({ to: { pathname: fp('calendar', e.ref), search: searchOf(e.day) }, state: { fromCal: true } })
  // P958: from the week (or another day's row) the day opens first, then the details slide in over it.
  const pick = (e, ev) => {
    if (view === e.day || ev.ctrlKey || ev.shiftKey || ev.button > 0) return
    ev.preventDefault()
    dayFirst(false, () => open(e.day), () => navigate(linkOf(e).to, { state: { fromCal: true } }))
  }
  const pickWeek = w => { setWeek(w); if (day != null) close() }
  const openDay = d => open(d)
  const closeDrawer = () => (location.state?.fromCal ? navigate(-1) : navigate(listUrl(), { replace: true }))
  const goToday = () => { if (week !== 0) setWeek(0); if (view !== TODAY) open(TODAY) }
  // A booking that was moved to another VA, or handled, still opens its pop-up (it says so); the id says which kind.
  const item = items.find(i => i.ref === id)
  const kind = (item || {}).kind || (id ? (id.startsWith('cl-') ? 'call' : 'task') : null)
  const headKey = d => e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDay(d) } }

  // P931 (P929 rule): text never cuts off and boxes never overlap. P958: a box is as tall as its call and never
  // shorter than its two lines (EV_MIN_PX); close calls sit side by side.
  const gridRef = useRef(null)
  const [pxPerMin, setPx] = useState(0)
  useLayoutEffect(() => {
    const el = gridRef.current
    if (!el) return undefined
    const measure = () => setPx(el.getBoundingClientRect().height / (ROWS * 60))
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const total = ROWS * 60
  const span = boxMinutes(SLOT, EV_MIN_PX, pxPerMin)
  const startOf = e => minutesOf(e.time) - START * 60
  const lanesOf = list => calLanes(list.map(e => ({ id: e.ref, start: startOf(e), end: startOf(e) + span })))

  const list = view != null ? ofDay(view) : []
  const rest = view != null ? items.filter(i => i.day > view && days.includes(i.day)).slice(0, 4) : []

  return (
    <div className="tp-page fx-page fs-sched fs-cal">
      {/* P947: the agent Calendar's top row from the same file (CalBar): week switch with counts, clock line, Today. */}
      <CalBar week={week} onWeek={pickWeek} counts={WEEKS.map(w => items.filter(i => w.includes(i.day)).length)} clock={`Your time (${zoneAbbr(clock.tz)}) · client times beside theirs`}
        todayOn={view === TODAY} onToday={goToday}><HelpDot lesson="calendar" /></CalBar>

      <WeekList days={days} today={TODAY} onOpen={openDay} name={dayName} num={dayNum} itemsOf={ofDay} line={e => `${e.time} ${e.name}`} />

      {/* P931: the grid keeps a set hour height (ful.css) instead of squeezing into the window, so every box can be read. */}
      <div className="fx-grid" data-fold>
        <section className={`fx-tile ${view != null ? 'fx-s8 is-day' : 'fx-s12 is-week'} fx-week cal910${settled ? ' is-settled' : ''}`} style={{ '--i': 0, '--days': cols.length, '--rows': ROWS }} aria-label={view != null ? `${dayName(view)}, ${dateText(view)}` : WEEK_LABEL[week]}>
          <div className="tp-tgrid-h"><span />{cols.map(d => (
            <b key={d} role="button" tabIndex={0} aria-pressed={d === view} title={d === view ? 'Back to the week' : `Open ${dayName(d)} ${dayNum(d)}`} className={`${d === TODAY ? 'today' : ''}${d === view ? ' is-on' : ''}`} onClick={() => openDay(d)} onKeyDown={headKey(d)}>
              {dayName(d)} <span>{dayNum(d)}</span>{d === TODAY && <small>Today</small>}
            </b>
          ))}</div>
          <div className="tp-tgrid-b" ref={gridRef}>
            <div className="tp-hours">{HOURS.map(h => <span key={h}>{label12(h)}</span>)}</div>
            {cols.map(d => {
              const dayItems = ofDay(d)
              const lanes = lanesOf(dayItems)
              return (
                <div key={d} className={`tp-tcol${d === TODAY ? ' today' : ''}`} data-day={d} onClick={e => { if (view == null && e.target === e.currentTarget) openDay(d) }}>
                  {dayItems.map(e => <Ev key={e.ref} e={e} look={lookOf(e)} link={linkOf(e)} onPick={pick} lane={lanes[e.ref] || [0, 1]}
                    top={Math.max(0, Math.min(100, (startOf(e) / total) * 100))} height={(span / total) * 100} />)}
                  {d === TODAY && <i className="tp-now" style={{ top: `${((minutesOf(NOW) - START * 60) / total) * 100}%` }} aria-hidden="true" />}
                </div>
              )
            })}
          </div>
        </section>

        {view != null && (
          <DayBox title={`${dayName(view)}, ${dateText(view)}`} sub={list.length ? `${list.length} booked` : 'Nothing booked'} leaving={leaving} onClose={close}>
            <b className="tp-num fx-huge2">{list.length}<small> {list.length === 1 ? 'call' : 'calls'}</small></b>
            <ul className="fx-rows">
              {list.map(e => (
                <li key={e.ref}><Link {...linkOf(e)} className={`fx-row is-${lookOf(e).tone}${lookOf(e).done ? ' is-past' : ''}`}><span className="fx-row-ic"><Phone size={15} aria-hidden="true" /></span><span className="tp-grow"><b>{e.name}</b><small>{e.time} · {e.why}</small></span><ChevronRight size={16} aria-hidden="true" /></Link></li>
              ))}
            </ul>
            {list.length === 0 && <Empty title="A free day" sub="Nothing is booked for this day." />}
            {rest.length > 0 && <>
              <h3 className="fx-h3">Rest of the week</h3>
              <ul className="fx-rows">
                {rest.map(e => <li key={e.ref}><Link {...linkOf(e)} onClick={ev => pick(e, ev)} className={`fx-row is-${e.st.tone}`}><span className="tp-grow"><b>{e.name}</b><small>{dayName(e.day)} {e.time} · {e.why}</small></span></Link></li>)}
              </ul>
            </>}
          </DayBox>
        )}
      </div>

      {/* P958: the call's details slide in from the right over the open day (any call, on these two weeks or not); the
          day list on the right stays as it is. */}
      {id && kind === 'call' && <CallDrawer key={id} id={id} onClose={closeDrawer} />}
      {id && kind && kind !== 'call' && <TaskDrawer key={id} id={id} onClose={closeDrawer} />}
      {id && !kind && <RecordDrawer label="Not on your calendar" kicker="Calendar" onClose={closeDrawer} hero={<h2>Not on your calendar</h2>}><p className="fx-calm">That item is not here any more.</p></RecordDrawer>}
    </div>
  )
}
