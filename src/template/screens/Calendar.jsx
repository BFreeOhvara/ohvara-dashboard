import { useState } from 'react'
import '../leads873.css'
import { Link } from 'react-router-dom'
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
import { DayBox, WeekStrip, WeekList } from '../DayBox'
import { useOpenDay, useStickyDay } from '../useOpenDay'
import { blockTime, clockOf, zoneAbbr } from '../../lib/callSlots'

// P848: the week shown comes from data useWeek (the sample week of Nov 2, or the real current week).
const START = 9 // the grid runs 9:00 AM to 6:00 PM, your working hours
const HOURS = Array.from({ length: 9 }, (_, i) => START + i)
const label12 = h => `${((h + 11) % 12) + 1} ${h < 12 ? 'AM' : 'PM'}`

// P878 (N-K-04, N-C-38, N-H-13): your hours per weekday and your calendar link, with any booked appointments the new
// hours would leave out listed to Keep or Move.
function HoursDrawer({ open, onClose, settings, appts }) {
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
function BlockDrawer({ open, onClose, appts, blocked }) {
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
function CantMakeIt({ appt, lead, onClose }) {
  const { monOf } = useWeek()
  const { cantMakeIt } = useSampleActions()
  const note = useNote()
  if (!appt || !lead) return null
  return (
    <Drawer open onClose={onClose} title="Can't make it?" sub={`${appt.who} · ${appt.day}, ${monOf(appt.date)} ${appt.date}, ${appt.time}`}
      footer={<><button type="button" className="tp-primary fx-accent" onClick={() => { cantMakeIt(appt.id); note(`${lead.first_name} got your apology and a link to pick a new time`); onClose() }}><CalendarX2 size={15} />Send and free the time</button><button type="button" className="tp-btn ov-ghost" onClick={onClose}>Keep it</button></>}>
      <p className="tp-sub">{lead.first_name} gets this text right away. If they don{'’'}t pick a new time, our team calls them.</p>
      <div className="tp-chat"><div className="tp-bub me">{leadText('cant_make_it', { lead: lead.first_name, appt: `${appt.day} at ${appt.time}` })}<small>Deedstone · draft wording · sends when your leads go live</small></div></div>
    </Drawer>
  )
}
// '3:30 PM' -> minutes after 9:00 AM
function minutesIn(time) {
  const [, h, m, ap] = /(\d+):(\d+)\s*(AM|PM)/.exec(time) || [0, 9, 0, 'AM']
  return ((Number(h) % 12) + (ap === 'PM' ? 12 : 0) - START) * 60 + Number(m)
}

// The week as a time grid at full width (desktop); click a day to open it (P854, the same as the VA Schedule: the
// grid narrows to that day and its box slides in; ?day= in the URL). On a phone, the week as a list; a day opens full
// screen. Each appointment is placed by its instant on your clock (Settings zone), with the client's time beside it
// when theirs differs.
export default function Calendar() {
  const { days: DAYS, nums: NUMS, nameOf, today: TODAY, time: NOW_TIME, monOf, isoOf } = useWeek()
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
  const events = raw.map(e => (e.iso ? { ...e, ...onAgentClock(e.iso, tz), when: blockTime(e.iso, tz, e.tz) } : { ...e, when: e.time }))
  const { day, open: openDay, close } = useOpenDay(NUMS, { esc: !open, isoOf })
  const { view, leaving } = useStickyDay(day)
  const ref = open && (open.kind === 'lead' ? leads.find(l => l.id === open.ref) : clients.find(c => c.id === open.ref))
  const phone = ref && (ref.phone || ref.client_phone)
  const place = ref && `${ref.city}, ${ref.state}`
  // P873: a lead's appointment card shows where the lead is now, and asks how it went once it has ended.
  const leadRef = open?.kind === 'lead' ? ref : null
  const ask = leadRef && needsOutcome(leadRef, clockNow())
  const shown = view != null ? DAYS.filter(([, d]) => d === view) : DAYS
  const ofDay = d => events.filter(e => e.date === d).sort((a, b) => minutesIn(a.time) - minutesIn(b.time))
  const list = view != null ? ofDay(view) : []
  const headKey = n => e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDay(n) } }
  // Two at the same time sit side by side.
  const Ev = ({ e, lane: [k, of] }) => (
    <button type="button" className={`tp-ev ${e.kind}`} onClick={() => setOpen(e)}
      style={{ top: `${(minutesIn(e.time) / (HOURS.length * 60)) * 100}%`, left: `calc(${(k / of) * 100}% + 4px)`, width: `calc(${100 / of}% - 8px)` }}>
      <b>{e.when}</b><span>{e.who}</span><small>{e.label}</small>
    </button>
  )
  return (
    <div className="tp-page fx-page">
      <div className="fx-tools">
        <WeekStrip days={NUMS} day={view} today={TODAY} onOpen={openDay} has={n => ofDay(n).length > 0} name={nameOf} />
        <span className="tp-grow" />
        <p className="tp-sub">Your time ({zoneAbbr(tz)}) · client times beside theirs</p>
        <span className="cal-tools">
          <button type="button" className="fx-pillbtn" onClick={() => setPanel('hours')}><Settings2 size={14} aria-hidden="true" />Hours</button>
          <button type="button" className="fx-pillbtn" onClick={() => setPanel('block')}><Ban size={14} aria-hidden="true" />Block a day</button>
        </span>
      </div>

      <WeekList days={NUMS} today={TODAY} onOpen={openDay} name={nameOf} itemsOf={ofDay} line={e => `${e.time} ${e.who}`} />

      <div className="fx-grid" data-fold data-fold-fit="360">
        <section className={`fx-tile ${view != null ? 'fx-s8 is-day' : 'fx-s12 is-week'} fx-week`} style={{ '--i': 0, '--days': shown.length }} aria-label={view != null ? `${nameOf(view)}, ${monOf(view)} ${view}` : 'This week'}>
          <div className="tp-tgrid-h"><span />{shown.map(([d, n]) => (
            <b key={d} role="button" tabIndex={0} aria-pressed={n === view} title={n === view ? 'Back to the week' : `Open ${d} ${n}`} className={`${n === TODAY ? 'today' : ''}${n === view ? ' is-on' : ''}`} onClick={() => openDay(n)} onKeyDown={headKey(n)}>
              {d} <span>{n}</span>{n === TODAY && <small>Today</small>}
            </b>
          ))}</div>
          <div className="tp-tgrid-b">
            <div className="tp-hours">{HOURS.map(h => <span key={h}>{label12(h)}</span>)}</div>
            {shown.map(([d, n]) => (
              <div key={d} className={`tp-tcol${n === TODAY ? ' today' : ''}${blocked.includes(d) ? ' is-blocked' : ''}`} data-day={n} title={blocked.includes(d) ? `${d} is blocked` : undefined} onClick={e => { if (view == null && e.target === e.currentTarget) openDay(n) }}>
                {ofDay(n).map((e, i, all) => { const same = all.filter(x => x.time === e.time); return <Ev key={e.id} e={e} lane={[same.indexOf(e), same.length]} /> })}
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
              {events.filter(e => e.date > view).slice(0, 4).map(e => <li key={e.id}><button type="button" className="fx-row" onClick={() => setOpen(e)}><span className={`tp-dot ${e.kind}`} /><span className="tp-grow"><b>{e.who}</b><small>{e.day} {e.when} · {e.label}</small></span></button></li>)}
            </ul>
          </DayBox>
        )}
      </div>

      <Drawer open={!!open} onClose={() => setOpen(null)} title={open?.who || ''} sub={open && `${open.day}, ${monOf(open.date)} ${open.date}, ${open.time} your time${open.iso && open.tz && clockOf(open.iso, open.tz) !== open.time ? ` · ${clockOf(open.iso, open.tz)} ${zoneAbbr(open.tz, open.iso)} for them` : ''}`}
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
