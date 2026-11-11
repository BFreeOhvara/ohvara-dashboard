// reactivation — P952 scrub runner (logic in core.ts). NOT DEPLOYED. Deploy with Brayden's yes, without JWT
// verification (pg_cron calls it with the x-ohvara-cron secret; nothing else is accepted):
//   npx.cmd supabase functions deploy reactivation --no-verify-jwt --project-ref jjextitmbptoaolacocs
// Secret: SCRUB_API_KEY (the scrub provider's key; Brayden adds it in Supabase himself, never in chat).
import { createClient } from 'npm:@supabase/supabase-js'
import { isCron } from '../_shared/cronAuth.ts'
import { scrubRun, scrubberFor } from './core.ts'

const admin = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } })

Deno.serve(async req => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  if (!(await isCron(req, admin))) return json({ error: 'Not allowed' }, 401)
  let body: { action?: string } = {}
  try { body = await req.json() } catch { return json({ error: 'Bad JSON' }, 400) }
  if (body.action !== 'scrub') return json({ error: 'Unknown action' }, 400)
  const { data: s } = await admin.from('reactivation_settings').select('scrub_provider').eq('id', true).maybeSingle()
  const provider = s?.scrub_provider ?? 'none'
  const store = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      const { data, error } = await admin.rpc(name, args)
      if (error) throw error
      return data
    },
  }
  // deno-lint-ignore no-explicit-any
  return json(await scrubRun(store, provider, scrubberFor(provider, { key: Deno.env.get('SCRUB_API_KEY') ?? '' }, fetch as any)))
})
