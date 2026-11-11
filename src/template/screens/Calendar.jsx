import { useLayoutEffect, useRef, useState } from 'react'
import '../leads873.css'
import { Link, useSearchParams } from 'react-router-dom'
import { Phone, MapPin, ChevronRight, Clock, ClipboardCheck, CalendarX2, Settings2, Ban } from 'lucide-react'
import { CountUp } from '../motion'
import { useSampleAppointments, useSampleLeads, useSampleClients, useSampleSettings, useSampleActions, useSampleBlocks, useWeek, AGENT_TZ, onAgentClock } from '../data'
import { Drawer, Empty, Chip, Field, useNote } from '../kit'
import { Select } from '../Select'
import { HoursEditor, CalendarConnect, ClashList } from '../Hours'
import { clashes } from '../hoursModel'
import { leadText } from '../leadTexts'
import '../p878.css'
import { needsOutcome, clockNow } from '../leadLifecycle'
import { stageChip } from '../LeadOutcome'
import { paths } from '../paths'
import { DayBox, WeekList } from '../DayBox'
import { CalBar } from '../CalBar'
import { LeadDrawer } from './Leads'
import '../cal910.css'
import { useOpenDay, useStickyDay } from '../useOpenDay'
import { blockTime, clockOf, zoneAbbr, dateOf } from '../../lib/callSlots'
import { calLanes, boxMinutes } from '../../lib/calLanes'

// P848: the week shown comes from data useWeek (the sample week of Nov 2, or the real current week).
const START = 9 // the grid runs 9:00 AM to 6:00 PM, your working hours
const HOURS = Array.from({ length: 9 }, (_, i) => START + i)
const label12 = h => `${((h + 11) % 12) + 1} ${h < 12 ? 'AM' : 'PM'}`

// P878 (N-K-04, N-C-38, N-H-13): your hours per weekday and your calendar link, with any booked appointments the new
// hours would leave out listed to Keep or Move.
export function HoursDrawer({ open, onClose, settings, appts }) {
  const { saveWeek, connectCalendar, moveAppts } = useSampleActions()
  const note = useNote()
  const [week, setWeek] = useState(settings.week)
  const [choice, setChoice] = useState({})
  const hit = clashes(appts, week)
  const save = () => {
    const move = hit.filter(a => choice[a.id] === 'move').map(a => a.id)
    saveWeek(week)
    if (move.length) moveAppts(move)
    note(move.length ? `Hours saved. ${move.length} moved: they got a link to pick a new time` : 'Hours saved')
    onClose()
  }
  return (
    <Drawer open={open} onClose={onClose} title="Your hours and calendar" sub="New appointments are only booked inside these hours"
      footer={<><button type="button" className="tp-primary fx-accent" onClick={save}>Save hours</button><button type="button" className="tp-btn ov-ghost" onClick={onClose}>Cancel</button></>}>
      <HoursEditor week={week} onChange={setWeek} tz={settings.timeZone} />
      <ClashList items={hit} choice={choice} onChoice={setChoice} title="Booked appointments outside these hours" />
      <CalendarConnect value={settings.calendarSync} onPick={p => { connectCalendar(p); note(p ? 'Sample: calendar linking opens later' : 'Using your Ohvara calendar') }} />
    </Drawer>
  )
}

// Block a whole day off: anything booked that day is listed to Keep or Move.
export function BlockDrawer({ open, onClose, appts, blocked }) {
  const { days: DAYS, monOf } = useWeek()
  const { blockDay, unblockDay } = useSampleActions()
  const note = useNote()
  const [day, setDay] = useState('Fri')
  const [choice, setChoice] = useState({})
  const hit = clashes(appts.filter(a => a.day === day), {}, [day])
  const isBlocked = blocked.includes(day)
  return (
    <Drawer open={open} onClose={onClose} title="Block a day" sub="Nothing new is booked on a blocked day"
      footer={<>{isBlocked
        ? <button type="button" className="tp-primary fx-accent" onClick={() => { unblockDay(day); note(`${day} open again`); onClose() }}>Open {day} again</button>
        : <button type="button" className="tp-primary fx-accent" onClick={() => { blockDay(day, hit.filter(a => choice[a.id] === 'move').map(a => a.id)); note(`${day} blocked`); onClose() }}><Ban size={15} />Block {day}</button>}
        <button type="button" className="tp-btn ov-ghost" onClick={onClose}>Cancel</button></>}>
      <Field label="Day"><Select label="Day" value={day} onChange={v => { setDay(v); setChoice({}) }} options={DAYS.map(([d, n]) => ({ value: d, label: `${d}, ${monOf(n)} ${n}${blocked.includes(d) ? ' · blocked' : ''}` }))} /></Field>
      {!isBlocked && <ClashList items={hit} choice={choice} onChoice={setChoice} title={`Booked on ${day}`} />}
      {!isBlocked && hit.length === 0 && <p className="tp-sub">Nothing booked that day.</p>}
    </Drawer>
  )
}

// "Can't make it" on a lead's appointment (N-C-36): an automatic apology and a one-tap rebook link go out.
export function CantMakeIt({ appt, lead, onClose }) {
  const { monOf } = useWeek()
  const { cantMakeIt } = useSampleActions()
  const note = useNote()
  if (!appt || !lead) return null
  return (
    <Drawer open onClose={onClose} title="Can't make it?" sub={`${appt.who} · ${appt.day}, ${monOf(appt.date)} ${appt.date}, ${appt.time}`}
      footer={<><button type="button" className="tp-primary fx-accent" onClick={() => { cantMakeIt(appt.id); note(`${lead.first_name} got your apology and a link to pick a new time`); onClose() }}><CalendarX2 size={15} />Send and free the time</button><button type="button" className="tp-btn ov-ghost" onClick={onClose}>Keep it</button></>}>
      <p className="tp-sub">{lead.first_name} gets this text right away. If they don{'’'}t pick a new time, our team calls them.</p>
      <div className="tp-chat"><div className="tp-bub me">{leadText('cant_make_it', { lead: lead.first_name, appt: `${appt.day} at ${appt.time}` })}<small>Deedstone · sends when your leads go live</small></div></div>
    </Drawer>
  )
}
// '3:30 PM' -> minutes after 9:00 AM
const BOX_MIN_PX = 58 // P929: the time, the name and the label fit
function minutesIn(time) {
  const [, h, m, ap] = /(\d+):(\d+)\s*(AM|PM)/.exec(time) || [0, 9, 0, 'AM']
  return ((Number(h) % 12) + (ap === 'PM' ? 12 : 0) - START) * 60 + Number(m)
}

// P910: no row of day buttons above the grid; a This week · Next week toggle instead (next week can be empty). Each
// day header and each row is a real button: pointer, hover, pressed.
const MONS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const plusDays = (iso, n) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10)
const WEEKS = [{ key: 'this', label: 'This week' }, { key: 'next', label: 'Next week' }]

// The week as a time grid at full width (desktop); click a day to open it (P854, the same as the VA Schedule: the
// grid narrows to that day and its box slides in; ?day= in the URL). On a phone, the week as a list; a day opens full
// screen. Each appointment is placed by its instant on your clock (Settings zone), with the client's time beside it
// when theirs differs.
export default function Calendar() {
  const week = useWeek()
  const [wk, setWk] = useState('this')
  // [weekday, day of month, month, iso] for the week on screen.
  const WEEK_DAYS = week.days.map(([d, n]) => {
    const iso = wk === 'next' ? plusDays(week.isoOf(n), 7) : week.isoOf(n)
    return [d, Number(iso.slice(8, 10)), MONS[Number(iso.slice(5, 7)) - 1], iso]
  })
  const DAYS = WEEK_DAYS
  const NUMS = WEEK_DAYS.map(d => d[1])
  const nameOf = n => WEEK_DAYS.find(d => d[1] === n)?.[0] || ''
  const monOf = n => WEEK_DAYS.find(d => d[1] === n)?.[2] || ''
  const isoOf = n => WEEK_DAYS.find(d => d[1] === n)?.[3] || null
  const TODAY = wk === 'this' ? week.today : null
  const weekIsos = key => week.days.map(([, n]) => (key === 'next' ? plusDays(week.isoOf(n), 7) : week.isoOf(n)))
  const NOW_TIME = week.time
  // P929: grid pixels per minute, so a box is never shorter than its words.
  const gridRef = useRef(null)
  const [pxPerMin, setPxPerMin] = useState(0)
  useLayoutEffect(() => {
    const el = gridRef.current
    if (!el) return undefined
    const col = () => el.querySelector('.tp-tcol')
    const read = () => { const h = col()?.getBoundingClientRect().height || 0; setPxPerMin(h ? h / (HOURS.length * 60) : 0) }
    read()
    if (typeof ResizeObserver === 'undefined') return undefined
    const ro = new ResizeObserver(read)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const { data: raw } = useSampleAppointments()
  const { data: leads } = useSampleLeads()
  const { data: clients } = useSampleClients()
  const { data: settings } = useSampleSettings()
  const note = useNote()
  const { data: blocked } = useSampleBlocks()
  const [open, setOpen] = useState(null)
  const [panel, setPanel] = useState(null)
  const [cant, setCant] = useState(null)
  const tz = settings.timeZone || AGENT_TZ
  const events = raw.map(e => (e.iso ? { ...e, ...onAgentClock(e.iso, tz), on: dateOf(e.iso, tz), when: blockTime(e.iso, tz, e.tz) } : { ...e, on: week.isoOf(e.date), when: e.time }))
  const { day, open: openDay, close } = useOpenDay(NUMS, { esc: !open, isoOf })
  const { view, leaving } = useStickyDay(day)
  const ref = open && (open.kind === 'lead' ? leads.find(l => l.id === open.ref) : clients.find(c => c.id === open.ref))
  const phone = ref && (ref.phone || ref.client_phone)
  const place = ref && `${ref.city}, ${ref.state}`
  // P873: a lead's appointment card shows where the lead is now, and asks how it went once it has ended.
  const leadRef = open?.kind === 'lead' ? ref : null
  const ask = leadRef && needsOutcome(leadRef, clockNow())
  const shown = view != null ? DAYS.filter(([, d]) => d === view) : DAYS
  const ofDay = d => events.filter(e => e.on === isoOf(d)).sort((a, b) => minutesIn(a.time) - minutesIn(b.time))
  const list = view != null ? ofDay(view) : []
  // P947: Today (CalBar) goes back to this week and opens today's day.
  // On Next week the day can't be opened by its number (that week's numbers are on screen), so it goes in the URL directly.
  const [, setParams] = useSearchParams()
  const goToday = () => {
    if (wk === 'this') { if (view !== week.today) openDay(week.today); return }
    setWk('this')
    setParams(p => { const q = new URLSearchParams(p); q.set('day', week.isoOf(week.today)); return q }, { state: { dayBox: true } })
  }
  const headKey = n => e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDay(n) } }
  // P929: boxes never overlap. Each box is as tall as its call (never shorter than it can be read); boxes that would
  // touch sit side by side, as many columns as the busiest moment needs (lib/calLanes).
  const total = HOURS.length * 60
  const span = e => boxMinutes(e.mins || e.duration, BOX_MIN_PX, pxPerMin)
  const lanesOf = list => calLanes(list.map(e => ({ id: e.id, start: minutesIn(e.time), end: minutesIn(e.time) + span(e) })))
  const Ev = ({ e, lane: [k, of] }) => (
    <button type="button" className={`tp-ev ${e.kind}${of > 1 ? ' is-lane' : ''}`} onClick={() => setOpen(e)}
      style={{ top: `${(minutesIn(e.time) / total) * 100}%`, height: `${(span(e) / total) * 100}%`, minHeight: 0, left: `calc(${(k / of) * 100}% + ${of > 1 ? 2 : 4}px)`, width: `calc(${100 / of}% - ${of > 1 ? 4 : 8}px)` }}>
      <b>{e.when}</b><span>{e.who}</span><small>{e.label}</small>
    </button>
  )
  return (
    <div className="tp-page fx-page">
      {/* P947: the one calendar top row (CalBar.jsx), the same file the VA and admin calendars use; Today jumps to this
          week and opens today. Hours and Block a day are the agent's own buttons after it. */}
      <CalBar week={wk} keys={WEEKS.map(w => w.key)} onWeek={k => { if (view != null) close(); setWk(k) }} counts={WEEKS.map(w => events.filter(e => weekIsos(w.key).includes(e.on)).length)}
        clock={`Your time (${zoneAbbr(tz)}) · client times beside theirs`} todayOn={view != null && view === TODAY} onToday={goToday}>
        <button type="button" className="fx-pillbtn" onClick={() => setPanel('hours')}><Settings2 size={14} aria-hidden="true" />Hours</button>
        <button type="button" className="fx-pillbtn" onClick={() => setPanel('block')}><Ban size={14} aria-hidden="true" />Block a day</button>
      </CalBar>

      <WeekList days={NUMS} today={TODAY} onOpen={openDay} name={nameOf} itemsOf={ofDay} line={e => `${e.time} ${e.who}`} />

      <div className="fx-grid" data-fold data-fold-fit="360">
        <section className={`fx-tile ${view != null ? 'fx-s8 is-day' : 'fx-s12 is-week'} fx-week cal910`} data-week={wk} style={{ '--i': 0, '--days': shown.length }} aria-label={view != null ? `${nameOf(view)}, ${monOf(view)} ${view}` : wk === 'next' ? 'Next week' : 'This week'}>
          <div className="tp-tgrid-h"><span />{shown.map(([d, n]) => (
            <b key={d} role="button" tabIndex={0} aria-pressed={n === view} title={n === view ? 'Back to the week' : `Open ${d} ${n}`} className={`${n === TODAY ? 'today' : ''}${n === view ? ' is-on' : ''}`} onClick={() => openDay(n)} onKeyDown={headKey(n)}>
              {d} <span>{n}</span>{n === TODAY && <small>Today</small>}
            </b>
          ))}</div>
          <div className="tp-tgrid-b" ref={gridRef}>
            <div className="tp-hours">{HOURS.map(h => <span key={h}>{label12(h)}</span>)}</div>
            {shown.map(([d, n]) => (
              <div key={d} className={`tp-tcol${n === TODAY ? ' today' : ''}${blocked.includes(d) ? ' is-blocked' : ''}`} data-day={n} title={blocked.includes(d) ? `${d} is blocked` : undefined} onClick={e => { if (view == null && e.target === e.currentTarget) openDay(n) }}>
                {(() => { const day = ofDay(n); const lanes = lanesOf(day); return day.map(e => <Ev key={e.id} e={e} lane={lanes[e.id] || [0, 1]} />) })()}
                {n === TODAY && <i className="tp-now" style={{ top: `${(minutesIn(NOW_TIME) / (HOURS.length * 60)) * 100}%` }} aria-hidden="true" />}
              </div>
            ))}
          </div>
        </section>

        {view != null && (
          <DayBox title={`${nameOf(view)}, ${monOf(view)} ${view}`} sub={list.length ? `${list.length} on your calendar` : 'Nothing booked'} leaving={leaving} onClose={close}>
            <b className="tp-num fx-huge2"><CountUp value={list.length} /><small> {list.length === 1 ? 'call' : 'calls'}</small></b>
            <ul className="fx-rows">
              {list.map(e => <li key={e.id}><button type="button" className={`fx-row is-${e.kind === 'lead' ? 'blue' : 'teal'}`} onClick={() => setOpen(e)}><span className="fx-row-ic"><Clock size={15} aria-hidden="true" /></span><span className="tp-grow"><b>{e.who}</b><small>{e.when} · {e.label}</small></span><ChevronRight size={16} aria-hidden="true" /></button></li>)}
            </ul>
            {list.length === 0 && <Empty title="A free day" sub="The team books new appointments inside your hours." />}
            <h3 className="fx-h3">Rest of the week</h3>
            <ul className="fx-rows">
              {events.filter(e => e.on > isoOf(view) && e.on <= WEEK_DAYS[WEEK_DAYS.length - 1][3]).slice(0, 4).map(e => <li key={e.id}><button type="button" className="fx-row" onClick={() => setOpen(e)}><span className={`tp-dot ${e.kind}`} /><span className="tp-grow"><b>{e.who}</b><small>{e.day} {e.when} · {e.label}</small></span></button></li>)}
            </ul>
          </DayBox>
        )}
      </div>

      {/* P949: a lead's booking opens the same pop-up as on Leads (details, status, messages, actions) */}
      {open?.kind === 'lead' && leadRef && <LeadDrawer id={open.ref} onClose={() => setOpen(null)}
        extra={!ask && ['booked', 'showed'].includes(leadRef.stage) ? <button type="button" className="tp-btn ov-ghost" data-cant onClick={() => { setCant(open); setOpen(null) }}><CalendarX2 size={14} />Can{'’'}t make it</button> : null} />}
      <Drawer open={!!open && open.kind !== 'lead'} onClose={() => setOpen(null)} title={open?.who || ''} sub={open && `${open.day}, ${monOf(open.date)} ${open.date}, ${open.time} your time${open.iso && open.tz && clockOf(open.iso, open.tz) !== open.time ? ` · ${clockOf(open.iso, open.tz)} ${zoneAbbr(open.tz, open.iso)} for them` : ''}`}
        footer={<><Link to={open?.kind === 'lead' ? paths.lead(open.ref) : paths.client(open?.ref)} className="tp-primary fx-accent" onClick={() => setOpen(null)}>{open?.kind === 'lead' ? 'Open lead' : 'Open client'}</Link>
          {open?.kind === 'lead'
            ? <button type="button" className="tp-btn ov-ghost" onClick={() => { setCant(open); setOpen(null) }}><CalendarX2 size={14} />Can{'’'}t make it</button>
            : <button type="button" className="tp-btn ov-ghost" onClick={() => { note('Asked the team to move it. They call the client'); setOpen(null) }}>Ask the team to move it</button>}</>}>
        {open && <>
          <p className="tp-mid">{open.label}</p>
          {leadRef && <p className="tp-row"><Chip tone={stageChip(leadRef.stage, leadRef)[0]}>{stageChip(leadRef.stage, leadRef)[1]}</Chip></p>}
          {ask && <Link to={`${paths.lead(leadRef.id)}?outcome=1`} className="lc-nudge" onClick={() => setOpen(null)}><ClipboardCheck size={16} aria-hidden="true" /><span className="tp-grow"><b>How did it go?</b><small>The appointment ended. Mark the outcome</small></span><span className="lc-nudge-go">Mark outcome</span></Link>}
          <p className="tp-row"><Phone size={16} />{phone}</p>
          <p className="tp-row"><MapPin size={16} />Lives in {place}</p>
          <p className="tp-sub">{open.kind === 'lead' ? 'Can’t make it sends them an apology and a link to pick a new time.' : 'The team makes the change and tells the client. You see it here.'}</p>
        </>}
      </Drawer>
      <HoursDrawer key={panel === 'hours' ? 'h-open' : 'h'} open={panel === 'hours'} onClose={() => setPanel(null)} settings={settings} appts={raw} />
      <BlockDrawer key={panel === 'block' ? 'b-open' : 'b'} open={panel === 'block'} onClose={() => setPanel(null)} appts={raw} blocked={blocked} />
      <CantMakeIt appt={cant} lead={cant && leads.find(l => l.id === cant.ref)} onClose={() => setCant(null)} />
    </div>
  )
}
