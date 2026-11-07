// P882 — the pre-dial check, as plain data (the server's predial_check is the real gate; this is the same rule set so
// the VA's "To call" list can show a blocked row before anyone taps Call). Before every outbound call:
//   consent on file · not opted out · not on our do-not-call list · not on the national list without written consent
//   · inside calling hours in EVERY zone of the lead's state (8 AM to 9 PM; FL, OK, MD and WA end at 8 PM)
//   · under the state's attempt cap (FL, OK, MD: 3 calls in 24 hours; others: none).
// A call the lead made to us (callIn) skips consent and the do-not-call lists, never the opt-out for outbound.
// No imports on purpose: it runs under node --test. Zones are the same list as the server's texting window.

export const STATE_ZONES = {
  AL: ['America/Chicago'], AK: ['America/Anchorage', 'America/Adak'], AZ: ['America/Phoenix'],
  AR: ['America/Chicago'], CA: ['America/Los_Angeles'], CO: ['America/Denver'],
  CT: ['America/New_York'], DE: ['America/New_York'], DC: ['America/New_York'],
  FL: ['America/New_York', 'America/Chicago'], GA: ['America/New_York'], HI: ['Pacific/Honolulu'],
  ID: ['America/Boise', 'America/Los_Angeles'], IL: ['America/Chicago'],
  IN: ['America/Indiana/Indianapolis', 'America/Chicago'], IA: ['America/Chicago'],
  KS: ['America/Chicago', 'America/Denver'], KY: ['America/New_York', 'America/Chicago'],
  LA: ['America/Chicago'], ME: ['America/New_York'], MD: ['America/New_York'],
  MA: ['America/New_York'], MI: ['America/Detroit', 'America/Menominee'], MN: ['America/Chicago'],
  MS: ['America/Chicago'], MO: ['America/Chicago'], MT: ['America/Denver'],
  NE: ['America/Chicago', 'America/Denver'], NV: ['America/Los_Angeles'], NH: ['America/New_York'],
  NJ: ['America/New_York'], NM: ['America/Denver'], NY: ['America/New_York'],
  NC: ['America/New_York'], ND: ['America/Chicago', 'America/Denver'], OH: ['America/New_York'],
  OK: ['America/Chicago'], OR: ['America/Los_Angeles', 'America/Boise'], PA: ['America/New_York'],
  RI: ['America/New_York'], SC: ['America/New_York'], SD: ['America/Chicago', 'America/Denver'],
  TN: ['America/Chicago', 'America/New_York'], TX: ['America/Chicago', 'America/Denver'],
  UT: ['America/Denver'], VT: ['America/New_York'], VA: ['America/New_York'],
  WA: ['America/Los_Angeles'], WV: ['America/New_York'], WI: ['America/Chicago'],
  WY: ['America/Denver'], PR: ['America/Puerto_Rico'], VI: ['America/St_Thomas'],
  GU: ['Pacific/Guam'], MP: ['Pacific/Saipan'], AS: ['Pacific/Pago_Pago'],
}

// Calling hours (minutes after local midnight; start inclusive, end exclusive) and the 24-hour attempt cap.
export const DEFAULT_RULE = { start: 8 * 60, end: 21 * 60, cap: null }
export const STATE_RULES = {
  FL: { end: 20 * 60, cap: 3 },
  OK: { end: 20 * 60, cap: 3 },
  MD: { end: 20 * 60, cap: 3 },
  WA: { end: 20 * 60 },
}
export const ruleFor = state => ({ ...DEFAULT_RULE, ...(STATE_RULES[code(state)] || {}) })
const code = s => String(s ?? '').trim().toUpperCase()
export const zonesFor = state => STATE_ZONES[code(state)] || null

const DAY = 24 * 60 * 60 * 1000
const STEP = 5 * 60 * 1000

export function localMinutes(at, tz) {
  const parts = new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: tz }).formatToParts(at)
  const get = t => Number(parts.find(p => p.type === t)?.value ?? NaN)
  return get('hour') * 60 + get('minute')
}
export function inHours(at, state) {
  const zones = zonesFor(state)
  if (!zones) return false
  const r = ruleFor(state)
  return zones.every(tz => { const m = localMinutes(at, tz); return m >= r.start && m < r.end })
}
// The next moment inside calling hours (5-minute steps, up to two days out), rounded to the step.
export function nextOpen(at, state) {
  if (!zonesFor(state)) return null
  let t = Math.ceil(at.getTime() / STEP) * STEP
  for (let i = 0; i < (2 * DAY) / STEP; i++, t += STEP) if (inHours(new Date(t), state)) return new Date(t)
  return null
}

// lead: { state, consent, optedOut, dnc, nationalDnc, writtenConsent, attempts: [ms or iso of calls in the last day] }
// → { ok, reason, nextAt (Date | null) }. reason matches the server's predial_check.
export function predial(lead, now = new Date(), { callIn = false } = {}) {
  const at = now instanceof Date ? now : new Date(now)
  if (lead.optedOut) return block('opted_out')
  if (!callIn) {
    if (!lead.consent) return block('no_consent')
    if (lead.dnc) return block('dnc')
    if (lead.nationalDnc && !lead.writtenConsent) return block('national_dnc')
  }
  if (!zonesFor(lead.state)) return block('unknown_state')
  if (!callIn) {
    const r = ruleFor(lead.state)
    const recent = (lead.attempts || []).map(a => (typeof a === 'number' ? a : Date.parse(a))).filter(t => at - t < DAY).sort((a, b) => a - b)
    if (r.cap != null && recent.length >= r.cap) {
      const free = new Date(recent[recent.length - r.cap] + DAY)
      return block('attempt_cap', inHours(free, lead.state) ? free : nextOpen(free, lead.state))
    }
    if (!inHours(at, lead.state)) return block('outside_hours', nextOpen(at, lead.state))
  }
  return { ok: true, reason: null, nextAt: null }
}
const block = (reason, nextAt = null) => ({ ok: false, reason, nextAt })

export const REASON_WORDS = {
  no_consent: 'No consent on file',
  opted_out: 'Opted out: no calls or texts',
  dnc: 'On our do-not-call list',
  national_dnc: 'On the national do-not-call list',
  outside_hours: 'Outside calling hours',
  attempt_cap: 'Call limit reached for today',
  unknown_state: 'State unknown, so calling hours can’t be checked',
}

// "Outside calling hours · calls at 8:00 AM ET" — the time in the lead's own zone (the first zone of the state).
export function predialLine(res, state, now = new Date()) {
  if (!res || res.ok) return ''
  const words = REASON_WORDS[res.reason] || 'Can’t call right now'
  const tz = zonesFor(state)?.[0]
  if (!res.nextAt || !tz) return words
  const t = new Date(res.nextAt)
  const parts = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz, timeZoneName: 'short' }).formatToParts(t)
  const get = k => parts.find(p => p.type === k)?.value || ''
  const day = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: tz }).format(t)
  const today = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: tz }).format(new Date(now))
  return `${words} · calls at ${day !== today ? `${day} ` : ''}${get('hour')}:${get('minute')} ${get('dayPeriod')} ${get('timeZoneName')}`
}
