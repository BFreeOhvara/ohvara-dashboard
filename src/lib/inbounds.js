import { DEFAULT_TIMEZONE, zonedDateStr } from './timezones.js'
import { US_STATES } from './usStates.js'

// Inbound helpers: stage words, names, time words and event shaping for the agent's Today,
// Inbounds, Inbound detail, header search and Activity. Data comes from migration 180
// (agent_inbounds(), inbound_events).

// ── Stages (leads.inbound_stage) ─────────────────────────────────────────────
export const STAGE = {
  new: { label: 'New', pill: 'new' },
  contacting: { label: 'Contacting', pill: 'contacting' },
  booked: { label: 'Booked', pill: 'booked' },
  met: { label: 'Met', pill: 'met' },
  sold: { label: 'Sold', pill: 'sold' },
  follow_up: { label: 'Follow up', pill: 'follow' },
  lost: { label: 'Lost', pill: 'lost' },
}
export const stageOf = l => STAGE[l?.inbound_stage] || STAGE.new

// The five board columns on Booked appointments. The last one holds three stages.
export const COLUMNS = [
  { key: 'new', title: 'New', sub: 'Just came in', tone: 'new', stages: ['new'] },
  { key: 'contacting', title: 'Contacting', sub: 'VA is calling and texting', tone: 'contacting', stages: ['contacting'] },
  { key: 'booked', title: 'Booked', sub: 'On your calendar', tone: 'booked', stages: ['booked'] },
  { key: 'met', title: 'Met', sub: 'Mark how it went', tone: 'met', stages: ['met'] },
  { key: 'done', title: 'Sold / Follow up / Lost', sub: 'Outcome marked', tone: 'done', stages: ['sold', 'follow_up', 'lost'] },
]

export const PRODUCT_LABEL = { booked_appointment: 'Booked appointment', live_call: 'Live call' }
export const PRODUCT_SHORT = { booked_appointment: 'Appointment', live_call: 'Live call' }

// agent_inbounds().live_call_result (Live calls only)
export const LIVE_RESULT = {
  transferred: { label: 'Transferred to you', pill: 'booked' },
  booked: { label: 'Booked', pill: 'contacting' },
  missed: { label: 'Missed', pill: 'new' },
}

export const OUTCOME_LABEL = { sold: 'Sold', follow_up: 'Follow up', not_interested: 'Not interested' }

// ── Names, phones, places ────────────────────────────────────────────────────
export const leadName = l => (l?.contact_name || '').trim() || 'Unknown caller'
export const firstName = s => (s || '').trim().split(/\s+/)[0] || ''
export const stateName = code => US_STATES.find(s => s.code === code)?.name || code || ''

// (555) 010-0142 from any US format; null when there are no 10 digits.
export function phoneDisplay(raw) {
  const d = String(raw || '').replace(/\D/g, '').slice(-10)
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : null
}
export const telHref = raw => {
  const d = String(raw || '').replace(/\D/g, '')
  return d.length >= 10 ? `tel:+${d.length === 10 ? '1' : ''}${d}` : null
}

// ── Time words (always the agent's own zone) ─────────────────────────────────
const zone = tz => tz || DEFAULT_TIMEZONE
const fmt = (iso, tz, opts) => new Date(iso).toLocaleString('en-US', { timeZone: zone(tz), ...opts })
export const timeText = (iso, tz) => fmt(iso, tz, { hour: 'numeric', minute: '2-digit' })
export const dateText = (iso, tz) => fmt(iso, tz, { month: 'short', day: 'numeric' })
export const dayKey = (iso, tz) => zonedDateStr(new Date(iso).getTime(), zone(tz))
export const sameDay = (a, b, tz) => dayKey(a, tz) === dayKey(b, tz)
const dayDiff = (iso, nowMs, tz) =>
  Math.round((new Date(`${dayKey(iso, tz)}T12:00:00Z`) - new Date(`${zonedDateStr(nowMs, zone(tz))}T12:00:00Z`)) / 864e5)

// "Today" / "Tomorrow" / "Yesterday" / "Wed, Oct 28"
export function dayLabel(iso, tz, nowMs = Date.now()) {
  const n = dayDiff(iso, nowMs, tz)
  if (n === 0) return 'Today'
  if (n === 1) return 'Tomorrow'
  if (n === -1) return 'Yesterday'
  return fmt(iso, tz, { weekday: 'short', month: 'short', day: 'numeric' })
}
// "Today, 2:31 PM" / "Oct 27, 3:15 PM"
export function whenText(iso, tz, nowMs = Date.now()) {
  const n = dayDiff(iso, nowMs, tz)
  const t = timeText(iso, tz)
  if (n === 0) return `Today, ${t}`
  if (n === -1) return `Yesterday, ${t}`
  return `${dateText(iso, tz)}, ${t}`
}
// Upcoming steps in plain words: "Today 5:00 PM", "Tomorrow 9:00 AM", "Fri 10:00 AM", "Tue, Nov 3".
export function upcomingWords(iso, tz, nowMs = Date.now()) {
  const n = dayDiff(iso, nowMs, tz)
  const t = timeText(iso, tz)
  if (n === 0) return `Today ${t}`
  if (n === 1) return `Tomorrow ${t}`
  if (n > 1 && n < 7) return `${fmt(iso, tz, { weekday: 'short' })} ${t}`
  return fmt(iso, tz, { weekday: 'short', month: 'short', day: 'numeric' })
}
// "in 25 min" / "in 2 hr" / "Tomorrow" / "Fri, Oct 30"
export function untilWords(iso, tz, nowMs = Date.now()) {
  const mins = Math.round((new Date(iso).getTime() - nowMs) / 60000)
  if (mins >= -1 && mins < 60) return mins <= 0 ? 'now' : `in ${mins} min`
  if (mins >= 60 && dayDiff(iso, nowMs, tz) === 0) return `in ${Math.round(mins / 60)} hr`
  return dayLabel(iso, tz, nowMs)
}
// 4:45 PM → ['4:45', 'PM']
export function clockParts(iso, tz) {
  const m = timeText(iso, tz).match(/^(\d+:\d+)\s*(AM|PM)$/)
  return m ? [m[1], m[2]] : [timeText(iso, tz), '']
}
export function greeting(tz, nowMs = Date.now()) {
  const h = Number(fmt(new Date(nowMs).toISOString(), tz, { hour: 'numeric', hour12: false })) % 24
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
}

// ── Events (inbound_events) ──────────────────────────────────────────────────
// The appointment time of an inbound. A 'booked' event carries it in detail.appointment_at;
// a scheduled 'booked' event is the appointment itself, so its `at` is the time.
export function appointmentAt(events) {
  const booked = (events || []).filter(e => e.kind === 'booked' && e.state !== 'skipped')
    .sort((a, b) => new Date(b.at) - new Date(a.at))
  for (const e of booked) {
    if (e.detail?.appointment_at) return e.detail.appointment_at
    if (e.state === 'scheduled') return e.at
  }
  return null
}

// Group events by lead id.
export function byLead(events) {
  const m = new Map()
  for (const e of events || []) {
    if (!m.has(e.lead_id)) m.set(e.lead_id, [])
    m.get(e.lead_id).push(e)
  }
  return m
}

// What happens next for one inbound: its first scheduled step.
export const nextScheduled = (events, nowMs = Date.now()) =>
  (events || []).filter(e => e.state === 'scheduled' && e.kind !== 'booked' && new Date(e.at).getTime() >= nowMs - 6e4)
    .sort((a, b) => new Date(a.at) - new Date(b.at))[0] || null

// Default titles when an event has no label.
const KIND_TITLE = {
  came_in: 'Came in', text_sent: 'Text sent', text_received: 'Replied by text', va_call: 'VA called', booked: 'Booked with you',
  reminder: 'Reminder text', transferred: 'Transferred to you', missed: 'Missed', no_show: 'No-show', rebooked: 'Rebooked',
  follow_up: 'Follow up', outcome: 'Outcome marked', note: 'Note', became_client: 'Became a client',
}
export const eventTitle = e => e.label || KIND_TITLE[e.kind] || 'Update'
// The second line of a timeline step: a quote for replies, else detail.summary / detail.note.
export function eventSub(e) {
  const d = e.detail || {}
  if (e.kind === 'text_received' && d.text) return `“${d.text}”`
  return d.summary || d.note || null
}

// Done and upcoming steps, ready to draw: done grouped by day (oldest first), upcoming by time.
// Notes live in their own card, so they are left out here.
export function buildTimeline(events, tz, nowMs = Date.now()) {
  const shown = (events || []).filter(e => e.kind !== 'note' && e.state !== 'skipped')
  const done = shown.filter(e => e.state === 'done').sort((a, b) => new Date(a.at) - new Date(b.at))
  const upcoming = shown.filter(e => e.state === 'scheduled').sort((a, b) => new Date(a.at) - new Date(b.at))
  const days = []
  for (const e of done) {
    const key = dayKey(e.at, tz)
    let g = days[days.length - 1]
    if (!g || g.key !== key) { g = { key, label: dayLabel(e.at, tz, nowMs), items: [] }; days.push(g) }
    g.items.push(e)
  }
  return { days, upcoming }
}

// ── Lists ────────────────────────────────────────────────────────────────────
// When an inbound reached this agent.
export const cameInAt = l => l.delivered_at || l.created_at
// "New inbounds": came in yesterday or today (agent's zone).
export const isRecent = (l, tz, nowMs = Date.now()) => dayDiff(cameInAt(l), nowMs, tz) >= -1

// "Fri, Oct 30, 10:00 AM" (day words for today / tomorrow / yesterday)
export const apptText = (iso, tz, nowMs = Date.now()) => `${dayLabel(iso, tz, nowMs)}, ${timeText(iso, tz)}`

// The one line on an inbound card: what happens next (clock = still to come, check = done).
// kind is check | clock | phone | note; `up` softens the colour for steps still to come.
export function nextLine(l, evs, tz, nowMs = Date.now()) {
  const ns = nextScheduled(evs, nowMs)
  const step = ns && `${eventTitle(ns)} · ${upcomingWords(ns.at, tz, nowMs)}`
  const lastReminder = (evs || []).filter(e => e.kind === 'reminder' && e.state === 'done')
    .sort((a, b) => new Date(b.at) - new Date(a.at))[0]
  switch (l.inbound_stage) {
    case 'contacting':
      return step ? { kind: 'clock', text: step, up: true } : { kind: 'phone', text: 'Our VA keeps trying' }
    case 'booked':
      if (step) return { kind: 'clock', text: step, up: true }
      return lastReminder ? { kind: 'check', text: `Reminder sent ${timeText(lastReminder.at, tz)}` } : { kind: 'check', text: 'On your calendar' }
    case 'met': return { kind: 'note', text: 'Mark the outcome', up: true }
    case 'sold': return { kind: 'check', text: 'Now your client' }
    case 'follow_up': return ns ? { kind: 'clock', text: `Call back ${upcomingWords(ns.at, tz, nowMs)}`, up: true } : { kind: 'clock', text: 'Follow up', up: true }
    case 'lost': return { kind: 'check', text: 'Not interested' }
    default: return step ? { kind: 'clock', text: step, up: true } : { kind: 'clock', text: 'Our VA calls within minutes', up: true }
  }
}

// The small grey line under the name on a card.
export function cardSub(l, appt, tz, nowMs = Date.now()) {
  switch (l.inbound_stage) {
    case 'booked': return appt ? apptText(appt, tz, nowMs) : `Came in ${whenText(cameInAt(l), tz, nowMs)}`
    case 'met': return appt ? `Met ${whenText(appt, tz, nowMs)}` : 'Met'
    case 'sold': return `${l.outcome_at ? dateText(l.outcome_at, tz) : 'Sold'} · now your client`
    case 'follow_up': return l.outcome_at ? `Marked ${dateText(l.outcome_at, tz)}` : 'Follow up'
    case 'lost': return `${l.outcome_at ? dateText(l.outcome_at, tz) : 'Closed'} · not interested`
    default: return `Came in ${whenText(cameInAt(l), tz, nowMs)}`
  }
}

// ── Search and Activity ──────────────────────────────────────────────────────
const digitsOf = s => String(s || '').replace(/\D/g, '')

// Header search: the typed text is in the inbound's name, or 3+ typed digits are in its phone
// (same rule as matchClients). Sorted by name, numeric-aware. Nothing for an empty query.
export function matchInbounds(list, query) {
  const q = String(query || '').trim().toLowerCase()
  if (!q) return []
  const qd = digitsOf(q)
  return (list || [])
    .filter(l => leadName(l).toLowerCase().includes(q) || (qd.length >= 3 && digitsOf(l.phone).includes(qd)))
    .sort((a, b) => leadName(a).localeCompare(leadName(b), undefined, { numeric: true }))
}

// Where an inbound opens.
export const inboundPath = leadId => `/agent/leads/${leadId}`

// Activity feed items for one day's finished inbound steps. Only done steps of inbounds in the agent's
// own list count (scheduled and skipped steps are not events, notes live on the detail page).
// Shaped like the policy-event items, plus `inbound` and `leadId` so a click opens the detail page.
export function inboundActivityItems(events, leads) {
  const byId = new Map((leads || []).map(l => [l.lead_id, l]))
  return (events || [])
    .filter(e => e.state === 'done' && e.kind !== 'note' && byId.has(e.lead_id))
    .map(e => {
      const sub = eventSub(e)
      return {
        key: `i-${e.id}`, id: e.id, kind: 'inbound', inbound: true, at: e.at, leadId: e.lead_id,
        client: leadName(byId.get(e.lead_id)), text: sub ? `${eventTitle(e)} · ${sub}` : eventTitle(e), row: 'inbound',
      }
    })
}
