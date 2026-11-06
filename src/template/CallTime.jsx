import { useMemo } from 'react'
import { CalendarClock, Clock3, Sparkles, UserCheck } from 'lucide-react'
import { PillTabs } from './kit'
import './calls.css'
import { WINDOWS } from './callTimeModel'
import { Select } from './Select'
import { BOOK_DAYS, sampleSlots, hoursLine } from './carriers'
import { useVaFor, rotaOf } from './ful/data'

// P847 — when fulfillment calls, picked while the agent is still on the phone with the client. Both optional:
//   Book a time with them: an exact day and time (the carrier-hours slot rule for a cancellation call). It lands on
//     the Schedule of the VA on shift then (the auto-assign, shown by name).
//   Best time to reach them: a window; the VA on shift calls inside it.
//   Let the team set it: neither, fulfillment reaches out.
// value = { mode: 'none' | 'exact' | 'window', day, time, window }
const MODES = [
  { key: 'exact', label: 'Book a time with them', sub: 'Pick it together now', icon: CalendarClock },
  { key: 'window', label: 'Best time to reach them', sub: 'A window, e.g. mornings', icon: Clock3 },
  { key: 'none', label: 'Let the team set it', sub: 'Fulfillment reaches out', icon: Sparkles },
]

export function CallTime({ kind = 'cancellation', value, onChange, state, oldCarrier }) {
  const v = value
  const carrier = kind === 'cancellation' ? oldCarrier : null
  const slots = useMemo(() => sampleSlots(v.day, state, carrier), [v.day, state, carrier])
  const ok = v.time && slots.includes(v.time)
  const va = useVaFor(v.day, v.mode === 'exact' && ok ? v.time : null)
  const rota = rotaOf(v.day)
  const put = patch => onChange({ ...v, ...patch })
  const what = kind === 'cancellation' ? 'cancellation call' : 'service call'
  return (
    <div className="fx-calltime">
      <div className="fx-calltime-h"><b>When should fulfillment call?</b><small>Optional. Ask while you have them on the phone.</small></div>
      <div className="fx-calltime-modes" role="radiogroup" aria-label={`When the ${what} happens`}>
        {MODES.map(m => (
          <button key={m.key} type="button" role="radio" aria-checked={v.mode === m.key} className={`fx-ctmode${v.mode === m.key ? ' is-on' : ''}`} disabled={v.mode === m.key} onClick={() => put({ mode: m.key })}>
            <m.icon size={17} aria-hidden="true" /><span><b>{m.label}</b><small>{m.sub}</small></span>
          </button>
        ))}
      </div>

      {v.mode === 'exact' && (
        <div className="fx-calltime-b" key="exact">
          <div className="tp-field"><span>Day</span>
            <PillTabs role="radiogroup" label="Day" className="fx-chips" itemClass="fx-chip" value={v.day} onChange={d => put({ day: d, time: '' })}
              items={BOOK_DAYS.map(([d, n]) => ({ key: n, label: <><small>{d}</small><b>{n}</b></> }))} />
          </div>
          <div className="tp-field"><span>Time (the client's time)</span>
            <Select label="Time (the client's time)" placeholder={slots.length ? 'Pick a time' : 'No open times that day'} disabled={!slots.length} value={ok ? v.time : ''} onChange={t => put({ time: t })} options={slots} />
            <small>{kind === 'cancellation' ? hoursLine(carrier) : 'Inside the team’s hours, 8:00 AM to 6:00 PM.'}</small>
          </div>
          <p className={`fx-calltime-va${va ? ' is-set' : ''}`} aria-live="polite">
            <UserCheck size={16} aria-hidden="true" />
            {va
              ? <span><b>Goes to {va.name}</b><small>On shift then. It lands on {va.name.split(' ')[0]}{'’'}s Schedule.</small></span>
              : <span><b>{rota.length ? `On shift: ${rota.map(x => x.name.split(' ')[0]).join(', ')}` : 'Nobody is on shift that day'}</b><small>Pick a time and we give it to whoever is free then.</small></span>}
          </p>
        </div>
      )}
      {v.mode === 'window' && (
        <div className="fx-calltime-b" key="window">
          <div className="tp-field"><span>Best time to reach them</span>
            <Select label="Best time to reach them" value={v.window} onChange={w => put({ window: w })} options={WINDOWS} />
            <small>The client{'’'}s time. The VA on shift calls inside this window.</small>
          </div>
        </div>
      )}
      {v.mode === 'none' && <p className="fx-calm fx-calltime-b" key="none">Fulfillment reaches out to the client to set a time.</p>}
    </div>
  )
}
