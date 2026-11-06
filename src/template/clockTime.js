import { useEffect, useState } from 'react'
import { DEFAULT_TIMEZONE, timezoneAbbr, timezoneLabel } from '../lib/timezones'

// P847 — the live clock's tick and its parts in a zone (Clock.jsx).
export function useTick(ms = 1000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    // Line the ticks up with the wall clock's seconds so the minute turns over on time.
    let t = setTimeout(function tick() { setNow(Date.now()); t = setTimeout(tick, ms - (Date.now() % ms)) }, ms - (Date.now() % ms))
    return () => clearTimeout(t)
  }, [ms])
  return now
}

const fmts = new Map()
const fmt = (tz, opts) => {
  const k = `${tz}|${JSON.stringify(opts)}`
  if (!fmts.has(k)) fmts.set(k, new Intl.DateTimeFormat('en-US', { timeZone: tz, ...opts }))
  return fmts.get(k)
}
export function clockParts(ms, tz = DEFAULT_TIMEZONE) {
  const p = Object.fromEntries(fmt(tz, { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true }).formatToParts(new Date(ms)).map(x => [x.type, x.value]))
  return {
    hm: `${p.hour}:${p.minute}`, s: p.second, ampm: p.dayPeriod,
    date: fmt(tz, { weekday: 'long', month: 'short', day: 'numeric' }).format(new Date(ms)),
    zone: `${timezoneLabel(tz)} (${timezoneAbbr(tz)})`,
  }
}

