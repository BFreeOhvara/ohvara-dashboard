import { Globe2, UserCheck } from 'lucide-react'
import './daybox.css'
import { PillTabs } from './kit'
import { Select } from './Select'
import { ZONE_CHOICES, zoneAbbr, timeLines, slotOptions } from '../lib/callSlots'

// P854 — the one booking-time picker (an agent's Book a call, a VA's booking, callback and Move). Times are always
// the client's: their zone comes from state + city (lib/callSlots zoneOf; a split-state city it doesn't know is
// looked up, strictly); when that fails the booker picks it here. Never a guess. Slots come from lib/callSlots
// (vaSlots / agentSlots): a Taken one is greyed out and can't be picked.

// days: [['Thu', 5], …]; slots: from vaSlots / agentSlots for the chosen day; value: the picked clock ('3:00 PM').
// mine = the VA id that counts as "you" (a slot that goes to someone else says so); notBefore = an ISO cut-off (today).
export function SlotPick({ days, day, onDay, slots, value, onPick, zone, place, viewerTz, mine = null, notBefore = null, label = 'Time', hint, showVa = false }) {
  const list = slots.filter(s => s.why !== 'off' && (!notBefore || s.iso >= notBefore))
  const open = list.some(s => s.open)
  const picked = list.find(s => s.clock === value && s.open) || null
  const lines = picked ? timeLines(picked.iso, zone.tz, viewerTz, place) : null
  const abbr = zone.tz ? zoneAbbr(zone.tz) : ''
  const nobody = zone.tz && slots.length > 0 && list.length === 0
  return (
    <div className="fx-slotpick">
      {!zone.auto && (zone.resolving
        ? <p className="tp-sub fx-tzwait" aria-live="polite"><Globe2 size={14} aria-hidden="true" />Finding their time zone{place ? ` from ${place}` : ''}…</p>
        : <div className="tp-field"><span>Client's time zone</span>
            <Select label="Client's time zone" placeholder="Pick their time zone" value={zone.manual} onChange={tz => { zone.pick(tz); onPick('') }} options={ZONE_CHOICES} invalid={!zone.tz} />
            <small>{place ? `We couldn't tell the zone from ${place}.` : 'We need their city and state to tell the zone.'} Ask them, then pick it.</small>
          </div>)}
      <div className="tp-field"><span>Day</span>
        <PillTabs role="radiogroup" label="Day" className="fx-chips" itemClass="fx-chip" value={day} onChange={d => { onDay(d); onPick('') }}
          items={days.map(([d, n]) => ({ key: n, label: <><small>{d}</small><b>{n}</b></> }))} />
      </div>
      <div className="tp-field"><span>{label} (the client's time{abbr ? `, ${abbr}` : ''})</span>
        <Select label={`${label} (the client's time)`} disabled={!zone.tz || !open} value={picked ? value : ''} onChange={onPick} options={slotOptions(list, { mine })}
          placeholder={!zone.tz ? 'Pick their time zone first' : nobody ? 'Nobody is on shift that day' : open ? 'Pick a time' : list.length ? 'Every time is taken that day' : 'No open times that day'} />
        {lines
          ? <small className="fx-tzline" aria-live="polite"><b>{lines.client}</b>{lines.mine && <span>{lines.mine}</span>}</small>
          : hint && <small>{hint}</small>}
      </div>
      {showVa && zone.tz && (
        <p className={`fx-calltime-va${picked?.va ? ' is-set' : ''}`} aria-live="polite">
          <UserCheck size={16} aria-hidden="true" />
          {picked?.va
            ? <span><b>Goes to {picked.va.id === mine ? 'you' : picked.va.name}</b><small>{picked.va.id === mine ? 'It lands on your Schedule.' : `Free then. It lands on ${picked.va.name.split(' ')[0]}’s Schedule.`}</small></span>
            : <span><b>Pick a time</b><small>Greyed-out times are taken: every VA on shift has a call within 30 minutes.</small></span>}
        </p>
      )}
    </div>
  )
}
