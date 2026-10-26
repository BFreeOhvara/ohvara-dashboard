// submit-mp-lead — the public mortgage-protection lead form. No login.
//
// Deployed with verify_jwt OFF (a public form; deploying is a manual step):
//   supabase functions deploy submit-mp-lead --no-verify-jwt --project-ref jjextitmbptoaolacocs
//
//   POST { first_name, last_name?, phone (+1XXXXXXXXXX), email?, state, age_band,
//          mortgage_balance_band, homeowner, smoker, best_time?, consent: true,
//          consent_text_version, utm_*?, website (honeypot, leave empty) }
//     → { ok: true }            stored (or quietly dropped), nothing else, ever
//     → { error } 400           a field is missing or wrong
//
// Needs mp_leads (migration 161), assign_mp_lead (migration 162) and
// check_and_record_hit (migration 163). Sends no
// text, email or call. All the rules live in core.ts; this wires the database.
import { createClient } from 'npm:@supabase/supabase-js'
import { checkAndRecord } from '../_shared/ipLimit.ts'
import { clientIp, handle, type Deps } from './core.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

const deps: Deps = {
  async countPhone(phone, since) {
    const { count, error } = await db.from('mp_leads').select('id', { count: 'exact', head: true })
      .eq('phone', phone).gte('created_at', since)
    if (error) throw error
    return count ?? 0
  },
  async insertLead(row) {
    const { data, error } = await db.from('mp_leads').insert(row).select('id').single()
    if (error) throw error
    return data.id
  },
  async assign(leadId) {
    const { error } = await db.rpc('assign_mp_lead', { p_lead_id: leadId })
    if (error) throw error
  },
  checkAndRecord: (key, limit, windowMs) => checkAndRecord(db, key, limit, windowMs),
  now: () => new Date(),
  log: m => console.error('[submit-mp-lead]', m),
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  let body: unknown
  try { body = await req.json() } catch { return json({ error: 'Invalid request body' }, 400) }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ error: 'Invalid request body' }, 400)
  try {
    const r = await handle(deps, body as Record<string, unknown>, clientIp(req.headers))
    return json(r.body, r.status)
  } catch (err) {
    // Error text only: never the phone, name or IP.
    console.error('[submit-mp-lead]', err instanceof Error ? err.message : String(err))
    return json({ error: 'Something went wrong. Try again.' }, 500)
  }
})
