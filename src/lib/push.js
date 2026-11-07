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
import { pushAction, transferLink } from './liveTransfer'

const TOKEN_KEY = 'ohvara-push-token'
let listening = false

// P880 — live transfer. A Yes / No tapped on the lock screen (iOS actionId YES / NO; Android's Yes / No open
// ohvara://transfer?check=…&answer=…) or a tap on the alert reaches the agent's TransferAlert through this
// window event, which sends the answer with the app's sign-in. A cold launch can beat the alert's mount, so the
// last one also waits in `pending` until the alert takes it.
export const TRANSFER_EVENT = 'ohvara:transfer'
let pending = null
export function takePendingTransfer() { const p = pending; pending = null; return p }
function toAlert(detail) {
  if (!detail?.check) return
  pending = detail
  try { window.dispatchEvent(new CustomEvent(TRANSFER_EVENT, { detail })) } catch { /* no window */ }
}

// The live-calls channel (Android): high importance, so it shows on the lock screen and heads up. Do Not Disturb
// override is the user's switch on this channel; the push test points them to it.
async function liveCallsChannel(PushNotifications) {
  if (nativePlatform() !== 'android') return
  try {
    await PushNotifications.createChannel({ id: 'ohvara_transfer', name: 'Live calls', description: 'A lead is on the line for you. Answer Yes or No within 30 seconds.', importance: 5, visibility: 1, vibration: true })
  } catch { /* older plugin */ }
}

// What the app tells the server about this phone (transfer_reach reads it): notifications allowed, and whether the
// live-calls alerts can break through (Android: the channel's importance; iPhone: not readable here, so unknown).
async function reportHealth(PushNotifications, token, receive) {
  let ts = 'unknown'
  if (nativePlatform() === 'android') {
    try {
      const { channels } = await PushNotifications.listChannels()
      const ch = channels?.find(c => c.id === 'ohvara_transfer')
      ts = ch ? (ch.importance >= 4 ? 'on' : 'off') : 'unknown'
    } catch { /* fine */ }
  }
  const perm = receive === 'granted' ? 'granted' : receive === 'denied' ? 'denied' : 'prompt'
  try { await supabase.rpc('push_report', { p_token: token, p_permission: perm, p_time_sensitive: ts }) } catch { /* P880 migration not applied yet */ }
}

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
  if (perm.receive !== 'granted') {
    const t = savedToken()
    if (t) reportHealth(PushNotifications, t, perm.receive)
    return 'denied'
  }

  if (!listening) {
    listening = true
    const info = await App.getInfo().catch(() => ({}))
    await PushNotifications.addListener('registration', async ({ value }) => {
      const { error } = await supabase.rpc('push_register', { p_token: value, p_platform: nativePlatform(), p_app_build: String(info.build ?? '') })
      if (!error) { saveToken(value); reportHealth(PushNotifications, value, 'granted') }
      else console.warn('[push] could not save the device:', error.message)
    })
    await PushNotifications.addListener('registrationError', e => console.warn('[push] registration failed:', e?.error))
    await PushNotifications.addListener('pushNotificationActionPerformed', a => {
      const t = pushAction(a)
      if (t) { toAlert(t); return }
      const link = a?.notification?.data?.link
      if (link && link.startsWith('/')) onOpen?.(link)
    })
    // The app is open when a check arrives: show it at once (realtime would too, a moment later).
    await PushNotifications.addListener('pushNotificationReceived', n => {
      if (n?.data?.type === 'transfer_check' && n.data.check_id) toAlert({ check: n.data.check_id, answer: null })
    })
    await liveCallsChannel(PushNotifications)
    // Android's Yes / No buttons open the app on a link; a cold start gets it from getLaunchUrl.
    App.addListener('appUrlOpen', e => { const t = transferLink(e?.url); if (t) toAlert(t) })
    App.getLaunchUrl?.().then(r => { const t = transferLink(r?.url); if (t) toAlert(t) }).catch(() => {})
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
