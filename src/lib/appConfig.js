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

// The one link people share: ohvara.com/app (P1000, the website). Phones go to their store (Android: join the
// testers group, then the Play opt-in, while the app is in closed testing); a computer picks Android or iPhone and
// gets that phone's QR code. P1001: was the portal's own old /app page, which still said "Coming soon".
export const SITE_APP_URL = 'https://ohvara.com/app'
// Android's working route while Play is in closed testing (the website's 3-step join checklist).
export const ANDROID_APP_URL = `${SITE_APP_URL}?os=android`
export const appLink = () => SITE_APP_URL
