// P999 — slows down password guessing on this device: after 5 wrong passwords for one email, each next try waits
// 30 s, then 1 min, 2 min … up to 15 min. Kept per email in localStorage (blocked storage = no wait). The real walls
// are on the server: Supabase Auth's per-IP sign-in limit and the bot check. No imports, so node --test loads it.

const KEY = 'ohvara-signin-fails'
export const FREE_TRIES = 5
const BASE_MS = 30e3
const MAX_MS = 15 * 60e3

const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {} } catch { return {} } }
const write = v => { try { localStorage.setItem(KEY, JSON.stringify(v)) } catch { /* storage blocked */ } }
const keyOf = id => String(id || '').trim().toLowerCase()

// How long to wait after `fails` wrong tries (0 while under FREE_TRIES).
export function waitMs(fails) {
  if (fails < FREE_TRIES) return 0
  return Math.min(MAX_MS, BASE_MS * 2 ** (fails - FREE_TRIES))
}

export function words(ms) {
  const s = Math.ceil(ms / 1000)
  if (s < 60) return `${s} seconds`
  const m = Math.ceil(s / 60)
  return m === 1 ? '1 minute' : `${m} minutes`
}

// '' when a try is allowed now, else how long to wait ("30 seconds").
export function failWait(id, now = Date.now()) {
  const r = read()[keyOf(id)]
  if (!r) return ''
  const left = r.at + waitMs(r.n) - now
  return left > 0 ? words(left) : ''
}

export function noteFail(id, now = Date.now()) {
  const all = read(); const k = keyOf(id)
  // A day without a wrong try starts the count again.
  const prev = all[k] && now - all[k].at < 864e5 ? all[k].n : 0
  all[k] = { n: prev + 1, at: now }
  write(all)
}

export function clearFails(id) {
  const all = read(); delete all[keyOf(id)]; write(all)
}
