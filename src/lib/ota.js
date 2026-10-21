// Prompt 775 — over-the-air web updates for the phone app, self-hosted.
//
// Each website build (Vercel) also writes /ota/manifest.json and a zip of
// the same build (scripts/vite-ota.mjs). The app checks the manifest on
// launch and when it comes back to the front; a newer build is downloaded
// with @capgo/capacitor-updater (open source, MPL-2.0, manual mode: no Capgo
// account, no Capgo servers, stats off) and switched in the next time the
// app is closed and reopened, never mid-call. If a new build can't start
// (notifyAppReady never runs), the plugin rolls back to the last good one.
//
// Only HTML/JS/CSS change this way. A build that needs new native code bumps
// `ohvara.otaMinNativeBuild` in package.json ({ ios, android }: Apple and
// Google count builds separately), and older store builds then ignore it
// until the user updates from the store.
import { App } from '@capacitor/app'
import { WEB_ORIGIN, nativePlatform } from './native'

/* global __APP_BUILD__ */
const RUNNING = typeof __APP_BUILD__ === 'string' ? __APP_BUILD__ : 'dev'
const EVERY_MS = 30 * 60 * 1000

let lastCheck = 0
let busy = false

export function isNewer(manifest, running, nativeBuild, platform) {
  if (!manifest?.version || !manifest?.bundle || !manifest?.checksum) return false
  if (manifest.version === running) return false
  const min = manifest.minNativeBuild?.[platform] ?? manifest.minNative ?? 1
  if (Number(nativeBuild) < Number(min || 1)) return false
  return true
}

async function check(Updater) {
  if (busy || Date.now() - lastCheck < EVERY_MS) return
  busy = true
  lastCheck = Date.now()
  try {
    const res = await fetch(`${WEB_ORIGIN}/ota/manifest.json`, { cache: 'no-store' })
    if (!res.ok) return
    const m = await res.json()
    const info = await App.getInfo()
    if (!isNewer(m, RUNNING, info.build, nativePlatform())) return
    const { bundles = [] } = await Updater.list()
    let bundle = bundles.find(b => b.version === m.version && b.status !== 'error')
    if (!bundle) {
      bundle = await Updater.download({ url: new URL(m.bundle, WEB_ORIGIN).toString(), version: m.version, checksum: m.checksum })
    }
    await Updater.next({ id: bundle.id })
    // Switch only on a fresh start, so a call or a half-filled form is never cut off.
    await Updater.setMultiDelay({ delayConditions: [{ kind: 'kill' }] })
  } catch (e) {
    console.warn('[ota] update check failed:', e?.message || e)
  } finally {
    busy = false
  }
}

export async function startOta() {
  try {
    const { CapacitorUpdater } = await import('@capgo/capacitor-updater')
    await CapacitorUpdater.notifyAppReady()
    check(CapacitorUpdater)
    App.addListener('resume', () => check(CapacitorUpdater))
  } catch (e) {
    console.warn('[ota] not available:', e?.message || e)
  }
}
