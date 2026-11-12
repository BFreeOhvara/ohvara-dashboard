// P967 — the agent phone app's rules, no React (so node --test can read them). The app is five tabs side by side
// (Home · Leads · Calendar · Messages · Account) you swipe between, with sub-screens that slide in from the right and
// Notifications from the left. The addresses are the portal's own (paths.js), so a link works on the phone, the
// desktop and in the native app; the small sub-screens with no page of their own ride in ?s= so Back closes them.
import { agentStatusOf, needsResult, isLiveCall } from '../agentView.js'
import { layoutOf } from '../paths.js'

export const TABS = ['home', 'leads', 'calendar', 'messages', 'account']
// Sub-screens with their own buttons at the bottom: the tab bar slides away on these.
export const OWN_BAR = ['lead', 'thread', 'submit', 'import']
// The small sub-screens that live in ?s= (no page of their own).
export const QUERY_SUBS = ['search', 'needs', 'today', 'import', 'thread', 'notif']

const TAB_OF = { overview: 'home', leads: 'leads', calendar: 'calendar', messages: 'messages', more: 'account' }
const PAGE_SUBS = ['billing', 'activity', 'settings', 'submit']

// Where a phone address puts you: a tab, or a sub-screen (with its id) over a tab. The page comes from paths.js
// layoutOf (both the real and the template addresses); one lead or one client carries its id last.
export function routeOf(pathname, search = '') {
  const layout = layoutOf(pathname)
  const segs = String(pathname || '').split(/\//).filter(Boolean)
  const id = segs.length >= (segs[0] === 'agent' ? 3 : 2) ? decodeURIComponent(segs[segs.length - 1]) : null
  const q = new URLSearchParams(search)
  const s = q.get('s')
  let out = { tab: 'home', sub: null, id: null }
  if (layout === 'leads') out = id ? { tab: null, sub: 'lead', id } : { tab: 'leads', sub: null, id: null }
  else if (layout === 'clients') out = { tab: null, sub: 'clients', id }
  else if (layout === 'request-service') out = { tab: null, sub: 'clients', id: null }
  else if (TAB_OF[layout]) out = { tab: TAB_OF[layout], sub: null, id: null }
  else if (PAGE_SUBS.includes(layout)) out = { tab: null, sub: layout, id: null }
  // A ?s= sub-screen sits over whatever the address shows (a tab, or a page sub-screen like Clients).
  if (s && QUERY_SUBS.includes(s)) return { ...out, tab: out.tab, over: out.sub, sub: s, id: s === 'thread' ? q.get('t') : out.id }
  return { ...out, over: null }
}

// The tab under a sub-screen: the one it was opened from (history state), else its home tab.
const HOME_TAB = { lead: 'leads', import: 'leads', thread: 'messages', search: 'home', needs: 'home', today: 'home', notif: 'home' }
export const baseTab = (route, fromTab) => route.tab || (TABS.includes(fromTab) ? fromTab : HOME_TAB[route.sub] || 'account')

// The tab the swipe lands on: one over, never past the ends.
export const nextTab = (i, dx, n = TABS.length) => Math.max(0, Math.min(n - 1, i + (dx < 0 ? 1 : -1)))
// A swipe is a swipe: far enough sideways, and clearly more sideways than up or down.
export const isSwipe = (dx, dy, min = 50) => Math.abs(dx) >= min && Math.abs(dx) >= Math.abs(dy) * 1.2

// ── Leads: four stages (P967), each its own colour ──────────────────────────────────────────────────────────────
// To mark: calls that happened and need the agent's result (a live call they took, a booked time that passed).
// Booked: on the calendar. Follow up: the agent's own call back. Sold. Lost (grey, under Sold's Show closed): no
// show and not interested. Leads our team is still calling, and Closed (opted out, couldn't reach), aren't shown.
export const STAGES = [
  { key: 'mark', label: 'To mark', hint: 'Calls that already happened. Tap Mark and tell us how it went.', empty: 'Nothing to mark. You’re all caught up.' },
  { key: 'booked', label: 'Booked', hint: 'On your calendar. We text them reminders before each one.', empty: 'No appointments booked yet. Our team books them as leads come in.' },
  { key: 'follow', label: 'Follow up', hint: 'People to call back. We remind you when it’s time.', empty: 'No follow-ups set.' },
  { key: 'sold', label: 'Sold', hint: 'Sold. Each one goes on to servicing.', empty: 'Sales you mark show here.' },
]
export const TONE = { mark: 'apricot', booked: 'sky', follow: 'butter', sold: 'sage', lost: 'stone' }

export function stageOf(l, now) {
  const st = agentStatusOf(l)
  if (l.stage === 'ringing' || isLiveCall(l) || (st === 'booked' && needsResult(l, now))) return 'mark'
  if (st === 'booked') return 'booked'
  if (st === 'follow') return 'follow'
  if (st === 'sold') return 'sold'
  if (st === 'no_show' || st === 'not_interested') return 'lost'
  return null
}
// The leads one stage shows (Sold adds the grey closed ones when Show closed is on).
export const inStage = (stage, key, closed = false) => stage === key || (key === 'sold' && closed && stage === 'lost')
export const TAG = { mark: 'Needs your result', booked: 'Booked', follow: 'Call back', sold: 'Sold', lost: 'Closed' }

// The result sheet: the mockup's words for the results this lead's status allows (agentView resultsFor).
export const RESULT = {
  sold: { label: 'Sold', sub: 'We take it from here and service the policy', sym: '✓', tone: 'sage' },
  not_interested: { label: 'Not sold', sub: 'Closes the lead. Calls and texts stop', sym: '×', tone: 'stone' },
  no_show: { label: 'No show', sub: 'We text them to rebook and our team calls', sym: '!', tone: 'apricot' },
  follow_up: { label: 'Follow up', sub: 'Call them back later. It goes on your calendar', sym: '↻', tone: 'butter' },
  booked: { label: 'Booked', sub: 'Back on your calendar', sym: '↺', tone: 'sky' },
}
export const RESULT_ORDER = ['sold', 'not_interested', 'no_show', 'follow_up', 'booked']

// ── Words ─────────────────────────────────────────────────────────────────────────────────────────────────────
export const greeting = hour => (hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening')
export const initialsOf = name => String(name || '').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase()
export const minutesOf = t => { const m = /(\d+):(\d+)\s*(AM|PM)/i.exec(t || ''); return m ? ((Number(m[1]) % 12) + (m[3].toUpperCase() === 'PM' ? 12 : 0)) * 60 + Number(m[2]) : 0 }
// "in 1 h 16 m", "in 40 m", "now".
export const untilWords = mins => (mins <= 0 ? 'now' : `in ${mins >= 60 ? `${Math.floor(mins / 60)} h ` : ''}${mins % 60} m`)

// ── Calendar: a real month ────────────────────────────────────────────────────────────────────────────────────
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
export const monthName = m => MONTHS[m - 1]
const iso = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
// Six weeks of days, Monday first, around the month: { iso, n, inMonth }.
export function monthGrid(year, month) {
  const first = new Date(Date.UTC(year, month - 1, 1))
  const lead = (first.getUTCDay() + 6) % 7 // days before the 1st, Monday first
  const start = Date.UTC(year, month - 1, 1 - lead)
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start + i * 86400000)
    return { iso: iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()), n: d.getUTCDate(), inMonth: d.getUTCMonth() === month - 1 }
  })
}
// A month that ends with a whole empty week drops it (five rows when that's all it takes).
export const trimGrid = cells => (cells.slice(35).every(c => !c.inMonth) ? cells.slice(0, 35) : cells)
export const shiftMonth = (y, m, by) => { const t = y * 12 + (m - 1) + by; return [Math.floor(t / 12), (t % 12) + 1] }
export const LONG_DAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
export const dayWords = (isoDay, todayIso) => {
  const d = new Date(`${isoDay}T12:00:00Z`)
  const base = `${MONTHS[d.getUTCMonth()].slice(0, 3)} ${d.getUTCDate()}`
  return isoDay === todayIso ? `Today, ${base}` : `${LONG_DAY[d.getUTCDay()]}, ${base}`
}
export const shortDay = (isoDay, todayIso) => {
  if (isoDay === todayIso) return 'Today'
  const t = new Date(`${todayIso}T12:00:00Z`)
  const d = new Date(`${isoDay}T12:00:00Z`)
  if ((d - t) / 86400000 === 1) return 'Tomorrow'
  return `${LONG_DAY[d.getUTCDay()].slice(0, 3)}, ${MONTHS[d.getUTCMonth()].slice(0, 3)} ${d.getUTCDate()}`
}

// ── Notifications: the bell badge clears once the panel is opened ─────────────────────────────────────────────
export const unseenCount = (ids, seen) => ids.filter(id => !seen.includes(id)).length
export const markSeen = (ids, seen) => [...new Set([...seen, ...ids])].slice(-200)

// ── P971: the swipe between tabs, and short values for Account and Settings ────────────────────────────────────
// Where a released swipe lands: a quick flick (≥ 0.3 px/ms, the way the finger moved) switches even when short, a
// slow drag past 35 % of the width switches, anything less springs back. Never past the first or last tab.
export function swipeTarget(i, dx, v, width, n = TABS.length) {
  const dir = dx < 0 ? 1 : -1
  const flick = Math.abs(v) >= 0.3 && Math.sign(v) === Math.sign(dx) && Math.abs(dx) >= 12
  const far = Math.abs(dx) >= width * 0.35
  return flick || far ? Math.max(0, Math.min(n - 1, i + dir)) : i
}
// Past the first or last tab the page only gives a little (rubber band).
export const rubber = (dx, width) => (dx / (1 + Math.abs(dx) / Math.max(1, width * 0.5))) * 0.45
// The finger's speed in px/ms over the last ~100 ms of samples [{ t, x }].
export function velocityOf(samples, window = 100) {
  if (!samples.length) return 0
  const last = samples[samples.length - 1]
  const first = samples.find(s => last.t - s.t <= window) || last
  const dt = last.t - first.t
  return dt > 0 ? (last.x - first.x) / dt : 0
}

// Account's "next charge" tile: one short value and the word for when. "Tonight, 8 PM" → 8 PM (tonight);
// "Tue, Dec 1" → Dec 1 (Tue).
const SOFT = ['tonight', 'today', 'tomorrow']
export function chargeStat(at) {
  const s = String(at || '').replace(/^at\s+/i, '').trim()
  const m = /^(.*?),\s*(.+)$/.exec(s)
  if (!m) return { value: s || '—', when: '' }
  return { value: m[2], when: SOFT.includes(m[1].toLowerCase()) ? m[1].toLowerCase() : m[1] }
}

// Settings' hours row: "Mon to Fri, 9 to 6" (times only when every day shares them).
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const shortTime = t => { const m = /(\d+)(?::(\d+))?\s*(AM|PM)?/i.exec(t || ''); return m ? `${m[1]}${m[2] && m[2] !== '00' ? `:${m[2]}` : ''}` : '' }
export function weekWords(week) {
  const on = DAYS.filter(d => week?.[d]?.on)
  if (!on.length) return 'Not set'
  const idx = on.map(d => DAYS.indexOf(d))
  const run = idx.every((x, i) => i === 0 || x === idx[i - 1] + 1)
  const days = on.length === 1 ? on[0] : run ? `${on[0]} to ${on[on.length - 1]}` : `${on.length} days`
  const starts = new Set(on.map(d => week[d].start))
  const ends = new Set(on.map(d => week[d].end))
  return starts.size === 1 && ends.size === 1 ? `${days}, ${shortTime(on.map(d => week[d].start)[0])} to ${shortTime(on.map(d => week[d].end)[0])}` : days
}
