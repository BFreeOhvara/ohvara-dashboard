// ai-caller — P892, AI speed to lead. The logic is core.ts (rules in rules.js); this file wires Deno: who may call,
// the service-role store, the provider adapter and the agent push (P880's builders).
//
// NOT DEPLOYED. Deploy only after Brayden picks and pays for a provider and approves the consent wording and the
// opening line (hard stops). Deploy WITHOUT jwt verification (pg_net, the provider and Twilio call it; every action
// checks its own secret):
//   npx.cmd supabase functions deploy ai-caller --no-verify-jwt --project-ref jjextitmbptoaolacocs
//
// Secrets: AI_PROVIDER (retell | vapi | ghl; unset = not connected, every lead goes to a VA), AI_WEBHOOK_SECRET
// (the provider sends it as ?k= on our webhook URL), AI_FROM_NUMBER (the fallback Deedstone caller ID; P916: each lead's
// agent's Deedstone number is used when the pool has one), and
// per provider (P902: no bridge number any more, the AI never hands a new lead to a VA):
// RETELL_API_KEY + RETELL_AGENT_ID, or VAPI_API_KEY + VAPI_ASSISTANT_ID + VAPI_PHONE_NUMBER_ID, or GHL_AI_WORKFLOW_ID.
// Plus the push keys notify-push uses (APNS_*, FCM_SERVICE_ACCOUNT). Needs migrations p892 then p902 (and p880, p882,
// p889).
import { createClient } from 'npm:@supabase/supabase-js'
import { handle, type Store, type CheckRow } from './core.ts'
import { noProvider, retell, vapi, ghl, type Provider } from './providers.ts'
import { isCron } from '../_shared/cronAuth.ts'
import { sendersFromEnv } from '../notify-push/senders.ts'
import { checkPush, clearPush, sendAll } from '../notify-push/transfer.ts'
import { retellVoices, retellSetup, retellNumber, retellNumbers, retellCall } from './retellAdmin.ts'

const env = (k: string) => Deno.env.get(k) ?? ''
const admin = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'))
const senders = sendersFromEnv()

// DRAFT words (src/lib/aiCaller.js DRAFT_WORDS) until Brayden approves them; the provider's agent prompt holds the rest.
// The transfer beats' words (check, connecting, bounce, hold) live in rules.js TRANSFER_WORDS (P903).
const WORDS = {
  // P940 (Brayden, Nov 10): who it is and why it's calling, no small talk.
  opening: 'Hi {first}, this is Max, the virtual assistant with Deedstone Insurance. I’m following up on the mortgage protection request you just sent in. I’ve just got a couple quick questions so I can get you to the right specialist.',
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
    const { data: l } = await admin.from('leads').select('id, contact_name, phone, state, qualifier_answers, inbound_product, is_sample').eq('id', id).maybeSingle()
    if (!l) return null
    const qa = (l.qualifier_answers ?? {}) as Record<string, unknown>
    // P926: only a sample lead can carry a test (admin test calls); a real lead never does.
    const test = l.is_sample && qa.test && typeof qa.test === 'object' ? qa.test as { check?: 'yes' | 'no' | 'none'; transferTo?: string } : null
    return { id: l.id, first: String(l.contact_name ?? '').split(' ')[0] || 'there', phone: l.phone, state: l.state, tz: (qa.tz as string) ?? null,
      need: (l.inbound_product as string) ?? 'Mortgage protection', age: (qa.age_band as string) ?? null, test,
      homeowner: typeof qa.homeowner === 'boolean' ? qa.homeowner : null, mortgage: (qa.mortgage_balance_band as string) ?? null }
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
  async slots(callId) { return rpc<string[]>('ai_caller_slots', { p_call: callId, p_limit: 6 }) },
  async book(callId, at) { return rpc('ai_caller_book', { p_call: callId, p_at: at }) },
  async insertCheck(row) {
    const { data, error } = await admin.from('transfer_checks').insert({ ...row, status: 'sent' }).select('id, status, answer, expires_at, seen_token, summary, is_test, ai_call_id').maybeSingle()
    if (error) return null // 23505: the agent is being checked by a VA right now
    return data
  },
  async check(id) { const { data } = await admin.from('transfer_checks').select('id, status, answer, expires_at, summary, ai_call_id').eq('id', id).maybeSingle(); return data },
  async sendCheck(c: CheckRow & { seen_token?: string; summary?: Record<string, unknown> }, agentId) {
    const { data: devices } = await admin.from('push_devices').select('token, platform, permission').eq('profile_id', agentId)
    const seenUrl = `${env('SUPABASE_URL')}/functions/v1/transfer-voice?${new URLSearchParams({ event: 'seen', check: c.id, t: c.seen_token ?? '' })}`
    const out = devices?.length ? await sendAll(senders, devices, checkPush({ id: c.id, summary: c.summary ?? {}, ai_call_id: (c as { ai_call_id?: string }).ai_call_id ?? 'ai' /* every check sent here is the AI's */ }, seenUrl)) : { reached: 0, dead: [], errors: ['no_device'] }
    const okSent = out.reached > 0
    await admin.from('transfer_checks').update(okSent
      ? { sent_at: new Date().toISOString(), expires_at: new Date(Date.now() + 30_000).toISOString(), devices: out.reached }
      : { status: 'failed', fail_reason: out.errors.join('; ').slice(0, 300) || 'no_device' }).eq('id', c.id)
    return okSent
  },
  async markCheck(id, patch, whenStatus) {
    let q = admin.from('transfer_checks').update(patch).eq('id', id)
    if (whenStatus?.length) q = q.in('status', whenStatus)
    const { error } = await q
    if (error) console.error('ai-caller markCheck', id, error.message)
  },
  // P940: minutes, cost and summary for a call whose result was set mid-call (only fills what is still empty).
  async endStats(id, p) {
    const row = Object.fromEntries(Object.entries({ duration_secs: p.duration_secs, cost_cents: p.cost_cents, summary: typeof p.summary === 'string' ? p.summary.slice(0, 1200) : undefined,
      transcript_ref: p.transcript_ref }).filter(([, v]) => v != null))
    const { error } = await admin.from('ai_calls').update(row).eq('id', id).eq('status', 'done').is('duration_secs', null)
    if (error) console.error('ai-caller endStats', id, error.message)
  },
  // P916: the agent's Deedstone number (Retell dials from_number; Vapi needs that number's id on Vapi).
  async deedstoneFrom(agentId, callId) {
    const { data, error } = await admin.rpc('deedstone_from', { p_agent: agentId, p_kind: 'ai_call', p_ref: callId })
    if (error || !data?.phone) return null
    return { phone: data.phone, providerId: data.provider_number_id ?? null }
  },
  async clearCheck(c, agentId, why) {
    if (!agentId) return
    try {
      const { data: devices } = await admin.from('push_devices').select('token, platform, permission').eq('profile_id', agentId)
      if (devices?.length) await sendAll(senders, devices, clearPush({ id: c.id, summary: c.summary ?? {} }, why))
    } catch (e) { console.error('ai-caller clearCheck', c.id, (e as Error).message) }
  },
}

// ── P926: Retell setup and admin test calls (cron secret only; CC runs them through fulfillment_cron_post) ──────
const E164 = /^\+1[2-9]\d{9}$/
const SCENARIOS: Record<string, 'yes' | 'no' | 'none' | null> = { booked: null, transfer: 'yes', agent_no: 'no', not_now: null, no_answer: null }
async function retellAction(action: string, body: any, d: { store: Store; provider: Provider; env: any }) {
  const f = fetch as unknown as Parameters<typeof retell>[2]
  const key = env('RETELL_API_KEY')
  const hook = `${env('SUPABASE_URL')}/functions/v1/ai-caller?k=${encodeURIComponent(env('AI_WEBHOOK_SECRET'))}`
  switch (action) {
    case 'retell_status': return { key: !!key, agent: !!env('RETELL_AGENT_ID'), llm: !!env('RETELL_LLM_ID'), webhook_secret: !!env('AI_WEBHOOK_SECRET'), provider: env('AI_PROVIDER') || 'none', from: !!env('AI_FROM_NUMBER'), ready: d.provider.ready }
    case 'retell_voices': return { voices: await retellVoices(f, key, !!body?.all) }
    case 'retell_setup': {
      if (!env('AI_WEBHOOK_SECRET')) throw Object.assign(new Error('AI_WEBHOOK_SECRET not set'), { status: 400 })
      const { data: s } = await admin.from('ai_caller_settings').select('max_call_secs').eq('id', true).maybeSingle()
      return retellSetup(f, key, hook, { prompt: String(body?.prompt ?? ''), voice_id: String(body?.voice_id ?? ''), voice: body?.voice ?? {}, max_secs: s?.max_call_secs ?? 300,
        llm_id: env('RETELL_LLM_ID') || null, agent_id: env('RETELL_AGENT_ID') || null })
    }
    case 'retell_number': {
      if (!env('RETELL_AGENT_ID')) throw Object.assign(new Error('set up the agent first'), { status: 400 })
      return retellNumber(f, key, env('RETELL_AGENT_ID'), Number(body?.area_code) || 512)
    }
    case 'retell_numbers': return { numbers: await retellNumbers(f, key) }
    case 'retell_call': return retellCall(f, key, String(body?.provider_call_id ?? ''))
    case 'test_call': {
      // Dials ONLY the number given here, as a sample lead of the Test Agent. ai_caller_live is not read or changed.
      const to = String(body?.to ?? ''), scenario = String(body?.scenario ?? '')
      if (!E164.test(to)) throw Object.assign(new Error('to must be +1XXXXXXXXXX'), { status: 400 })
      if (!(scenario in SCENARIOS)) throw Object.assign(new Error(`scenario: ${Object.keys(SCENARIOS).join(' | ')}`), { status: 400 })
      const transferTo = body?.transfer_to ? String(body.transfer_to) : null
      if (transferTo && !E164.test(transferTo)) throw Object.assign(new Error('transfer_to must be +1XXXXXXXXXX'), { status: 400 })
      const { data: ag } = await admin.from('profiles').select('id').eq('full_name', 'Test Agent').eq('is_test', true).maybeSingle()
      if (!ag) throw Object.assign(new Error('no Test Agent'), { status: 400 })
      // The same answers the Deedstone form (submit-mp-lead) collects, so the AI confirms them (P940).
      const qa = { tz: 'America/Chicago', age_band: '45-54', homeowner: true, mortgage_balance_band: '200-300k', smoker: false, test: { check: SCENARIOS[scenario], transferTo, scenario } }
      // No phone on insert, so the new-lead router never queues it for a VA; the phone goes on right after.
      const { data: lead, error: le } = await admin.from('leads').insert({ business_name: 'P926 test call', contact_name: `Brayden (test ${scenario.replace('_', ' ')})`,
        lead_type: 'mortgage_protection', is_sample: true, assigned_rep_id: ag.id, state: 'TX', qualifier_answers: qa }).select('id').single()
      if (le) throw le
      const { error: pe } = await admin.from('leads').update({ phone: to }).eq('id', lead.id)
      if (pe) throw pe
      const { data: call, error: ce } = await admin.from('ai_calls').insert({ lead_id: lead.id, agent_id: ag.id, attempt: 1, lead_in_at: new Date().toISOString(), provider: 'retell' }).select('id').single()
      if (ce) throw ce
      return { lead_id: lead.id, call_id: call.id, start: await handle('start', { call_id: call.id }, d) }
    }
    case 'test_cleanup': {
      // The test leads keep their calls (admin AI calls shows them) but lose the phone numbers.
      const { data, error } = await admin.from('leads').update({ phone: null, qualifier_answers: { cleaned: true } }).eq('business_name', 'P926 test call').eq('is_sample', true).select('id')
      if (error) throw error
      return { cleaned: data?.length ?? 0 }
    }
    default: return null
  }
}

const cors = { 'Content-Type': 'application/json' }
Deno.serve(async req => {
  const url = new URL(req.url)
  try {
    const body = await req.json().catch(() => ({}))
    const d = { store, provider: provider(), env: { now: () => Date.now(), from: env('AI_FROM_NUMBER') || null, words: WORDS } }
    if (url.searchParams.get('k')) {
      // The provider's webhook and tool calls.
      if (!env('AI_WEBHOOK_SECRET') || url.searchParams.get('k') !== env('AI_WEBHOOK_SECRET')) return new Response('forbidden', { status: 403 })
      return new Response(JSON.stringify(await handle('event', body, d)), { headers: cors })
    }
    if (!(await isCron(req, admin))) return new Response(JSON.stringify({ error: 'forbidden' }), { status: 403, headers: cors })
    const setup = await retellAction(String(body?.action ?? ''), body, d)
    if (setup) return new Response(JSON.stringify(setup), { headers: cors })
    return new Response(JSON.stringify(await handle(String(body?.action ?? ''), body, d)), { headers: cors })
  } catch (e) {
    const err = e as Error & { status?: number }
    console.error('ai-caller', err.message)
    return new Response(JSON.stringify({ error: err.message }), { status: err.status ?? 500, headers: cors })
  }
})
