import { useState } from 'react'
import { CalendarClock, MessageSquareText } from 'lucide-react'
import { Drawer, useNote } from '../kit'
import { useKeep } from '../motion'
import { SlotPick } from '../SlotPick'
import { useClientZone } from '../useClientZone'
import { vaSlots, zoneAbbr, clocksBetween } from '../../lib/callSlots'
import { useVaBooking, useFulClock } from './data'

// P907 — move any booked call (a hand-off, save, change, callback, welcome, yearly review). The system booked it in
// the client's preferred window; a VA (or admin) can pick another time on the client's clock. A slot is open only when
// a VA on shift is free then (the 30-minute rule, lib/callSlots), you first; a time that goes to someone else says
// so. The client gets the usual confirmation text with the new time (P902's rules).
const CLIENT_DAY = clocksBetween(8 * 60, 20 * 60 - 30) // the client's 8 AM to 8 PM; the VA shift filters it
export function MoveBooking({ open, onClose, name, state, city, tz, exceptId, onMove }) {
  const book = useVaBooking()
  const note = useNote()
  const found = useClientZone(state, city)
  const zone = tz ? { ...found, tz, auto: true } : found
  const { today, nowIso, bookDays, dayName, dateText, isoOf } = useFulClock()
  const [day, setDay] = useState(bookDays[0][1] ?? today)
  const [time, setTime] = useState('')
  const clocks = zone.tz ? CLIENT_DAY : []
  const slots = vaSlots({ date: isoOf(day), clocks, clientTz: zone.tz, team: book.team, calls: book.calls, load: book.load, prefer: book.me, exceptId })
  const pick = slots.find(x => x.clock === time && x.open && x.iso >= nowIso)
  const keep = useKeep(open)
  if (!keep) return null
  const first = String(name || '').split(' ')[0] || 'The client'
  const save = () => {
    const mine = pick.va.id === book.me
    onMove(pick.iso, pick.va.id)
    note(`Moved to ${dayName(day)}, ${dateText(day)}, ${time} ${zoneAbbr(zone.tz, pick.iso)}, their time. ${first} gets a text with the new time${mine ? '' : `. ${pick.va.name} has it now`}`)
    onClose()
  }
  return (
    <Drawer open={open} center onClose={onClose} title="Move this call" sub={`${name} · the client's time`}
      footer={<button type="button" className="tp-primary fx-accent" disabled={!pick} onClick={save}><CalendarClock size={16} />Move it</button>}>
      <SlotPick days={bookDays} day={day} onDay={d => { setDay(d); setTime('') }} slots={slots} value={time} onPick={setTime} zone={zone} place={[city, state].filter(Boolean).join(', ')}
        viewerTz={book.viewerTz} mine={book.me} notBefore={nowIso} showVa label="New time" hint="Inside the team’s hours. Greyed-out times have no VA free." />
      <p className="tp-sub fs-movetext"><MessageSquareText size={14} aria-hidden="true" />{first} gets the usual confirmation text with the new time.</p>
    </Drawer>
  )
}
