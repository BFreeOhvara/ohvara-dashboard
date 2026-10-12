// fulfillment-voice — Prompt 751, Twilio's webhook for the pop-up phone: the
// TwiML App's Voice URL (the rep's browser joins the call's conference) and
// the status callbacks that keep fulfillment_voice_legs current. The logic is
// core.ts; this file wires Deno.
//
// Deploy WITHOUT jwt verification (Twilio calls it; core.ts checks the
// X-Twilio-Signature on every request):
//   npx.cmd supabase functions deploy fulfillment-voice --no-verify-jwt --project-ref jjextitmbptoaolacocs
//
// Secrets: CALLER_ID_TWILIO_AUTH_TOKEN (signs Twilio's requests).
// The TwiML App's Voice URL = https://jjextitmbptoaolacocs.supabase.co/functions/v1/fulfillment-voice
import { createClient } from 'npm:@supabase/supabase-js'
import { handle, type Store } from './core.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const admin = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

const legs = () => admin.from('fulfillment_voice_legs')

const store: Store = {
  async role(id) {
    const { data } = await admin.from('profiles').select('role').eq('id', id).maybeSingle()
    return data?.role ?? null
  },
  async policy(id) {
    const { data } = await admin.from('policies')
      .select('id, fulfillment_assigned, assigned_fulfillment_id, fulfillment_stage')
      .eq('id', id).maybeSingle()
    return data
  },
  async voiceLive() {
    const { data } = await admin.from('recovery_config').select('voice_live').limit(1).maybeSingle()
    return !!data?.voice_live
  },
  async saveLeg({ answered, ...patch }) {
    const now = new Date().toISOString()
    const row: Record<string, unknown> = { ...patch, updated_at: now }
    if (patch.status === 'ended') { row.ended_at = now; row.hold_since = null }
    // An ended leg stays ended (callbacks can arrive out of order).
    const { data: had } = await legs().select('status, answered_at').eq('call_sid', patch.call_sid).maybeSingle()
    if (had?.status === 'ended') return
    if (answered && !had?.answered_at) row.answered_at = now
    const { error } = had
      ? await legs().update(row).eq('call_sid', patch.call_sid)
      : await legs().insert(row)
    if (error) throw error
  },
  async setHold(callSid, hold) {
    const now = new Date().toISOString()
    await legs().update({ on_hold: hold, hold_since: hold ? now : null, updated_at: now })
      .eq('call_sid', callSid).neq('status', 'ended').neq('on_hold', hold)
  },
  async endLegs(policyId, reason) {
    const now = new Date().toISOString()
    await legs().update({ status: 'ended', on_hold: false, hold_since: null, ended_at: now, end_reason: reason, updated_at: now })
      .eq('policy_id', policyId).neq('status', 'ended')
  },
}

Deno.serve(req => handle(req, store, {
  authToken: Deno.env.get('CALLER_ID_TWILIO_AUTH_TOKEN') ?? null,
  publicUrl: `${SUPABASE_URL}/functions/v1/fulfillment-voice`,
}))
