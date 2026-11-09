// The Deno side of the live transfer, shared by help-transfer and transfer-voice: the service-role store,
// Twilio and the push senders. Service role only; nothing here is reachable from a browser.
import { createClient } from 'npm:@supabase/supabase-js'
import type { Env, Store } from './core.ts'
import { twilioClient } from '../_shared/twilio.ts'
import { sendersFromEnv } from '../notify-push/senders.ts'

const SID = Deno.env.get('CALLER_ID_TWILIO_ACCOUNT_SID')
const TOKEN = Deno.env.get('CALLER_ID_TWILIO_AUTH_TOKEN')
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!

const admin = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
const now = () => new Date().toISOString()

export const store: Store = {
  async userFromJwt(jwt) {
    const { data } = await admin.auth.getUser(jwt)
    return data.user?.id ?? null
  },
  async caller(id) {
    const { data } = await admin.from('profiles').select('role, is_active, phone').eq('id', id).maybeSingle()
    return data
  },
  async voiceLive() {
    const { data } = await admin.from('recovery_config').select('voice_live').limit(1).maybeSingle()
    return !!data?.voice_live
  },
  async helpCall(callSid) {
    if (!callSid) return null
    const { data } = await admin.from('help_calls').select('*').eq('call_sid', callSid).maybeSingle()
    return data
  },
  async updateHelpCall(callSid, patch, whenStatus) {
    let q = admin.from('help_calls').update(patch).eq('call_sid', callSid)
    if (whenStatus) q = q.in('status', whenStatus)
    const { data, error } = await q.select('*').maybeSingle()
    if (error) throw error
    return data
  },
  // What the push and the whisper say. Age and need come from the qualifier answers (166); "Your client"
  // when the lead's 10 digits match one of that agent's policies.
  async lead(id) {
    const { data: l } = await admin.from('leads')
      .select('id, contact_name, phone, state, qualifier_answers, inbound_product, lead_type, assigned_rep_id')
      .eq('id', id).maybeSingle()
    if (!l) return null
    const qa = (l.qualifier_answers ?? {}) as Record<string, unknown>
    const pick = (...k: string[]) => k.map(x => qa[x]).find(v => v != null && v !== '') as string | undefined
    const digits = String(l.phone ?? '').replace(/\D/g, '').slice(-10)
    let yours = false
    if (l.assigned_rep_id && digits.length === 10) {
      const { data: p } = await admin.from('policies').select('client_phone')
        .eq('agent_id', l.assigned_rep_id).ilike('client_phone', `%${digits.slice(-4)}%`).limit(50)
      yours = (p ?? []).some(x => String(x.client_phone ?? '').replace(/\D/g, '').slice(-10) === digits)
    }
    return {
      agent_id: l.assigned_rep_id,
      summary: {
        name: l.contact_name || 'A lead',
        age: pick('age', 'Age') ?? null,
        state: pick('state') ?? l.state ?? null,
        need: pick('need', 'coverage', 'product', 'looking_for') ?? l.inbound_product ?? null,
        your_client: yours,
      },
    }
  },
  async reach(agentId) {
    const { data, error } = await admin.rpc('transfer_reach_for', { p_agent: agentId })
    if (error) throw error
    const r = Array.isArray(data) ? data[0] : data
    return { ready: !!r?.ready, reason: r?.reason ?? 'not_tested' }
  },
  async licensed(agentId, state) {
    const { data, error } = await admin.rpc('licence_allows', { p_agent: agentId, p_state: state })
    // P881 not applied yet: no gate (the function doesn't exist), same as before.
    if (error) { if (/licence_allows/.test(error.message || '') || error.code === 'PGRST202') return true; throw error }
    return data === true
  },
  async devices(agentId) {
    const { data } = await admin.from('push_devices').select('token, platform, permission').eq('profile_id', agentId)
    return (data ?? []).filter(d => (d.permission ?? 'granted') === 'granted').map(d => ({ token: d.token, platform: d.platform }))
  },
  async dropDevices(tokens) {
    if (tokens.length) await admin.from('push_devices').delete().in('token', tokens)
  },
  async insertCheck(row) {
    const { data, error } = await admin.from('transfer_checks').insert(row).select('*').maybeSingle()
    if (error?.code === '23505') return null
    if (error) throw error
    return data
  },
  async check(id) {
    const { data } = await admin.from('transfer_checks').select('*').eq('id', id).maybeSingle()
    return data
  },
  async updateCheck(id, patch, whenStatus) {
    let q = admin.from('transfer_checks').update(patch).eq('id', id)
    if (whenStatus) q = q.in('status', whenStatus)
    const { data, error } = await q.select('*').maybeSingle()
    if (error?.code === '23505') return null
    if (error) throw error
    return data
  },
  async readiness(agentId) {
    const { data } = await admin.from('transfer_readiness').select('*').eq('agent_id', agentId).maybeSingle()
    return data
  },
  async setReadiness(agentId, patch) {
    const { error } = await admin.from('transfer_readiness').upsert({ agent_id: agentId, ...patch, updated_at: now() }, { onConflict: 'agent_id' })
    if (error) throw error
  },
  async scheduleCallback(leadId) {
    await admin.from('leads').update({ va_outcome: 'callback', va_callback_at: new Date(Date.now() + 5 * 60_000).toISOString() })
      .eq('id', leadId).not('va_outcome', 'in', '(booked,transferred)')
  },
  async setLeadTransferStatus(leadId, status) {
    await admin.from('leads').update({ transfer_status: status, ...(status === 'connected' ? { transferred_at: now() } : null) }).eq('id', leadId)
  },
  // P916: the agent's Deedstone number (assigned the first time, kept).
  async deedstoneFrom(agentId, kind, ref) {
    const { data, error } = await admin.rpc('deedstone_from', { p_agent: agentId, p_kind: kind, p_ref: ref })
    if (error) { console.error('deedstone_from', error.message); return null }
    return (data as { phone?: string } | null)?.phone ?? null
  },
}

export const twilio = twilioClient(SID ?? '', TOKEN ?? '')

export const env: Env = {
  from: Deno.env.get('HELP_TRACKING_NUMBER') || null,
  voiceUrl: `${SUPABASE_URL}/functions/v1/transfer-voice`,
  configured: !!(SID && TOKEN),
  senders: sendersFromEnv(),
  // Work after the response (the hand-off wait, clearing other phones): Supabase's EdgeRuntime.waitUntil.
  waitUntil: p => {
    // deno-lint-ignore no-explicit-any
    const rt = (globalThis as any).EdgeRuntime
    if (rt?.waitUntil) rt.waitUntil(p)
    else p.catch(e => console.error('[transfer] background work failed:', e))
  },
}
