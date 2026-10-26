// submit-mp-lead — the public mortgage-protection lead form (Meta qualifier). No login.
//
// Deployed with verify_jwt OFF (a public form; deploying is a manual step):
//   supabase functions deploy submit-mp-lead --no-verify-jwt --project-ref jjextitmbptoaolacocs
//
// Contract (from the lead-intake brief):
//   POST { first_name, phone, state, age_range, mortgage_balance_range,
//          homeowner: boolean, best_time, consent_checked: boolean,
//          utm: { source, campaign, ad } }
//     → { ok: true, lead_id }      stored, or the same phone's existing lead
//     → { ok: false, error } 400   a field is missing or wrong, or no consent
//   Phone is normalised to US E.164, the same phone is deduped, the lead is
//   assigned. No texting here.
//
// How that lands here (the names the live form, MortgageProtection.jsx, sends):
//   age_range → age_band, mortgage_balance_range → mortgage_balance_band,
//   consent_checked → consent: true (+ consent_text_version), utm.source /
//   campaign / ad → utm_source / utm_campaign / utm_content. Also last_name?,
//   email?, smoker and website (honeypot, leave empty). Phone may be loose,
//   e.g. "(512) 555-0123". The dedupe window is 30 days, not 24h: no second
//   row means no second charge. A rate-limited or honeypot post also gets
//   { ok: true, lead_id }, with an id that matches no row.
//
// Needs mp_leads (161_mp_leads) and assign_mp_lead (162_agent_balance_ledger);
// prepaid charging is 169_prepaid_lead_balance. The rate limit is in memory
// for now; _shared/ipLimit.ts on public_form_attempts (164) is the lasting one.
// None of these migrations is on master yet. Sends no text, email or call. All
// the rules live in core.ts; this wires the database.
import { createClient } from 'npm:@supabase/supabase-js'
import { clientIp, handle, Limiter, type Deps } from './core.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

const deps: Deps = {
  async findRecent(phone, since) {
    const { data, error } = await db.from('mp_leads').select('id')
      .eq('phone', phone).gte('created_at', since)
      .order('created_at', { ascending: false }).limit(1).maybeSingle()
    if (error) throw error
    return data?.id ?? null
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
  limiter: new Limiter(),
  now: () => new Date(),
  log: m => console.error('[submit-mp-lead]', m),
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
    console.error('[submit-mp-lead]', err instanceof Error ? err.message : String(err))
    return json({ ok: false, error: 'Something went wrong. Try again.' }, 500)
  }
})
