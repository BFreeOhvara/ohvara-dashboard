import { useCallback, useSyncExternalStore } from 'react'
import { markSeen, emptySeen } from './videoModel.js'
import { SEED_WATCHED } from './store.js'

// P877 — how much of each training video a VA has seen, and where they stopped. Sample only (this browser), kept apart
// from the check results in ./store.js; P852 moves it to the database with the rest of training progress.
const KEY = 'ful-training-video:v1'
function load() {
  try { const raw = JSON.parse(localStorage.getItem(KEY) || 'null'); if (raw && typeof raw === 'object') return raw } catch { /* start fresh */ }
  return {}
}
let state = load()
const subs = new Set()
function set(next) {
  state = next
  try { localStorage.setItem(KEY, JSON.stringify(state)) } catch { /* private window: it lasts this visit */ }
  subs.forEach(f => f())
}
const subscribe = f => { subs.add(f); return () => subs.delete(f) }
const snap = () => state
const key = (name, id) => `${name}|${id}`
const seeded = (name, id, duration) => (SEED_WATCHED[name]?.includes(id) ? { ...emptySeen(duration), pct: 1, watched: true } : null)

export function useVideoProgress(name, id, duration) {
  const s = useSyncExternalStore(subscribe, snap)
  const v = s[key(name, id)] || seeded(name, id, duration) || emptySeen(duration)
  const seen = useCallback((from, to) => {
    const k = key(name, id)
    const cur = state[k]
    const next = markSeen(cur, from, to, duration)
    if (cur && next.seen.length === cur.seen.length && Math.abs((cur.pos || 0) - to) < 2) return
    set({ ...state, [k]: { ...next, pos: to } })
  }, [name, id, duration])
  const savePos = useCallback(pos => {
    const k = key(name, id)
    const cur = state[k] || emptySeen(duration)
    if (Math.abs((cur.pos || 0) - pos) >= 1) set({ ...state, [k]: { ...cur, pos } })
  }, [name, id, duration])
  return { ...v, seen, savePos }
}

// For lists (lesson rows, admin): has this person watched this lesson's video?
export function useWatchedMap(name) {
  const s = useSyncExternalStore(subscribe, snap)
  const out = {}
  for (const id of SEED_WATCHED[name] || []) out[id] = seeded(name, id, 0)
  for (const [k, v] of Object.entries(s)) { const [n, id] = k.split('|'); if (n === name) out[id] = v }
  return out
}
