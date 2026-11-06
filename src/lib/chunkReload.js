// Prompt 746 — chunk-load recovery: a tab opened before a deploy asks for an
// /assets hash that is gone, the dynamic import rejects, and we reload.
// Prompt 861 — the guard is now once per BUILD VERSION (the build this tab is running), kept in localStorage, and the
// reload carries a cache-busting query so the browser cannot hand back the stale index.html it already holds. A
// session flag per failed URL (the old guard) let one reload through, which came back to the same stale page in a
// browser that cached index.html, and left a blank page behind. Plain JS (no JSX, no Vite-only imports) so a node
// test runs it.

/* global __APP_BUILD__ */
const CHUNK_RE = /ChunkLoadError|Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Failed to load module script|Unable to preload CSS|Cannot read properties of undefined \(reading 'default'\)/i
export const FLAG_PREFIX = 'ov-chunk-reload:'
export const BUST_PARAM = '_cb'
// A fresh deploy lands in seconds, but a browser can sit on a stale index.html for a while: the same build gets one
// more automatic try after this long (never a loop: a reload that works moves the tab onto a newer build).
export const FLAG_WINDOW_MS = 10 * 60_000

export const isChunkError = err => CHUNK_RE.test(`${err?.name || ''} ${err?.message || ''}`)

// The build this tab is running ('dev' in the dev server and in tests).
export const runningBuild = () => (typeof __APP_BUILD__ === 'string' ? __APP_BUILD__ : 'dev')

const stores = () => {
  const list = []
  try { if (typeof localStorage !== 'undefined') list.push(localStorage) } catch { /* blocked */ }
  try { if (typeof sessionStorage !== 'undefined') list.push(sessionStorage) } catch { /* blocked */ }
  return list
}

// The address to reload to: the same page with a throw-away query, so the browser asks the server for index.html.
export function bustedHref(href, now = Date.now()) {
  const u = new URL(href)
  u.searchParams.set(BUST_PARAM, String(now))
  return u.toString()
}

// Takes this build's one reload. True when it was free (and is now spent); false when it was already used lately or
// when no storage works (no way to guard a loop, so no reload at all). `env` is for the test.
export function takeReload(build = runningBuild(), now = Date.now(), list = stores()) {
  const key = FLAG_PREFIX + build
  if (!list.length) return false
  try {
    for (const s of list) {
      const last = Number(s.getItem(key) || 0)
      if (last && now - last < FLAG_WINDOW_MS) return false
    }
    list[0].setItem(key, String(now))
  } catch {
    return false
  }
  return true
}

// Reloads the page (once per build, cache-busted). Returns true if it reloaded; false means the caller shows its
// visible fallback panel. `url` is accepted for the old call sites and no longer decides anything.
export function reloadOnceFor() {
  if (!takeReload()) return false
  try { window.location.replace(bustedHref(window.location.href)) } catch { window.location.reload() }
  return true
}

// The crash panels' Reload button: always a fresh fetch of the page (never the cached copy), no guard needed since a
// person pressed it.
export function reloadFresh() {
  try { window.location.replace(bustedHref(window.location.href)) } catch { window.location.reload() }
}

// Boot: take the throw-away query back out of the address bar (the page already loaded fresh with it).
export function stripBust() {
  try {
    const u = new URL(window.location.href)
    if (!u.searchParams.has(BUST_PARAM)) return
    u.searchParams.delete(BUST_PARAM)
    window.history.replaceState(window.history.state, '', u.pathname + u.search + u.hash)
  } catch { /* leave the address alone */ }
}

// The failed module's URL, when the browser's message carries one (Chrome:
// "Failed to fetch dynamically imported module: https://…/assets/x.js").
export const failedUrl = err => (String(err?.message || '').match(/https?:\/\/\S+/) || [])[0]
