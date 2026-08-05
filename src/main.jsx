import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Geist — 400 and 500 weights ONLY (anti-rule: no 600/700)
import '@fontsource/geist/400.css'
import '@fontsource/geist/500.css'
// JetBrains Mono — all numbers, money, data values
import '@fontsource/jetbrains-mono/400.css'
// Playfair Display — elegant high-contrast serif, Overview clock only
// (Prompt 350, replaces Prompt 342's DSEG7 seven-segment choice — Brayden
// didn't like the digital/LCD look after living with it). On Google Fonts,
// but self-hosted via @fontsource for the same reason as the others: no
// runtime CDN dependency.
import '@fontsource/playfair-display/700.css'
import './index.css'
import App from './App.jsx'

// Prompt 420 — root-caused a live bug where a shipped deploy (Prompt 419's
// Fulfillment intake fields) never reached Brayden's already-open tab even
// after Vercel's own deployment record confirmed the new commit was READY
// in production. Cause: the service worker's generateSW build binds EVERY
// navigation to its precached index.html (`NavigationRoute` +
// `createHandlerBoundToURL`), so an already-registered SW keeps serving
// whatever it precached at its last check-in — including on a manual hard
// refresh — until it notices a new deploy on its own. registerType
// 'autoUpdate' already skipWaiting()s + clientsClaim()s a new SW the
// moment one activates, but nothing forced (a) an active check for a new
// deploy, or (b) the already-open tab to actually reload once a fresher SW
// took control — so the same field-set bug was structurally guaranteed to
// recur on every future deploy for any tab left open across it.
if ('serviceWorker' in navigator) {
  ;(async () => {
    const { registerSW } = await import('virtual:pwa-register')
    const updateSW = registerSW({ immediate: true })
    // Passive browser SW-update checks are lazy/throttled; poll explicitly
    // so a stale open tab (especially an installed PWA session, which is
    // rarely fully closed) notices a new deploy promptly instead of
    // possibly waiting up to 24h.
    setInterval(() => updateSW(), 30 * 60 * 1000)
  })()

  // clientsClaim() hands control to a new SW without reloading already-open
  // tabs — without this, those tabs keep running already-loaded old JS and
  // keep hitting the (now-updated) precache for any subsequent navigation,
  // landing back on stale content. Reload once, guarded against the event
  // firing more than once per activation.
  let reloaded = false
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloaded) return
    reloaded = true
    window.location.reload()
  })
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
