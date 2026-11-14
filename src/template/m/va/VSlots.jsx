import { Globe2, UserCheck } from 'lucide-react'
import { ZONE_CHOICES, zoneAbbr, timeLines, slotOptions } from '../../../lib/callSlots'

// P1002 — the phone's booking-time picker: the desktop SlotPick (src/template/SlotPick.jsx) as chips. Same slots (lib/callSlots
// vaSlots / agentSlots), same rules: times are the client's, a Taken one can't be picked, the zone is asked only when
// it can't be worked out. Used by Move (a booked call) and Book for an agent.
// days: [['Thu', 5], …]; slots: for the chosen day; value: the picked clock ('3:00 PM'); mine: the VA id that is "you".
export function SlotChooser({ days, day, onDay, slots, value, onPick, zone, place, viewerTz, mine = null, notBefore = null, label = 'Time', hint, showVa = false }) {
  const list = slots.filter(s => s.why !== 'off' && (!notBefore || s.iso >= notBefore))
  const opts = slotOptions(list, { mine })
  const open = list.some(s => s.open)
  const picked = list.find(s => s.clock === value && s.open) || null
  const lines = picked ? timeLines(picked.iso, zone.tz, viewerTz, place) : null
  const abbr = zone.tz ? zoneAbbr(zone.tz) : ''
  const nobody = zone.tz && slots.length > 0 && list.length === 0
  return (
    <div className="va-slots">
      {!zone.auto && (zone.resolving
        ? <p className="ma-hint va-slots-wait" aria-live="polite"><Globe2 size={14} aria-hidden="true" />Finding their time zone{place ? ` from ${place}` : ''}…</p>
        : (
          <label className="va-field va-field-sel"><span>Client&apos;s time zone</span>
            <select value={zone.manual || ''} onChange={e => { zone.pick(e.target.value); onPick('') }} aria-invalid={!zone.tz}>
              <option value="">Pick their time zone</option>
              {ZONE_CHOICES.map(z => <option key={z.value} value={z.value}>{z.label}</option>)}
            </select>
            <small>{place ? `We couldn't tell the zone from ${place}.` : 'We need their city and state to tell the zone.'} Ask them, then pick it.</small>
          </label>
        ))}
      <p className="ma-cap">Day</p>
      <div className="va-chips va-dayscroll" role="radiogroup" aria-label="Day">
        {days.map(([d, n]) => (
          <button key={n} type="button" role="radio" aria-checked={day === n} className={`ma-chip va-tap va-daychip ma-press${day === n ? ' is-solid' : ''}`} onClick={() => { onDay(n); onPick('') }}>
            <small>{d}</small><b>{n}</b>
          </button>
        ))}
      </div>
      <p className="ma-cap is-out">{label} (the client&apos;s time{abbr ? `, ${abbr}` : ''})</p>
      {!zone.tz && <p className="ma-hint">Pick their time zone first.</p>}
      {zone.tz && (opts.length > 0
        ? (
          <div className="va-timegrid" role="radiogroup" aria-label={label}>
            {opts.map(o => (
              <button key={o.value} type="button" role="radio" aria-checked={value === o.value} disabled={o.disabled} className={`ma-chip va-tap va-timechip ma-press${value === o.value ? ' is-solid' : ''}`} onClick={() => onPick(o.value)}>
                <b>{o.label}</b>{o.sub && <small>{o.sub}</small>}
              </button>
            ))}
          </div>
        )
        : <p className="ma-hint">{nobody ? 'Nobody is on shift that day.' : 'No open times that day.'}</p>)}
      {zone.tz && opts.length > 0 && !open && <p className="ma-hint">Every time is taken that day.</p>}
      {lines
        ? <p className="va-tzline" aria-live="polite"><b>{lines.client}</b>{lines.mine && <span>{lines.mine}</span>}</p>
        : hint && <p className="ma-hint">{hint}</p>}
      {showVa && zone.tz && (
        <p className={`va-slotva${picked?.va ? ' is-set' : ''}`} aria-live="polite">
          <UserCheck size={16} aria-hidden="true" />
          {picked?.va
            ? <span><b>Goes to {picked.va.id === mine ? 'you' : picked.va.name}</b><small>{picked.va.id === mine ? 'It lands on your Schedule.' : `Free then. It lands on ${picked.va.name.split(' ')[0]}’s Schedule.`}</small></span>
            : <span><b>Pick a time</b><small>Greyed-out times are taken: every VA on shift has a call within 30 minutes.</small></span>}
        </p>
      )}
    </div>
  )
}
