// Prompt 775 — over-the-air web updates for the phone app, self-hosted.
//
// Each website build (Vercel) also writes /ota/manifest.json and a zip of
// the same build (scripts/vite-ota.mjs). The app checks the manifest on
// launch and when it comes back to the front; a newer build is downloaded
// with @capgo/capacitor-updater (open source, MPL-2.0, manual mode: no Capgo
// account, no Capgo servers, stats off) and switched in at the start of the
// next launch, never mid-call. If a new build can't start (notifyAppReady
// never runs), the plugin rolls back to the last good one.
//
// P961 — why build 4 never moved: the downloaded build was parked with a
// "kill" delay so the plugin wouldn't swap it in while the app sat in the
// background (a call may be running). The plugin clears that delay on the next
// launch but only swaps on the next trip to the background, and by then this
// file had parked the same build again with a fresh "kill" delay. Launch after
// launch it stayed parked. Now the start of every launch switches a parked
// build in straight away (applyPending), before anyone can be on a call.
//
// Only HTML/JS/CSS change this way. A build that needs new native code bumps
// `ohvara.otaMinNativeBuild` in package.json ({ ios, android }: Apple and
// Google count builds separately), and older store builds then ignore it
// until the user updates from the store.
import { App } from '@capacitor/app'
import { WEB_ORIGIN, nativePlatform } from './native'
import { whyNot, shouldApply } from './otaRules.js'

/* global __APP_BUILD__ */
export const RUNNING = typeof __APP_BUILD__ === 'string' ? __APP_BUILD__ : 'dev'
const EVERY_MS = 30 * 60 * 1000
const STATUS_KEY = 'ohvara-ota-status'

let lastCheck = 0
let busy = false
const listeners = new Set()

// What the updater last did, kept on the phone for the "About this app" line.
export function readOtaStatus() {
  try { return JSON.parse(window.localStorage.getItem(STATUS_KEY)) || {} } catch { return {} }
}
function note(patch) {
  const s = { ...readOtaStatus(), ...patch }
  try { window.localStorage.setItem(STATUS_KEY, JSON.stringify(s)) } catch { /* storage off */ }
  listeners.forEach(fn => fn(s))
  return s
}
export function onOtaStatus(fn) { listeners.add(fn); return () => listeners.delete(fn) }

export { whyNot, isNewer, shouldApply } from './otaRules.js'

async function applyPending(Updater) {
  const next = await Updater.getNextBundle().catch(() => null)
  const s = readOtaStatus()
  if (!shouldApply(next, RUNNING, s.tried)) return false
  note({ applying: next.version, tried: { [next.version]: ((s.tried || {})[next.version] || 0) + 1 } })
  await Updater.cancelDelay().catch(() => {})
  await Updater.set({ id: next.id }) // reloads the app into the new build now
  return true
}

async function check(Updater) {
  if (busy || Date.now() - lastCheck < EVERY_MS) return
  busy = true
  lastCheck = Date.now()
  note({ lastCheck: lastCheck })
  try {
    const res = await fetch(`${WEB_ORIGIN}/ota/manifest.json`, { cache: 'no-store' })
    if (!res.ok) { note({ result: `manifest ${res.status}`, error: `manifest ${res.status}` }); return }
    const m = await res.json()
    const info = await App.getInfo()
    const why = whyNot(m, RUNNING, info.build, nativePlatform())
    if (why) { note({ latest: m.version, result: why, error: null }); return }
    const { bundles = [] } = await Updater.list()
    let bundle = bundles.find(b => b.version === m.version && b.status !== 'error')
    if (!bundle) {
      bundle = await Updater.download({ url: new URL(m.bundle, WEB_ORIGIN).toString(), version: m.version, checksum: m.checksum })
      note({ downloaded: m.version, downloadedAt: Date.now() })
    }
    await Updater.next({ id: bundle.id })
    // Never swap while the app is in the background (a call may be running): it switches in at the next launch.
    await Updater.setMultiDelay({ delayConditions: [{ kind: 'kill' }] })
    note({ latest: m.version, result: 'ready: opens next launch', error: null })
  } catch (e) {
    const msg = String(e?.message || e).slice(0, 120)
    note({ result: 'check failed', error: msg })
    console.warn('[ota] update check failed:', msg)
  } finally {
    busy = false
  }
}

export async function startOta() {
  try {
    const { CapacitorUpdater } = await import('@capgo/capacitor-updater')
    await CapacitorUpdater.notifyAppReady()
    const s = readOtaStatus()
    if (s.applying === RUNNING) note({ applying: null, applied: RUNNING, appliedAt: Date.now(), error: null })
    else if (s.applying) note({ applying: null, error: `${s.applying} did not start; kept ${RUNNING}` })
    try {
      if (await applyPending(CapacitorUpdater)) return
    } catch (e) {
      note({ applying: null, error: `switch failed: ${String(e?.message || e).slice(0, 100)}` })
    }
    check(CapacitorUpdater)
    App.addListener('resume', () => check(CapacitorUpdater))
  } catch (e) {
    note({ error: String(e?.message || e).slice(0, 120) })
    console.warn('[ota] not available:', e?.message || e)
  }
}
