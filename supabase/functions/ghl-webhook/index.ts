// ghl-webhook — texts, replies and opt-outs from Jordan's GoHighLevel onto the
// lead's Ohvara timeline (Prompt 850). BUILT, NOT DEPLOYED.
//
// Deploy WITHOUT jwt verification (GHL calls it directly):
//   https://jjextitmbptoaolacocs.supabase.co/functions/v1/ghl-webhook
// Requests must carry GHL's X-GHL-Signature (app webhooks) or the header
// x-ohvara-ghl-secret = GHL_WEBHOOK_SECRET (workflow webhooks; saved on Connect, env as fallback).
// Does nothing but record opt-outs while ghl_settings.enabled is off.
// Logic: core.ts. Setup: brain/ohvara/ghl-bridge.md in the vault.
import { createClient } from 'npm:@supabase/supabase-js'
import { GHL_ED25519_PUBLIC_KEY, handle, type Settings } from './core.ts'
import { readSecrets } from '../_shared/secretStore.ts'

const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

// P1018: Jordan saves the webhook password on Admin -> Connect (the secrets table, encrypted). That value wins; the
// function's own GHL_WEBHOOK_SECRET env value is the fallback. Read at most once a minute.
let cached: { at: number; value: string | undefined } | null = null
async function sharedSecret(): Promise<string | undefined> {
  if (cached && Date.now() - cached.at < 60_000) return cached.value
  const s = await readSecrets(supabase as never, ['GHL_WEBHOOK_SECRET'], {
    encKey: Deno.env.get('SECRETS_ENCRYPTION_KEY') ?? undefined, env: n => Deno.env.get(n), log: m => console.error(m),
  })
  cached = { at: Date.now(), value: s.GHL_WEBHOOK_SECRET || undefined }
  return cached.value
}

Deno.serve(async req => handle(req, {
  sharedSecret: await sharedSecret(),
  publicKey: GHL_ED25519_PUBLIC_KEY,
  settings: () => supabase.from('ghl_settings').select('enabled, location_id').eq('id', true)
    .maybeSingle() as PromiseLike<{ data: Settings | null; error: { message: string } | null }>,
  rpc: (fn, args) => supabase.rpc(fn, args),
  insertReply: row => supabase.from('lead_sms_replies').insert(row),
  log: msg => console.error(msg),
}))
