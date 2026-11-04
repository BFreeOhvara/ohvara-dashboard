import QRCode from 'qrcode'

// Prompt 834 — the agent shell's "Get the phone app" drawer reads its store names and QR from here, so the
// sample-only template folder holds no brand names or raw colours (src/templateScan.test.js). Same stores and
// QR look as the portal's GetAppModal (P775).
export const STORES = [
  { key: 'ios', label: 'App Store', sub: 'iPhone' },
  { key: 'android', label: 'Google Play', sub: 'Android' },
]
export const STORES_SOON = 'Coming soon to the App Store and Google Play.'

// The QR must stay dark-on-light in both themes so every phone camera reads it.
export const appQr = (link, width = 400) => QRCode.toDataURL(link, { width, margin: 1, color: { dark: '#080810', light: '#FFFFFF' } })
