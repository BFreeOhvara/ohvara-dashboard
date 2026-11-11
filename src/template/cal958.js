// P958 — every week calendar (agent Calendar, VA Calendar, admin Fulfillment): what a call box says, how a call that
// has passed looks, and the timings for "click a call: its day opens first, then the details slide in". Plain
// functions, no React (cal958.test.js); the box itself is CalEv.jsx.
import { clockOf, zoneAbbr } from '../lib/callSlots.js'
import { agentStatusOf } from './agentView.js'

// Two lines at 16 px plus the box's padding and border: a box is never drawn shorter, so no line is ever cut in half.
export const EV_MIN_PX = 44
// The day box slides in over 280 ms (daybox.css); the details wait for it.
export const DAY_FIRST_MS = 320
// The boxes' entrance (flow.css fx-pop: .3 s delay + .45 s) is over by then; after it, nothing replays it.
export const SETTLE_MS = 1100

// Line 2: the call's type and, when their clock differs from yours, the client's time. Empty parts drop out.
export const evLine2 = (type, client) => [type, client].filter(Boolean).join(' · ')

// "client 2:00 PM ET" when the client's clock shows a different time from the viewer's; '' otherwise.
export function clientAt(iso, viewerTz, clientTz) {
  if (!iso || !clientTz || !viewerTz) return ''
  const theirs = clockOf(iso, clientTz)
  if (theirs === clockOf(iso, viewerTz)) return ''
  return `client ${theirs} ${zoneAbbr(clientTz, iso)}`
}

// '1:00 PM' -> minutes after midnight (null when it isn't a time).
export function minsOf(time) {
  const m = /(\d+):(\d+)\s*(AM|PM)/i.exec(String(time || ''))
  if (!m) return null
  return ((Number(m[1]) % 12) + (m[3].toUpperCase() === 'PM' ? 12 : 0)) * 60 + Number(m[2])
}
const pad = n => String(n).padStart(2, '0')
// A wall-clock stamp 'YYYY-MM-DDTHH:MM' for a day and a time on it.
export function stampOf(isoDay, time) {
  const m = minsOf(time)
  if (!isoDay || m == null) return null
  return `${isoDay}T${pad(Math.floor(m / 60))}:${pad(m % 60)}`
}
// Has the call ended? end = start + its length (30 minutes when unknown), compared on the same wall clock.
export function isPast(startStamp, now, mins = 30) {
  if (!startStamp || !now) return false
  const end = new Date(Date.parse(`${startStamp.slice(0, 16)}:00Z`) + (mins || 30) * 60000).toISOString().slice(0, 16)
  return end <= String(now).slice(0, 16)
}

// How a box looks: { tone, done, mark }. A call that has passed and has a result takes the result's colour and is
// dimmed (done); one that has passed with no result yet keeps its colour and gets the "Mark result" dot (mark).
export function evLook({ base, past, result, needs = past }) {
  if (past && result) return { tone: result, done: true, mark: false }
  return { tone: base, done: false, mark: !!(past && needs) }
}

// The class names a box adds: the two-line layout, its colour (is-<tone>), dimmed once done, and the dot.
export const evClass = look => `ev958 is-${look.tone}${look.done ? ' is-past' : ''}${look.mark ? ' has-mark' : ''}`

// Agent: a lead's result, as the colour of its status (agentView AGENT_STATUSES: Sold green, No show grey, Follow up
// yellow, Not interested orange; Closed coral). Booked, live and the team's statuses are not results.
export const AGENT_RESULT_TONE = { sold: 'green', no_show: 'mute', follow: 'teal', not_interested: 'warn', closed: 'rose' }
export const leadResultTone = lead => (lead ? AGENT_RESULT_TONE[agentStatusOf(lead)] || null : null)

// VA: a booked call's result as a colour. Done well = green, couldn't reach / couldn't finish = orange, passed on = grey.
const VA_MISSED = ['no_answer', 'not_reached', 'could_not_complete', 'not_delivered', 'missed', 'problem']
export function vaResultTone(item) {
  if (!item) return null
  if (item.kind === 'call' || item.type === 'cancel_old') {
    if (item.status === 'cancelled') return 'green'
    if (item.status === 'no_answer') return 'warn'
    if (item.status === 'passed') return 'mute'
    return null
  }
  if (item.status === 'done') return VA_MISSED.includes(item.row?.outcome || item.outcome) ? 'warn' : 'green'
  if (item.state === 'no_answer') return 'warn'
  return null
}

// Admin Fulfillment: a VA's cancellation call. Cancelled green, no answer orange, passed on grey.
export const ADMIN_RESULT_TONE = { cancelled: 'green', no_answer: 'warn', passed: 'mute' }
