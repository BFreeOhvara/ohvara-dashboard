// ghl-ad-spend — daily Meta spend per campaign from Jordan's GoHighLevel Ad
// Manager into ad_spend_daily (Prompt 858). BUILT, NOT DEPLOYED, SWITCHED OFF
// (ghl_settings.ad_spend_enabled, default false; needs migration 232).
//
// Deploy WITHOUT jwt verification (cron calls it with the x-ohvara-cron
// secret), then schedule it once a day after midnight Central:
//   select cron.schedule('ghl-ad-spend', '30 6 * * *',
//     $$select public.fulfillment_cron_post('ghl-ad-spend', '{"action":"run"}'::jsonb)$$);
// Secret: GHL_API_KEY (the bridge's Private Integration token; it also needs
// scope adPublishing.readonly). Logic: core.ts. Endpoint: api.ts.
import { createClient } from 'npm:@supabase/supabase-js'
import { isCron } from '../_shared/cronAuth.ts'
import { ghlReport } from './api.ts'
import { readSecrets } from '../_shared/secretStore.ts'
import { handle, type Settings } from './core.ts'

const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

Deno.serve(req => handle(req, {
  apiKey: Deno.env.get('GHL_API_KEY') || undefined,
  // P939: the key pasted on the Connect page (secrets table) wins; the env value is the fallback.
  secrets: async () => ({
    apiKey: (await readSecrets(supabase as never, ['GHL_API_KEY'], {
      encKey: Deno.env.get('SECRETS_ENCRYPTION_KEY') ?? undefined, env: n => Deno.env.get(n), log: m => console.error(m),
    })).GHL_API_KEY,
  }),
  isCron: r => isCron(r, supabase),
  settings: () => supabase.from('ghl_settings').select('ad_spend_enabled, location_id').eq('id', true)
    .maybeSingle() as PromiseLike<{ data: Settings | null; error: { message: string } | null }>,
  report: ghlReport((url, init) => fetch(url, init)),
  save: (rows, status, error) => supabase.rpc('ghl_ad_spend_save', { p_rows: rows, p_status: status, p_error: error }),
  now: () => new Date(),
  log: msg => console.error(msg),
}))
