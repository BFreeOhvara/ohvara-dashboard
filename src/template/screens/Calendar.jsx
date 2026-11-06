import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Phone, MapPin, ChevronRight, Clock } from 'lucide-react'
import { CountUp } from '../motion'
import { useSampleAppointments, useSampleLeads, useSampleClients, useSampleSettings, AGENT_TZ, onAgentClock } from '../data'
import { Drawer, Empty, useNote } from '../kit'
import { paths } from '../paths'
import { DayBox, WeekStrip, WeekList } from '../DayBox'
import { useOpenDay, useStickyDay } from '../useOpenDay'
import { blockTime, clockOf, zoneAbbr } from '../../lib/callSlots'

const DAYS = [['Mon', 2], ['Tue', 3], ['Wed', 4], ['Thu', 5], ['Fri', 6]]
const NUMS = DAYS.map(([, n]) => n)
const nameOf = n => DAYS.find(([, d]) => d === n)?.[0] || ''
const TODAY = 2
const START = 9 // the grid runs 9:00 AM to 6:00 PM, your working hours
const HOURS = Array.from({ length: 9 }, (_, i) => START + i)
const label12 = h => `${((h + 11) % 12) + 1} ${h < 12 ? 'AM' : 'PM'}`
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
  const { data: raw } = useSampleAppointments()
  const { data: leads } = useSampleLeads()
  const { data: clients } = useSampleClients()
  const { data: settings } = useSampleSettings()
  const note = useNote()
  const [open, setOpen] = useState(null)
  const tz = settings.timeZone || AGENT_TZ
  const events = raw.map(e => (e.iso ? { ...e, ...onAgentClock(e.iso, tz), when: blockTime(e.iso, tz, e.tz) } : { ...e, when: e.time }))
  const { day, open: openDay, close } = useOpenDay(NUMS, { esc: !open })
  const { view, leaving } = useStickyDay(day)
  const ref = open && (open.kind === 'lead' ? leads.find(l => l.id === open.ref) : clients.find(c => c.id === open.ref))
  const phone = ref && (ref.phone || ref.client_phone)
  const place = ref && `${ref.city}, ${ref.state}`
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
        <p className="tp-sub">Working hours 9:00 AM to 6:00 PM · only what you attend</p>
      </div>

      <WeekList days={NUMS} today={TODAY} onOpen={openDay} name={nameOf} itemsOf={ofDay} line={e => `${e.time} ${e.who}`} />

      <div className="fx-grid">
        <section className={`fx-tile ${view != null ? 'fx-s8 is-day' : 'fx-s12 is-week'} fx-week`} style={{ '--i': 0, '--days': shown.length }} aria-label={view != null ? `${nameOf(view)}, Nov ${view}` : 'This week'}>
          <div className="tp-tgrid-h"><span />{shown.map(([d, n]) => (
            <b key={d} role="button" tabIndex={0} aria-pressed={n === view} title={n === view ? 'Back to the week' : `Open ${d} ${n}`} className={`${n === TODAY ? 'today' : ''}${n === view ? ' is-on' : ''}`} onClick={() => openDay(n)} onKeyDown={headKey(n)}>
              {d} <span>{n}</span>{n === TODAY && <small>Today</small>}
            </b>
          ))}</div>
          <div className="tp-tgrid-b">
            <div className="tp-hours">{HOURS.map(h => <span key={h}>{label12(h)}</span>)}</div>
            {shown.map(([d, n]) => (
              <div key={d} className={`tp-tcol${n === TODAY ? ' today' : ''}`} data-day={n} onClick={e => { if (view == null && e.target === e.currentTarget) openDay(n) }}>
                {ofDay(n).map((e, i, all) => { const same = all.filter(x => x.time === e.time); return <Ev key={e.id} e={e} lane={[same.indexOf(e), same.length]} /> })}
                {n === TODAY && <i className="tp-now" style={{ top: `${(minutesIn('2:14 PM') / (HOURS.length * 60)) * 100}%` }} aria-hidden="true" />}
              </div>
            ))}
          </div>
        </section>

        {view != null && (
          <DayBox title={`${nameOf(view)}, Nov ${view}`} sub={list.length ? `${list.length} on your calendar` : 'Nothing booked'} leaving={leaving} onClose={close}>
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

      <Drawer open={!!open} onClose={() => setOpen(null)} title={open?.who || ''} sub={open && `${open.day}, Nov ${open.date}, ${open.time} your time${open.iso && open.tz && clockOf(open.iso, open.tz) !== open.time ? ` · ${clockOf(open.iso, open.tz)} ${zoneAbbr(open.tz, open.iso)} for them` : ''}`}
        footer={<><Link to={open?.kind === 'lead' ? paths.lead(open.ref) : paths.client(open?.ref)} className="tp-primary fx-accent" onClick={() => setOpen(null)}>{open?.kind === 'lead' ? 'Open lead' : 'Open client'}</Link>
          <button type="button" className="tp-btn ov-ghost" onClick={() => { note('Asked the team to reschedule. They will tell the client'); setOpen(null) }}>Ask the team to reschedule</button>
          <button type="button" className="tp-btn ov-ghost" onClick={() => { note('Asked the team to cancel. They will tell the client'); setOpen(null) }}>Ask the team to cancel</button></>}>
        {open && <>
          <p className="tp-mid">{open.label}</p>
          <p className="tp-row"><Phone size={16} />{phone}</p>
          <p className="tp-row"><MapPin size={16} />Lives in {place}</p>
          <p className="tp-sub">The team makes the change and tells the client. You see it here.</p>
        </>}
      </Drawer>
    </div>
  )
}
