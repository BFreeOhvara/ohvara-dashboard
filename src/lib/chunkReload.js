// Prompt 746 — chunk-load recovery: a tab opened before a deploy asks for an
// /assets hash that is gone, the dynamic import rejects, and we reload once.

const CHUNK_RE = /ChunkLoadError|Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i
const FLAG_PREFIX = 'ov-chunk-reload:'
// One automatic reload per failed URL per minute: enough to pick up a new
// deploy, never enough to loop.
const FLAG_WINDOW_MS = 60_000

export const isChunkError = err => CHUNK_RE.test(`${err?.name || ''} ${err?.message || ''}`)

// Reloads the page once for this failed URL. Returns true if it reloaded.
// Storage calls are wrapped: with storage blocked we refuse to reload at all
// (no way to guard the loop), and the caller falls through to the fallback.
export function reloadOnceFor(url) {
  const key = FLAG_PREFIX + (url || window.location.pathname)
  try {
    const last = Number(sessionStorage.getItem(key) || 0)
    if (last && Date.now() - last < FLAG_WINDOW_MS) return false
    sessionStorage.setItem(key, String(Date.now()))
  } catch {
    return false
  }
  window.location.reload()
  return true
}

// The failed module's URL, when the browser's message carries one (Chrome:
// "Failed to fetch dynamically imported module: https://…/assets/x.js").
export const failedUrl = err => (String(err?.message || '').match(/https?:\/\/\S+/) || [])[0]
