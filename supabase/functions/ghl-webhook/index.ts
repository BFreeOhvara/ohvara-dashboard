// ghl-webhook — texts, replies and opt-outs from Jordan's GoHighLevel onto the
// lead's Ohvara timeline (Prompt 850). BUILT, NOT DEPLOYED.
//
// Deploy WITHOUT jwt verification (GHL calls it directly):
//   https://jjextitmbptoaolacocs.supabase.co/functions/v1/ghl-webhook
// Requests must carry GHL's X-GHL-Signature (app webhooks) or the header
// x-ohvara-ghl-secret = secret GHL_WEBHOOK_SECRET (workflow webhooks).
// Does nothing but record opt-outs while ghl_settings.enabled is off.
// Logic: core.ts. Setup: brain/ohvara/ghl-bridge.md in the vault.
import { createClient } from 'npm:@supabase/supabase-js'
import { GHL_ED25519_PUBLIC_KEY, handle, type Settings } from './core.ts'

const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

Deno.serve(req => handle(req, {
  sharedSecret: Deno.env.get('GHL_WEBHOOK_SECRET') || undefined,
  publicKey: GHL_ED25519_PUBLIC_KEY,
  settings: () => supabase.from('ghl_settings').select('enabled, location_id').eq('id', true)
    .maybeSingle() as PromiseLike<{ data: Settings | null; error: { message: string } | null }>,
  rpc: (fn, args) => supabase.rpc(fn, args),
  insertReply: row => supabase.from('lead_sms_replies').insert(row),
  log: msg => console.error(msg),
}))
