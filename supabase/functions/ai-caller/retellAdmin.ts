// P926 — setting up Retell from our side (cron-secret actions in index.ts; CC runs them through fulfillment_cron_post).
// voices: the natural US voices to offer. setup: create or update the LLM + agent from retellSpec.js. number: buy a
// Retell number for the agent's outbound calls (only with Brayden's yes; $2 a month).
import { retellLlm, retellAgent, pickVoices, CALLER_VOICES, CALLER_SPLIT } from './retellSpec.js'
import type { Fetch } from './providers.ts'

const API = 'https://api.retellai.com'
async function call(f: Fetch, key: string, method: string, path: string, body?: unknown) {
  const res = await f(`${API}${path}`, { method, headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: body == null ? undefined : JSON.stringify(body) })
  if (!res.ok) throw Object.assign(new Error(`retell ${method} ${path} ${res.status}: ${(await res.text()).slice(0, 400)}`), { status: 502 })
  return res.json()
}

export async function retellVoices(f: Fetch, key: string, all = false) {
  const list = await call(f, key, 'GET', '/list-voices')
  const slim = (v: Record<string, unknown>) => ({ voice_id: v.voice_id, name: v.voice_name, provider: v.provider, gender: v.gender, accent: v.accent, age: v.age, preview: v.preview_audio_url })
  return all ? (list as Record<string, unknown>[]).map(slim) : pickVoices(list, 12).map(slim)
}

export type SetupIn = { prompt: string; voice_id: string; voice?: Record<string, number | boolean>; max_secs?: number; llm_id?: string | null; agent_id?: string | null }
export async function retellSetup(f: Fetch, key: string, webhookUrl: string, a: SetupIn) {
  if (!a.prompt || !a.voice_id) throw Object.assign(new Error('prompt and voice_id needed'), { status: 400 })
  const llmBody = retellLlm({ prompt: a.prompt, url: webhookUrl })
  const llm = a.llm_id ? await call(f, key, 'PATCH', `/update-retell-llm/${a.llm_id}`, llmBody) : await call(f, key, 'POST', '/create-retell-llm', llmBody)
  const agentBody = retellAgent({ llmId: llm.llm_id, voiceId: a.voice_id, webhookUrl, maxSecs: a.max_secs, voice: a.voice })
  const agent = a.agent_id ? await call(f, key, 'PATCH', `/update-agent/${a.agent_id}`, agentBody) : await call(f, key, 'POST', '/create-agent', agentBody)
  return { llm_id: llm.llm_id, llm_version: llm.version ?? null, agent_id: agent.agent_id, agent_version: agent.version ?? null, voice_id: agent.voice_id }
}

export async function retellNumber(f: Fetch, key: string, agentId: string, areaCode: number) {
  const r = await call(f, key, 'POST', '/create-phone-number', {
    area_code: areaCode, country_code: 'US', nickname: 'Deedstone AI (tests)', outbound_agents: [{ agent_id: agentId, weight: 1 }], allowed_outbound_country_list: ['US'],
  })
  return { phone_number: r.phone_number, pretty: r.phone_number_pretty ?? null }
}

export async function retellCall(f: Fetch, key: string, id: string) {
  const c = await call(f, key, 'GET', `/v2/get-call/${encodeURIComponent(id)}`)
  return { status: c.call_status, reason: c.disconnection_reason, secs: Math.round((c.duration_ms ?? 0) / 1000), cost_cents: c.call_cost?.combined_cost ?? null,
    products: c.call_cost?.product_costs ?? null, summary: c.call_analysis?.call_summary ?? null }
}

// Read-only: the numbers on the Retell account (a purchase reply can be lost to pg_net's 5 s timeout).
export async function retellNumbers(f: Fetch, key: string) {
  const r = await call(f, key, 'GET', '/v2/list-phone-numbers?limit=100') // legacy /list-phone-numbers retired Jun 2026
  return ((r.items ?? []) as Record<string, unknown>[]).map(n => ({ phone_number: n.phone_number, pretty: n.phone_number_pretty ?? null, nickname: n.nickname ?? null, outbound: n.outbound_agents ?? null }))
}

// P940: a Retell chat on the live LLM (no phone call). Creates a chat agent once (reuse its id), starts a chat with the
// call's variables and metadata, sends each turn, and returns a compact log: agent words, function calls and replies.
export async function retellChat(f: Fetch, key: string, a: { llmId: string; chatAgentId: string | null; vars: Record<string, unknown>; metadata: Record<string, string>;
  turns: string[]; onChat: (chatId: string) => Promise<void>; onTurn: (log: string[]) => Promise<void> }) {
  const chatAgentId = a.chatAgentId || (await call(f, key, 'POST', '/create-chat-agent', { agent_name: 'Deedstone VA (chat tests)', response_engine: { type: 'retell-llm', llm_id: a.llmId } })).agent_id
  const vars = Object.fromEntries(Object.entries(a.vars).map(([k, v]) => [k, v == null ? '' : String(v)]))
  const chat = await call(f, key, 'POST', '/create-chat', { agent_id: chatAgentId, metadata: a.metadata, retell_llm_dynamic_variables: vars })
  await a.onChat(chat.chat_id)
  const log: string[] = [`VARS: ${JSON.stringify(vars).slice(0, 600)}`]
  for (const t of a.turns) {
    log.push(`LEAD: ${t}`)
    const r = await call(f, key, 'POST', '/create-chat-completion', { chat_id: chat.chat_id, content: t })
    for (const m of r.messages ?? []) {
      if (m.role === 'agent') log.push(`MAX: ${m.content}`)
      else if (m.role === 'tool_call_invocation') log.push(`  -> ${m.name}(${String(m.arguments ?? '').slice(0, 200)})`)
      else if (m.role === 'tool_call_result') log.push(`  <- ${String(m.content ?? '').slice(0, 300)}`)
      else if (m.role !== 'user') log.push(`  [${m.role}] ${String(m.content ?? '').slice(0, 200)}`)
    }
    await a.onTurn(log)
  }
  await f(`${API}/end-chat/${encodeURIComponent(chat.chat_id)}`, { method: 'PATCH', headers: { Authorization: `Bearer ${key}` } }).catch(() => null)
  return { chatAgentId, chatId: chat.chat_id, log }
}

// ── P976: the voice split (Hope and Mark), two agents on the one LLM ────────────────────────────────────────────────
// An ElevenLabs library voice joins the Retell account as a community voice: search-community-voice finds its
// public_user_id (ElevenLabs needs it), add-community-voice returns the Retell voice_id the agent uses.
export async function retellAddVoice(f: Fetch, key: string, v: { eleven: string; label: string }) {
  let hit: Record<string, string> | undefined
  for (const q of [v.label, v.eleven]) {
    const r = await call(f, key, 'POST', '/search-community-voice', { search_query: q, voice_provider: 'elevenlabs' })
    hit = ((r.voices ?? []) as Record<string, string>[]).find(x => x.provider_voice_id === v.eleven)
    if (hit) break
  }
  if (!hit) throw Object.assign(new Error(`ElevenLabs voice ${v.label} (${v.eleven}) not found in Retell's community search`), { status: 404 })
  const added = await call(f, key, 'POST', '/add-community-voice', { provider_voice_id: v.eleven, voice_name: `${v.label} (ElevenLabs)`, voice_provider: 'elevenlabs',
    ...(hit.public_user_id ? { public_user_id: hit.public_user_id } : {}) })
  return String(added.voice_id)
}
export async function retellGetVoice(f: Fetch, key: string, id: string) {
  const v = await call(f, key, 'GET', `/get-voice/${encodeURIComponent(id)}`)
  return { voice_id: v.voice_id, name: v.voice_name, provider: v.provider, gender: v.gender ?? null, accent: v.accent ?? null }
}
export async function retellGetAgent(f: Fetch, key: string, id: string) {
  const a = await call(f, key, 'GET', `/get-agent/${encodeURIComponent(id)}`)
  return { agent_id: a.agent_id, name: a.agent_name, llm_id: a.response_engine?.llm_id ?? null, voice_id: a.voice_id, voice_model: a.voice_model ?? null,
    voice_speed: a.voice_speed ?? null, voice_temperature: a.voice_temperature ?? null, fallback: a.fallback_voice_ids ?? null, version: a.version ?? null }
}

export type SplitRow = { voice_id?: string | null; agent_id?: string | null }
// Adds any voice not yet on the account, then creates or updates one agent per voice on the shared LLM (the same
// body as the old agent, only the voice, its fallback and the name differ). Returns what to save in ai_caller_settings.
export async function retellSplit(f: Fetch, key: string, webhookUrl: string, a: { llmId: string; maxSecs?: number; saved: Record<string, SplitRow> | null }) {
  if (!a.llmId) throw Object.assign(new Error('RETELL_LLM_ID not set'), { status: 400 })
  const out: Record<string, { voice_id: string; agent_id: string }> = {}
  for (const k of CALLER_SPLIT) {
    const v = (CALLER_VOICES as Record<string, { eleven: string; label: string }>)[k]
    const was = a.saved?.[k] ?? {}
    const voiceId = was.voice_id || await retellAddVoice(f, key, v)
    const body = retellAgent({ llmId: a.llmId, voiceId, webhookUrl, maxSecs: a.maxSecs, split: k })
    const ag = was.agent_id ? await call(f, key, 'PATCH', `/update-agent/${was.agent_id}`, body) : await call(f, key, 'POST', '/create-agent', body)
    out[k] = { voice_id: voiceId, agent_id: String(ag.agent_id) }
  }
  return out
}
// Read back from Retell: each split agent's voice, model and LLM, and the voice itself.
export async function retellSplitCheck(f: Fetch, key: string, saved: Record<string, SplitRow> | null, llmId: string) {
  const out: Record<string, unknown> = {}
  for (const k of CALLER_SPLIT) {
    const s = saved?.[k]
    if (!s?.agent_id) { out[k] = { missing: true }; continue }
    const agent = await retellGetAgent(f, key, s.agent_id)
    const voice = await retellGetVoice(f, key, String(agent.voice_id))
    out[k] = { agent, voice, same_llm: agent.llm_id === llmId, voice_ok: agent.voice_id === s.voice_id && voice.provider === 'elevenlabs' }
  }
  return out
}
