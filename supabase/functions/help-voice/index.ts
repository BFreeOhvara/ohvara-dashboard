// help-voice — Roadmap Goal 9, Twilio's webhook for the tracking number: a
// caller waits in a conference while the VAs' browser phones ring, and the
// first VA to answer joins. The logic is core.ts; this file wires Deno.
//
// Deploy WITHOUT jwt verification (Twilio calls it; core.ts checks the
// X-Twilio-Signature on every request):
//   npx.cmd supabase functions deploy help-voice --no-verify-jwt --project-ref jjextitmbptoaolacocs
//
// Secrets: CALLER_ID_TWILIO_AUTH_TOKEN (signs Twilio's requests),
// CALLER_ID_TWILIO_ACCOUNT_SID (rings the VAs), HELP_TRACKING_NUMBER (the
// tracking number, read-only: the VA legs' From).
// The tracking number's Voice URL = https://jjextitmbptoaolacocs.supabase.co/functions/v1/help-voice
import { createClient } from 'npm:@supabase/supabase-js'
import { handle, type Store } from './core.ts'
import { twilioClient } from '../_shared/twilio.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const admin = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

const calls = () => admin.from('help_calls')
const SID = Deno.env.get('CALLER_ID_TWILIO_ACCOUNT_SID')
const TOKEN = Deno.env.get('CALLER_ID_TWILIO_AUTH_TOKEN') ?? null

const store: Store = {
  async voiceLive() {
    const { data } = await admin.from('recovery_config').select('voice_live').limit(1).maybeSingle()
    return !!data?.voice_live
  },
  async activeVas() {
    const { data, error } = await admin.from('profiles').select('id')
      .eq('role', 'fulfillment').eq('is_active', true).or('is_demo.is.null,is_demo.eq.false')
    if (error) throw error
    return (data ?? []).map(p => p.id)
  },
  async insertHelpCall(row) {
    const { data, error } = await calls().upsert(row, { onConflict: 'call_sid', ignoreDuplicates: true }).select('call_sid')
    if (error) throw error
    return (data ?? []).length > 0
  },
  async helpCall(callSid) {
    const { data } = await calls().select('*').eq('call_sid', callSid).maybeSingle()
    return data
  },
  async claimHelpCall(callSid, vaId, vaCallSid) {
    const { data, error } = await calls()
      .update({ status: 'live', va_id: vaId, va_call_sid: vaCallSid, answered_at: new Date().toISOString() })
      .eq('call_sid', callSid).eq('status', 'ringing').select('*').maybeSingle()
    if (error) throw error
    return data
  },
  async updateHelpCall(callSid, patch, whenStatus) {
    let q = calls().update(patch).eq('call_sid', callSid)
    if (whenStatus) q = q.in('status', whenStatus)
    const { data, error } = await q.select('*').maybeSingle()
    if (error) throw error
    return data
  },
  async setLeadTransferStatus(leadId, status) {
    const { error } = await admin.from('leads').update({ transfer_status: status }).eq('id', leadId)
    if (error) throw error
  },
}

Deno.serve(req => handle(req, store, SID && TOKEN ? twilioClient(SID, TOKEN) : null, {
  authToken: TOKEN,
  publicUrl: `${SUPABASE_URL}/functions/v1/help-voice`,
  trackingNumber: Deno.env.get('HELP_TRACKING_NUMBER') ?? null,
}))
