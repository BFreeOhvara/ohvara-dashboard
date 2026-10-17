// Prompt 775 — the Ohvara phone app (Capacitor). Everything that behaves
// differently inside the iPhone / Android app goes through here, so the web
// portal is untouched when isNativeApp() is false.
import { Capacitor } from '@capacitor/core'

export const isNativeApp = () => Capacitor.isNativePlatform()
export const nativePlatform = () => Capacitor.getPlatform() // 'ios' | 'android' | 'web'

// The app's own pages are served from the phone (capacitor://localhost or
// https://localhost), so links that must reach the real website use this.
export const WEB_ORIGIN = (import.meta.env.VITE_PUBLIC_APP_URL || 'https://portal.ohvara.com').replace(/\/$/, '')

export function webUrl(path = '/') {
  return new URL(path, isNativeApp() ? WEB_ORIGIN : window.location.origin).toString()
}

// Outside pages (Stripe, carriers, help) open in the system browser sheet in
// the app (SFSafariViewController / Chrome Custom Tabs), never in the app's
// own webview. On the web: same tab when `sameTab`, else a new tab.
// `opening` lets nativeBoot's window.open hook step aside while the browser
// sheet itself is opening (a plugin without a native side falls back to
// window.open, which must not loop back here).
export const opening = { now: false }

export async function openExternal(url, { sameTab = false } = {}) {
  if (isNativeApp()) {
    const { Browser } = await import('@capacitor/browser')
    opening.now = true
    try { await Browser.open({ url, presentationStyle: 'popover' }) } finally { opening.now = false }
    return
  }
  if (sameTab) window.location.assign(url)
  else window.open(url, '_blank', 'noopener')
}

// tel: / mailto: / sms: need nothing here: Capacitor hands any navigation that
// isn't the app's own pages to the system (the dialer for tel:).
