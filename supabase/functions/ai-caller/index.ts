// ai-caller — P892, AI speed to lead. The logic is core.ts (rules in rules.js); this file wires Deno: who may call,
// the service-role store, the provider adapter and the agent push (P880's builders).
//
// NOT DEPLOYED. Deploy only after Brayden picks and pays for a provider and approves the consent wording and the
// opening line (hard stops). Deploy WITHOUT jwt verification (pg_net, the provider and Twilio call it; every action
// checks its own secret):
//   npx.cmd supabase functions deploy ai-caller --no-verify-jwt --project-ref jjextitmbptoaolacocs
//
// Secrets: AI_PROVIDER (retell | vapi | ghl; unset = not connected, every lead goes to a VA), AI_WEBHOOK_SECRET
// (the provider sends it as ?k= on our webhook URL), AI_FROM_NUMBER (the Deedstone caller ID, on the provider),
// AI_BRIDGE_NUMBER (a Twilio number whose voice URL is this function's ?twiml=1&line=…), and per provider:
// RETELL_API_KEY + RETELL_AGENT_ID, or VAPI_API_KEY + VAPI_ASSISTANT_ID + VAPI_PHONE_NUMBER_ID, or GHL_AI_WORKFLOW_ID.
// Plus the push keys notify-push uses (APNS_*, FCM_SERVICE_ACCOUNT). Needs migration p892 (and p880, p882, p889).
import { createClient } from 'npm:@supabase/supabase-js'
import { handle, twiml, type Store, type CheckRow } from './core.ts'
import { noProvider, retell, vapi, ghl, type Provider } from './providers.ts'
import { isCron } from '../_shared/cronAuth.ts'
import { sendersFromEnv } from '../notify-push/senders.ts'
import { checkPush, sendAll } from '../notify-push/transfer.ts'

const env = (k: string) => Deno.env.get(k) ?? ''
const admin = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'))
const senders = sendersFromEnv()

// DRAFT words (src/lib/aiCaller.js DRAFT_WORDS) until Brayden approves them; the provider's agent prompt holds the rest.
const WORDS = {
  opening: 'Hi {first}, this is Deedstone’s virtual assistant, calling about the request you just sent us. Is now a good time for two quick questions?',
  hold: 'One moment, I’m checking if your licensed agent can talk right now.',
  toPerson: 'Let me get one of our team on the line for you. One moment.',
  noPerson: 'Everyone on our team is with someone right now. One of us will call you back in a few minutes.',
}

function provider(): Provider {
  const f = fetch as unknown as Parameters<typeof retell>[2]
  switch (env('AI_PROVIDER')) {
    case 'retell': return retell(env('RETELL_API_KEY'), env('RETELL_AGENT_ID'), f)
    case 'vapi': return vapi(env('VAPI_API_KEY'), env('VAPI_ASSISTANT_ID'), env('VAPI_PHONE_NUMBER_ID'), f)
    case 'ghl': return ghl(env('GHL_AI_WORKFLOW_ID') ? async body => { await admin.functions.invoke('ghl-push', { body }) } : null, env('GHL_AI_WORKFLOW_ID') || null)
    default: return noProvider()
  }
}

const rpc = async <T>(fn: string, args: Record<string, unknown>): Promise<T> => {
  const { data, error } = await admin.rpc(fn, args)
  if (error) throw error
  return data as T
}
const callCols = 'id, lead_id, agent_id, attempt, status, provider_call_id, control_url, check_id, routed, summary, booked_for'

const store: Store = {
  async live() {
    const [{ data: rc }, { data: s }] = await Promise.all([
      admin.from('recovery_config').select('ai_caller_live').limit(1).maybeSingle(),
      admin.from('ai_caller_settings').select('max_call_secs').eq('id', true).maybeSingle(),
    ])
    return { on: !!rc?.ai_caller_live, maxSecs: s?.max_call_secs ?? 300 }
  },
  async call(id) { const { data } = await admin.from('ai_calls').select(callCols).eq('id', id).maybeSingle(); return data },
  async callByProvider(pid) { if (!pid) return null; const { data } = await admin.from('ai_calls').select(callCols).eq('provider_call_id', pid).maybeSingle(); return data },
  async lead(id) {
    const { data: l } = await admin.from('leads').select('id, contact_name, phone, state, qualifier_answers, inbound_product').eq('id', id).maybeSingle()
    if (!l) return null
    const qa = (l.qualifier_answers ?? {}) as Record<string, unknown>
    return { id: l.id, first: String(l.contact_name ?? '').split(' ')[0] || 'there', phone: l.phone, state: l.state, tz: (qa.tz as string) ?? null,
      need: (l.inbound_product as string) ?? 'Mortgage protection', age: (qa.age_band as string) ?? null }
  },
  async agent(id) {
    const [{ data: p }, { data: lp }, reach] = await Promise.all([
      admin.from('profiles').select('id, full_name, phone, timezone').eq('id', id).maybeSingle(),
      admin.from('agent_lead_product').select('mode, live_hours, tz').eq('agent_id', id).maybeSingle(),
      admin.rpc('transfer_reach_for', { p_agent: id }),
    ])
    if (!p) return null
    const r = Array.isArray(reach.data) ? reach.data[0] : reach.data
    return { id: p.id, first: String(p.full_name ?? '').split(' ')[0], phone: p.phone, mode: lp?.mode ?? 'appts', hours: lp?.live_hours ?? {},
      tz: lp?.tz ?? p.timezone ?? 'America/Chicago', reachable: r?.ready !== false }
  },
  async takes(leadId) { const r = await rpc<{ by: 'ai' | 'va'; reason: string | null }[]>('ai_caller_takes', { p_lead: leadId }); return r[0] ?? { by: 'va', reason: 'rules' } },
  async toVa(callId, reason) { await rpc('ai_caller_to_va', { p_call: callId, p_reason: reason }) },
  async status(callId, status, patch = {}) { return rpc('ai_caller_status', { p_call: callId, p_status: status, p_patch: patch }) },
  async result(callId, outcome, patch = {}) { return rpc('ai_caller_result', { p_call: callId, p_outcome: outcome, p_patch: patch }) },
  async handoff(callId, reason, summary) { return rpc('ai_caller_handoff', { p_call: callId, p_reason: reason, p_summary: summary }) },
  async slots(callId) { return rpc<string[]>('ai_caller_slots', { p_call: callId, p_limit: 6 }) },
  async book(callId, at) { return rpc('ai_caller_book', { p_call: callId, p_at: at }) },
  async insertCheck(row) {
    const { data, error } = await admin.from('transfer_checks').insert({ ...row, status: 'sent' }).select('id, status, answer, expires_at, seen_token, summary, is_test').maybeSingle()
    if (error) return null // 23505: the agent is being checked by a VA right now
    return data
  },
  async check(id) { const { data } = await admin.from('transfer_checks').select('id, status, answer, expires_at').eq('id', id).maybeSingle(); return data },
  async sendCheck(c: CheckRow & { seen_token?: string; summary?: Record<string, unknown> }, agentId) {
    const { data: devices } = await admin.from('push_devices').select('token, platform, permission').eq('profile_id', agentId)
    const seenUrl = `${env('SUPABASE_URL')}/functions/v1/transfer-voice?${new URLSearchParams({ event: 'seen', check: c.id, t: c.seen_token ?? '' })}`
    const out = devices?.length ? await sendAll(senders, devices, checkPush({ id: c.id, summary: c.summary ?? {} }, seenUrl)) : { reached: 0, dead: [], errors: ['no_device'] }
    const okSent = out.reached > 0
    await admin.from('transfer_checks').update(okSent
      ? { sent_at: new Date().toISOString(), expires_at: new Date(Date.now() + 30_000).toISOString(), devices: out.reached }
      : { status: 'failed', fail_reason: out.errors.join('; ').slice(0, 300) || 'no_device' }).eq('id', c.id)
    return okSent
  },
  async lineConference(lineId) { const { data } = await admin.from('va_lines').select('conference, status').eq('id', lineId).maybeSingle(); return data && data.status !== 'ended' ? data.conference : null },
}

const cors = { 'Content-Type': 'application/json' }
Deno.serve(async req => {
  const url = new URL(req.url)
  try {
    // Twilio asks the bridge number what to do: join the VA's line.
    if (url.searchParams.get('twiml') === '1') {
      if (url.searchParams.get('k') !== env('AI_WEBHOOK_SECRET') || !env('AI_WEBHOOK_SECRET')) return new Response('forbidden', { status: 403 })
      return new Response(await twiml(store, url.searchParams.get('line') ?? ''), { headers: { 'Content-Type': 'text/xml' } })
    }
    const body = await req.json().catch(() => ({}))
    const d = { store, provider: provider(), env: { now: () => Date.now(), from: env('AI_FROM_NUMBER') || null, bridgeNumber: env('AI_BRIDGE_NUMBER') || null, words: WORDS } }
    if (url.searchParams.get('k')) {
      // The provider's webhook and tool calls.
      if (!env('AI_WEBHOOK_SECRET') || url.searchParams.get('k') !== env('AI_WEBHOOK_SECRET')) return new Response('forbidden', { status: 403 })
      return new Response(JSON.stringify(await handle('event', body, d)), { headers: cors })
    }
    if (!(await isCron(req, admin))) return new Response(JSON.stringify({ error: 'forbidden' }), { status: 403, headers: cors })
    return new Response(JSON.stringify(await handle(String(body?.action ?? ''), body, d)), { headers: cors })
  } catch (e) {
    const err = e as Error & { status?: number }
    console.error('ai-caller', err.message)
    return new Response(JSON.stringify({ error: err.message }), { status: err.status ?? 500, headers: cors })
  }
})
