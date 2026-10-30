// Prompt 775 — runs once at start-up inside the phone app only (main.jsx
// imports it when isNativeApp()). The web portal never loads this file.
//
// - viewport-fit=cover so the page can use the notch / home-bar insets the
//   phone layout already pads for (env(safe-area-inset-*)).
// - Status bar icons follow the theme (light icons on dark, dark on light).
// - Android back button: an open sheet / dialog closes first (they all close
//   on Esc), then the page goes back, and on a home tab the app goes to the
//   background instead of closing.
// - Outside links open in the system browser sheet, never in the app.
// - The keyboard never covers the field being typed in.
// - Online / offline for the offline screen.
// - Over-the-air web updates (ota.js).
import { App } from '@capacitor/app'
import { StatusBar, Style } from '@capacitor/status-bar'
import { Keyboard } from '@capacitor/keyboard'
import { Network } from '@capacitor/network'
import { nativePlatform, openExternal, opening } from './native'
import { setOnline } from './nativeState'
import { startOta } from './ota'

const HOME_TABS = ['/', '/login', '/agent', '/fulfillment', '/fulfillment/desk', '/admin']

function viewportCover() {
  const meta = document.querySelector('meta[name="viewport"]')
  if (meta && !meta.content.includes('viewport-fit')) meta.content += ', viewport-fit=cover'
}

function syncStatusBar() {
  const light = document.documentElement.getAttribute('data-theme') === 'light'
  // Style.Light = dark icons for a light page; Style.Dark = light icons.
  StatusBar.setStyle({ style: light ? Style.Light : Style.Dark }).catch(() => {})
}

// An open sheet, dialog or full-screen panel: anything modal on the page.
function openOverlay() {
  return document.querySelector('[aria-modal="true"], [role="dialog"], .nt-wrap.is-full, .ph-sheet')
}

function onBack() {
  if (openOverlay()) {
    const target = document.activeElement && document.activeElement !== document.body ? document.activeElement : document.body
    target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }))
    return
  }
  if (HOME_TABS.includes(window.location.pathname) || window.history.length <= 1) {
    App.minimizeApp().catch(() => App.exitApp())
    return
  }
  window.history.back()
}

function isOutside(href) {
  try {
    const u = new URL(href, window.location.href)
    return (u.protocol === 'http:' || u.protocol === 'https:') && u.origin !== window.location.origin
  } catch { return false }
}

function interceptLinks() {
  document.addEventListener('click', e => {
    if (e.defaultPrevented || e.button !== 0) return
    const a = e.target.closest?.('a[href]')
    if (!a || !isOutside(a.href)) return
    e.preventDefault()
    openExternal(a.href)
  }, true)
  const open = window.open.bind(window)
  window.open = (url, ...rest) => {
    if (!opening.now && url && isOutside(String(url))) { openExternal(new URL(String(url), window.location.href).toString()); return null }
    return open(url, ...rest)
  }
}

export function bootNative() {
  const root = document.documentElement
  root.classList.add('is-native', `is-${nativePlatform()}`)
  viewportCover()

  syncStatusBar()
  new MutationObserver(syncStatusBar).observe(root, { attributes: true, attributeFilter: ['data-theme'] })

  App.addListener('backButton', onBack)
  interceptLinks()

  Keyboard.addListener('keyboardDidShow', () => {
    const el = document.activeElement
    if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) el.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }).catch(() => {})

  Network.getStatus().then(s => setOnline(s.connected)).catch(() => {})
  Network.addListener('networkStatusChange', s => setOnline(s.connected))

  startOta()
}
