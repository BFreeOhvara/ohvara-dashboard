// lead-followup-sms — the instant first text to a new mortgage_protection lead.
//
//   POST { lead_id }  (service-role bearer or the cron secret; nothing else)
//     → { status } one of: sent, failed, skipped_gate, skipped_opt_out,
//       skipped_no_phone, skipped_no_agent, skipped_no_link, skipped_not_mp
//
// Same gate as recovery-sms: while recovery_config.sms_live is off nothing is
// sent and the attempt is logged as skipped_gate (lead_followup_sms_log,
// migration 163). Opt-outs (sms_opt_outs, 157) are honored. The booking link
// comes from LEAD_BOOKING_URL and the agent name from the lead's assigned
// agent; the template holds no agent data. Rules live in core.ts.
import { createClient } from 'npm:@supabase/supabase-js'
import { isCron } from '../_shared/cronAuth.ts'
import { handle, type Deps } from './core.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

const SID = Deno.env.get('RECOVERY_TWILIO_ACCOUNT_SID') ?? Deno.env.get('CALLER_ID_TWILIO_ACCOUNT_SID')
const TOKEN = Deno.env.get('RECOVERY_TWILIO_AUTH_TOKEN') ?? Deno.env.get('CALLER_ID_TWILIO_AUTH_TOKEN')
const SERVICE = Deno.env.get('TWILIO_MESSAGING_SERVICE_SID')
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const db = createClient(Deno.env.get('SUPABASE_URL')!, SERVICE_KEY)

const deps: Deps = {
  async smsLive() {
    const { data, error } = await db.from('recovery_config').select('sms_live').maybeSingle()
    if (error) throw error
    return !!data?.sms_live
  },
  async getLead(id) {
    const { data, error } = await db.from('leads')
      .select('id, lead_type, phone, contact_name, agent:profiles!leads_assigned_rep_id_fkey(full_name)')
      .eq('id', id).maybeSingle()
    if (error) throw error
    if (!data) return null
    const agent = Array.isArray(data.agent) ? data.agent[0] : data.agent
    return { id: data.id, lead_type: data.lead_type, phone: data.phone, contact_name: data.contact_name, agent_name: agent?.full_name ?? null }
  },
  async optedOut(phone) {
    const { data, error } = await db.rpc('sms_is_opted_out', { p_phone: phone })
    if (error) throw error
    return !!data
  },
  async alreadySent(leadId) {
    const { count, error } = await db.from('lead_followup_sms_log').select('id', { count: 'exact', head: true })
      .eq('lead_id', leadId).eq('status', 'sent')
    if (error) throw error
    return (count ?? 0) > 0
  },
  bookingLink: Deno.env.get('LEAD_BOOKING_URL') || null,
  async send(to, body) {
    if (!(SID && TOKEN && SERVICE)) return { ok: false, error: 'sender not configured' }
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${SID}/Messages.json`, {
      method: 'POST',
      headers: { Authorization: `Basic ${btoa(`${SID}:${TOKEN}`)}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ To: to, MessagingServiceSid: SERVICE, Body: body }),
    })
    const data = await res.json().catch(() => ({}))
    // Status + Twilio's code only; the message can quote the number.
    if (!res.ok) return { ok: false, error: `${res.status} ${data?.code ?? ''}`.trim() }
    return { ok: true, sid: data.sid }
  },
  async log(row) {
    const { error } = await db.from('lead_followup_sms_log').insert(row)
    if (error) console.error('[lead-followup-sms] log', error.message)
  },
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const bearer = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
  if (!(bearer === SERVICE_KEY || await isCron(req, db))) return json({ error: 'Unauthorized' }, 401)
  let body: unknown
  try { body = await req.json() } catch { return json({ error: 'Invalid request body' }, 400) }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ error: 'Invalid request body' }, 400)
  try {
    const r = await handle(deps, body as Record<string, unknown>)
    return json(r.body, r.status)
  } catch (err) {
    console.error('[lead-followup-sms]', err instanceof Error ? err.message : String(err))
    return json({ error: 'Something went wrong' }, 500)
  }
})
