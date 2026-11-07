// The APNs / FCM senders from this project's secrets (Deno only). notify-push and help-transfer share it.
import { apnsSender, fcmSender, type Senders } from './core.ts'

export function sendersFromEnv(): Senders {
  const out: Senders = {}
  const p8 = Deno.env.get('APNS_KEY_P8'), keyId = Deno.env.get('APNS_KEY_ID'), teamId = Deno.env.get('APNS_TEAM_ID')
  if (p8 && keyId && teamId) {
    out.ios = apnsSender({
      keyP8: p8, keyId, teamId,
      bundleId: Deno.env.get('APNS_BUNDLE_ID') || 'com.ohvara.portal',
      production: (Deno.env.get('APNS_PRODUCTION') ?? 'true') !== 'false',
    })
  }
  const sa = Deno.env.get('FCM_SERVICE_ACCOUNT')
  if (sa) {
    try { out.android = fcmSender(JSON.parse(sa)) } catch { console.error('[push] FCM_SERVICE_ACCOUNT is not valid JSON') }
  }
  return out
}
