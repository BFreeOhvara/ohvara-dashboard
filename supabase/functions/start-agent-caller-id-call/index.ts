import { createClient } from 'npm:@supabase/supabase-js'

// Prompt 666 — Fulfillment's "Call client": a two-leg Twilio call. Twilio
// rings the Fulfillment rep at their own number on file, then dials the client
// with the *agent's* verified number as Caller ID, so the client sees a number
// they already know from the sales call. The rep calls on the agent's behalf
// and never claims to be them — the whisper below and the work view both say so.
//
// Leg 1 (to the rep) needs a Twilio-owned "From" number:
// CALLER_ID_TWILIO_FROM_NUMBER. Until one is bought this returns
// code 'no_from_number' and the UI keeps the plain tel: link.
//
// POST JSON { policy_id } → { call_sid }
// Error codes the UI acts on: not_configured, no_from_number, caller_id_off,
// no_rep_phone, no_client_phone.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

const SID = Deno.env.get('CALLER_ID_TWILIO_ACCOUNT_SID')
const TOKEN = Deno.env.get('CALLER_ID_TWILIO_AUTH_TOKEN')
const FROM = Deno.env.get('CALLER_ID_TWILIO_FROM_NUMBER')

function toE164(raw: unknown): string | null {
  const d = String(raw ?? '').replace(/\D/g, '')
  if (d.length === 10) return `+1${d}`
  if (d.length === 11 && d.startsWith('1')) return `+${d}`
  return null
}

const xml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer /, '')
  const { data: { user } } = await admin.auth.getUser(jwt)
  if (!user) return json({ error: 'Not signed in' }, 401)

  const { data: me } = await admin.from('profiles').select('id, role, phone').eq('id', user.id).single()
  if (!me || !['fulfillment', 'admin'].includes(me.role)) return json({ error: 'Fulfillment only' }, 403)

  let body: any = {}
  try { body = await req.json() } catch { /* empty body */ }
  if (!body.policy_id) return json({ error: 'policy_id required' }, 400)

  const { data: p } = await admin
    .from('policies')
    .select('id, agent_id, client_first_name, client_phone, fulfillment_assigned, assigned_fulfillment_id')
    .eq('id', body.policy_id)
    .single()
  if (!p || !p.fulfillment_assigned) return json({ error: 'Cancellation not found' }, 404)
  if (me.role !== 'admin' && p.assigned_fulfillment_id !== me.id) {
    return json({ error: 'Claim this cancellation before calling the client.' }, 403)
  }

  const { data: agent } = await admin
    .from('profiles')
    .select('full_name, caller_id_number, caller_id_enabled')
    .eq('id', p.agent_id)
    .single()
  if (!agent?.caller_id_number || !agent.caller_id_enabled) {
    return json({ error: 'The agent\'s number isn\'t available for this call.', code: 'caller_id_off' }, 409)
  }

  if (!SID || !TOKEN) return json({ error: 'Calling isn\'t set up yet.', code: 'not_configured' }, 503)
  if (!FROM) return json({ error: 'No Twilio number to place calls from yet.', code: 'no_from_number' }, 503)

  const repPhone = toE164(me.phone)
  if (!repPhone) {
    return json({ error: 'Add your own phone number on your Profile — that\'s the phone we ring first.', code: 'no_rep_phone' }, 400)
  }
  const clientPhone = toE164(p.client_phone)
  if (!clientPhone) return json({ error: 'No valid client phone on file.', code: 'no_client_phone' }, 400)

  const agentName = (agent.full_name || 'the agent').split(' ')[0]
  const clientName = p.client_first_name || 'the client'
  const twiml =
    `<Response>` +
    `<Say>Connecting you to ${xml(clientName)}. You are calling on behalf of ${xml(agentName)}. Never say you are ${xml(agentName)}.</Say>` +
    `<Dial callerId="${agent.caller_id_number}" timeout="30"><Number>${clientPhone}</Number></Dial>` +
    `</Response>`

  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${SID}/Calls.json`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${btoa(`${SID}:${TOKEN}`)}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ To: repPhone, From: FROM, Twiml: twiml, Timeout: '25' }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) return json({ error: data?.message || `Twilio refused the call (${res.status})` }, 502)

  return json({ call_sid: data.sid })
})
