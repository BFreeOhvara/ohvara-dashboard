// P975 — the fulfillment (VA) phone app's rules, as plain functions (no React), so node --test runs them. The app
// itself is in this folder (VaApp and its screens); it reads the same VA data hooks as the desktop desk
// (src/template/ful/data.js) and starts calls on the same call engine (ful/callLine.js + hooks/useRealLine).
import { FUL, OLD_CALLS, OLD_QUEUE, OLD_SERVICING } from '../../ful/paths.js'
import { outcomesOf } from '../../ful/words.js'
import { findCarrier, isVerified } from '../../../lib/carriers/catalog.js'
import { monthGrid, trimGrid, initialsOf } from '../appModel.js'
import { whenText } from '../../../lib/fulReal.js'
import { emptySupport } from '../../support911.js'

export const VA_TABS = ['today', 'calendar', 'rota', 'messages', 'me']
export const VA_LABEL = { today: 'Today', calendar: 'Calendar', rota: 'Schedule', messages: 'Messages', me: 'Me' }
// Sub-screens opened with ?s= over the current tab (the agent app's way), plus the real VA addresses they stand for.
export const VA_SUBS = ['notif', 'search', 'settings', 'profile', 'pay', 'training', 'help', 'thread', 'client']
// Screens with their own bottom: the tab bar slides away under them.
export const VA_OWN_BAR = ['thread', 'search', 'client']

const noSlash = p => (p.length > 1 ? p.replace(/\/$/, '') : p)
const under = (p, base) => p === base || p.startsWith(`${base}/`)
const rest = (p, base) => (p.startsWith(`${base}/`) ? decodeURIComponent(p.slice(base.length + 1).split(/\//)[0]) : null)

// Where an address lands in the app: { tab, sub, id, brief }. `brief` = a booked call whose brief opens on the
// Calendar (a call's own address, old ones included). The real VA addresses keep working: /settings is Me → Settings,
// /fulfillment/pay is Me → Hours and pay, /fulfillment/pipeline/<id> is a client.
export function vaRouteOf(pathname, search = '') {
  const p = noSlash(String(pathname || ''))
  const q = new URLSearchParams(search || '')
  const r = { tab: 'today', sub: null, id: null, brief: null }
  if (p === FUL.messages || p === `${FUL.overview}${FUL.messages}`) r.tab = 'messages'
  else if (p === FUL.settings || p === `${FUL.overview}${FUL.settings}`) Object.assign(r, { tab: 'me', sub: 'settings' })
  else if (under(p, FUL.calendar)) Object.assign(r, { tab: 'calendar', brief: rest(p, FUL.calendar) })
  else if ([OLD_CALLS, OLD_QUEUE, OLD_SERVICING].some(o => under(p, o))) Object.assign(r, { tab: 'calendar', brief: [OLD_CALLS, OLD_QUEUE, OLD_SERVICING].map(o => rest(p, o)).find(Boolean) || null })
  else if (p.startsWith(`${FUL.schedule}/`)) Object.assign(r, { tab: 'calendar', brief: rest(p, FUL.schedule) })
  else if (p === FUL.schedule) r.tab = 'rota'
  else if (p === FUL.more) r.tab = 'me'
  else if (p === FUL.pay) Object.assign(r, { tab: 'me', sub: 'pay' })
  else if (under(p, FUL.training)) Object.assign(r, { tab: 'me', sub: 'training', id: rest(p, FUL.training) })
  else if (under(p, FUL.clients)) Object.assign(r, rest(p, FUL.clients) ? { sub: 'client', id: rest(p, FUL.clients) } : { sub: 'search' })
  const s = q.get('s')
  if (VA_SUBS.includes(s)) { r.sub = s; r.id = q.get('t') || q.get('c') || q.get('l') || null }
  return r
}

// ── A booked call's state on the day ─────────────────────────────────────────────────────────────────────────────
// A call still open half an hour past its time was left without a result (the desktop rule: a call can't close
// without one). done = green, no answer = butter, needs a result = apricot, to call = blue.
export const GRACE_MS = 30 * 60000
export function stateOf(item, nowMs) {
  if (!item) return 'todo'
  if (item.done) return 'done'
  if (item.state === 'no_answer') return 'noanswer'
  const at = Date.parse(item.iso || '')
  return Number.isFinite(at) && at + GRACE_MS <= nowMs ? 'open' : 'todo'
}
export const STATE_TONE = { done: 'sage', noanswer: 'butter', open: 'apricot', todo: 'sky' }
export const STATE_TAG = { done: 'Done', noanswer: 'No answer', open: 'Needs a result', todo: 'To call' }
export const needsResult = (items, nowMs) => items.filter(i => stateOf(i, nowMs) === 'open')
// What a call is for, in a few words, and who it's for: "Cancel old policy · for Dana Walker".
export const forLine = (what, agent) => [what, agent ? `for ${agent}` : null].filter(Boolean).join(' · ')

// ── Calendar ─────────────────────────────────────────────────────────────────────────────────────────────────────
// The month's boxes: a call-count pill, today ringed, past faded, days off and weekends marked.
export function monthCells(year, month, { byDate = {}, todayIso = '', offDates = [] } = {}) {
  return trimGrid(monthGrid(year, month)).map(c => {
    const dow = new Date(`${c.iso}T12:00:00Z`).getUTCDay()
    return { ...c, count: c.inMonth ? (byDate[c.iso] || []).length : 0, today: c.iso === todayIso, past: c.iso < todayIso, off: offDates.includes(c.iso), weekend: dow === 0 || dow === 6 }
  })
}

// A day hour by hour, 8 AM to 6 PM (the shift), each call in its hour; the red Now line in the current hour today.
export const HOURS = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18]
export const hourLabel = h => (h === 12 ? '12 PM' : h > 12 ? `${h - 12} PM` : `${h} AM`)
export function hourRows(list, { today = false, nowMin = 0, minOf = () => 0 } = {}) {
  return HOURS.map((h, i) => ({
    h, label: hourLabel(h),
    now: today && nowMin >= h * 60 && (nowMin < (h + 1) * 60 || i === HOURS.length - 1) && nowMin < 19 * 60,
    calls: list.filter(c => { const hh = Math.floor(minOf(c) / 60); return Math.min(18, Math.max(8, hh)) === h }),
  }))
}

// ── Rota ─────────────────────────────────────────────────────────────────────────────────────────────────────────
const addDays = (iso, n) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const DOW3 = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
// A week as seven day cards: the rota's weekdays (who's on, you first), then Saturday and Sunday (no shifts).
export function weekCards(days = [], todayIso = '') {
  if (!days.length) return []
  const cards = days.map(d => {
    const me = d.vas.find(v => v.me)
    const people = [...d.vas.filter(v => v.me && !v.off), ...d.vas.filter(v => !v.me)]
    return { date: d.date, dow: DOW3[new Date(`${d.date}T12:00:00Z`).getUTCDay()], num: Number(String(d.date).slice(8)), today: d.date === todayIso, past: d.date < todayIso, weekend: false, people, youOff: !me || !!me.off, offAsked: !!me?.off }
  })
  const fri = days[days.length - 1].date
  for (const n of [1, 2]) {
    const date = addDays(fri, n)
    cards.push({ date, dow: DOW3[new Date(`${date}T12:00:00Z`).getUTCDay()], num: Number(date.slice(8)), today: date === todayIso, past: date < todayIso, weekend: true, people: [], youOff: false, offAsked: false })
  }
  return cards
}

// ── The result of a call ─────────────────────────────────────────────────────────────────────────────────────────
// The five picks on the result sheet (the mockup), and what each one saves on each kind of booked call, with the
// desktop's own actions (useFulActions): a cancel-the-old-policy call (markCall), a booked servicing call
// (finishTask / moveTask / sendToAgent), or a caller who rang in with no booking (a callback).
export const OUTCOMES = [
  { key: 'done', label: 'Done', sub: 'Did what the call was for', sym: '✓', tone: 'sage' },
  { key: 'saved', label: 'Saved the policy', sub: 'They were leaving and stayed', sym: '♥', tone: 'sage' },
  { key: 'no_answer', label: 'No answer', sub: 'We text them and book a new time', sym: '…', tone: 'butter' },
  { key: 'rebook', label: 'Book a new time', sub: 'They asked to talk later', sym: '↻', tone: 'sky' },
  { key: 'agent', label: 'Agent needs to step in', sub: 'Sends the agent a message', sym: '!', tone: 'apricot' },
]
const DONE_KEY = { lapse_save: 'saved', packet_check: 'delivered', welcome_call: 'welcomed', handoff_call: 'welcomed', cancel_request: 'saved', chargeback_watch: 'on_time' }
const keysOf = kind => outcomesOf(kind).map(o => o[0])
export function doneKey(kind) {
  const keys = keysOf(kind)
  return DONE_KEY[kind] && keys.includes(DONE_KEY[kind]) ? DONE_KEY[kind] : keys.includes('completed') ? 'completed' : keys[0]
}
export function noAnswerKey(kind) {
  const keys = keysOf(kind)
  return keys.includes('no_answer') ? 'no_answer' : keys.includes('not_reached') ? 'not_reached' : keys.includes('could_not_complete') ? 'could_not_complete' : keys.at(-1)
}

// The next business day at the same clock time (Book a new time, and a No answer's retry the system books).
export function nextTry(iso, tz = 'America/Chicago') {
  let ms = Date.parse(iso || '')
  if (!Number.isFinite(ms)) return null
  const dow = t => new Date(t).toLocaleDateString('en-US', { weekday: 'short', timeZone: tz })
  do ms += 86400000; while (['Sat', 'Sun'].includes(dow(ms)))
  return new Date(ms).toISOString()
}

// What a pick saves: [action name, ...args] for useFulActions, plus the toast's word. `item` is a Schedule item
// (P907's row: { kind: 'call' | 'task', ref, iso, row }), or null for a caller with no booking.
export function outcomePlan(item, pick, { tz = 'America/Chicago', notes = '' } = {}) {
  const word = OUTCOMES.find(o => o.key === pick)?.label || pick
  if (!item) {
    if (pick === 'no_answer') return { word, run: [['bookCallback', { why: 'missed_call', note: notes || 'Line dropped before we spoke.' }]] }
    if (pick === 'rebook') return { word, run: [['bookCallback', { why: 'asked', note: notes || 'Asked us to call back later.' }]] }
    if (pick === 'agent') return { word, run: [['tellAgent', notes]] }
    return { word, run: [] }
  }
  const id = item.ref || item.id
  if (item.kind === 'call') {
    if (pick === 'done' || pick === 'saved') return { word, run: [['markCall', id, 'cancelled', notes ? { notes } : {}]] }
    if (pick === 'no_answer') return { word, run: [['markCall', id, 'no_answer', { notes: notes || 'No answer.' }]] }
    if (pick === 'rebook') return { word, run: [['moveCall', id, nextTry(item.iso, tz)]] }
    return { word, run: [...(notes ? [['saveCallNotes', id, notes]] : []), ['tellAgent', notes]] }
  }
  const kind = item.row?.kind || item.type
  const keys = keysOf(kind)
  if (pick === 'done') return { word, run: [['finishTask', id, doneKey(kind)]] }
  if (pick === 'saved') return { word, run: [['finishTask', id, keys.includes('saved') ? 'saved' : doneKey(kind)]] }
  if (pick === 'no_answer') return { word, run: [['finishTask', id, noAnswerKey(kind)]] }
  if (pick === 'rebook') return { word, run: [['moveTask', id, nextTry(item.iso, tz)]] }
  return { word, run: keys.includes('problem') ? [['finishTask', id, 'problem']] : [['sendToAgent', id, notes || 'Agent needs to step in']] }
}

// ── The call brief ───────────────────────────────────────────────────────────────────────────────────────────────
const ABBR = { 'America/New_York': 'ET', 'America/Chicago': 'CT', 'America/Denver': 'MT', 'America/Phoenix': 'MT', 'America/Los_Angeles': 'PT' }
const clockOfHM = hhmm => { const [h, m] = String(hhmm).split(':').map(Number); return `${((h + 11) % 12) + 1}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h < 12 ? 'AM' : 'PM'}` }
// The carrier's service line today: "8:30 AM to 4:30 PM CT" (the carrier directory's checked hours).
export function carrierLine(name, dayIso = null) {
  const c = name ? findCarrier(name) : null
  if (!c) return name ? 'Hours not listed' : 'Not given'
  if (!isVerified(c)) return 'Hours not checked yet'
  const dk = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][dayIso ? new Date(`${dayIso}T12:00:00Z`).getUTCDay() : 1]
  const h = c.hours[dk] || c.hours.mon
  if (!h) return 'Closed today'
  return `${clockOfHM(h.open)} to ${clockOfHM(h.close)} ${ABBR[c.hours_tz] || ''}`.trim()
}
export const carrierPhone = name => findCarrier(name || '')?.service_phone || null
export const carrierId = name => findCarrier(name || '')?.id || null
const ORD = n => { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return `${n}${s[(v - 20) % 10] || s[v] || s[0]}` }
export const draftWords = d => (Number(d) > 0 ? `the ${ORD(Number(d))}` : 'Not given')

// ── Today ────────────────────────────────────────────────────────────────────────────────────────────────────────
export const greetingOf = min => (min < 12 * 60 ? 'Good morning' : min < 17 * 60 ? 'Good afternoon' : 'Good evening')
export const firstName = name => String(name || '').trim().split(/\s+/)[0] || ''
// Time on shift so far: "5h 40m" (8 AM to now, capped at 6 PM).
export function onShiftWords(nowMin, start = 8 * 60, end = 18 * 60) {
  const m = Math.max(0, Math.min(nowMin, end) - start)
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`
}
const mmss = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
export const holdTitle = (n, longestSec) => `${n} ${n === 1 ? 'client' : 'clients'} on hold${longestSec ? ` · longest ${mmss(longestSec)}` : ''}`
export const withYou = (mates = [], offNames = []) => {
  const on = mates.map(m => firstName(m.name))
  const a = on.length === 0 ? 'Just you today' : `With you today: ${on.length === 1 ? on[0] : `${on.slice(0, -1).join(', ')} and ${on.at(-1)}`}`
  return offNames.length ? `${a} · ${offNames.map(firstName).join(' and ')} ${offNames.length === 1 ? 'is' : 'are'} off` : a
}
export const callTimer = ms => mmss(Math.max(0, Math.floor(ms / 1000)))
export { initialsOf }

// ── Messages (P977) ──────────────────────────────────────────────────────────────────────────────────────────────
export const dmThreadId = key => `dm-${key}`
// Real: standing threads → the VA's support line and one DM per VA.
export function toVaStanding(rows = [], meId, nowMs, tz) {
  const last = r => (r.last_body ? { from: r.last_sender_id === meId ? 'me' : 'them', text: r.last_body, at: whenText(r.last_at, nowMs, tz) } : null)
  let support = null
  const vas = []
  for (const r of rows || []) {
    if (!r.peer_id && r.agent_id === meId) support = { ...emptySupport(), dm: { agentId: r.agent_id, peerKey: 'admin' }, unread: r.unread_count || 0, last: last(r), last_at: r.last_at }
    else if (r.peer_id && r.agent_role === 'fulfillment' && (r.agent_id === meId || r.peer_id === meId)) {
      const other = r.agent_id === meId ? { id: r.peer_id, name: r.peer_name } : { id: r.agent_id, name: r.agent_name }
      vas.push({ id: dmThreadId(other.id), va: true, name: other.name || 'VA', dm: { agentId: r.agent_id, peerKey: r.peer_key }, unread: r.unread_count || 0, last: last(r), last_at: r.last_at })
    }
  }
  return { support, vas }
}
