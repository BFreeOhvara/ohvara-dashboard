// P989 — time zone rules for the phone apps, as plain functions (no React) so node --test runs them. The
// components that use them are in zone.jsx.
import { SELECTABLE_TIMEZONES, DEFAULT_TIMEZONE, timezoneAbbr, timezoneLabel } from '../../lib/timezones.js'

const fmts = new Map()
const fmt = (tz, opts) => {
  const k = `${tz}|${JSON.stringify(opts)}`
  if (!fmts.has(k)) fmts.set(k, new Intl.DateTimeFormat('en-US', { timeZone: tz, ...opts }))
  return fmts.get(k)
}
// The zone's offset from UTC (minutes) at an instant.
function offsetAt(tz, ms) {
  try {
    const p = Object.fromEntries(fmt(tz, { year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(new Date(ms)).map(x => [x.type, x.value]))
    return Math.round((Date.UTC(+p.year, p.month - 1, +p.day, +p.hour % 24, +p.minute) - Math.floor(ms / 60000) * 60000) / 60000)
  } catch { return null }
}
const ALIAS = { 'America/Boise': 'America/Denver', 'America/Detroit': 'America/New_York', 'America/Indiana/Indianapolis': 'America/New_York' }
const PICKABLE = new Set(SELECTABLE_TIMEZONES.map(z => z.value))

// Any IANA zone → one of the zones Settings offers (same clock in winter AND summer), or null when none matches
// (a phone abroad: Ohvara only runs on US zones, so it doesn't offer a switch).
export function pickableZone(tz) {
  if (!tz) return null
  if (PICKABLE.has(tz)) return tz
  if (ALIAS[tz]) return ALIAS[tz]
  const y = new Date().getUTCFullYear()
  const jan = Date.UTC(y, 0, 15, 12), jul = Date.UTC(y, 6, 15, 12)
  const a = offsetAt(tz, jan), b = offsetAt(tz, jul)
  if (a == null) return null
  return SELECTABLE_TIMEZONES.find(z => offsetAt(z.value, jan) === a && offsetAt(z.value, jul) === b)?.value || null
}
export function phoneZone() {
  try { return pickableZone(Intl.DateTimeFormat().resolvedOptions().timeZone) } catch { return null }
}
export const zoneName = tz => { const z = pickableZone(tz) || tz || DEFAULT_TIMEZONE; return z === 'America/Phoenix' ? 'Arizona' : timezoneLabel(z) }

// "Friday, Nov 13 · 12:13 PM CT": the desktop clock line, live, in the user's zone (ticks on the minute).
export function clockLine(ms, tz = DEFAULT_TIMEZONE) {
  const z = tz || DEFAULT_TIMEZONE
  const date = fmt(z, { weekday: 'long', month: 'short', day: 'numeric' }).format(new Date(ms))
  const time = fmt(z, { hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(ms))
  return { date, time, abbr: timezoneAbbr(z), text: `${date} · ${time} ${timezoneAbbr(z)}` }
}

// A time with its zone: "2:00 PM CT". `theirs` (a lead's or client's zone) adds theirs when the clock differs:
// "2:00 PM your time · 1:00 PM theirs".
export function timeIn(iso, tz) {
  if (!iso || Number.isNaN(new Date(iso).getTime())) return ''
  return fmt(tz || DEFAULT_TIMEZONE, { hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(iso))
}
export function bothZones(iso, mine, theirs) {
  const a = timeIn(iso, mine)
  if (!a) return ''
  const b = theirs && pickableZone(theirs) !== pickableZone(mine) ? timeIn(iso, theirs) : ''
  return b && b !== a ? `${a} your time · ${b} theirs` : `${a} ${timezoneAbbr(pickableZone(mine) || mine || DEFAULT_TIMEZONE)}`
}

// "8:00 AM to 6:00 PM" on the team's clock (Central) in another zone, for a VA who isn't on Central: "9 AM to 7 PM".
// Null when the zones read the same clock or the text isn't two times.
export function shiftIn(text, tz, from = DEFAULT_TIMEZONE) {
  const m = /(\d{1,2})(?::(\d{2}))?\s*([AP]M)\s*(?:to|-|–)\s*(\d{1,2})(?::(\d{2}))?\s*([AP]M)/i.exec(String(text || ''))
  if (!m || !tz || pickableZone(tz) === pickableZone(from)) return null
  const at = (h, mi, ap) => {
    const H = (+h % 12) + (/p/i.test(ap) ? 12 : 0)
    const d = new Date()
    const base = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), H, +(mi || 0)) // today, so summer time counts
    const iso = new Date(base - offsetAt(from, base) * 60000).toISOString()
    return timeIn(iso, tz).replace(':00', '')
  }
  return `${at(m[1], m[2], m[3])} to ${at(m[4], m[5], m[6])}`
}

// P989: shifts run on Central (the team's clock); a VA elsewhere also sees them in their own time:
// "8 AM to 6 PM Central · 9 AM to 7 PM your time".
export function shiftWords(text, tz) {
  const t = text || '8:00 AM to 6:00 PM'
  const mine = shiftIn(t, tz)
  return `${t.replace(/:00/g, '')} Central${mine ? ` · ${mine} your time` : ''}`
}

// A booking's time for the lead or client, when their clock differs from yours: "1:00 PM". Null when it's the same.
export function theirTime(e, mine) {
  if (!e?.iso || !e?.tz) return null
  const a = timeIn(e.iso, mine), b = timeIn(e.iso, e.tz)
  return b && b !== a ? b : null
}
// "2:00 PM your time · 1:00 PM theirs", or "2:00 PM CT" when they're on your clock.
export function whenBoth(e, mine) {
  const t = theirTime(e, mine)
  const shown = e?.time || timeIn(e?.iso, mine)
  return t ? `${shown} your time · ${t} theirs` : `${shown} ${timezoneAbbr(pickableZone(mine) || mine || DEFAULT_TIMEZONE)}`
}
