// P932 — path of least resistance (Brayden, Nov 9 22:32): "our own system already knows how each carrier does it".
// Pure rules, no React (node --test runs them):
//   entryFor / pathFor   the carrier playbook entry for a change and the easiest path: e-sign the carrier's form
//                        (P886 sends it, a follow-up checks it was processed, the client gets a "done" text) or a
//                        merge call. A carrier not in the playbook: "New carrier: we'll learn it on this call".
//   openState / doItNow  is the carrier open now; "do it now" when it's open, a VA is free and the client says yes;
//                        closing soon, closed or the weekend → the next times the carrier is open and the client is free.
import { PLAYBOOK, ACTIONS, PLAYBOOK_CHECKED } from './playbookData.js'
import { findCarrier, CARRIER_CATALOG, MEDIAN_HOURS, CENTRAL, isVerified } from '../carriers/catalog.js'
import { DAYS, toMin } from '../carriers.js'
import { zonedTimeToUtcIso } from '../timezones.js'

export { PLAYBOOK, ACTIONS, PLAYBOOK_CHECKED }

export const ACTION_WORD = { cancel: 'Cancel', beneficiary: 'Beneficiary', bank: 'Bank or draft day', address: 'Address', name: 'Name' }
export const METHOD = {
  esign: { label: 'E-sign their form', short: 'E-sign', tone: 'green' },
  online: { label: 'Owner does it online', short: 'Online', tone: 'blue' },
  merge: { label: 'Owner on a merge call', short: 'Merge call', tone: 'violet' },
  check: { label: 'Check on first call', short: 'Check', tone: 'warn' },
}
export const VIA_WORD = { fax: 'Fax', email: 'Email', upload: 'Upload', mail: 'Mail' }

// The change a task or call is about → the playbook action.
const ACTION_OF = {
  beneficiary_change: 'beneficiary', payment_change: 'bank', draft_date_change: 'bank', bank_change: 'bank',
  address_change: 'address', name_change: 'name', cancel_old: 'cancel', cancel: 'cancel', cancellation_request: 'cancel',
}
export const actionOf = kind => ACTION_OF[kind] || (ACTIONS.includes(kind) ? kind : null)

const byKey = new Map(PLAYBOOK.map(p => [p.key, p]))
export const PLAYBOOK_CARRIERS = PLAYBOOK.map(p => ({ ...p, name: CARRIER_CATALOG.find(c => c.id === p.key)?.name || p.key }))

// The carrier's playbook: { carrier (catalog row or null), entry (playbook carrier or null) }. `edits` are the saved
// rows ({ [key]: { [action]: entry } }), which win over the researched seed.
export function playbookOf(carrierName, edits = null) {
  const carrier = findCarrier(carrierName)
  const key = carrier?.id || null
  const seed = key ? byKey.get(key) : null
  const own = key && edits?.[key]
  if (!seed && !own) return { carrier, entry: null, key, name: carrier?.name || String(carrierName || '').trim() }
  const actions = { ...(seed?.actions || {}), ...(own || {}) }
  return { carrier, key, name: carrier?.name || carrierName, entry: { ...(seed || { key, phone: carrier?.service_phone || null }), actions } }
}

export function entryFor(carrierName, action, edits = null) {
  const pb = playbookOf(carrierName, edits)
  const a = pb.entry?.actions?.[action] || null
  return { ...pb, action, step: a }
}

// The easiest path for a change: 'esign' when the carrier takes a signed form by fax, email or upload, else 'merge'
// (online-only and phone-only carriers, mail-only forms and "check on first call" all go to a merge call with the owner).
export function pathFor(carrierName, kindOrAction, edits = null) {
  const action = actionOf(kindOrAction)
  const e = entryFor(carrierName, action, edits)
  const phone = e.entry?.phone || e.carrier?.service_phone || null
  if (!e.entry) return { ...e, phone, known: false, path: 'merge', learn: true, line: 'New carrier: we’ll learn it on this call.' }
  const s = e.step || { method: 'check', have: [] }
  const esign = s.method === 'esign' && ['fax', 'email', 'upload'].includes(s.via)
  const line = esign
    ? `${e.name} takes a signed form. We send the e-sign link; you don’t need to call them.`
    : s.method === 'online' ? `${e.name}: the owner can do it online, or we merge them in on a call.`
    : s.method === 'merge' ? `${e.name} needs the owner on the phone. Merge call.`
    : `${e.name}: not confirmed yet. Check on first call, then save what you learn.`
  return { ...e, step: s, phone, known: true, path: esign ? 'esign' : 'merge', learn: s.method === 'check', wetInk: esign && s.esign === 'no', line }
}

// What follows an e-sign path, in order (the panel's tracker).
export const ESIGN_STEPS = [
  { key: 'sent', label: 'Link texted', sub: 'Prefilled from the policy' },
  { key: 'signed', label: 'Signed on their phone' },
  { key: 'to_carrier', label: 'Sent to the carrier', sub: 'Fax, email or upload' },
  { key: 'processed', label: 'Carrier processed it', sub: 'Follow-up task checks' },
  { key: 'done_text', label: '“Done” text sent' },
]
export const esignStage = status => ({ out_for_signature: 1, signed: 2, sent: 3, delivered: 3, processed: 4, done: 5 })[status] ?? 0

// ── Carrier clock ────────────────────────────────────────────────────────
const partsFmt = new Map()
function partsIn(ms, tz) {
  if (!partsFmt.has(tz)) partsFmt.set(tz, new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit' }))
  const p = Object.fromEntries(partsFmt.get(tz).formatToParts(new Date(ms)).map(x => [x.type, x.value]))
  return { day: p.weekday.toLowerCase().slice(0, 3), min: (+p.hour % 24) * 60 + +p.minute, date: `${p.year}-${p.month}-${p.day}` }
}
// A carrier's weekly hours and their zone: its own when verified, else the median of verified carriers (Central).
export function hoursOf(carrier) {
  if (carrier && isVerified(carrier)) return { hours: carrier.hours, tz: carrier.hours_tz, verified: true }
  return { hours: MEDIAN_HOURS.hours, tz: MEDIAN_HOURS.hours_tz, verified: false }
}

export const SOON_MIN = 30   // "closing soon": under 30 minutes left
export function openState(carrier, now = Date.now()) {
  const { hours, tz, verified } = hoursOf(carrier)
  const p = partsIn(now, tz)
  const h = hours[p.day]
  const weekend = p.day === 'sat' || p.day === 'sun'
  if (!h) return { open: false, reason: weekend ? 'weekend' : 'closed', verified, tz }
  const o = toMin(h.open), c = toMin(h.close)
  if (p.min < o) return { open: false, reason: 'before', opensIn: o - p.min, verified, tz }
  if (p.min >= c) return { open: false, reason: 'closed', verified, tz }
  const left = c - p.min
  return { open: true, reason: left <= SOON_MIN ? 'closing' : 'open', closesIn: left, verified, tz }
}

const VA_DAY = { open: 8 * 60, close: 18 * 60 }   // VA shifts 8 AM–6 PM Central, weekdays
const fmtTime = new Intl.DateTimeFormat('en-US', { timeZone: CENTRAL, hour: 'numeric', minute: '2-digit' })
const fmtDay = new Intl.DateTimeFormat('en-US', { timeZone: CENTRAL, weekday: 'long' })
export function whenLabel(ms, now = Date.now()) {
  const t = fmtTime.format(new Date(ms)).replace(':00', '')
  const d0 = partsIn(now, CENTRAL).date, d1 = partsIn(ms, CENTRAL).date
  const tomorrow = partsIn(now + 864e5, CENTRAL).date
  const day = d1 === d0 ? 'today' : d1 === tomorrow ? 'tomorrow' : fmtDay.format(new Date(ms))
  return `${day} at ${t}`
}

// The next `count` times (on different days, or later today) when the carrier is open with an hour to spare, a VA is on
// shift and the client is free. clientFree: (ms) => boolean, or null for "any time". Weekend → Monday. Each time is
// the first good half hour from an hour after the carrier opens.
export function nextTimes(carrier, now = Date.now(), { clientFree = null, count = 2, callMin = 30 } = {}) {
  const { hours, tz } = hoursOf(carrier)
  const out = []
  const start = Math.ceil((now + 15 * 6e4) / 18e5) * 18e5
  let lastDay = null
  for (let ms = start; ms < now + 8 * 864e5 && out.length < count; ms += 18e5) {
    const cp = partsIn(ms, tz), vp = partsIn(ms, CENTRAL)
    if (lastDay === vp.date) continue
    const h = hours[cp.day]
    if (!h || vp.day === 'sat' || vp.day === 'sun') continue
    const o = toMin(h.open) + 60, c = toMin(h.close) - 15
    if (cp.min < Math.min(o, c - callMin) || cp.min + callMin > c) continue
    if (vp.min < VA_DAY.open || vp.min + callMin > VA_DAY.close) continue
    if (clientFree && !clientFree(ms)) continue
    out.push({ at: new Date(ms).toISOString(), label: whenLabel(ms, now) })
    lastDay = vp.date
  }
  return out
}

// "Do it now" for a call-type change: mode 'now' (carrier open, not closing, a VA free) with the hold line, else
// 'closing' / 'closed' / 'busy' with the next open times and the line to say.
export function doItNow(carrier, now = Date.now(), { vaFree = true, clientFree = null, name = 'They' } = {}) {
  const st = openState(carrier, now)
  if (st.open && st.reason === 'open' && vaFree) {
    return { mode: 'now', state: st, times: [], say: `You can hold while I reach ${name}, or I’ll ring you back as soon as they answer.` }
  }
  const times = nextTimes(carrier, now, { clientFree })
  const first = times[0]?.label, second = times[1]?.label
  const ask = first ? `Can we do ${first}${second ? ` or ${second}` : ''}?` : 'When’s a good time for you this week?'
  const mode = !vaFree && st.open ? 'busy' : st.reason === 'closing' ? 'closing' : 'closed'
  const lead = mode === 'closing' ? `${name} close${name === 'They' ? '' : 's'} soon.`
    : mode === 'busy' ? 'Everyone’s on a call right now.'
    : st.reason === 'weekend' ? `${name} ${name === 'They' ? 'are' : 'is'} closed for the weekend.`
    : `${name} ${name === 'They' ? 'are' : 'is'} closed right now.`
  return { mode, state: st, times, say: `${lead} ${ask}` }
}

export const DAYS_ORDER = DAYS
// Plain-words weekly hours on Central's clock ("Mon–Fri 8 AM–5 PM CT"), from the hours themselves.
export function hoursLine(carrier) {
  const { hours, tz, verified } = hoursOf(carrier)
  const days = DAYS.filter(d => hours[d])
  if (!days.length) return 'Hours not known'
  const h = hours[days[0]]
  const same = days.every(d => hours[d].open === h.open && hours[d].close === h.close)
  const t = hhmm => { const m = toMin(hhmm); const hr = Math.floor(m / 60); return `${hr % 12 || 12}${m % 60 ? `:${String(m % 60).padStart(2, '0')}` : ''} ${hr < 12 ? 'AM' : 'PM'}` }
  const ab = { 'America/Chicago': 'CT', 'America/New_York': 'ET', 'America/Denver': 'MT', 'America/Phoenix': 'MST', 'America/Los_Angeles': 'PT' }[tz] || tz
  const span = days.length === 5 && days[0] === 'mon' && days[4] === 'fri' ? 'Mon–Fri' : days.map(d => d[0].toUpperCase() + d.slice(1)).join(', ')
  return `${span}${same ? ` ${t(h.open)}–${t(h.close)} ${ab}` : ''}${verified ? '' : ' (not verified)'}`
}
// The zoned instant of a local wall time, for tests.
export const at = (local, tz = CENTRAL) => Date.parse(zonedTimeToUtcIso(local, tz))
