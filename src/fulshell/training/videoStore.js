import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { markSeen, emptySeen, finishSeen, mergeSeen, fromRow, toRow } from './videoModel.js'
import VIDEOS from './videos.json' with { type: 'json' }
import { SEED_WATCHED } from './store.js'

// P877 — how much of each training video a VA has seen, and where they stopped, kept apart from the check results in
// ./store.js. P985: for a signed-in person (the real portal and phone app, `live`) it is also saved on the server
// (va_training_video, migration 272, through save_training_video), so closing the app, signing out or moving from desk
// to phone picks up in the same place. This browser's copy is the cache; the template preview stays in this browser.
// No table yet (migration not applied) or offline = this browser only, never an error.
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
// P984: the phone version keeps its own place and seen parts (name|id|phone); a lesson watched on either counts once.
const key = (name, id, variant) => (variant === 'phone' ? `${name}|${id}|phone` : `${name}|${id}`)
const other = (name, id, variant) => key(name, id, variant === 'phone' ? null : 'phone')
const seeded = (name, id, duration) => (SEED_WATCHED[name]?.includes(id) ? { ...emptySeen(duration), pct: 1, watched: true } : null)

// ── server copy (P985) ───────────────────────────────────────────────────────────────────────────────────────────
let off = false // the table/function isn't there: stop asking
let api = null
const db = () => (api ||= import('../../lib/supabase.js').then(m => m.supabase).catch(() => null))
const durOf = (id, variant) => { const d = VIDEOS.lessons?.[id]; return (variant === 'phone' && d?.phone ? d.phone.duration : d?.duration) || 1 }
const timers = new Map()
async function send(k, id, variant) {
  timers.delete(k)
  const cur = state[k]
  if (off || !cur) return
  const sb = await db()
  if (!sb) return
  const { error } = await sb.rpc('save_training_video', toRow(id, variant, cur, cur.duration || durOf(id, variant)))
  if (error && /does not exist|not find|PGRST202|42883|42P01/i.test(`${error.code} ${error.message}`)) off = true
}
// Save soon (while playing) or now (pause, end, leaving the page).
function push(k, id, variant, now = false) {
  if (off) return
  clearTimeout(timers.get(k))
  timers.set(k, setTimeout(() => send(k, id, variant), now ? 0 : 4000))
}
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => { for (const k of [...timers.keys()]) { clearTimeout(timers.get(k)); const [, id, v] = k.split('|'); send(k, id, v || null) } })
}
const pulled = new Map() // name -> promise
// Bring this person's saved spots from the server into this browser's copy (once per visit, per name).
export function pullVideo(name) {
  if (off || !name) return Promise.resolve()
  if (pulled.has(name)) return pulled.get(name)
  const p = (async () => {
    const sb = await db()
    if (!sb) return
    const uid = (await sb.auth.getSession())?.data?.session?.user?.id
    if (!uid) return
    const { data, error } = await sb.from('va_training_video').select('lesson_id, variant, pos, furthest, seen, watched, updated_at').eq('user_id', uid)
    if (error) { if (/does not exist|not find|PGRST205|42P01/i.test(`${error.code} ${error.message}`)) off = true; return }
    let next = state
    for (const r of data || []) {
      const v = r.variant === 'phone' ? 'phone' : null
      const k = key(name, r.lesson_id, v)
      const d = durOf(r.lesson_id, v)
      next = { ...next, [k]: mergeSeen(next[k], fromRow(r, d), d) }
    }
    if (next !== state) set(next)
  })().catch(() => {})
  pulled.set(name, p)
  return p
}
export const usePullVideo = (name, live) => useEffect(() => { if (live && name) pullVideo(name) }, [name, live])

export function useVideoProgress(name, id, duration, variant = null, live = false) {
  const s = useSyncExternalStore(subscribe, snap)
  usePullVideo(name, live)
  const own = s[key(name, id, variant)] || seeded(name, id, duration) || emptySeen(duration)
  const v = !own.watched && s[other(name, id, variant)]?.watched ? { ...own, watched: true } : own
  const write = useCallback((k, nextVal, now) => {
    set({ ...state, [k]: { ...nextVal, at: Date.now() } })
    if (live) push(k, id, variant, now)
  }, [id, variant, live])
  const seen = useCallback((from, to) => {
    const k = key(name, id, variant)
    const cur = state[k]
    const next = markSeen(cur, from, to, duration)
    if (cur && next.seen.length === cur.seen.length && next.watched === cur.watched && Math.abs((cur.pos || 0) - to) < 2) return
    write(k, { ...next, pos: to }, next.watched && !cur?.watched)
  }, [name, id, duration, variant, write])
  const savePos = useCallback(pos => {
    const k = key(name, id, variant)
    const cur = state[k] || emptySeen(duration)
    if (Math.abs((cur.pos || 0) - pos) >= 1) write(k, { ...cur, pos }, true)
  }, [name, id, duration, variant, write])
  const finish = useCallback(() => {
    const k = key(name, id, variant)
    write(k, finishSeen(state[k], duration), true)
  }, [name, id, duration, variant, write])
  return { ...v, seen, savePos, finish }
}

// For lists (lesson rows, admin): has this person watched this lesson's video?
export function useWatchedMap(name, live = false) {
  const s = useSyncExternalStore(subscribe, snap)
  usePullVideo(name, live)
  const out = {}
  for (const id of SEED_WATCHED[name] || []) out[id] = seeded(name, id, 0)
  for (const [k, v] of Object.entries(s)) {
    const [n, id] = k.split('|')
    if (n === name && !(out[id]?.watched && !v.watched)) out[id] = v // either version watched counts
  }
  return out
}
