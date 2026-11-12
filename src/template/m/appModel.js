// P967 — the agent phone app's rules, no React (so node --test can read them). The app is five tabs side by side
// (Home · Leads · Calendar · Messages · Account) you swipe between, with sub-screens that slide in from the right and
// Notifications from the left. The addresses are the portal's own (paths.js), so a link works on the phone, the
// desktop and in the native app; the small sub-screens with no page of their own ride in ?s= so Back closes them.
import { agentStatusOf, needsResult, isLiveCall } from '../agentView.js'
import { layoutOf } from '../paths.js'
import { shortDate } from '../../lib/clientCheck.js'
import { navFor } from '../../lib/products.js'

export const TABS = ['home', 'leads', 'calendar', 'messages', 'account']
// Sub-screens with their own buttons at the bottom: the tab bar slides away on these.
export const OWN_BAR = ['lead', 'thread', 'submit', 'import', 'search']
// The small sub-screens that live in ?s= (no page of their own).
export const QUERY_SUBS = ['search', 'needs', 'today', 'import', 'thread', 'notif', 'help']

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
  if (s && QUERY_SUBS.includes(s)) return { ...out, tab: out.tab, over: out.sub, overId: out.id, sub: s, id: s === 'thread' ? q.get('t') : out.id }
  return { ...out, over: null, overId: null }
}

// The tab under a sub-screen: the one it was opened from (history state), else its home tab.
const HOME_TAB = { lead: 'leads', import: 'leads', thread: 'messages', search: 'home', needs: 'home', today: 'home', notif: 'home', help: 'account' }
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

// ── P972: the layer stack, swipe back, sheets, notifications, chat runs ───────────────────────────────────────
// A screen one level in (a setting, the full Billing or Submit page, one client) and a ?s= screen over a page
// sub-screen have a parent: it sits under the top layer (the peek while swiping back) and Back lands on it.
const NESTED = { settings: 'set', billing: 'full', submit: 'full' }
export function nestedOf(route, search = '') {
  const k = NESTED[route.sub]
  const v = k ? new URLSearchParams(search).get(k) : null
  return k === 'full' ? (v === '1' ? 'full' : '') : v || ''
}
export function parentOf(route, search = '') {
  if (route.over) return { sub: route.over, id: route.overId || null, nested: '' }
  if (route.sub === 'clients' && route.id) return { sub: 'clients', id: null, nested: '' }
  if (nestedOf(route, search)) return { sub: route.sub, id: null, nested: '' }
  return null
}
// One key per screen, the same whether it's on top or under, so the parent keeps its scroll when it comes back up.
export const screenKey = (sub, id, nested = '') => `${sub}:${id || ''}:${nested || ''}`

// Where a released swipe-back lands: a flick the way it came from (≥ 0.35 px/ms) or a drag past 35 % closes it,
// anything less springs back. d and v are signed in the closing direction (positive = closing).
export const backCloses = (d, v, width) => (v >= 0.35 && d >= 12) || d >= width * 0.35
// A bottom sheet pulled down: a flick down (≥ 0.5 px/ms) or past a quarter of its height (at most 140 px) closes it.
export const sheetCloses = (dy, v, height) => (v >= 0.5 && dy >= 10) || dy >= Math.min(140, height * 0.25)

// Notifications and Activity: what kind of thing happened (its icon and colour) and which day group it falls in.
export const NOTE_KIND = {
  booking: { tone: 'sky', label: 'New booking' },
  live: { tone: 'apricot', label: 'Live call' },
  packet: { tone: 'butter', label: 'Packet in' },
  payment: { tone: 'coral', label: 'Payment' },
  risk: { tone: 'coral', label: 'Client at risk' },
  message: { tone: 'stone', label: 'Team message' },
  protected: { tone: 'sage', label: 'Protected' },
  moved: { tone: 'butter', label: 'Moved' },
  sold: { tone: 'sage', label: 'Sold' },
  todo: { tone: 'apricot', label: 'To do' },
  cancel: { tone: 'stone', label: 'Old policy cancelled' },
  drafted: { tone: 'sage', label: 'Drafted' },
  save: { tone: 'butter', label: 'Save' },
}
// An activity row's kind, from what it says (the log has a coarse kind: lead, client, moved, call, text).
export function kindOfActivity(a) {
  const t = String(a?.text || '')
  if (/chargeback|lapsed|didn.t go through|at risk|save call/i.test(t)) return 'risk'
  if (/packet/i.test(t)) return 'packet'
  if (/live call|transfer/i.test(t)) return 'live'
  if (/charged|payment|card|receipt/i.test(t)) return 'payment'
  if (/(^|[^a-z])sold(?![a-z])/i.test(t) && !/not sold/i.test(t)) return 'sold'
  if (/protected/i.test(t)) return 'protected'
  if (/booked|appointment|new lead/i.test(t)) return 'booking'
  if (a?.kind === 'text') return 'message'
  if (a?.kind === 'call') return 'live'
  if (a?.kind === 'client') return 'protected'
  return 'moved'
}
// "Today, 9:40 AM" → today, "Yesterday, 11:02 AM" → yesterday, anything else → earlier; plus the time on its own.
export function dayOf(at) {
  const s = String(at || '')
  const time = (/(\d{1,2}:\d{2}\s*(?:AM|PM))\s*$/i.exec(s) || [])[1] || ''
  if (/^today(?![a-z])/i.test(s)) return { group: 'today', time, day: 'Today' }
  if (/^yesterday(?![a-z])/i.test(s)) return { group: 'yesterday', time, day: 'Yesterday' }
  const day = s.replace(/,?\s*\d{1,2}:\d{2}\s*(?:AM|PM)\s*$/i, '').trim()
  return { group: 'earlier', time, day: day || 'Earlier' }
}
export const GROUPS = [['today', 'Today'], ['yesterday', 'Yesterday'], ['earlier', 'Earlier']]
// Splits items into Today / Yesterday / Earlier (in that order, empty groups dropped), keeping their order inside.
export const groupByDay = items => GROUPS.map(([k, label]) => ({ key: k, label, items: items.filter(i => i.group === k) })).filter(g => g.items.length)

// Chat: consecutive messages from the same sender are one run. The name shows over the first bubble of a team
// run; the tail and the time only on the last.
export function runsOf(msgs, whoOf) {
  return msgs.map((m, i) => {
    const key = x => (x.from === 'me' ? 'me' : `t:${whoOf(x)}`)
    const prev = msgs[i - 1]
    const next = msgs[i + 1]
    return { first: !prev || key(prev) !== key(m), last: !next || key(next) !== key(m) }
  })
}
// The policy number's last four ("•• 1001"), never the whole number.
export const last4 = n => { const d = String(n || '').replace(/[^0-9A-Za-z]/g, ''); return d ? `•• ${d.slice(-4)}` : '' }

// ── P974: servicing-only agents, Clients built out ────────────────────────────────────────────────────────────
// The bottom bar for what they bought (lib/products.js navFor, live: adding a product flips it). Any lead product
// (Leads or Your own leads) keeps Leads second, with Clients in Account. Servicing only: Clients takes Leads' place
// and Leads moves into Account's list.
export const tabsFromNav = nav => TABS.map(t => (t === 'leads' ? (nav.has('leads') ? 'leads' : nav.has('clients') ? 'clients' : null) : t)).filter(Boolean)
export const tabsFor = (picked, opts) => tabsFromNav(navFor(picked, opts))
export const clientsInBar = tabs => tabs.includes('clients')

// With Clients in the bar, /clients is that tab (not a sub-screen) and Leads (/leads) opens as a sub-screen from
// Account. Everything else is routeOf as is.
export function routeForTabs(route, tabs) {
  if (clientsInBar(tabs)) {
    if (route.sub === 'clients' && !route.id) return { ...route, tab: 'clients', sub: null, id: null }
    if (route.over === 'clients' && !route.overId) return { ...route, tab: 'clients', over: null, overId: null }
  }
  if (route.tab === 'leads' && !tabs.includes('leads')) return { ...route, tab: null, sub: 'leads', id: null }
  return route
}

export const CLIENT_TONE = { needs_attention: 'apricot', working: 'sky', protected: 'sage', closed: 'stone' }
export const CLIENT_GROUPS = [['needs_attention', 'Needs attention'], ['working', 'Working'], ['protected', 'Protected']]
const clientName = c => `${c.client_first_name || ''} ${c.client_last_name || ''}`.trim()
const digits = v => String(v || '').replace(/\D/g, '').slice(-10)
export const clientMatches = (c, q) => {
  const n = String(q || '').trim().toLowerCase()
  if (!n) return true
  const d = n.replace(/\D/g, '')
  return `${clientName(c)} ${c.carrier_name || ''} ${c.product_name || ''}`.toLowerCase().includes(n) || (d.length >= 3 && digits(c.client_phone).includes(d))
}
// The grouped list: Needs attention, then Working, then Protected (Closed only when asked), each in book order.
// f = 'all' or one status (the summary tiles); q = the search.
export function groupClients(clients, statusOf, { f = 'all', q = '', closed = false } = {}) {
  const groups = [...CLIENT_GROUPS, ...(closed || f === 'closed' ? [['closed', 'Closed']] : [])]
  return groups
    .filter(([k]) => f === 'all' || f === k)
    .map(([key, label]) => ({ key, label, tone: CLIENT_TONE[key], items: clients.filter(c => statusOf(c) === key && clientMatches(c, q)) }))
    .filter(g => g.items.length)
}

// What's happening with a client, in one plain line (the list row and the client screen).
export function clientNow(c, st, stages, next) {
  if (st === 'closed') return c.track?.closed || 'Closed. Nothing more to do.'
  if (st === 'needs_attention') return 'Waiting on you: is it still on the books?'
  if (c.next_step) return c.next_step
  if (stages?.current) return `${stages.current.label}${stages.current.next ? ` · ${stages.current.next}` : ''}`
  if (next?.askOn) return `Nothing needed. Next check ${shortDate(next.askOn)}`
  return c.note || 'Nothing needed right now.'
}
// The hero's "since when": the draft a check is about, when the current work started, or when it was last settled.
export function clientSince(c, st, stages, due) {
  const done = (stages?.steps || []).filter(x => x.state === 'done' && x.at)
  if (st === 'needs_attention' && due?.draft) return `since the ${shortDate(due.draft)} draft`
  if (st === 'closed') return ''
  if (st === 'working') { const at = c.fixing?.since ? shortDate(c.fixing.since) : done[0]?.at || c.submitted; return at ? `since ${at}` : '' }
  const at = done.length ? done[done.length - 1].at : c.submitted
  return at ? `since ${at}` : ''
}
// The client screen's timeline, newest first: what the log says about them, then the steps done (sold, hand-off,
// approved, old policy cancelled, payments, saves), the draft last confirmed, a missed payment, and where it began.
const STEP_KIND = { sold: 'sold', handoff: 'booking', approved: 'protected', old_cancel: 'cancel', first_payment: 'payment', found: 'risk', booked: 'booking', reached: 'live', fixed: 'save', cleared: 'payment', requested: 'moved', carrier: 'moved', confirmed: 'protected', added: 'sold', welcome: 'booking' }
export function clientTimeline(c, act = [], stages) {
  if (!c) return []
  const name = clientName(c).toLowerCase()
  const logged = act.filter(a => String(a.who || '').toLowerCase() === name).map(a => ({ id: a.id, kind: kindOfActivity(a), text: a.text, at: a.at }))
  const done = (stages?.steps || []).filter(x => x.state === 'done').reverse().map(x => ({ id: `st-${x.key}`, kind: STEP_KIND[x.key] || 'moved', text: x.label, at: x.at || '' }))
  const extra = []
  if (c.missed?.on || c.missed?.draft) extra.push({ id: 'missed', kind: 'risk', text: c.missed.done ? 'Missed payment, saved' : 'Payment missed', at: c.missed.on || c.missed.draft || '' })
  if (c.checked_through) extra.push({ id: 'drafted', kind: 'drafted', text: 'Draft confirmed on the books', at: /^\d{4}-\d{2}-\d{2}/.test(c.checked_through) ? shortDate(c.checked_through) : c.checked_through })
  const began = done.some(x => x.id === 'st-sold' || x.id === 'st-added') ? [] : [{ id: 'start', kind: 'sold', text: c.added ? 'Added to your book' : 'Sold and submitted', at: c.submitted || '' }]
  return [...logged, ...extra, ...done, ...began]
}
// The lead a client came from: its id when the row has one, else the sold lead with the same phone, else the name.
export function leadOfClient(c, leads = []) {
  if (!c) return null
  const id = c.lead_id || c.leadId
  if (id) return leads.find(l => l.id === id) || null
  const d = digits(c.client_phone)
  const byPhone = d.length === 10 ? leads.find(l => digits(l.rawPhone || l.phone) === d) : null
  if (byPhone) return byPhone
  const n = clientName(c).toLowerCase()
  return leads.find(l => `${l.first_name || ''} ${l.last_name || ''}`.trim().toLowerCase() === n) || null
}
// With Clients in the bar a client's screen sits straight on the Clients tab (no Clients sub-screen under it), and a
// client opened from anywhere without a tab to go back to belongs to the Clients tab.
export function parentFor(route, search, tabs) {
  const p = route.sub ? parentOf(route, search) : null
  return p && clientsInBar(tabs) && p.sub === 'clients' && !p.id ? null : p
}
export function baseTabFor(route, fromTab, tabs) {
  if (clientsInBar(tabs) && !route.tab && route.sub === 'clients' && !tabs.includes(fromTab)) return 'clients'
  const t = baseTab(route, fromTab)
  return tabs.includes(t) ? t : tabs.includes(fromTab) ? fromTab : clientsInBar(tabs) && t === 'leads' ? 'account' : 'home'
}
