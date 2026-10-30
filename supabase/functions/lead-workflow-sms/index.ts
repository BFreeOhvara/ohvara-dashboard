// lead-workflow-sms — the Booked Appointments texts to a mortgage_protection
// lead: welcome, not-reached follow-ups (day 0/1/3/7, then monthly),
// confirmation and reminders once booked, a rebook text after a no-show.
//
//   POST { action: 'plan', lead_id }  → { planned: ['step:seq', ...], stopped }
//        schedules the lead's steps as inbound_events rows (once each)
//   POST { action: 'tick' }           → { sent, skipped, moved, stopped, failed }
//        runs every scheduled step that is due
//   (service-role bearer or the cron secret; nothing else)
//
// Same gate as recovery-sms: while recovery_config.sms_live is off nothing is
// sent and each step is marked skipped (detail.reason 'sms_off'). Every text
// goes from recovery_config.sms_from_number, the one central Ohvara number;
// null means nothing is sent ('no_sender'). Opt-outs are sms_is_opted_out
// (157). The texts are DRAFTS (templates.ts), not registered with A2P, and
// each still holds the opt-out placeholder, which core.ts refuses to send.
// Nothing calls this yet: no cron, no trigger. Rules live in core.ts.
import { createClient } from 'npm:@supabase/supabase-js'
import { isCron } from '../_shared/cronAuth.ts'
import { handle, type Deps, type Event } from './core.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

const SID = Deno.env.get('RECOVERY_TWILIO_ACCOUNT_SID') ?? Deno.env.get('CALLER_ID_TWILIO_ACCOUNT_SID')
const TOKEN = Deno.env.get('RECOVERY_TWILIO_AUTH_TOKEN') ?? Deno.env.get('CALLER_ID_TWILIO_AUTH_TOKEN')
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
// The service role has no auth.uid(), so 151's block_inactive_writer lets
// these inbound_events writes through.
const db = createClient(Deno.env.get('SUPABASE_URL')!, SERVICE_KEY)

const deps: Deps = {
  async smsLive() {
    const { data, error } = await db.from('recovery_config').select('sms_live').maybeSingle()
    if (error) throw error
    return !!data?.sms_live
  },
  async centralNumber() {
    const { data, error } = await db.from('recovery_config').select('sms_from_number').maybeSingle()
    if (error) throw error
    return data?.sms_from_number ?? null
  },
  async getLead(id) {
    const { data, error } = await db.from('leads')
      .select('id, lead_type, inbound_stage, phone, contact_name, state, assigned_rep_id, agent:profiles!leads_assigned_rep_id_fkey(full_name)')
      .eq('id', id).maybeSingle()
    if (error) throw error
    if (!data) return null
    const agent = Array.isArray(data.agent) ? data.agent[0] : data.agent
    return {
      id: data.id, lead_type: data.lead_type, inbound_stage: data.inbound_stage, phone: data.phone,
      contact_name: data.contact_name, state: data.state, agent_id: data.assigned_rep_id,
      agent_name: agent?.full_name ?? null,
    }
  },
  async events(leadId) {
    const { data, error } = await db.from('inbound_events')
      .select('id, lead_id, kind, state, at, detail, created_at')
      .eq('lead_id', leadId).order('at')
    if (error) throw error
    return (data ?? []) as Event[]
  },
  async replied(leadId) {
    const { data, error } = await db.from('lead_sms_replies').select('id').eq('lead_id', leadId).limit(1)
    // lead_sms_replies (NNN_lead_sms_replies) may not be applied yet.
    if (error) {
      if (error.code === '42P01' || error.code === 'PGRST205') return false
      throw error
    }
    return (data ?? []).length > 0
  },
  async optedOut(phone) {
    const { data, error } = await db.rpc('sms_is_opted_out', { p_phone: phone })
    if (error) throw error
    return !!data
  },
  async leadsWithScheduled() {
    const { data, error } = await db.from('inbound_events').select('lead_id')
      .eq('state', 'scheduled').not('detail->>step', 'is', null)
      .order('at').limit(2000)
    if (error) throw error
    return [...new Set((data ?? []).map((r: { lead_id: string }) => r.lead_id))]
  },
  async insert(row) {
    const { error } = await db.from('inbound_events').insert(row)
    if (!error) return true
    if (error.code === '23505') return false   // inbound_events_step_uidx: already planned or sent
    throw error
  },
  async update(id, patch, from) {
    const { data, error } = await db.from('inbound_events').update(patch)
      .eq('id', id).eq('state', from).select('id')
    if (error) throw error
    return (data ?? []).length > 0
  },
  async send(to, body, from) {
    if (!(SID && TOKEN)) return { ok: false, error: 'sender not configured' }
    // From is always the central number core.ts passes in (sms_from_number).
    const params = new URLSearchParams({ To: to, From: from, Body: body })
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${SID}/Messages.json`, {
      method: 'POST',
      headers: { Authorization: `Basic ${btoa(`${SID}:${TOKEN}`)}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params,
    })
    const data = await res.json().catch(() => ({}))
    // Status + Twilio's code only; the message can quote the number.
    if (!res.ok) return { ok: false, error: `${res.status} ${data?.code ?? ''}`.trim() }
    return { ok: true, sid: data.sid }
  },
  now: () => new Date(),
  rescheduleUrl: Deno.env.get('LEAD_RESCHEDULE_URL') || null,
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
    // Database and Twilio errors only; nothing here carries a phone number.
    console.error('[lead-workflow-sms]', err instanceof Error ? err.message : String(err))
    return json({ error: 'Something went wrong' }, 500)
  }
})
