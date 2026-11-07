import { useEffect, useMemo } from 'react'
import { CalendarClock, Clock3, Sparkles } from 'lucide-react'
import './calls.css'
import { WINDOWS } from './callTimeModel'
import { Select } from './Select'
import { SlotPick } from './SlotPick'
import { useClientZone } from './useClientZone'
import { BOOK_DAYS, isoOf, sampleSlots, hoursLine } from './carriers'
import { useVaBooking, NOW_ISO } from './ful/data'
import { vaSlots } from '../lib/callSlots'

// P847 — when fulfillment calls, picked while the agent is still on the phone with the client. Both optional:
//   Book a time with them: an exact day and time (the carrier-hours slot rule for a cancellation call). It lands on
//     the Schedule of the VA on shift then (the auto-assign, shown by name).
//   Best time to reach them: a window; the VA on shift calls inside it.
//   Let the team set it: neither, fulfillment reaches out.
// value = { mode: 'none' | 'exact' | 'window', day, time, window, iso, tz, vaId }
// P854: the time is the client's (zone from state + city, or picked); a slot is open only when a VA on shift then is
// free under the 30-minute rule (lib/callSlots); iso + tz + vaId are what gets stored.
const MODES = [
  { key: 'exact', label: 'Book a time with them', sub: 'Pick it together now', icon: CalendarClock },
  { key: 'window', label: 'Best time to reach them', sub: 'A window, e.g. mornings', icon: Clock3 },
  { key: 'none', label: 'Let the team set it', sub: 'Fulfillment reaches out', icon: Sparkles },
]

// P868 — the exact-time picker on its own (CallTime's "Book a time with them", and Submit a policy's "Book a call").
// value = { day, time, iso, tz, vaId }. kind 'cancellation' books inside the old carrier's open hours; anything else
// inside the team's hours (8 AM to 6 PM). A VA on shift must be free under the 30-minute rule (no double-booking).
export function BookTime({ kind = 'cancellation', value, onChange, state, city = '', oldCarrier, viewerTz }) {
  const v = value
  const carrier = kind === 'cancellation' ? oldCarrier : null
  const zone = useClientZone(state, city)
  const book = useVaBooking()
  const clocks = useMemo(() => (zone.tz ? sampleSlots(v.day, zone.tz, carrier) : []), [v.day, zone.tz, carrier])
  const slots = vaSlots({ date: isoOf(v.day), clocks, clientTz: zone.tz, team: book.team, calls: book.calls, load: book.load })
  const pick = slots.find(s => s.clock === v.time && s.open && s.iso >= NOW_ISO)
  // A picked time that stopped fitting (another zone picked, the slot got taken) is dropped, not kept stale.
  const stale = !!v.time && (!pick || pick.iso !== v.iso || pick.va?.id !== v.vaId)
  useEffect(() => { if (stale) onChange({ ...v, time: '', iso: null, vaId: null, tz: zone.tz }) })
  const put = patch => onChange({ ...v, ...patch })
  const setTime = t => { const s = slots.find(x => x.clock === t); put({ time: t, iso: s?.iso || null, tz: zone.tz, vaId: s?.va?.id || null }) }
  const place = city ? `${city}, ${state}` : state || ''
  return (
    <SlotPick days={BOOK_DAYS} day={v.day} onDay={d => put({ day: d, time: '', iso: null, vaId: null })} slots={slots} value={v.time} onPick={setTime}
      zone={zone} place={place} viewerTz={viewerTz} notBefore={NOW_ISO} showVa
      hint={kind === 'cancellation' ? hoursLine(carrier) : 'Inside the team’s hours, 8:00 AM to 6:00 PM.'} />
  )
}

export function CallTime({ kind = 'cancellation', value, onChange, state, city = '', oldCarrier, viewerTz }) {
  const v = value
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
          <BookTime kind={kind} value={v} onChange={onChange} state={state} city={city} oldCarrier={oldCarrier} viewerTz={viewerTz} />
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
