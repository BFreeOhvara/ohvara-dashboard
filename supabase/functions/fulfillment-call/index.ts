// fulfillment-call — Prompt 751, the pop-up phone's buttons (ring the client,
// ring the carrier, hold, swap, merge, keypad, end). The logic is core.ts;
// this file wires Deno: secrets, the service-role store and Twilio's REST API.
//
// Deploy WITH jwt verification (called by a signed-in rep):
//   npx.cmd supabase functions deploy fulfillment-call --project-ref jjextitmbptoaolacocs
//
// Secrets: CALLER_ID_TWILIO_ACCOUNT_SID, CALLER_ID_TWILIO_AUTH_TOKEN,
// CALLER_ID_TWILIO_FROM_NUMBER (Ohvara's number; the same ones
// start-agent-caller-id-call uses).
import { createClient } from 'npm:@supabase/supabase-js'
import { handle, type Store, type Twilio } from './core.ts'

const SID = Deno.env.get('CALLER_ID_TWILIO_ACCOUNT_SID')
const TOKEN = Deno.env.get('CALLER_ID_TWILIO_AUTH_TOKEN')
const FROM = Deno.env.get('CALLER_ID_TWILIO_FROM_NUMBER') || null
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!

const admin = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

const store: Store = {
  async userFromJwt(jwt) {
    const { data } = await admin.auth.getUser(jwt)
    return data.user?.id ?? null
  },
  async role(id) {
    const { data } = await admin.from('profiles').select('role').eq('id', id).maybeSingle()
    return data?.role ?? null
  },
  async policy(id) {
    const { data } = await admin.from('policies')
      .select('id, agent_id, client_phone, fulfillment_assigned, assigned_fulfillment_id, fulfillment_stage, carrier_id, is_demo')
      .eq('id', id).maybeSingle()
    return data
  },
  async agentCallerId(agentId) {
    const { data } = await admin.from('profiles').select('caller_id_number, caller_id_enabled').eq('id', agentId).maybeSingle()
    return data
  },
  async carrierPhone(carrierId) {
    if (!carrierId) return null
    const { data } = await admin.from('carriers').select('service_phone').eq('id', carrierId).maybeSingle()
    return data?.service_phone ?? null
  },
  async voiceLive() {
    const { data } = await admin.from('recovery_config').select('voice_live').limit(1).maybeSingle()
    return !!data?.voice_live
  },
  async openLegs(policyId) {
    const { data } = await admin.from('fulfillment_voice_legs')
      .select('call_sid, policy_id, conference_sid, party, status, on_hold')
      .eq('policy_id', policyId).neq('status', 'ended')
    return data ?? []
  },
  async saveLeg(leg) {
    const now = new Date().toISOString()
    const row: Record<string, unknown> = { ...leg, updated_at: now }
    if (leg.on_hold === true) row.hold_since = now
    if (leg.on_hold === false) row.hold_since = null
    if (leg.status === 'ended') row.ended_at = now
    // A new leg carries policy_id + party (insert); a patch only updates.
    // Twilio's own callback can land first, so a new leg never overwrites one.
    const q = leg.policy_id
      ? admin.from('fulfillment_voice_legs').upsert(row, { onConflict: 'call_sid', ignoreDuplicates: true })
      : admin.from('fulfillment_voice_legs').update(row).eq('call_sid', leg.call_sid)
    const { error } = await q
    if (error) throw error
  },
}

const twilio: Twilio = async (method, path, params) => {
  const body = new URLSearchParams()
  for (const [k, v] of Object.entries(params ?? {})) for (const one of [v].flat()) body.append(k, one)
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${SID}${path}`, {
    method,
    headers: {
      Authorization: `Basic ${btoa(`${SID}:${TOKEN}`)}`,
      ...(method === 'POST' ? { 'Content-Type': 'application/x-www-form-urlencoded' } : null),
    },
    body: method === 'POST' ? body : undefined,
  })
  const data = res.status === 204 ? {} : await res.json().catch(() => ({}))
  return { status: res.status, data }
}

Deno.serve(req => handle(req, store, twilio, {
  from: FROM,
  voiceUrl: `${SUPABASE_URL}/functions/v1/fulfillment-voice`,
  configured: !!(SID && TOKEN),
}))
