// fulfillment-call — Prompt 751, the pop-up phone's buttons (ring the client,
// ring the carrier, hold, swap, merge, keypad, end). P882: every call type
// through lines.ts ({ line_id }), and the sweep's end_line (x-ohvara-cron). The logic is core.ts;
// this file wires Deno: secrets, the service-role store and Twilio's REST API.
//
// Deploy WITH jwt verification (called by a signed-in rep):
//   npx.cmd supabase functions deploy fulfillment-call --project-ref jjextitmbptoaolacocs
//
// Secrets: CALLER_ID_TWILIO_ACCOUNT_SID, CALLER_ID_TWILIO_AUTH_TOKEN,
// CALLER_ID_TWILIO_FROM_NUMBER (Ohvara's old single number: carriers, and the
// fallback while the Deedstone pool is empty).
// P916: calls about an agent's lead or client go out from the agent's Deedstone
// number (deedstone_from); agents call through Deedstone ({ action: 'agent_*' },
// agentCall.ts), and help-voice runs that call's TwiML.
import { createClient } from 'npm:@supabase/supabase-js'
import { handle, type Store, type Twilio } from './core.ts'
import type { LineStore } from './lines.ts'
import type { AgentStore } from './agentCall.ts'

const SID = Deno.env.get('CALLER_ID_TWILIO_ACCOUNT_SID')
const TOKEN = Deno.env.get('CALLER_ID_TWILIO_AUTH_TOKEN')
const FROM = Deno.env.get('CALLER_ID_TWILIO_FROM_NUMBER') || null
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!

const admin = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

// P916: the agent's Deedstone number (assigned the first time, kept); kind logs one outbound call on it.
async function deedstoneFrom(agentId: string, kind: string | null, ref: string): Promise<string | null> {
  const { data, error } = await admin.rpc('deedstone_from', { p_agent: agentId, p_kind: kind, p_ref: ref })
  if (error) { console.error('deedstone_from', error.message); return null }
  return (data as { phone?: string } | null)?.phone ?? null
}

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
  deedstoneFrom,
}

// P882 — the line path (every call type). Service role; the SQL functions check the task rule and the routing.
const rpc = async (fn: string, args: Record<string, unknown>) => {
  const { data, error } = await admin.rpc(fn, args)
  if (error) throw new Error(error.message)
  return data
}
const lineStore: LineStore = {
  role: store.role,
  voiceLive: store.voiceLive,
  carrierPhone: store.carrierPhone,
  async line(id) {
    const { data } = await admin.from('va_lines')
      .select('id, kind, conference, lead_id, policy_id, help_call_sid, va_id, va_call_sid, status').eq('id', id).maybeSingle()
    return data
  },
  async lead(id) {
    const { data } = await admin.from('leads').select('id, phone, state, assigned_rep_id').eq('id', id).maybeSingle()
    return data
  },
  async policyRow(id) {
    const { data } = await admin.from('policies').select('id, agent_id, client_phone, carrier_id, state, is_demo').eq('id', id).maybeSingle()
    return data
  },
  async agentPhone(agentId) {
    const { data } = await admin.from('profiles').select('phone').eq('id', agentId).maybeSingle()
    return data?.phone ?? null
  },
  async voicemailText() {
    const { data } = await admin.from('recovery_config').select('voicemail_text').limit(1).maybeSingle()
    return data?.voicemail_text ?? null
  },
  async lineLegs(lineId) {
    const { data } = await admin.from('fulfillment_voice_legs')
      .select('call_sid, line_id, conference_sid, party, status, on_hold').eq('line_id', lineId).neq('status', 'ended')
    return data ?? []
  },
  async saveLineLeg(leg) {
    const now = new Date().toISOString()
    const row: Record<string, unknown> = { ...leg, updated_at: now }
    if (leg.on_hold === true) row.hold_since = now
    if (leg.on_hold === false) row.hold_since = null
    if (leg.status === 'ended') row.ended_at = now
    const q = leg.line_id
      ? admin.from('fulfillment_voice_legs').upsert(row, { onConflict: 'call_sid', ignoreDuplicates: true })
      : admin.from('fulfillment_voice_legs').update(row).eq('call_sid', leg.call_sid)
    const { error } = await q
    if (error) throw error
  },
  lineOpen: (va, leadId, policyId) => rpc('line_open', { p_va: va, p_lead: leadId, p_policy: policyId, p_kind: null }),
  lineEnded: async (lineId, reason) => { await rpc('line_ended', { p_line: lineId, p_reason: reason }) },
  lineHoldState: async lineId => { await rpc('line_hold_state', { p_line: lineId }) },
  lineHandoff: (lineId, va, detail) => rpc('line_handoff', { p_line: lineId, p_va: va, p_detail: detail }),
  lineRequeue: async lineId => { await rpc('line_requeue', { p_line: lineId }) },
  async predial(phone, state, leadId, policyId) {
    const rows = await rpc('predial_check', { p_phone: phone, p_state: state, p_lead: leadId, p_channel: 'call', p_policy: policyId })
    const r = Array.isArray(rows) ? rows[0] : rows
    return { ok: !!r?.ok, reason: r?.reason ?? null, next_at: r?.next_at ?? null }
  },
  logAttempt: async (phone, leadId, policyId, lineId, va) => {
    await rpc('predial_log_attempt', { p_phone: phone, p_lead: leadId, p_policy: policyId, p_line: lineId, p_va: va })
  },
  async endHelpCall(callSid, reason) {
    await admin.from('help_calls').update({ status: 'ended', end_reason: reason, ended_at: new Date().toISOString() })
      .eq('call_sid', callSid).neq('status', 'ended')
  },
  deedstoneFrom,
}

// P916 — an agent's Call through Deedstone, and the phone code call.
const agentStore: AgentStore = {
  role: store.role,
  voiceLive: store.voiceLive,
  callBegin: async (agentId, leadId, policyId) => await rpc('deedstone_call_begin', { p_agent: agentId, p_lead: leadId, p_policy: policyId }),
  async agentCall(id) {
    const { data } = await admin.from('deedstone_calls').select('id, agent_id, agent_call_sid, status').eq('id', id).maybeSingle()
    return data
  },
  async saveAgentCall(id, patch) {
    const { error } = await admin.from('deedstone_calls').update(patch).eq('id', id)
    if (error) throw error
  },
  codeBegin: async (agentId, phone) => String(await rpc('deedstone_code_begin', { p_agent: agentId, p_phone: phone })),
  numberFor: agentId => deedstoneFrom(agentId, null, 'code'),
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
  holdUrl: `${SUPABASE_URL}/functions/v1/help-voice?event=music`,   // P932: our hold music on a merge-call hold
  configured: !!(SID && TOKEN),
}, {
  store: lineStore,
  async isCron(secret) {
    const { data } = await admin.rpc('fulfillment_cron_ok', { p_secret: secret })
    return data === true
  },
}, {
  store: agentStore,
  env: { from: FROM, helpUrl: `${SUPABASE_URL}/functions/v1/help-voice`, configured: !!(SID && TOKEN) },
}))
