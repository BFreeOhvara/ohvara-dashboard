import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight, Settings2, Ban, CalendarX2, ExternalLink } from 'lucide-react'
import { useSampleAppointments, useSampleLeads, useSampleClients, useSampleSettings, useSampleBlocks, useWeek, AGENT_TZ, onAgentClock } from '../data'
import { useNote } from '../kit'
import { laneOf } from '../stages'
import { useClientStatusOf } from '../checkSettings'
import { clientStatus } from '../../lib/clientCheck.js'
import { needsOutcome, clockNow } from '../leadLifecycle'
import { dateOf, clockOf, zoneAbbr } from '../../lib/callSlots'
import { HoursDrawer, BlockDrawer, CantMakeIt } from '../screens/Calendar'
import { ActionSheet, ActRow } from './Sheet'
import { CallBtn } from './bits'
import { mp } from './mpaths'

// P908 — the Calendar on a phone: This week / Next week, a strip of days (a dot per call, blocked days marked), and the
// picked day as an agenda, each call a full-width row in its person's colour with Call on the right. Tapping a call
// opens its actions (open, mark the result, can't make it). Your hours and Block a day sit under the agenda.
const minutesOf = t => { const m = /(\d+):(\d+)\s*(AM|PM)/.exec(t || ''); return m ? ((Number(m[1]) % 12) + (m[3] === 'PM' ? 12 : 0)) * 60 + Number(m[2]) : 0 }
const MONS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const plusDays = (iso, n) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }

export default function MCalendar() {
  const week = useWeek()
  const { data: raw } = useSampleAppointments()
  const { data: leads } = useSampleLeads()
  const { data: clients } = useSampleClients()
  const { data: settings } = useSampleSettings()
  const { data: blocked } = useSampleBlocks()
  const statusOf = useClientStatusOf()
  const note = useNote()
  const [wk, setWk] = useState('this')
  const days = week.days.map(([d, n]) => { const iso = wk === 'next' ? plusDays(week.isoOf(n), 7) : week.isoOf(n); return { name: d, n: Number(iso.slice(8, 10)), mon: MONS[Number(iso.slice(5, 7)) - 1], iso } })
  const todayIso = week.today != null ? week.isoOf(week.today) : null
  const [pick, setPick] = useState(todayIso || days[0].iso)
  const day = days.find(d => d.iso === pick) || days[0]
  const [open, setOpen] = useState(null)
  const [panel, setPanel] = useState(null)
  const [cant, setCant] = useState(null)
  const tz = settings.timeZone || AGENT_TZ
  const events = raw.map(e => (e.iso ? { ...e, ...onAgentClock(e.iso, tz), on: dateOf(e.iso, tz) } : { ...e, on: week.isoOf(e.date) }))
  const personOf = a => (a.kind === 'client' ? clients.find(c => c.id === a.ref) : leads.find(l => l.id === a.ref))
  const toneOf = a => { const p = personOf(a); return !p ? 'blue' : a.kind === 'client' ? clientStatus(statusOf(p)).tone : laneOf(p).tone }
  const phoneOf = a => { const p = personOf(a); return p?.phone || p?.client_phone }
  const rows = events.filter(e => e.on === day.iso).sort((a, b) => minutesOf(a.time) - minutesOf(b.time))
  const nowMin = day.iso === todayIso ? minutesOf(week.time) : null
  const hours = settings.week?.[day.name]
  const isBlocked = blocked.includes(day.name)
  const setWeek = k => { setWk(k); setPick(k === 'this' && todayIso ? todayIso : plusDays(week.isoOf(week.days[0][1]), k === 'next' ? 7 : 0)) }
  const lead = open?.kind === 'lead' ? personOf(open) : null
  const ask = lead && needsOutcome(lead, clockNow())

  return (
    <div className="mx-page">
      <div className="mx-seg" role="radiogroup" aria-label="Week">
        {[['this', 'This week'], ['next', 'Next week']].map(([k, l]) => <button key={k} type="button" role="radio" aria-checked={wk === k} className={wk === k ? 'is-on' : ''} onClick={() => setWeek(k)}>{l}</button>)}
      </div>
      <div className="mx-strip" role="tablist" aria-label="Days">
        {days.map(d => {
          const count = events.filter(e => e.on === d.iso).length
          const off = blocked.includes(d.name)
          return (
            <button key={d.iso} type="button" role="tab" aria-selected={d.iso === day.iso} className={`mx-sday${d.iso === day.iso ? ' is-on' : ''}${d.iso === todayIso ? ' is-today' : ''}${off ? ' is-blocked' : ''}`} onClick={() => setPick(d.iso)}>
              <small>{d.name}</small><b className="tp-num">{d.n}</b>
              <span className="mx-dots" aria-label={off ? 'Blocked' : `${count} calls`}>{off ? <Ban size={12} aria-hidden="true" /> : Array.from({ length: Math.min(count, 3) }, (_, i) => <i key={i} />)}</span>
            </button>
          )
        })}
      </div>
      <p className="mx-dayline">
        <b>{day.iso === todayIso ? 'Today' : day.name}, {day.mon} {day.n}</b>
        <span>{rows.length} {rows.length === 1 ? 'call' : 'calls'}{isBlocked ? ' · blocked' : hours ? ` · ${hours.on ? `${hours.start} to ${hours.end}` : 'day off'}` : ''}</span>
      </p>
      {rows.length
        ? (
          <ol className="mx-agenda">
            {rows.map(a => {
              const past = nowMin != null && minutesOf(a.time) + 30 <= nowMin
              return (
                <li key={a.id} className={`mx-slot${past ? ' is-past' : ''}`}>
                  <span className="mx-slot-t tp-num">{a.time}</span>
                  <div className={`mx-ev fx-card is-${toneOf(a)}`}>
                    <button type="button" className="mx-cover" aria-label={`${a.who}, ${a.label}`} onClick={() => setOpen(a)} />
                    <span className="tp-grow"><b>{a.who}</b><small>{a.label}{past ? ' · done' : ''}</small></span>
                    {past ? <ChevronRight size={18} className="mx-chev" aria-hidden="true" /> : <CallBtn phone={phoneOf(a)} />}
                  </div>
                </li>
              )
            })}
          </ol>
        )
        : <p className="mx-empty">{isBlocked ? 'This day is blocked. Nothing new is booked.' : 'Nothing booked this day. Our team fills open times inside your hours.'}</p>}

      <div className="mx-two">
        <button type="button" className="mx-btn" onClick={() => setPanel('hours')}><Settings2 size={18} aria-hidden="true" />Your hours</button>
        <button type="button" className="mx-btn" onClick={() => setPanel('block')}><Ban size={18} aria-hidden="true" />Block a day</button>
      </div>

      <ActionSheet open={!!open} onClose={() => setOpen(null)} title={open?.who || ''}
        sub={open && `${open.day}, ${open.time} your time${open.iso && open.tz && clockOf(open.iso, open.tz) !== open.time ? ` · ${clockOf(open.iso, open.tz)} ${zoneAbbr(open.tz, open.iso)} for them` : ''} · ${open.label}`}>
        {open && <Link to={open.kind === 'lead' ? mp.lead(open.ref, ask) : mp.client(open.ref)} className="mx-act-row" onClick={() => setOpen(null)}><span className="mx-act-ic"><ExternalLink size={20} aria-hidden="true" /></span><span className="tp-grow"><b>{ask ? 'Mark the result' : open.kind === 'lead' ? 'Open lead' : 'Open client'}</b><small>{open.kind === 'lead' ? 'Everything about them, and the result' : 'Their policy and messages'}</small></span></Link>}
        {open?.kind === 'lead'
          ? <ActRow icon={CalendarX2} label="Can’t make it" sub="They get an apology and a link to pick a new time" onClick={() => { setCant(open); setOpen(null) }} />
          : <ActRow icon={CalendarX2} label="Ask the team to move it" sub="The team calls the client and tells you" onClick={() => { note('Asked the team to move it. They call the client'); setOpen(null) }} />}
      </ActionSheet>
      {cant && <CantMakeIt appt={cant} lead={personOf(cant)} onClose={() => setCant(null)} />}
      <HoursDrawer key={panel === 'hours' ? 'h-open' : 'h'} open={panel === 'hours'} onClose={() => setPanel(null)} settings={settings} appts={raw} />
      <BlockDrawer key={panel === 'block' ? 'b-open' : 'b'} open={panel === 'block'} onClose={() => setPanel(null)} appts={raw} blocked={blocked} />
    </div>
  )
}
