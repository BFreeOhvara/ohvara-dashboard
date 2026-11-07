// fulfillment-voice — Prompt 751, Twilio's webhook for the pop-up phone: the
// TwiML App's Voice URL (the rep's browser joins the call's conference) and
// the status callbacks that keep fulfillment_voice_legs current. The logic is
// core.ts; this file wires Deno.
//
// Deploy WITHOUT jwt verification (Twilio calls it; core.ts checks the
// X-Twilio-Signature on every request):
//   npx.cmd supabase functions deploy fulfillment-voice --no-verify-jwt --project-ref jjextitmbptoaolacocs
//
// Secrets: CALLER_ID_TWILIO_AUTH_TOKEN (signs Twilio's requests);
// CALLER_ID_TWILIO_ACCOUNT_SID (Prompt 764: plays the recording notice).
// The TwiML App's Voice URL = https://jjextitmbptoaolacocs.supabase.co/functions/v1/fulfillment-voice
import { createClient } from 'npm:@supabase/supabase-js'
import { handle, type Store, type LineVoiceStore } from './core.ts'
import { twilioClient } from '../_shared/twilio.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const admin = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

const legs = () => admin.from('fulfillment_voice_legs')
const SID = Deno.env.get('CALLER_ID_TWILIO_ACCOUNT_SID')
const TOKEN = Deno.env.get('CALLER_ID_TWILIO_AUTH_TOKEN') ?? null

// P882 — lines (every call type). The SQL functions own the rules; this only reads and writes rows.
const rpc = async (fn: string, args: Record<string, unknown>) => {
  const { data, error } = await admin.rpc(fn, args)
  if (error) throw new Error(error.message)
  return data
}
const lines: LineVoiceStore = {
  async line(id) {
    const { data } = await admin.from('va_lines').select('id, kind, conference, help_call_sid, va_id, va_call_sid, status')
      .eq('id', id).maybeSingle()
    return data
  },
  async lineJoined(lineId, va, callSid) {
    const row = await rpc('line_va_joined', { p_line: lineId, p_va: va, p_call_sid: callSid })
    return !!row?.id
  },
  lineVaLeft: async (lineId, callSid) => !!(await rpc('line_va_left', { p_line: lineId, p_call_sid: callSid })),
  lineEnded: async (lineId, reason) => { await rpc('line_ended', { p_line: lineId, p_reason: reason }) },
  lineHoldState: async lineId => { await rpc('line_hold_state', { p_line: lineId }) },
  async claimHelpCall(callSid, va, vaCallSid) {
    const { data, error } = await admin.from('help_calls')
      .update({ status: 'live', va_id: va, va_call_sid: vaCallSid, answered_at: new Date().toISOString() })
      .eq('call_sid', callSid).in('status', ['ringing', 'live']).select('call_sid').maybeSingle()
    if (error) throw error
    return !!data
  },
  async saveLineLeg({ answered, ...patch }) {
    const now = new Date().toISOString()
    const row: Record<string, unknown> = { ...patch, updated_at: now }
    if (patch.on_hold === true) row.hold_since = now
    if (patch.on_hold === false) row.hold_since = null
    if (patch.status === 'ended') { row.ended_at = now; row.hold_since = null }
    const { data: had } = await legs().select('status, answered_at').eq('call_sid', patch.call_sid).maybeSingle()
    if (had?.status === 'ended') return
    if (answered && !had?.answered_at) row.answered_at = now
    const { error } = had ? await legs().update(row).eq('call_sid', patch.call_sid) : await legs().insert(row)
    if (error) throw error
  },
  async liveLineLegs(lineId) {
    const { data } = await legs().select('call_sid, on_hold').eq('line_id', lineId).eq('status', 'live')
    return data ?? []
  },
  async endLineLegs(lineId, reason) {
    const now = new Date().toISOString()
    await legs().update({ status: 'ended', on_hold: false, hold_since: null, ended_at: now, end_reason: reason, updated_at: now })
      .eq('line_id', lineId).neq('status', 'ended')
  },
}

const store: Store = {
  lines,
  async role(id) {
    const { data } = await admin.from('profiles').select('role').eq('id', id).maybeSingle()
    return data?.role ?? null
  },
  async policy(id) {
    const { data } = await admin.from('policies')
      .select('id, fulfillment_assigned, assigned_fulfillment_id, fulfillment_stage, is_demo')
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
  async recording() {
    const { data } = await admin.from('recovery_config').select('recording_live, recording_notice').limit(1).maybeSingle()
    return { live: !!data?.recording_live, notice: data?.recording_notice || 'This call may be recorded.' }
  },
  async startRecording(row) {
    const { error } = await admin.from('fulfillment_recordings').upsert(row, { onConflict: 'call_sid', ignoreDuplicates: true })
    if (error) throw error
  },
  async claimNotice(callSid) {
    const { data } = await legs().update({ notice_at: new Date().toISOString() })
      .eq('call_sid', callSid).is('notice_at', null).select('conference_sid').maybeSingle()
    return data?.conference_sid ?? null
  },
  async endLegs(policyId, reason) {
    const now = new Date().toISOString()
    await legs().update({ status: 'ended', on_hold: false, hold_since: null, ended_at: now, end_reason: reason, updated_at: now })
      .eq('policy_id', policyId).neq('status', 'ended')
  },
}

Deno.serve(req => handle(req, store, {
  authToken: TOKEN,
  publicUrl: `${SUPABASE_URL}/functions/v1/fulfillment-voice`,
  checkUrl: `${SUPABASE_URL}/functions/v1/fulfillment-cancel-check`,
  helpUrl: `${SUPABASE_URL}/functions/v1/help-voice`,
  twilio: SID && TOKEN ? twilioClient(SID, TOKEN) : null,
}))
