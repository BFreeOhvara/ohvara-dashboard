import { Switch } from './kit'
import { Select } from './Select'
import { zoneAbbr } from '../lib/callSlots'
import { WEEKDAYS, minOf } from './hoursModel'
import './p878.css'
const CLOCKS = ['7:00 AM', '7:30 AM', '8:00 AM', '8:30 AM', '9:00 AM', '9:30 AM', '10:00 AM', '11:00 AM', '12:00 PM', '1:00 PM', '2:00 PM', '3:00 PM', '4:00 PM', '5:00 PM', '5:30 PM', '6:00 PM', '6:30 PM', '7:00 PM', '8:00 PM', '9:00 PM']

// P878 — the agent's hours per weekday in their confirmed time zone (N-H-13, N-K-04), the calendar link (busy times both
// ways), and the clash list when hours or a blocked day hit booked appointments (N-C-38): Keep or Move each one.
export function HoursEditor({ week, onChange, tz }) {
  const set = (d, patch) => onChange({ ...week, [d]: { ...week[d], ...patch } })
  return (
    <div className="tp-field"><span>Your hours{tz ? ` (your time, ${zoneAbbr(tz)})` : ''}</span>
      <div className="hr-week" role="group" aria-label="Hours per weekday">
        {WEEKDAYS.map(d => {
          const day = week[d]
          const bad = day.on && minOf(day.end) <= minOf(day.start)
          return (
            <div key={d} className="hr-day">
              <b>{d}</b>
              <Switch on={day.on} label={`Work on ${d}`} onChange={on => set(d, { on })} />
              {day.on ? <>
                <Select label={`${d} start`} value={day.start} onChange={v => set(d, { start: v })} options={CLOCKS} />
                <Select label={`${d} end`} value={day.end} onChange={v => set(d, { end: v })} options={CLOCKS} invalid={bad} />
              </> : <span className="is-off">Off. Nothing is booked this day</span>}
            </div>
          )
        })}
      </div>
      <small>Appointments are booked in 30-minute slots inside these hours, never two at once. Clients see the times in their own zone.</small>
    </div>
  )
}

// choice: { [apptId]: 'keep' | 'move' }. Move sends that client an automatic link to pick a new time.
export function ClashList({ items, choice, onChoice, title = 'These booked appointments fall outside' }) {
  if (!items.length) return null
  return (
    <div className="hr-clash" role="group" aria-label={title}>
      <h3>{title}</h3>
      <ul>
        {items.map(a => (
          <li key={a.id}>
            <span><b>{a.who}</b>{a.day}, Nov {a.date}, {a.time} · {a.label}</span>
            <Select label={`${a.who}: keep or move`} value={choice[a.id] || 'keep'} onChange={v => onChoice({ ...choice, [a.id]: v })}
              options={[{ value: 'keep', label: 'Keep it' }, { value: 'move', label: a.kind === 'lead' ? 'Move: send a rebook link' : 'Move: our team reschedules' }]} />
          </li>
        ))}
      </ul>
      <small className="tp-sub">Keep means you still take it. Move texts the client a link to pick a new time (for clients, our team calls).</small>
    </div>
  )
}

// The calendar link: busy times on the agent's own calendar block those slots, and Ohvara appointments show there.
const PROVIDERS = [
  { key: 'gcal', label: 'Google Calendar', sub: 'Gmail or Workspace' },
  { key: 'outlook', label: 'Outlook', sub: 'Microsoft 365 or Outlook.com' },
  { key: null, label: 'Ohvara only', sub: 'Use the calendar here' },
]
export function CalendarConnect({ value, onPick }) {
  return (
    <div className="tp-field"><span>Your calendar</span>
      <div className="hr-connect" role="radiogroup" aria-label="Your calendar">
        {PROVIDERS.map(p => <button key={p.label} type="button" role="radio" aria-checked={value.provider === p.key} className={value.provider === p.key ? 'is-on' : ''} onClick={() => onPick(p.key)}><b>{p.label}</b><small>{p.sub}</small></button>)}
      </div>
      <small>{value.provider ? 'Sample: the link opens once calendar connections are built. Busy times there will block slots here, and your Ohvara appointments will show there.' : 'Appointments live on your Ohvara calendar. You can connect one any time.'}</small>
    </div>
  )
}
