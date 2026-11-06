import { useState } from 'react'
import { CalendarOff, Clock3, Users } from 'lucide-react'
import { useFulShift, useFulActions } from './data'
import { Drawer, Field, PillTabs, useNote } from '../kit'

// P846 — VAs do not switch themselves Active or Away: they work set hours in a rotation. This file holds the two
// pieces every VA page shares: the shift line (Overview, Settings) and the "Request a day off" drawer (rail, avatar
// menu, Overview, Settings, Schedule). Sample info: the request shows on the rota and in the bell; real shifts and
// requests are stored with the admin side later.

export function DayOffDrawer({ open, onClose }) {
  const { data: shift } = useFulShift()
  const { requestDayOff } = useFulActions()
  const note = useNote()
  const [day, setDay] = useState(null)
  const [why, setWhy] = useState('')
  if (!open) return null
  const pick = day ?? shift.askable[0]?.day ?? null
  const send = () => {
    const d = shift.askable.find(x => x.day === pick)
    requestDayOff(pick, why.trim())
    note(`The team knows you're off ${d.name}, Nov ${pick}`)
    setDay(null)
    setWhy('')
    onClose()
  }
  return (
    <Drawer open center onClose={onClose} title="Request a day off" sub="The team sees it right away and covers your shift."
      footer={pick == null ? null : <><button type="button" className="tp-primary fx-accent" onClick={send}><CalendarOff size={16} />Tell the team</button><button type="button" className="tp-btn ov-ghost" onClick={onClose}>Cancel</button></>}>
      {pick == null ? <p className="fx-calm">You have no more shifts to ask off in the next two weeks.</p> : <>
        <div className="tp-field"><span>Which day</span>
          <PillTabs role="radiogroup" label="Day off" className="fx-chips fs-wrap" itemClass="fx-chip" value={pick} onChange={setDay}
            items={shift.askable.map(d => ({ key: d.day, label: <><small>{d.name}</small><b>{d.day}</b></> }))} />
          <small className="tp-sub">Your shifts after today. Ask as early as you can so the others can plan.</small>
        </div>
        <Field label="Anything the team should know" hint="Optional"><input value={why} placeholder="e.g. Doctor's appointment" onChange={e => setWhy(e.target.value)} /></Field>
      </>}
    </Drawer>
  )
}

// "Your shift today 8:00 AM to 6:00 PM", who is on with them, and the day-off action.
export function ShiftLine({ onAsk, className = '' }) {
  const { data: s } = useFulShift()
  const names = s.mates.map(m => m.name)
  const withWho = names.length === 0 ? 'You are the only VA on today' : names.length === 1 ? `${names[0]} is on with you` : `${names.slice(0, -1).join(', ')} and ${names.at(-1)} are on with you`
  return (
    <section className={`fx-tile fs-shift ${className}`.trim()} aria-label="Your shift">
      <span className="fs-shift-ic" aria-hidden="true"><Clock3 size={18} /></span>
      <span className="tp-grow">
        <b>{s.onToday ? <>Your shift today <span className="tp-num">{s.shift.text}</span></> : 'You are off today'}</b>
        <small><Users size={12} aria-hidden="true" />{s.onToday ? `${withWho} · the carriers' hours` : 'Your next shift is on the rota'}</small>
      </span>
      <button type="button" className="tp-btn ov-ghost fs-shift-btn" onClick={onAsk}><CalendarOff size={15} />Request a day off</button>
    </section>
  )
}
