// P926 — setting up Retell from our side (cron-secret actions in index.ts; CC runs them through fulfillment_cron_post).
// voices: the natural US voices to offer. setup: create or update the LLM + agent from retellSpec.js. number: buy a
// Retell number for the agent's outbound calls (only with Brayden's yes; $2 a month).
import { retellLlm, retellAgent, pickVoices } from './retellSpec.js'
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
