import { useSyncExternalStore } from 'react'
import { MIN_STATES, MAX_STATES, NOT_TAKING } from '../lib/signupDetails.js'

// P949 — "Your states" on agent Billing: the one campaign setting an agent changes themselves (hours stay in Settings).
// Add, remove or swap states, staying within 3 to 10, never New York, with the licence tick for any state that's new.
// A change starts with the next day's leads. Each agent has one campaign and the campaign sync can't change its
// states yet, so each change is an admin to-do: "Update ad states for Dana Walker: +FL, −GA" (admin todos.js).
// Sample: this small store, kept in the browser so the agent's change shows on the admin Overview after a reload.

export { MIN_STATES, MAX_STATES, NOT_TAKING }

const uniq = xs => [...new Set((xs || []).map(s => String(s).toUpperCase()))].sort()

// What changed between the states the ads run in now and the picked ones.
export function stateDiff(from = [], to = []) {
  const a = uniq(from), b = uniq(to)
  return { added: b.filter(s => !a.includes(s)), removed: a.filter(s => !b.includes(s)) }
}

// "+FL, −GA" (a real minus sign).
export const diffWords = ({ added = [], removed = [] }) => [...added.map(s => `+${s}`), ...removed.map(s => `−${s}`)].join(', ')

// Pick or unpick one state, inside the limits (New York can't be picked; an 11th state can't be added).
export function flipState(states, code) {
  const c = String(code).toUpperCase()
  if (NOT_TAKING.includes(c)) return uniq(states)
  if (states.includes(c)) return uniq(states.filter(s => s !== c))
  return states.length >= MAX_STATES ? uniq(states) : uniq([...states, c])
}

// Why the picked set can't be saved (null = it can). `ticked` = the licence tick for the added states.
export function statesBlock(from, to, ticked) {
  const n = uniq(to).length
  const { added, removed } = stateDiff(from, to)
  if (!added.length && !removed.length) return 'Nothing changed yet'
  if (uniq(to).some(s => NOT_TAKING.includes(s))) return 'We aren’t taking New York yet'
  if (n < MIN_STATES) return `Keep at least ${MIN_STATES} states (you have ${n})`
  if (n > MAX_STATES) return `At most ${MAX_STATES} states`
  if (added.length && !ticked) return 'Tick the box: licensed in every state you added'
  return null
}

// The day a change made on `todayIso` starts: the next day's ads.
export function startsOn(todayIso) {
  const d = new Date(`${todayIso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
export const dayWords = iso => { const d = new Date(`${iso}T12:00:00Z`); return `${DAYS[d.getUTCDay()]}, ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}` }

// One change: who, what, when it was asked and when it starts. done = the admin updated the campaign.
export function makeChange({ agentId, agentName, from, to, todayIso, at }) {
  const { added, removed } = stateDiff(from, to)
  return { id: `stc-${agentId}-${Date.now()}`, agentId, agentName, added, removed, states: uniq(to), at, starts: startsOn(todayIso), done: null }
}

// The admin to-do rows for changes still waiting on the campaign (todos.js shape).
export const openChanges = (list = []) => list.filter(c => !c.done)

// ── the sample store ─────────────────────────────────────────────────────────────────────────────────────────────
const KEY = 'ohvara-state-changes:v1'
const SEED = [
  // Dana's history before today: one swap in October (already on the ads).
  { id: 'stc-seed-1', agentId: 'ag-dana', agentName: 'Dana Walker', added: ['AZ'], removed: ['OK'], states: ['AZ', 'FL', 'GA', 'TX'], at: 'Oct 12, 9:14 AM', starts: '2026-10-13', done: 'Oct 12, 2:30 PM' },
]
let changes = (() => { try { return JSON.parse(globalThis.localStorage?.getItem(KEY) || 'null') || SEED } catch { return SEED } })()
const subs = new Set()
const put = next => {
  changes = next
  try { globalThis.localStorage?.setItem(KEY, JSON.stringify(next)) } catch { /* private window: this page only */ }
  subs.forEach(f => f())
}
export const addStateChange = c => put([c, ...changes])
export const doneStateChange = (id, at) => put(changes.map(c => (c.id === id ? { ...c, done: at } : c)))
export const stateChanges = () => changes
export const resetStateChanges = () => put(SEED)
const subscribe = f => { subs.add(f); return () => subs.delete(f) }
export const useStateChanges = () => useSyncExternalStore(subscribe, () => changes, () => changes)
