// Prompt 775 — /app/config.json on the website: the store links (null until
// the apps are live, so the portal shows "Coming soon") and, per platform,
// the first native build number that has push set up (null = push off).
// One file, read by the portal, the /app smart-link page and the phone app.
import { WEB_ORIGIN, isNativeApp } from './native'

const EMPTY = { ios: null, android: null, push: { ios: null, android: null } }
let cached = null

export async function loadAppConfig() {
  if (cached) return cached
  const urls = isNativeApp() ? [`${WEB_ORIGIN}/app/config.json`, '/app/config.json'] : ['/app/config.json']
  for (const url of urls) {
    try {
      const res = await fetch(url, { cache: 'no-cache' })
      if (res.ok) { cached = { ...EMPTY, ...(await res.json()) }; return cached }
    } catch { /* try the next one */ }
  }
  return EMPTY
}

// The one link people share: phones go to their store, anything else sees
// both badges and the QR code (public/app/index.html).
export const appLink = () => `${WEB_ORIGIN}/app`
