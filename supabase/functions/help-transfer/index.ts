// help-transfer — Roadmap Goal 9, the VA desk's transfer buttons (dial an
// on-duty agent into the call, drop off, or book instead). The logic is
// core.ts; this file wires Deno: secrets, the service-role store and Twilio's
// REST API.
//
// Deploy WITH jwt verification (called by a signed-in VA; core.ts still checks
// the caller, the gateway's check keeps nobody out):
//   npx.cmd supabase functions deploy help-transfer --project-ref jjextitmbptoaolacocs
//
// Secrets: CALLER_ID_TWILIO_ACCOUNT_SID, CALLER_ID_TWILIO_AUTH_TOKEN (the ones
// help-voice uses), HELP_TRACKING_NUMBER (read-only: the agent leg's From).
import { createClient } from 'npm:@supabase/supabase-js'
import { handle, toE164, type Store } from './core.ts'
import { twilioClient } from '../_shared/twilio.ts'

const SID = Deno.env.get('CALLER_ID_TWILIO_ACCOUNT_SID')
const TOKEN = Deno.env.get('CALLER_ID_TWILIO_AUTH_TOKEN')
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!

const admin = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
const calls = () => admin.from('help_calls')

const store: Store = {
  async userFromJwt(jwt) {
    const { data } = await admin.auth.getUser(jwt)
    return data.user?.id ?? null
  },
  async caller(id) {
    const { data } = await admin.from('profiles').select('role, is_active').eq('id', id).maybeSingle()
    return data
  },
  async voiceLive() {
    const { data } = await admin.from('recovery_config').select('voice_live').limit(1).maybeSingle()
    return !!data?.voice_live
  },
  async helpCall(callSid) {
    const { data } = await calls().select('*').eq('call_sid', callSid).maybeSingle()
    return data
  },
  async updateHelpCall(callSid, patch, whenStatus) {
    let q = calls().update(patch).eq('call_sid', callSid)
    if (whenStatus) q = q.in('status', whenStatus)
    const { data, error } = await q.select('*').maybeSingle()
    if (error) throw error
    return data
  },
  // The service role reads agent_duty directly: 174's read function returns
  // zero rows for anyone who isn't a signed-in admin.
  async onDutyAgent() {
    const { data, error } = await admin.from('agent_duty')
      .select('agent_id, since, profiles!inner(role, is_active, is_demo, phone)')
      .eq('on_duty', true).eq('profiles.role', 'agent').eq('profiles.is_active', true)
      .order('since', { ascending: true, nullsFirst: false }).order('agent_id')
    if (error) throw error
    for (const d of data ?? []) {
      const p = Array.isArray(d.profiles) ? d.profiles[0] : d.profiles
      const phone = toE164(p?.phone)
      if (p && !p.is_demo && phone) return { agent_id: d.agent_id, phone }
    }
    return null
  },
}

Deno.serve(req => handle(req, store, twilioClient(SID ?? '', TOKEN ?? ''), {
  from: Deno.env.get('HELP_TRACKING_NUMBER') || null,
  voiceUrl: `${SUPABASE_URL}/functions/v1/help-voice`,
  configured: !!(SID && TOKEN),
}))
