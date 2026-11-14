import { useState } from 'react'
import { CalendarCheck, ShieldAlert } from 'lucide-react'
import { useFulAgents, useVaBooking, useFulClock, useAgentAppts } from '../../ful/data'
import { useClientZone } from '../../useClientZone'
import { agentSlots, clocksBetween, zoneAbbr, DEFAULT_APPT_MIN } from '../../../lib/callSlots'
import { licensedIn } from '../../ful/p879'
import { useNote } from '../../kit'
import { BottomSheet, Ini } from '../AppKit'
import { SlotChooser } from './VSlots'
import { firstName } from './vaModel'

// P1002 — Book for an agent, on the phone (the desktop's BookForAgent, ful/FulFrame.jsx): the person on the line, the
// agent, a day and a time. Lands on the agent's calendar. The time is the person's (their zone from state + city, or
// picked), inside the agent's hours on the agent's clock, and never within the agent's appointment length + buffer of
// another appointment. Only an agent licensed in the person's state can be booked. Like the desktop it is sample-only
// for now: it says what was booked and closes. `person` = { name, number, city, state }.
const APPT_CLOCKS = clocksBetween(8 * 60, 20 * 60) // the person's 8 AM to 8 PM; the agent's hours filter it

export function BookForAgentSheet({ open, onClose, person = null, className = '' }) {
  const { data: agents } = useFulAgents()
  const book = useVaBooking()
  const note = useNote()
  const clock = useFulClock()
  const days = clock.bookDays.slice(0, 4)
  const [picked, setAgent] = useState(null)
  const [date, setDate] = useState(days[0]?.[1])
  const [time, setTime] = useState('')
  const who = person ? { name: person.name, phone: person.number, city: person.city || '', state: person.state || '' } : null
  // N-C-22, N-A-12: only an agent licensed in the person's state can be booked.
  const where = who?.state || null
  const agent = picked || (agents.find(a => licensedIn(a, where)) || agents[0])?.id
  const ag = agents.find(x => x.id === agent)
  const licensed = licensedIn(ag, where)
  const zone = useClientZone(who?.state, who?.city)
  const appts = useAgentAppts(agent)
  const slots = ag ? agentSlots({ date: clock.isoOf(date), clocks: APPT_CLOCKS, clientTz: zone.tz, appts, length: ag.appt?.length, buffer: ag.appt?.buffer, hours: { tz: ag.tz, open: ag.open, close: ag.close, days: ag.days } }) : []
  const pick = licensed ? slots.find(x => x.clock === time && x.open && x.iso >= clock.nowIso) : null
  const first = firstName(ag?.name)
  const gap = (ag?.appt?.length || DEFAULT_APPT_MIN) + (ag?.appt?.buffer || 0)
  const save = () => {
    const when = `${clock.dayName(date)}, ${clock.dateText(date)}, ${time} ${zoneAbbr(zone.tz, pick.iso)} (their time)`
    note(`${who.name} booked with ${ag.name}, ${when}`)
    onClose()
  }
  return (
    <BottomSheet open={open} onClose={onClose} label="Book for an agent" tall className={className}>
      <p className="ma-sheet-t">Book for an agent</p>
      {(!who || !ag)
        ? <p className="ma-sheet-s">{who ? 'No agents yet. Agents you serve show here once they join.' : 'Nobody on the line. Book a caller with an agent from the call, when the transfer does not connect.'}</p>
        : <>
          <p className="ma-sheet-s">It goes on the agent&apos;s calendar inside their hours.</p>
          <p className="va-bookwho"><b>{who.name}</b>{who.city ? ` · ${who.city}, ${who.state}` : ''}</p>
          <p className="ma-cap">Agent</p>
          <div className="va-chips" role="radiogroup" aria-label="Agent">
            {agents.map(a => (
              <button key={a.id} type="button" role="radio" aria-checked={agent === a.id} className={`ma-chip va-tap va-agentchip ma-press${agent === a.id ? ' is-solid' : ''}`} onClick={() => { setAgent(a.id); setTime('') }}>
                <Ini person name={a.name} size={26} />{firstName(a.name)}{!licensedIn(a, where) && <small>{where ? `not in ${where}` : 'state?'}</small>}
              </button>
            ))}
          </div>
          <p className="ma-hint">{ag.hours}, {zoneAbbr(ag.tz)} · {ag.states ? `licensed in ${ag.states.join(', ')}` : 'licence states not connected yet'}</p>
          {!licensed && <p className="va-warn" role="alert"><ShieldAlert size={15} aria-hidden="true" />{!ag.states ? `We can't see ${first}'s licence states yet, so booking stays off. Leave it for the team.` : where ? `${first} isn't licensed in ${where}. Pick an agent who is, or leave it for the team.` : "Confirm the person's state on the call first."}</p>}
          <SlotChooser days={days} day={date} onDay={setDate} slots={slots} value={time} onPick={setTime} zone={zone} place={[who.city, who.state].filter(Boolean).join(', ')} viewerTz={book.viewerTz}
            notBefore={clock.nowIso} hint={`Inside ${first}’s hours. Greyed-out times are within ${gap} minutes of another appointment.`} />
          <button type="button" className="ma-btn is-solid is-tall va-wide ma-press" disabled={!pick} onClick={save}><CalendarCheck size={18} aria-hidden="true" />Book it</button>
        </>}
    </BottomSheet>
  )
}
