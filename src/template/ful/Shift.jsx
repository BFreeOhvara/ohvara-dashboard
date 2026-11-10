import { useState } from 'react'
import { CalendarOff, Clock3, Users } from 'lucide-react'
import { useFulShift } from './data'
import { Drawer, Field, PillTabs, useNote } from '../kit'
import { useKeep } from '../motion'
import { useDayOffActions } from '../../hooks/useVaShiftsShell'
import { dateLabel } from '../../lib/vaShifts'
import { NO_DAYS_LEFT } from '../../lib/dayOff'

// P846 — VAs do not switch themselves Active or Away: they work set hours in a rotation. This file holds the two
// pieces every VA page shares: the shift line (Overview, Settings) and the "Request a day off" drawer (rail, avatar
// menu, Overview, Settings, Schedule). Sample info: the request shows on the rota and in the bell; real shifts and
// requests are stored with the admin side later.
// P851 Phase 2: once migration 231 is applied the signed-in VA's real rota replaces the sample (useVaShiftView via
// plugRealShift in src/hooks/useVaShiftsShell), and asking for or taking back a day off goes through va_request_day_off / va_cancel_day_off.
// Until then every read comes back empty and the pages keep the sample rota.

export function DayOffDrawer({ open, onClose }) {
  const { data: shift } = useFulShift()
  const { request, check } = useDayOffActions()
  const note = useNote()
  const [busy, setBusy] = useState(false)
  const [day, setDay] = useState(null)
  const [why, setWhy] = useState('')
  const keep = useKeep(open)
  if (!keep) return null
  const pick = day ?? shift.askable[0]?.day ?? null
  // P915: the monthly allowance (no approvals since P913): used up, the day can't be booked.
  const room = pick == null ? null : check(shift.askable.find(x => x.day === pick))
  const send = () => {
    const d = shift.askable.find(x => x.day === pick)
    setBusy(true)
    request(d, why.trim()).then(() => {
      note(`Booked: you're off ${dateLabel(d.date)}. The team covers your shift.`)
      setDay(null)
      setWhy('')
      onClose()
    }, e => note(e?.message || 'That did not send. Try again.')).finally(() => setBusy(false))
  }
  return (
    <Drawer open={open} center onClose={onClose} title="Request a day off" sub="Booked at once while you have days left. The team sees it and covers your shift."
      footer={pick == null ? null : <><button type="button" className="tp-primary fx-accent" onClick={send} disabled={busy || !room?.ok}><CalendarOff size={16} />{room?.none ? NO_DAYS_LEFT : 'Book it'}</button><button type="button" className="tp-btn ov-ghost" onClick={onClose}>Cancel</button></>}>
      {pick == null ? <p className="fx-calm">{shift.notSet ? 'Day-off requests open once your rota is set up.' : 'You have no more shifts to ask off in the next two weeks.'}</p> : <>
        <div className="tp-field"><span>Which day</span>
          <PillTabs role="radiogroup" label="Day off" className="fx-chips fs-wrap" itemClass="fx-chip" value={pick} onChange={setDay}
            items={shift.askable.map(d => ({ key: d.day, label: <><small>{d.name}</small><b>{d.day}</b></> }))} />
          <small className="tp-sub">Your shifts after today. Ask as early as you can so the others can plan.</small>
          {room && <small className={room.ok ? 'tp-sub' : 'tp-sub is-warn'} role={room.ok ? undefined : 'alert'}>{room.ok ? `${room.used} of ${room.allowance} days off used that month.` : room.why}</small>}
        </div>
        <Field label="Anything the team should know" hint="Optional"><input value={why} placeholder="e.g. Doctor's appointment" onChange={e => setWhy(e.target.value)} /></Field>
      </>}
    </Drawer>
  )
}

// "Your shift today 8:00 AM to 6:00 PM", who is on with them, and the day-off action.
export function ShiftLine({ onAsk, className = '' }) {
  const { data: s } = useFulShift()
  const { check } = useDayOffActions()
  const next = s.askable?.[0]
  const none = !!(next && check(next)?.none)
  const names = s.mates.map(m => m.name)
  const withWho = names.length === 0 ? 'You are the only VA on today' : names.length === 1 ? `${names[0]} is on with you` : `${names.slice(0, -1).join(', ')} and ${names.at(-1)} are on with you`
  return (
    <section className={`fx-tile fs-shift ${className}`.trim()} aria-label="Your shift">
      <span className="fs-shift-ic" aria-hidden="true"><Clock3 size={18} /></span>
      <span className="tp-grow">
        <b>{s.notSet ? 'Your rota isn’t set up yet' : s.onToday ? <>Your shift today <span className="tp-num">{s.shift.text}</span></> : 'You are off today'}</b>
        <small><Users size={12} aria-hidden="true" />{s.notSet ? 'Shifts are 8 AM to 6 PM Central, the carriers’ hours' : s.onToday ? `${withWho} · the carriers' hours` : 'Your next shift is on the rota'}</small>
      </span>
      <button type="button" className="tp-btn ov-ghost fs-shift-btn" onClick={onAsk} disabled={none} title={none ? "You've used this month's days off" : undefined}><CalendarOff size={15} />{none ? NO_DAYS_LEFT : 'Request a day off'}</button>
    </section>
  )
}
