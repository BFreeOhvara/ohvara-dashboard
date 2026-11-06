import { useMemo } from 'react'
import './clock.css'
import { Select } from './Select'
import { SELECTABLE_TIMEZONES, DEFAULT_TIMEZONE, timezoneAbbr } from '../lib/timezones'
import { useTick, clockParts } from './clockTime'

// P847 — the live clock on every portal's Overview header (right side, under Messages and the bell) and the time zone
// pick in Settings. The zone list is the existing one (lib/timezones SELECTABLE_TIMEZONES, the profiles.timezone values);
// the clock reads the real time in the chosen zone, so it is live even on the sample pages.
export function LiveClock({ tz = DEFAULT_TIMEZONE }) {
  const now = useTick(1000)
  const c = clockParts(now, tz)
  return (
    <div className="fx-clock" role="timer" aria-live="off" aria-label={`${c.hm} ${c.ampm}, ${c.date}, ${c.zone} time`}>
      <b className="fx-clock-t tp-num" aria-hidden="true">{c.hm}<i className="fx-clock-s" key={c.s}>{c.s}</i><em>{c.ampm}</em></b>
      <span className="fx-clock-d" aria-hidden="true">{c.date}<i>·</i>{c.zone}</span>
    </div>
  )
}

// The time zone dropdown: each zone with its time right now, so picking is obvious.
export function TimeZoneSelect({ value, onChange, label = 'Time zone' }) {
  const now = useTick(60000)
  const options = useMemo(() => SELECTABLE_TIMEZONES.map(z => {
    const c = clockParts(now, z.value)
    return { value: z.value, label: z.label, sub: `${timezoneAbbr(z.value)} · now ${c.hm} ${c.ampm}` }
  }), [now])
  return <Select label={label} value={value} onChange={onChange} options={options} search />
}
