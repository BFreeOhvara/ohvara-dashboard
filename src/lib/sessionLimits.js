// P970 — auto sign-out on the WEB portal, agents only.
//   Agents in a browser: signed out after 8 h with no activity, and a fresh login at least every 7 days.
//   Admin, VAs (role 'fulfillment') and the phone app (Capacitor): never. People can still sign out themselves.
// Pure on purpose (no Supabase, no Capacitor import): the clock and the storage are passed in, so the rules run
// under node --test with a fake clock. The React side is in AuthProvider (src/hooks/useAuth.jsx); the phone-app check is passed in as `native`.
// No Supabase project setting is touched (it would also hit the phone app): this is all the web app's own code.

// The one place the times live.
export const SESSION_LIMITS = {
  idleMs: 8 * 60 * 60 * 1000,          // no activity for this long -> signed out
  maxAgeMs: 7 * 24 * 60 * 60 * 1000,   // last real login older than this -> signed out, however active
  checkEveryMs: 60 * 1000,             // timer for a tab left open (also checked on load and on tab focus)
  activityThrottleMs: 30 * 1000,       // activity is written to storage at most this often
  quietMs: 2 * 60 * 1000,              // "idle enough to sign out": nothing touched in this long (matters for the 7-day rule)
  roles: ['agent'],                    // only these are ever signed out
}

export const LIMIT_KEYS = {
  active: 'ohvara-last-active',        // ms timestamp of the last click / key / scroll in any tab
  login: 'ohvara-login-at',            // JSON { uid, at } of the last real login
  note: 'ohvara-signed-out',           // sessionStorage: why the login page opens (idle | weekly)
  back: 'ohvara-return-to',            // sessionStorage: the page they were on
}

// The events that count as "working". Tab visibility is NOT one of them: coming back to a tab after a night away
// must hit the limit, not reset it.
export const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'scroll', 'wheel', 'touchstart', 'mousemove']

const num = v => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null }

// Is any sign-out rule in play for this person right now? Agents on the web only.
export function limitsApply({ role, native }, cfg = SESSION_LIMITS) {
  return !native && cfg.roles.includes(role)
}

// null (fine) | 'idle' | 'weekly'. Missing stamps never sign anyone out: ensureStamps starts the clock first.
export function limitBroken({ role, native = false, now, lastActive, loginAt }, cfg = SESSION_LIMITS) {
  if (!limitsApply({ role, native }, cfg)) return null
  if (num(lastActive) && now - lastActive >= cfg.idleMs) return 'idle'
  if (num(loginAt) && now - loginAt >= cfg.maxAgeMs) return 'weekly'
  return null
}

// What the login page says. The hours come from the config so a change there changes the note.
export function limitNote(reason, cfg = SESSION_LIMITS) {
  if (reason === 'idle') return `You were signed out after ${Math.round(cfg.idleMs / 3600000)} hours away. Log in again.`
  if (reason === 'weekly') return 'Time for your weekly sign-in. Log in again.'
  return ''
}

// ---- storage (any Storage-like: getItem / setItem / removeItem) ----

export function readLogin(store, uid) {
  try {
    const v = JSON.parse(store.getItem(LIMIT_KEYS.login) || 'null')
    return v && v.uid === uid && num(v.at) ? v.at : null
  } catch { return null }
}

export function markLogin(store, uid, now) {
  try { store.setItem(LIMIT_KEYS.login, JSON.stringify({ uid, at: now })) } catch { /* storage blocked */ }
  try { store.setItem(LIMIT_KEYS.active, String(now)) } catch { /* storage blocked */ }
}

export function readActive(store) {
  try { return num(store.getItem(LIMIT_KEYS.active)) } catch { return null }
}

// Throttled write, so a scroll storm is one write per 30 s. Returns true when it wrote.
export function noteActivity(store, now, cfg = SESSION_LIMITS) {
  const last = readActive(store)
  if (last && now - last < cfg.activityThrottleMs && now >= last) return false
  try { store.setItem(LIMIT_KEYS.active, String(now)) } catch { return false }
  return true
}

// A session that exists with no stamps (it began before this shipped, or through Join / Reset password) starts its
// clocks now rather than being signed out. Another person's login record is replaced.
export function ensureStamps(store, uid, now) {
  let loginAt = readLogin(store, uid)
  if (!loginAt) { markLogin(store, uid, now); loginAt = now }
  let lastActive = readActive(store)
  if (!lastActive) { try { store.setItem(LIMIT_KEYS.active, String(now)) } catch { /* ignore */ } lastActive = now }
  return { lastActive, loginAt }
}

export function clearStamps(store) {
  for (const k of [LIMIT_KEYS.active, LIMIT_KEYS.login]) { try { store.removeItem(k) } catch { /* ignore */ } }
}

// ---- when to wait ----

// Things that must finish first (a live call, an unsaved form) register here and release when done.
const holds = new Set()
export function holdSignOut(why = 'busy') {
  const h = { why }
  holds.add(h)
  return () => { holds.delete(h) }
}
export const heldCount = () => holds.size
export function resetHolds() { holds.clear() }

// A focused field with text typed into it: mid-typing / an unsaved form.
export function typingInField(doc) {
  const el = doc?.activeElement
  if (!el) return false
  const tag = String(el.tagName || '').toLowerCase()
  if (tag === 'textarea') return !!el.value
  if (tag === 'input') {
    const t = String(el.type || 'text').toLowerCase()
    if (['button', 'submit', 'checkbox', 'radio', 'range', 'file', 'color', 'reset', 'image'].includes(t)) return false
    return !!el.value
  }
  return !!el.isContentEditable && !!String(el.textContent || '').trim()
}

// Sign-out waits while: something is held (a call, a form), they touched the page in the last `quietMs`, or (for
// the 7-day rule only) a field has text in it. After 8 idle hours a stale half-typed field must not keep a
// session alive, so the field check does not apply to 'idle'.
export function mustWait({ reason, now, lastActive, doc, held = heldCount() }, cfg = SESSION_LIMITS) {
  if (held > 0) return true
  if (reason === 'weekly') {
    if (num(lastActive) && now - lastActive < cfg.quietMs) return true
    if (typingInField(doc)) return true
  }
  return false
}

// ---- return to the page they were on ----

// Only same-site paths come back; never an off-site or protocol-relative URL, and never the login pages.
export function safeReturnPath(p) {
  if (typeof p !== 'string' || !p.startsWith('/') || p.startsWith('//') || p.startsWith('/\\')) return null
  if (/^\/(login|signup|join|j\/|confirm-email|reset-password)/.test(p)) return null
  return p
}
