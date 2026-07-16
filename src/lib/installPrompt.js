// Captures the browser's `beforeinstallprompt` event (Android/Chrome only —
// iOS Safari never fires it) at module load time, before any component
// mounts, so the event isn't missed if it fires while the user is still on
// the Login page. Imported once for its side effect at app boot (App.jsx).
let deferredPrompt = null
const listeners = new Set()

function notify() {
  listeners.forEach(l => l())
}

window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault()
  deferredPrompt = e
  notify()
})

window.addEventListener('appinstalled', () => {
  deferredPrompt = null
  notify()
})

export function getDeferredPrompt() {
  return deferredPrompt
}

export function subscribeInstallPrompt(cb) {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

// Fires the captured native install prompt. Resolves to the browser's
// { outcome: 'accepted' | 'dismissed' } choice, or null if no prompt was
// ever captured (iOS, or a browser that doesn't support it).
export async function triggerInstall() {
  if (!deferredPrompt) return null
  deferredPrompt.prompt()
  const choice = await deferredPrompt.userChoice
  deferredPrompt = null
  notify()
  return choice
}
