// ghl-push — sends Ohvara lead changes to Jordan's GoHighLevel (Prompt 850).
// BUILT, NOT DEPLOYED. Does nothing while ghl_settings.enabled is false (the
// default), and the triggers in migration 230 queue nothing while it is off.
//
// Deploy WITHOUT jwt verification (cron calls it with the x-ohvara-cron
// secret, checked by fulfillment_cron_ok), then schedule it every minute:
//   select cron.schedule('ghl-push', '* * * * *',
//     $$select public.fulfillment_cron_post('ghl-push', '{"action":"run"}'::jsonb)$$);
// Secret: GHL_API_KEY (Jordan's Private Integration token, sub-account scope
// contacts.write). Logic: core.ts. GHL endpoints: api.ts.
// P915: GHL_CONTROL_WEBHOOK_URL (Jordan's Inbound Webhook trigger URL,
// https://services.leadconnectorhq.com/hooks/…) receives campaign on/off.
import { createClient } from 'npm:@supabase/supabase-js'
import { isCron } from '../_shared/cronAuth.ts'
import { ghlClient } from './api.ts'
import { handle, type Settings } from './core.ts'

const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

Deno.serve(req => handle(req, {
  apiKey: Deno.env.get('GHL_API_KEY') || undefined,
  isCron: r => isCron(r, supabase),
  ghl: key => ghlClient(key, (url, init) => fetch(url, init)),
  controlUrl: Deno.env.get('GHL_CONTROL_WEBHOOK_URL') || undefined,
  post: async (url, body) => {
    const res = await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(10_000),
    })
    await res.text().catch(() => '')
    return { ok: res.ok, status: res.status }
  },
  settings: () => supabase.from('ghl_settings')
    .select('enabled, location_id, workflow_new_inbound, workflow_appointment_reminder, workflow_no_show, workflow_opt_out, workflow_no_answer')
    .eq('id', true).maybeSingle() as PromiseLike<{ data: Settings | null; error: { message: string } | null }>,
  rpc: (fn, args) => supabase.rpc(fn, args),
  log: msg => console.error(msg),
}))
