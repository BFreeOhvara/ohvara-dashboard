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
import { handle, type Store, type RouteStore } from './core.ts'
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
  async logMissedTransfer(callSid) {
    const { error } = await admin.rpc('log_missed_transfer', { p_call_sid: callSid })
    if (error) throw error
  },
}

// P882 — routing: one VA at a time through call_queue (SQL), after-hours greeting, rescue, the sweep's timeout.
const rpc = async (fn: string, args: Record<string, unknown>) => {
  const { data, error } = await admin.rpc(fn, args)
  if (error) throw new Error(error.message)
  return data
}
const route: RouteStore = {
  deskOpen: async () => !!(await rpc('route_desk_open', {})),
  async afterHoursText() {
    const { data } = await admin.from('recovery_config').select('after_hours_text').limit(1).maybeSingle()
    return data?.after_hours_text ?? null
  },
  routeInbound: async (callSid, caller) => (await rpc('route_inbound', { p_call_sid: callSid, p_caller: caller })) ?? { queue_id: null },
  afterHoursCall: async (callSid, caller) => { await rpc('route_after_hours_call', { p_call_sid: callSid, p_caller: caller }) },
  inboundGone: async callSid => { await rpc('route_inbound_gone', { p_call_sid: callSid }) },
  async vaLeftLine(callSid, vaLegSid) {
    const { data } = await admin.from('va_lines').select('id').eq('help_call_sid', callSid).neq('status', 'ended')
      .order('created_at', { ascending: false }).limit(1).maybeSingle()
    return data?.id ? !!(await rpc('line_va_left', { p_line: data.id, p_call_sid: vaLegSid })) : false
  },
  async isCron(secret) {
    const { data } = await admin.rpc('fulfillment_cron_ok', { p_secret: secret })
    return data === true
  },
}

Deno.serve(req => handle(req, store, SID && TOKEN ? twilioClient(SID, TOKEN) : null, {
  authToken: TOKEN,
  publicUrl: `${SUPABASE_URL}/functions/v1/help-voice`,
  trackingNumber: Deno.env.get('HELP_TRACKING_NUMBER') ?? null,
}, route))
