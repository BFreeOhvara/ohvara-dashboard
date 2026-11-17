import { isNativeApp } from './native'

// P1020 — the loading screen's one overlay (components/shared/Loader.jsx renders it; the look is in index.html).
export const WAIT_MS = 300
const OUT_MS = 220
const GRACE_MS = 60
const PHONE_Q = '(max-width: 767.98px)'

// The mark (ohvara-site/_src/mark.json, as in the mockups). The boot copy in index.html must match (components/shared/loader.test.js).
export const MARK_BODY = 'M54 352 L52 353 L66 339 L88 314 L115 281 L154 223 L188 162 L220 94 L231 67 L237 50 L240 41 L244 31 L247 22 L249 17 L254 2 L255 52 L250 171 L248 205 L247 230 L289 251 L279 257 L264 264 L239 274 L224 280 L201 290 L193 294 L161 307 L141 316 L116 326 L108 330 L97 334 L89 338 L71 345 L54 352 Z'
export const MARK_WING = 'M73 296 L72 296 L72 274 L68 236 L58 203 L43 171 L21 137 L1 114 L7 116 L41 132 L111 163 L125 170 L164 187 L172 190 L173 188 L175 189 L175 193 L174 196 L171 200 L170 203 L167 207 L166 210 L163 214 L162 217 L159 221 L157 225 L154 229 L152 233 L148 238 L141 243 L142 240 L145 235 L73 296 Z'
const INNER = `<svg viewBox="0 0 291.4 354" aria-hidden="true"><path class="olb" d="${MARK_BODY}"/><path class="olw" d="${MARK_WING}"/></svg>`
  + '<div class="ol-track" aria-hidden="true"><i></i></div><div class="ol-word">Loading</div>'

export const isPhone = () => {
  try { return isNativeApp() || !!window.matchMedia?.(PHONE_Q).matches } catch { return false }
}

// Every overlay runs its loops on the page clock, so one that takes over (or the boot copy) never jumps a beat.
const clock = el => el.style.setProperty('--ol-t', `-${(performance.now() / 1000).toFixed(3)}s`)

let spare = null // an overlay whose owner just left: fading out (or still waiting), ready to be taken over

function show(h) {
  h.shown = true
  h.el.classList.remove('is-out')
  h.el.classList.add('is-on')
}

function wait(h, ms) {
  clearTimeout(h.wait)
  h.wait = setTimeout(() => { if (!h.gone) show(h) }, Math.max(0, ms))
}

function drop(h) {
  clearTimeout(h.wait); clearTimeout(h.release)
  h.el.remove()
  if (spare === h) spare = null
}

export function acquire() {
  if (spare) {
    const h = spare
    spare = null
    clearTimeout(h.release)
    h.gone = false
    if (h.shown) show(h)
    return h
  }
  const el = document.createElement('div')
  el.className = 'ol'
  el.setAttribute('role', 'status')
  el.setAttribute('aria-live', 'polite')
  el.setAttribute('aria-label', 'Loading')
  el.innerHTML = INNER
  clock(el)
  document.body.appendChild(el)
  const h = { el, shown: false, gone: false, wait: 0, release: 0 }
  wait(h, WAIT_MS)
  return h
}

export function release(h) {
  if (spare && spare !== h) drop(spare)
  h.gone = true
  spare = h
  if (h.shown) {
    h.el.classList.remove('is-on')
    h.el.classList.add('is-out')
  }
  h.release = setTimeout(() => drop(h), h.shown ? OUT_MS : GRACE_MS)
}

// The overlay index.html painted before this bundle ran (#ol-boot). main.jsx hands it over before React renders, so
// the first <Loader /> takes it over; if none mounts, it fades out (or simply goes, if it never showed).
export function adoptBoot() {
  const el = typeof document !== 'undefined' && document.getElementById('ol-boot')
  if (!el) return
  el.removeAttribute('id')
  el.classList.remove('ol-boot')
  clock(el)
  document.body.appendChild(el)
  const h = { el, shown: false, gone: false, wait: 0, release: 0 }
  const since = performance.now()
  if (since >= WAIT_MS) show(h)
  else wait(h, WAIT_MS - since)
  spare = h
  // React's first commit lands within a frame or two; give it that long to take the overlay over.
  const later = () => { if (spare === h) release(h) }
  h.release = setTimeout(later, 250)
}

// P1026 — one loader until the page is ready. The first time a portal opens, the loading screen covers the whole window
// and the shell stays hidden behind it (html.ol-hold, index.html) until the shell AND its first data are in, then the whole
// page comes up at once. After that, a slow page keeps the current page on screen under a slim teal line at the top of
// the window, and only past SLOW_MS falls back to the full-screen loader. Never a box inside the page.
export const SLOW_MS = 2000
let booted = false
export const isBooted = () => booted
export const markBooted = () => { booted = true }
export const resetBooted = () => { booted = false }

// Hides the app behind the loading screen (not the overlay itself, which sits outside #root) while a hold is up.
export function hold(on) {
  try { document.documentElement.classList.toggle('ol-hold', on) } catch { /* no document */ }
}
