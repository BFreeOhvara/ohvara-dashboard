import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Phone, MapPin } from 'lucide-react'
import { useSampleAppointments, useSampleLeads, useSampleClients } from '../data'
import { Seg, Drawer, useNote } from '../kit'
import { paths } from '../paths'

const DAYS = [['Mon', 2], ['Tue', 3], ['Wed', 4], ['Thu', 5], ['Fri', 6]]

export default function Calendar() {
  const { data: events } = useSampleAppointments()
  const { data: leads } = useSampleLeads()
  const { data: clients } = useSampleClients()
  const note = useNote()
  const [view, setView] = useState('week')
  const [open, setOpen] = useState(null)
  const ref = open && (open.kind === 'lead' ? leads.find(l => l.id === open.ref) : clients.find(c => c.id === open.ref))
  const phone = ref && (ref.phone || ref.client_phone)
  const place = ref && `${ref.city}, ${ref.state}`
  const shown = view === 'day' ? DAYS.filter(([, d]) => d === 2) : DAYS
  return (
    <div className="tp-page">
      <div className="tp-row tp-wrap tp-between">
        <Seg label="View" value={view} onChange={setView} options={[{ key: 'week', label: 'Week' }, { key: 'day', label: 'Day' }]} />
        <p className="tp-sub">Working hours 9:00 AM to 5:00 PM · Only what you attend</p>
      </div>
      <div className="tp-week-grid" style={view === 'day' ? { gridTemplateColumns: 'minmax(0, 1fr)' } : undefined}>
        {shown.map(([day, date]) => (
          <section key={day} className={`ov-card tp-day${date === 2 ? ' today' : ''}`}>
            <h3><span>{day} {date}</span>{date === 2 && <small className="tp-sub">Today</small>}</h3>
            {events.filter(e => e.date === date).map(e => (
              <button key={e.id} type="button" className={`tp-ev ${e.kind}`} onClick={() => setOpen(e)}>
                <b>{e.time}</b><span>{e.who}</span><br /><span>{e.label}</span>
              </button>
            ))}
            {events.every(e => e.date !== date) && <p className="tp-sub">Nothing booked</p>}
          </section>
        ))}
      </div>
      <Drawer open={!!open} onClose={() => setOpen(null)} title={open?.who || ''} sub={open && `${open.day}, Nov ${open.date}, ${open.time} your time`}
        footer={<><Link to={open?.kind === 'lead' ? paths.lead(open.ref) : paths.client(open?.ref)} className="ov-hero tp-primary" onClick={() => setOpen(null)}>{open?.kind === 'lead' ? 'Open lead' : 'Open client'}</Link>
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
