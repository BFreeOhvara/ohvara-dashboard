// Prompt 775 — phone alerts (push) in the Ohvara app. Android tokens are
// Firebase (FCM) tokens; iPhone tokens are APNs device tokens. The token is
// saved to the signed-in user (push_register) and removed on sign-out
// (push_unregister) and on account deletion (server side). What gets pushed,
// and quiet hours, are decided on the server by notify() — same lists as the
// bell and email (Ohvara Notifications Plan).
import { App } from '@capacitor/app'
import { supabase } from './supabase'
import { isNativeApp, nativePlatform } from './native'
import { loadAppConfig } from './appConfig'

const TOKEN_KEY = 'ohvara-push-token'
let listening = false

function savedToken() {
  try { return localStorage.getItem(TOKEN_KEY) } catch { return null }
}
function saveToken(t) {
  try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY) } catch { /* private mode */ }
}

// Push is switched on per platform from the first native build that has it
// set up (Firebase file on Android, push capability on iPhone). Registering
// on a build without Firebase would crash Android, so this check comes first.
export async function pushReady() {
  if (!isNativeApp()) return false
  const cfg = await loadAppConfig()
  const from = cfg.push?.[nativePlatform()]
  if (from == null) return false
  const info = await App.getInfo().catch(() => null)
  return !!info && Number(info.build) >= Number(from)
}

// Called once the user is signed in and their Phone alerts switch is on.
// `onOpen(link)` runs when they tap an alert.
export async function startPush({ onOpen, ask = true }) {
  if (!(await pushReady())) return 'unavailable'
  const { PushNotifications } = await import('@capacitor/push-notifications')
  let perm = await PushNotifications.checkPermissions()
  if (perm.receive === 'prompt' || perm.receive === 'prompt-with-rationale') {
    if (!ask) return 'not-asked'
    perm = await PushNotifications.requestPermissions()
  }
  if (perm.receive !== 'granted') return 'denied'

  if (!listening) {
    listening = true
    const info = await App.getInfo().catch(() => ({}))
    await PushNotifications.addListener('registration', async ({ value }) => {
      const { error } = await supabase.rpc('push_register', { p_token: value, p_platform: nativePlatform(), p_app_build: String(info.build ?? '') })
      if (!error) saveToken(value)
      else console.warn('[push] could not save the device:', error.message)
    })
    await PushNotifications.addListener('registrationError', e => console.warn('[push] registration failed:', e?.error))
    await PushNotifications.addListener('pushNotificationActionPerformed', a => {
      const link = a?.notification?.data?.link
      if (link && link.startsWith('/')) onOpen?.(link)
    })
  }
  await PushNotifications.register()
  return 'on'
}

// Sign-out: forget this phone for this user before the session ends (the
// RPC needs the session). Never blocks sign-out.
export async function stopPush() {
  const token = savedToken()
  if (!token) return
  try { await supabase.rpc('push_unregister', { p_token: token }) } catch { /* signing out anyway */ }
  saveToken(null)
  if (isNativeApp()) {
    try {
      const { PushNotifications } = await import('@capacitor/push-notifications')
      await PushNotifications.removeAllListeners()
      listening = false
    } catch { /* not available */ }
  }
}
