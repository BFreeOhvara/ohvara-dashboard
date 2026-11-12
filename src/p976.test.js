// P976 — the AI caller's voice split: ElevenLabs Hope and Mark on two Retell agents (one LLM), alternated 50/50 on
// outgoing calls, the voice saved per call, and admin AI calls comparing booked rate per voice.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as core from '../supabase/functions/ai-caller/core.ts'
import { noProvider } from '../supabase/functions/ai-caller/providers.ts'
import { CALLER_VOICES, CALLER_SPLIT, pickVoice, aiNameOf, retellAgent, retellLlm, retellPrompt, SCRIPT, VOICEMAIL_LINE, RETELL_VOICE_DEFAULTS } from '../supabase/functions/ai-caller/retellSpec.js'
import { SAMPLE_AI_CALLS, SAMPLE_CENTS_PER_MIN, voiceStats, voiceStatsFromView } from './lib/aiCaller.js'

const HOOK = 'https://x.supabase.co/functions/v1/ai-caller?k=s'

test('the split is Hope and Mark with the ElevenLabs ids Brayden picked, mirrored in the reels voice config', () => {
  assert.deepEqual(CALLER_SPLIT, ['hope', 'mark'])
  assert.equal(CALLER_VOICES.hope.eleven, 'OYTbf65OHHFELVut7v2H')
  assert.equal(CALLER_VOICES.mark.eleven, 'UgBBYS2sOqTuMpoF3BR0')
  assert.equal(aiNameOf('hope'), 'Hope')
  assert.equal(aiNameOf('mark'), 'Max')
  assert.equal(aiNameOf(null), 'Max')
  let cfg = null
  try { cfg = JSON.parse(readFileSync('C:/Users/freem/ohvara-reels/voice-config.json', 'utf8')) } catch { /* not on this machine */ }
  if (cfg) {
    assert.deepEqual(cfg.caller.split, CALLER_SPLIT)
    for (const k of CALLER_SPLIT) assert.equal(cfg.voices[k], CALLER_VOICES[k].eleven)
  }
})

test('alternation: strict from even, fewest first calls wins, self-heals', () => {
  const counts = {}
  const seq = []
  for (let i = 0; i < 10; i++) { const v = pickVoice(counts); seq.push(v); counts[v] = (counts[v] ?? 0) + 1 }
  assert.deepEqual(seq, ['hope', 'mark', 'hope', 'mark', 'hope', 'mark', 'hope', 'mark', 'hope', 'mark'])
  assert.equal(pickVoice({ hope: 5, mark: 2 }), 'mark')
  assert.equal(pickVoice({ hope: 3, mark: 3 }), 'hope')
  assert.equal(pickVoice({ mark: 1 }), 'hope')
  // 1000 calls stay exactly 50/50
  const c = {}
  for (let i = 0; i < 1000; i++) { const v = pickVoice(c); c[v] = (c[v] ?? 0) + 1 }
  assert.deepEqual(c, { hope: 500, mark: 500 })
})

test('both agents: identical body on the one LLM except the voice, its same-gender fallback and the name', () => {
  const h = retellAgent({ llmId: 'llm_1', voiceId: 'v_hope', webhookUrl: HOOK, split: 'hope' })
  const m = retellAgent({ llmId: 'llm_1', voiceId: 'v_mark', webhookUrl: HOOK, split: 'mark' })
  const strip = a => { const { voice_id, fallback_voice_ids, agent_name, ...rest } = a; return rest }
  assert.deepEqual(strip(h), strip(m))
  assert.deepEqual(strip(m), strip(retellAgent({ llmId: 'llm_1', voiceId: 'x', webhookUrl: HOOK }))) // same as the old agent (P940 settings)
  assert.equal(h.response_engine.llm_id, 'llm_1')
  assert.equal(h.voice_model, 'eleven_multilingual_v2')
  assert.deepEqual(h.fallback_voice_ids, ['cartesia-Grace'])
  assert.deepEqual(m.fallback_voice_ids, ['cartesia-Max'])
  assert.deepEqual(RETELL_VOICE_DEFAULTS.fallback_voice_ids, ['cartesia-Max'])
  assert.match(h.agent_name, /Hope$/)
  assert.match(m.agent_name, /Mark$/)
})

test('the prompt says who it is per call ({{ai_name}}), Max by default; no hard-coded Max left in the lines', () => {
  const p = retellPrompt()
  assert.ok(!/\bMax\b/.test(p), 'no hard-coded Max in the prompt')
  assert.match(p, /You are \{\{ai_name\}\}, the virtual assistant/)
  assert.match(SCRIPT.open, /this is \{\{ai_name\}\}, the virtual assistant/)
  assert.match(VOICEMAIL_LINE, /this is \{\{ai_name\}\} with Deedstone/)
  assert.deepEqual(retellLlm({ prompt: p, url: HOOK }).default_dynamic_variables, { ai_name: 'Max' })
})

function fakes({ agents = { hope: { agent_id: 'ag_h' }, mark: { agent_id: 'ag_m' } }, counts = {}, attempt = 1, earlier = null, test = null, key = 'retell' } = {}) {
  const log = []
  let got = null
  const call = { id: '22222222-2222-4222-8222-222222222222', lead_id: 'l1', agent_id: 'ag-1', attempt, status: 'queued' }
  const store = {
    live: async () => ({ on: true, maxSecs: 300 }),
    call: async () => ({ ...call }),
    lead: async () => ({ id: 'l1', first: 'Ann', phone: '+15125556001', state: 'TX', tz: null, need: null, age: null, test }),
    agent: async () => ({ id: 'ag-1', first: 'Nate', phone: '+15125550100', mode: 'appts', hours: {}, tz: 'America/Chicago', reachable: true }),
    takes: async () => ({ by: 'ai', reason: null }),
    toVa: async (_id, reason) => { log.push(['toVa', reason]) },
    status: async (_id, st) => { log.push(['status', st]) },
    result: async (_id, o) => { log.push(['result', o]) },
    deedstoneFrom: async () => ({ phone: '+17373383859', providerId: null, pool: 'main' }),
    voiceAgents: async () => agents,
    voiceCounts: async tests => { log.push(['counts', tests]); return counts },
    leadVoice: async () => earlier,
    setVoice: async (_id, v) => { log.push(['voice', v]) },
  }
  const provider = { ...noProvider(), key, ready: true, start: async a => { got = a; return { providerCallId: 'rc1' } } }
  const env = { now: () => Date.now(), from: '+18005550110', words: { opening: 'Hey {first}, this is Max, the virtual assistant with Deedstone Insurance.' } }
  return { store, provider, env, log, call, got: () => got }
}

test('a call takes the next voice: its agent dials, the name follows the voice, the voice is saved on the row', async () => {
  const f = fakes({ counts: { hope: 4, mark: 3 } })
  const r = await core.start(f.store, f.provider, f.env, f.call.id)
  assert.equal(r.ok, true)
  assert.equal(r.voice, 'mark')
  assert.equal(f.got().agentId, 'ag_m')
  assert.equal(f.got().vars.ai_name, 'Max')
  assert.deepEqual(f.log.find(l => l[0] === 'voice'), ['voice', 'mark'])
  assert.deepEqual(f.log.find(l => l[0] === 'counts'), ['counts', false]) // real leads counted apart from tests

  const g = fakes({ counts: { hope: 3, mark: 3 } })
  await core.start(g.store, g.provider, g.env, g.call.id)
  assert.equal(g.got().agentId, 'ag_h')
  assert.equal(g.got().vars.ai_name, 'Hope')
  assert.match(g.got().vars.opening, /this is Hope, the virtual assistant/)
})

test('second try keeps the lead\'s voice; a test call can ask for one; no split = the old agent, no voice saved', async () => {
  const f = fakes({ attempt: 2, earlier: 'hope', counts: { hope: 9, mark: 0 } })
  await core.start(f.store, f.provider, f.env, f.call.id)
  assert.equal(f.got().agentId, 'ag_h')

  const t = fakes({ test: { check: null, voice: 'mark' }, counts: { hope: 0, mark: 5 } })
  await core.start(t.store, t.provider, t.env, t.call.id)
  assert.equal(t.got().agentId, 'ag_m')

  for (const agents of [null, { hope: { agent_id: 'ag_h' } }]) {
    const n = fakes({ agents })
    const r = await core.start(n.store, n.provider, n.env, n.call.id)
    assert.equal(r.ok, true)
    assert.equal(n.got().agentId, null)
    assert.equal(n.got().vars.ai_name, 'Max')
    assert.ok(!n.log.some(l => l[0] === 'voice'))
  }
  const v = fakes({ key: 'vapi' })
  await core.start(v.store, v.provider, v.env, v.call.id)
  assert.equal(v.got().agentId, null)
})

test('the Retell adapter dials the voice\'s agent (override_agent_id), else its own agent', async () => {
  const { retell } = await import('../supabase/functions/ai-caller/providers.ts')
  const bodies = []
  const f = async (_u, init) => { bodies.push(JSON.parse(init.body)); return { ok: true, status: 200, json: async () => ({ call_id: 'c1' }), text: async () => '' } }
  const p = retell('k', 'agent_old', f)
  await p.start({ callId: 'x', to: '+15125556001', from: '+17373383859', maxSecs: 300, vars: {}, agentId: 'ag_h' })
  await p.start({ callId: 'y', to: '+15125556001', from: '+17373383859', maxSecs: 300, vars: {} })
  assert.equal(bodies[0].override_agent_id, 'ag_h')
  assert.equal(bodies[1].override_agent_id, 'agent_old')
})

test('admin By voice: sample has a believable split; the view rows map the same way; tests left out', () => {
  const rows = voiceStats(SAMPLE_AI_CALLS, SAMPLE_CENTS_PER_MIN)
  assert.deepEqual(rows.map(r => r.voice), ['hope', 'mark'])
  const firsts = SAMPLE_AI_CALLS.filter(c => c.attempt === 1)
  const h = firsts.filter(c => c.voice === 'hope').length, m = firsts.filter(c => c.voice === 'mark').length
  assert.ok(Math.abs(h - m) <= 1, `first calls ${h}/${m}`)
  for (const r of rows) {
    assert.ok(r.calls > 0 && r.answered > 0 && r.booked > 0)
    assert.equal(r.rate, Math.round((r.booked / r.answered) * 100))
    assert.ok(r.costCents > 0 && r.minutes > 0)
  }
  assert.equal(voiceStats([{ voice: 'hope', test: true, outcome: 'booked', duration: 60 }]).length, 0)
  const v = voiceStatsFromView([{ voice: 'mark', calls: 10, answered: 8, booked: 2, transferred: 1, minutes: 21.4, cost_cents: '331.70' }, { voice: 'hope', calls: 10, answered: 7, booked: 3, transferred: 0, minutes: 19, cost_cents: null }])
  assert.deepEqual(v.map(r => [r.voice, r.label, r.rate, r.costCents]), [['hope', 'Hope', 43, null], ['mark', 'Mark', 25, 331.7]])
})

test('migration 271: voice column, settings agents, counts function, view returns voice and by_voice', () => {
  const sql = readFileSync(new URL('../supabase/migrations/271_ai_caller_voice_split.sql', import.meta.url), 'utf8')
  assert.match(sql, /alter table public\.ai_calls add column if not exists voice text/)
  assert.match(sql, /alter table public\.ai_caller_settings add column if not exists voice_agents jsonb/)
  assert.match(sql, /function public\.ai_caller_voice_counts\(p_tests boolean\)/)
  assert.match(sql, /grant execute on function public\.ai_caller_voice_counts\(boolean\) to service_role;/)
  assert.match(sql, /'voice', c\.voice\)/)
  assert.match(sql, /'by_voice'/)
  assert.match(sql, /not coalesce\(l\.is_sample, false\)/)
  assert.ok(!/ai_caller_live/.test(sql.replace(/--.*$/gm, '')), 'never touches the switch')
})
