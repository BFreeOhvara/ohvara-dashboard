// notify-push — Prompt 775, phone alerts. Deploy with --no-verify-jwt: the
// only caller is pg_cron, checked by the x-ohvara-cron Vault secret in core.ts.
//
// Secrets (Brayden adds them; until then that platform is skipped):
//   APNS_KEY_P8        the .p8 file's text (Certificates, IDs & Profiles → Keys)
//   APNS_KEY_ID        the key's 10-character id
//   APNS_TEAM_ID       the Apple Developer team id
//   APNS_BUNDLE_ID     com.ohvara.portal (default)
//   APNS_PRODUCTION    'true' for App Store / TestFlight builds (default true)
//   FCM_SERVICE_ACCOUNT the Firebase service account JSON (Project settings → Service accounts)
import { createClient } from 'npm:@supabase/supabase-js'
import { apnsSender, fcmSender, handle, type Senders, type Store } from './core.ts'

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

const store: Store = {
  async cronOk(secret) {
    const { data } = await db.rpc('fulfillment_cron_ok', { p_secret: secret })
    return data === true
  },
  async claim(limit) {
    const { data, error } = await db.rpc('notify_claim_pushes', { p_limit: limit })
    if (error) throw error
    return data || []
  },
  async finish(id, ok, error, dead) {
    await db.rpc('notify_finish_push', { p_id: id, p_ok: ok, p_error: error, p_dead: dead.length ? dead : null })
  },
}

function senders(): Senders {
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
    try { out.android = fcmSender(JSON.parse(sa)) } catch { console.error('[notify-push] FCM_SERVICE_ACCOUNT is not valid JSON') }
  }
  return out
}

const configured = senders()
Deno.serve(req => handle(req, store, configured))
