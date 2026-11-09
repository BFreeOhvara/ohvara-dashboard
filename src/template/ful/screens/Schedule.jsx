import { useState } from 'react'
import { CalendarOff, Undo2, CalendarCheck } from 'lucide-react'
import { useFulShift, useFulSource } from '../data'
import { FirstRun } from '../../DataState'
import { Avatar, Seg, useNote } from '../../kit'
import { DayOffDrawer } from '../Shift'
import { useDayOffActions } from '../../../hooks/useVaShiftsShell'
import { companyDay, dateLabel, rangeText } from '../../../lib/vaShifts'
import { ClockTile, SwapsHolidays } from '../Clock879'
import { HelpDot } from '../../../fulshell/training/HelpDot'

// P918 — Schedule: the VA's own hours (the booked calls moved to the Calendar tab). Clock in and out, their shifts and
// who is on with them (the rota, This week · Next week), time off inside the monthly allowance (P915), and cover:
// swaps, open shifts and holidays (P879). Real data once 231 is applied, the sample until then.
const WEEK_LABEL = ['This week', 'Next week']

// The week's rota: who is on which day (two or three VAs a day), mine first.
function Rota({ week }) {
  const { data: s } = useFulShift()
  if (s.notSet) return <section className="fx-tile fs-rota" style={{ '--i': 1 }}><FirstRun icon={CalendarOff} title="Your rota isn't set up yet" sub="Your shifts and who is on with you show here once the team's rota is built. Shifts are 8 AM to 6 PM Central." /></section>
  const days = s.days[week] || []
  const people = [s.me, ...Array.from(new Map(days.flatMap(d => d.vas).filter(v => !v.me).map(v => [v.id, v])).values())]
  const label = s.live && days.length ? `${WEEK_LABEL[week]}, ${rangeText(days[0].date, days.at(-1).date)}` : WEEK_LABEL[week]
  const mineOn = days.filter(d => d.vas.some(v => v.me && !v.off)).length
  return (
    <section className="fx-tile fs-rota" style={{ '--i': 1 }} aria-label="Your shifts">
      <header className="fx-tile-h">
        <span className="tp-grow"><h2>Your shifts</h2><p>{label} · {mineOn} {mineOn === 1 ? 'shift' : 'shifts'} for you · {s.shift.text}</p></span>
      </header>
      <div className="fs-rota-sc">
        <table className="fs-rota-t">
          <caption className="tp-sr">Who is on shift, {label.toLowerCase()}</caption>
          <thead><tr><th scope="col"><span className="tp-sr">VA</span></th>{days.map(d => <th key={d.day} scope="col" className={d.today ? 'is-today' : ''}>{d.name} <b>{d.day}</b></th>)}</tr></thead>
          <tbody>
            {people.map(v => (
              <tr key={v.id} className={v.me ? 'is-me' : ''}>
                <th scope="row"><Avatar name={v.name} /><span>{v.me ? 'You' : v.name}</span></th>
                {days.map(d => {
                  const on = d.vas.find(x => x.id === v.id)
                  return <td key={d.day} className={d.today ? 'is-today' : ''}>{on ? <span className={`fs-pill${on.off ? ' is-off' : ''}`}>{on.off ? (on.offStatus === 'approved' ? 'Off' : 'Off asked') : 'On'}</span> : <span className="fs-none" aria-label="Not on">·</span>}</td>
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

// Time off: the month's allowance, the days asked, and Request a day off.
function TimeOff({ onAsk }) {
  const { data: s } = useFulShift()
  const { cancel, check } = useDayOffActions()
  const note = useNote()
  const todayIso = s.live ? companyDay() : s.days.flat().find(d => d.today)?.date || ''
  const room = check({ date: todayIso })
  const left = Math.max(0, room.allowance - room.used)
  const mine = (s.dayOffs || []).filter(o => o.date >= todayIso).sort((a, b) => String(a.date).localeCompare(String(b.date)))
  const takeBack = o => cancel(o).then(() => note(`Took back your day off on ${dateLabel(o.date)}`), e => note(e?.message || 'That did not save. Try again.'))
  return (
    <section className="fx-tile fs-timeoff" style={{ '--i': 2 }} aria-label="Time off">
      <header className="fx-tile-h"><span className="tp-grow"><h2>Time off</h2><p>{room.allowance} days off a month · the team covers your shift</p></span></header>
      <div className="fs-to-big"><b className="fx-huge tp-num">{left}</b><span><b>{left === 1 ? 'day' : 'days'} left this month</b><small>{room.used} of {room.allowance} used</small></span></div>
      {mine.length > 0 ? (
        <ul className="fs-offs" aria-label="Your days off">
          {mine.map(o => (
            <li key={o.id}><CalendarOff size={14} aria-hidden="true" /><span className="tp-grow">{dateLabel(o.date)}{o.why ? ` · ${o.why}` : ''}{o.status === 'declined' ? '. The team said no, so you are on.' : ''}</span>
              {o.date > todayIso && <button type="button" className="fx-pillbtn" onClick={() => takeBack(o)}><Undo2 size={13} />Take it back</button>}</li>
          ))}
        </ul>
      ) : <p className="fx-calm"><CalendarCheck size={16} aria-hidden="true" />No days off booked.</p>}
      <button type="button" className="tp-btn ov-ghost fs-to-ask" onClick={onAsk} disabled={s.notSet}><CalendarOff size={15} />Request a day off</button>
    </section>
  )
}

export default function Schedule() {
  const real = useFulSource() === 'real'
  const [week, setWeek] = useState(0)
  const [ask, setAsk] = useState(false)
  return (
    <div className="tp-page fx-page fs-mysched">
      <div className="fx-tools">
        <Seg label="Week" value={week} onChange={setWeek} options={WEEK_LABEL.map((label, key) => ({ key, label }))} />
        <span className="tp-grow" />
        <HelpDot lesson="schedule" />
      </div>
      <div className="fs-ms-grid">
        <ClockTile className="fs-ms-clock" />
        <TimeOff onAsk={() => setAsk(true)} />
        <Rota week={week} />
      </div>
      {!real && <SwapsHolidays />}
      <DayOffDrawer open={ask} onClose={() => setAsk(false)} />
    </div>
  )
}
