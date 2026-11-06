import { useMemo } from 'react'
import './clock.css'
import { Select } from './Select'
import { SELECTABLE_TIMEZONES, DEFAULT_TIMEZONE, timezoneAbbr } from '../lib/timezones'
import { useTick, clockParts } from './clockTime'

// P847 + P860 — the live clock, one line on the page-title row of every page in all three portals (right side, level with
// the title): "Thursday, Nov 5 · 10:57:29 PM". No zone chip: the zone comes from Settings (profiles.timezone) and the time
// shown is in that zone. Ticks each second, tabular numbers so the line never jitters. It reads the real time, so it is live
// even on the sample pages.
export function LiveClock({ tz = DEFAULT_TIMEZONE }) {
  const now = useTick(1000)
  const c = clockParts(now, tz)
  return (
    <div className="fx-clock" role="timer" aria-live="off" aria-label={`${c.date}, ${c.hm}:${c.s} ${c.ampm}, ${c.zone} time`}>
      <span className="fx-clock-d" aria-hidden="true">{c.date}</span>
      <i className="fx-clock-dot" aria-hidden="true">·</i>
      <b className="fx-clock-t tp-num" aria-hidden="true">{c.hm}:{c.s} {c.ampm}</b>
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
