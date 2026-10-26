// lead-intake — public intake for the Meta mortgage-protection qualifier. No login.
//
// Contract (from the brief):
//   POST { first_name, phone, state, age_range, mortgage_balance_range,
//          homeowner: boolean, best_time, consent_checked: boolean,
//          utm: { source, campaign, ad } }
//     → { ok: true, lead_id }          stored (or the same phone's lead from the last 24h)
//     → { ok: false, error } 400       a field is missing or wrong, or consent_checked isn't true
//     → { ok: false, error } 429       too many tries from this IP or phone
//   Phone is normalised to US E.164. The lead goes into leads as
//   lead_type 'mortgage_protection', lead_source 'meta', with qualifier_answers,
//   and gets delivered_at once an agent has it.
//   No texting here; that is a separate function.
//
// Deployed with verify_jwt OFF (a public form; deploying is a manual step):
//   supabase functions deploy lead-intake --no-verify-jwt --project-ref jjextitmbptoaolacocs
//
// Needs leads.lead_type / lead_source / qualifier_answers / delivered_at
// (migration 161_lead_types_delivery). Assignment is not wired yet: leads are
// saved unassigned, and delivered_at (when an agent gets the lead) is set once
// assign_lead (migration 164) exists. All the rules live in core.ts; this wires
// the database with the service role. No credentials in code: env only.
import { createClient } from 'npm:@supabase/supabase-js'
import { clientIp, handle, Limiter, type Deps } from './core.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
const limiter = new Limiter()

const deps: Deps = {
  async findRecent(phone, since) {
    const { data, error } = await db.from('leads').select('id')
      .eq('lead_type', 'mortgage_protection').eq('phone', phone).gte('created_at', since)
      .order('created_at', { ascending: false }).limit(1).maybeSingle()
    if (error) throw error
    return data?.id ?? null
  },
  async insertLead(row) {
    const { data, error } = await db.from('leads').insert(row).select('id').single()
    if (error) throw error
    return data.id
  },
  // No assignment yet: leads stay unassigned (and undelivered) until
  // assign_lead(p_lead_id) lands in migration 164. Then this becomes:
  //   const { data, error } = await db.rpc('assign_lead', { p_lead_id: leadId })
  async assign(_leadId) {
    return null
  },
  async markDelivered(leadId, at) {
    const { error } = await db.from('leads').update({ delivered_at: at })
      .eq('id', leadId).is('delivered_at', null)
    if (error) throw error
  },
  async overLimit(key, limit, windowMs) {
    return limiter.over(key, limit, windowMs, Date.now())
  },
  now: () => new Date(),
  log: m => console.error('[lead-intake]', m),
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ ok: false, error: 'POST only' }, 405)
  let body: unknown
  try { body = await req.json() } catch { return json({ ok: false, error: 'Invalid request body' }, 400) }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ ok: false, error: 'Invalid request body' }, 400)
  try {
    const r = await handle(deps, body as Record<string, unknown>, clientIp(req.headers))
    return json(r.body, r.status)
  } catch (err) {
    // Error text only: never the phone, name or IP.
    console.error('[lead-intake]', err instanceof Error ? err.message : String(err))
    return json({ ok: false, error: 'Something went wrong. Try again.' }, 500)
  }
})
