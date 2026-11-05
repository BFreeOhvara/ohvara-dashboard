import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Phone, MapPin, ChevronRight, Clock } from 'lucide-react'
import { CountUp } from '../motion'
import { useSampleAppointments, useSampleLeads, useSampleClients } from '../data'
import { Seg, Drawer, Empty, PillTabs, useNote } from '../kit'
import { paths } from '../paths'

const DAYS = [['Mon', 2], ['Tue', 3], ['Wed', 4], ['Thu', 5], ['Fri', 6]]
const START = 9 // the grid runs 9:00 AM to 6:00 PM, your working hours
const HOURS = Array.from({ length: 9 }, (_, i) => START + i)
const label12 = h => `${((h + 11) % 12) + 1} ${h < 12 ? 'AM' : 'PM'}`
// '3:30 PM' -> minutes after 9:00 AM
function minutesIn(time) {
  const [, h, m, ap] = /(\d+):(\d+)\s*(AM|PM)/.exec(time) || [0, 9, 0, 'AM']
  return ((Number(h) % 12) + (ap === 'PM' ? 12 : 0) - START) * 60 + Number(m)
}

// The week as a time grid (desktop) with the agenda beside it; on a phone, day chips over that day's list.
export default function Calendar() {
  const { data: events } = useSampleAppointments()
  const { data: leads } = useSampleLeads()
  const { data: clients } = useSampleClients()
  const note = useNote()
  const [view, setView] = useState('week')
  const [day, setDay] = useState(2)
  const [open, setOpen] = useState(null)
  const ref = open && (open.kind === 'lead' ? leads.find(l => l.id === open.ref) : clients.find(c => c.id === open.ref))
  const phone = ref && (ref.phone || ref.client_phone)
  const place = ref && `${ref.city}, ${ref.state}`
  const shown = view === 'day' ? DAYS.filter(([, d]) => d === day) : DAYS
  const ofDay = d => events.filter(e => e.date === d).sort((a, b) => minutesIn(a.time) - minutesIn(b.time))
  // Two at the same time sit side by side.
  const Ev = ({ e, lane: [k, of] }) => (
    <button type="button" className={`tp-ev ${e.kind}`} onClick={() => setOpen(e)}
      style={{ top: `${(minutesIn(e.time) / (HOURS.length * 60)) * 100}%`, left: `calc(${(k / of) * 100}% + 4px)`, width: `calc(${100 / of}% - 8px)` }}>
      <b>{e.time}</b><span>{e.who}</span><small>{e.label}</small>
    </button>
  )
  return (
    <div className="tp-page fx-page">
      <div className="fx-tools">
        <Seg label="View" value={view} onChange={setView} options={[{ key: 'week', label: 'Week' }, { key: 'day', label: 'Day' }]} />
        <PillTabs label="Day" className="fx-chips" itemClass="fx-chip" value={day} onChange={setDay}
          items={DAYS.map(([d, n]) => ({ key: n, label: <><small>{d}</small><b>{n}</b></>, extra: day !== n && ofDay(n).length > 0 ? <i aria-hidden="true" /> : null }))} />
        <span className="tp-grow" />
        <p className="tp-sub">Working hours 9:00 AM to 6:00 PM · only what you attend</p>
      </div>

      <div className="fx-grid">
        <section className="fx-tile fx-s8 fx-week" style={{ '--i': 0, '--days': shown.length }} aria-label="This week">
          <div className="tp-tgrid-h"><span />{shown.map(([d, n]) => <b key={d} className={n === 2 ? 'today' : ''}>{d} <span>{n}</span>{n === 2 && <small>Today</small>}</b>)}</div>
          <div className="tp-tgrid-b">
            <div className="tp-hours">{HOURS.map(h => <span key={h}>{label12(h)}</span>)}</div>
            {shown.map(([d, n]) => (
              <div key={d} className={`tp-tcol${n === 2 ? ' today' : ''}`}>
                {ofDay(n).map((e, i, all) => { const same = all.filter(x => x.time === e.time); return <Ev key={e.id} e={e} lane={[same.indexOf(e), same.length]} /> })}
                {n === 2 && <i className="tp-now" style={{ top: `${(minutesIn('2:14 PM') / (HOURS.length * 60)) * 100}%` }} aria-hidden="true" />}
              </div>
            ))}
          </div>
        </section>

        <aside className="fx-tile fx-s4 fx-agenda" style={{ '--i': 1 }} aria-label="Agenda">
          <header className="fx-tile-h"><span className="tp-grow"><h2>{DAYS.find(([, n]) => n === day)[0]}, Nov {day}</h2><p>{ofDay(day).length ? `${ofDay(day).length} on your calendar` : 'Nothing booked'}</p></span></header>
          <b className="tp-num fx-huge2"><CountUp value={ofDay(day).length} /><small> {ofDay(day).length === 1 ? 'call' : 'calls'}</small></b>
          <ul className="fx-rows">
            {ofDay(day).map(e => <li key={e.id}><button type="button" className={`fx-row is-${e.kind === 'lead' ? 'blue' : 'teal'}`} onClick={() => setOpen(e)}><span className="fx-row-ic"><Clock size={15} aria-hidden="true" /></span><span className="tp-grow"><b>{e.who}</b><small>{e.time} · {e.label}</small></span><ChevronRight size={16} aria-hidden="true" /></button></li>)}
          </ul>
          {ofDay(day).length === 0 && <Empty title="A free day" sub="The team books new appointments inside your hours." />}
          <h3 className="fx-h3">Rest of the week</h3>
          <ul className="fx-rows">
            {events.filter(e => e.date > day).slice(0, 4).map(e => <li key={e.id}><button type="button" className="fx-row" onClick={() => setOpen(e)}><span className={`tp-dot ${e.kind}`} /><span className="tp-grow"><b>{e.who}</b><small>{e.day} {e.time} · {e.label}</small></span></button></li>)}
          </ul>
        </aside>
      </div>

      <Drawer open={!!open} onClose={() => setOpen(null)} title={open?.who || ''} sub={open && `${open.day}, Nov ${open.date}, ${open.time} your time`}
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
