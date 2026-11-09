import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { useSampleAppointments, useSampleLeads, useSampleClients, useSampleSettings, useWeek } from '../data'
import { laneOf } from '../stages'
import { useClientStatusOf } from '../checkSettings'
import { clientStatus } from '../../lib/clientCheck.js'
import { CallBtn } from './bits'
import { mp } from './mpaths'

// P908 — the Calendar on a phone: a week strip on top (a dot per call), the picked day as an agenda below it, each
// call a full-width row in its person's colour with Call on the right. Today is picked first.
const minutesOf = t => { const m = /(\d+):(\d+)\s*(AM|PM)/.exec(t || ''); return m ? ((Number(m[1]) % 12) + (m[3] === 'PM' ? 12 : 0)) * 60 + Number(m[2]) : 0 }
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

export default function MCalendar() {
  const week = useWeek()
  const { data: appts } = useSampleAppointments()
  const { data: leads } = useSampleLeads()
  const { data: clients } = useSampleClients()
  const { data: settings } = useSampleSettings()
  const statusOf = useClientStatusOf()
  const [day, setDay] = useState(week.today ?? week.nums[0])
  const personOf = a => (a.kind === 'client' ? clients.find(c => c.id === a.ref) : leads.find(l => l.id === a.ref))
  const toneOf = a => { const p = personOf(a); return !p ? 'blue' : a.kind === 'client' ? clientStatus(statusOf(p)).tone : laneOf(p).tone }
  const phoneOf = a => { const p = personOf(a); return a.kind === 'client' ? p?.client_phone : p?.rawPhone || p?.phone }
  const rows = appts.filter(a => a.date === day).sort((a, b) => minutesOf(a.time) - minutesOf(b.time))
  const nowMin = week.today === day ? minutesOf(week.time) : null
  const hours = settings.week?.[week.nameOf(day)]
  return (
    <div className="mx-page">
      <p className="mx-month">{MONTHS[(week.month || 11) - 1]} {week.year}</p>
      <div className="mx-strip" role="tablist" aria-label="Days">
        {week.days.map(([name, n]) => {
          const count = appts.filter(a => a.date === n).length
          return (
            <button key={n} type="button" role="tab" aria-selected={day === n} className={`mx-sday${day === n ? ' is-on' : ''}${week.today === n ? ' is-today' : ''}`} onClick={() => setDay(n)}>
              <small>{name}</small><b className="tp-num">{n}</b>
              <span className="mx-dots" aria-label={`${count} calls`}>{Array.from({ length: Math.min(count, 3) }, (_, i) => <i key={i} />)}</span>
            </button>
          )
        })}
      </div>
      <p className="mx-dayline">
        <b>{week.today === day ? 'Today' : week.nameOf(day)}, {week.monOf(day)} {day}</b>
        <span>{rows.length} {rows.length === 1 ? 'call' : 'calls'}{hours ? ` · ${hours.on ? `${hours.start} to ${hours.end}` : 'day off'}` : ''}</span>
      </p>
      {rows.length
        ? (
          <ol className="mx-agenda">
            {rows.map(a => {
              const past = nowMin != null && minutesOf(a.time) + 30 <= nowMin
              const tone = toneOf(a)
              return (
                <li key={a.id} className={`mx-slot${past ? ' is-past' : ''}`}>
                  <span className="mx-slot-t tp-num">{a.time.replace(' ', ' ')}</span>
                  <div className={`mx-ev fx-card is-${tone}`}>
                    <Link to={a.kind === 'client' ? mp.client(a.ref) : mp.lead(a.ref)} className="mx-cover" aria-label={`Open ${a.who}`} />
                    <span className="tp-grow"><b>{a.who}</b><small>{a.label}{past ? ' · done' : ''}</small></span>
                    {past ? <ChevronRight size={18} className="mx-chev" aria-hidden="true" /> : <CallBtn phone={phoneOf(a)} />}
                  </div>
                </li>
              )
            })}
          </ol>
        )
        : <p className="mx-empty">Nothing booked this day. Our team fills open times inside your hours.</p>}
    </div>
  )
}
