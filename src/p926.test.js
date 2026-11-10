// P926 — the AI caller on Retell: the agent we send to Retell (prompt, tools, transfer with a whisper, voice), and the
// admin test call (a sample lead: skips the switch, only dials the given number, check answered for the agent).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { AI_RULES } from './lib/aiCaller.js'
import { AI_CALL_WORDS } from '../supabase/functions/ai-caller/rules.js'
import { retellPrompt, retellTools, retellLlm, retellAgent, pickVoices, RETELL_VOICE_DEFAULTS } from '../supabase/functions/ai-caller/retellSpec.js'
import * as core from '../supabase/functions/ai-caller/core.ts'
import { noProvider } from '../supabase/functions/ai-caller/providers.ts'

const HOOK = 'https://x.supabase.co/functions/v1/ai-caller?k=secret'
const NOW = Date.parse('2026-11-10T21:00:00Z') // Tue 3 PM CT

test('prompt: Deedstone virtual assistant, the VA questions, never coverage or price, wait questions, bounce words', () => {
  const p = retellPrompt()
  assert.match(p, /the virtual assistant with Deedstone/)
  assert.match(p, /Never discuss coverage, prices, carriers/)
  assert.match(p, /never leave long silence/)
  assert.match(p, /call ask_agent/)
  assert.match(p, /call transfer_failed/)
  assert.doesNotMatch(p, /\bVA\b|virtual agent hand/i)
})

test('tools: our functions on the secret URL, check_status maps transfer_to + whisper, warm transfer with a private whisper, 20 s ring', () => {
  const t = retellTools(HOOK)
  const names = t.map(x => x.name)
  for (const n of ['qualified', 'ask_agent', 'check_status', 'transfer_failed', 'slots', 'book', 'outcome', 'stop', 'transfer_call', 'end_call']) assert.ok(names.includes(n), n)
  assert.ok(t.filter(x => x.type === 'custom').every(x => x.url === HOOK && x.method === 'POST'))
  assert.deepEqual(t.find(x => x.name === 'check_status').response_variables, { transfer_to: 'transfer_to', whisper: 'whisper' })
  const tr = t.find(x => x.type === 'transfer_call')
  assert.equal(tr.transfer_destination.number, '{{transfer_to}}')
  assert.equal(tr.transfer_option.type, 'warm_transfer')
  assert.equal(tr.transfer_option.private_handoff_option.message, '{{whisper}}')
  assert.equal(tr.transfer_option.transfer_ring_duration_ms, AI_RULES.ringSecs * 1000)
})

test('llm + agent bodies: opening from {{opening}}, gpt-4.1, voice knobs, hang up on voicemail, webhook events', () => {
  const l = retellLlm({ prompt: 'p', url: HOOK })
  assert.equal(l.begin_message, '{{opening}}')
  assert.equal(l.start_speaker, 'agent')
  assert.equal(l.model_config.primary.model, 'claude-5.5-sonnet') // P940
  assert.equal(l.model_config.backup.model, 'gpt-4.1')
  const a = retellAgent({ llmId: 'llm_1', voiceId: 'v1', webhookUrl: HOOK, maxSecs: 300, voice: { voice_speed: 1.05 } })
  assert.deepEqual(a.response_engine, { type: 'retell-llm', llm_id: 'llm_1' })
  assert.equal(a.voice_speed, 1.05)
  assert.equal(a.interruption_sensitivity, RETELL_VOICE_DEFAULTS.interruption_sensitivity)
  assert.equal(a.max_call_duration_ms, 300000)
  assert.equal(a.voicemail_option.action.type, 'static_text') // P940: leaves a message
  assert.deepEqual(a.webhook_events, ['call_started', 'call_ended', 'call_analyzed'])
})

test('pickVoices: US voices with a preview, ElevenLabs first', () => {
  const v = pickVoices([{ voice_id: 'a', accent: 'British', provider: 'elevenlabs', preview_audio_url: 'x' }, { voice_id: 'b', accent: 'American', provider: 'openai', preview_audio_url: 'x' },
    { voice_id: 'c', accent: 'American', provider: 'elevenlabs', preview_audio_url: 'x' }, { voice_id: 'd', accent: 'American', provider: 'elevenlabs' }])
  assert.deepEqual(v.map(x => x.voice_id), ['c', 'b'])
})

function fakes({ test: t = null, live = false, attempt = 1 } = {}) {
  const log = []
  const call = { id: '22222222-2222-4222-8222-222222222222', lead_id: 'l1', agent_id: 'ag-t', attempt, status: 'queued', provider_call_id: null, check_id: null, routed: null, summary: null, booked_for: null }
  let check = null
  const store = {
    live: async () => ({ on: live, maxSecs: 300 }),
    call: async () => ({ ...call }),
    callByProvider: async () => ({ ...call }),
    lead: async () => ({ id: 'l1', first: 'Brayden', phone: '+15125550123', state: 'TX', tz: 'America/Chicago', need: 'Mortgage protection', age: '45-54', test: t }),
    agent: async () => ({ id: 'ag-t', first: 'Test', phone: '+15125550100', mode: 'appts', hours: {}, tz: 'America/Chicago', reachable: false }),
    takes: async () => { log.push(['takes']); return { by: 'va', reason: 'consent' } },
    toVa: async (_id, r) => { log.push(['toVa', r]); call.status = 'to_va' },
    status: async (_id, st, patch = {}) => { Object.assign(call, { status: st, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v != null)) }); return call },
    result: async (_id, o, p = {}) => { log.push(['result', o, p.summary]); call.status = 'done' },
    slots: async () => ['2026-11-11T16:00:00Z'],
    book: async (_id, at) => { call.booked_for = at; return { ok: true } },
    insertCheck: async row => { check = { id: 'chk', status: 'sent', answer: null, expires_at: null, summary: row.summary }; return check },
    check: async () => ({ ...check }),
    sendCheck: async () => { log.push(['push']); return true },
    markCheck: async (_id, patch) => { log.push(['mark', patch.status, patch.is_test]); Object.assign(check, patch) },
    clearCheck: async () => {},
  }
  const provider = { ...noProvider(), key: 'retell', ready: true, talksWhileWaiting: true,
    start: async a => { log.push(['dial', a.to, a.from]); return { providerCallId: 'rc1' } },
    transfer: async (_id, to) => { log.push(['transfer', to]) } }
  const env = { now: () => NOW, from: '+15125559999', words: { opening: 'Hi {first}' } }
  const tool = (name, args = {}) => core.onEvent(store, provider, env, { type: 'tool', providerCallId: 'rc1', callId: call.id, toolCallId: null, name, args })
  return { log, call, store, provider, env, tool, start: () => core.start(store, provider, env, call.id), answered: () => core.onEvent(store, provider, env, { type: 'answered', providerCallId: 'rc1', callId: call.id }) }
}

test('a real lead with the switch off still goes to a VA (unchanged); a test call dials with the switch off and skips the lead rules', async () => {
  const real = fakes()
  assert.equal((await real.start()).code, 'switch_off')
  assert.deepEqual(real.log, [['toVa', 'switch_off']])
  const t = fakes({ test: { check: null } })
  assert.equal((await t.start()).ok, true)
  assert.deepEqual(t.log, [['dial', '+15125550123', '+15125559999']])
})

test('a test call is never tried twice', async () => {
  const t = fakes({ test: { check: null }, attempt: 2 })
  assert.equal((await t.start()).code, 'test_no_retry')
  assert.equal(t.log[0][1], 'no_answer')
})

test('test "transfer": check answered Yes for the agent (no push), transfer to the given number', async () => {
  const t = fakes({ test: { check: 'yes', transferTo: '+15125550777' } })
  await t.start(); await t.answered()
  const r = await t.tool('qualified', { summary: 'TX 45-54' })
  assert.equal(r.next, 'check_status')
  assert.ok(!t.log.some(x => x[0] === 'push'))
  assert.deepEqual(t.log.find(x => x[0] === 'mark'), ['mark', 'yes', true])
  const s = await t.tool('check_status')
  assert.equal(s.transfer_to, '+15125550777')
  assert.ok(s.whisper)
})

test('test "agent_no": check answered No → bounce words and times to book', async () => {
  const t = fakes({ test: { check: 'no' } })
  await t.start(); await t.answered(); await t.tool('qualified', {})
  const s = await t.tool('check_status')
  assert.ok(s.say.startsWith(AI_CALL_WORDS.bounce)) // P940: never "Test Agent"
  assert.deepEqual(s.slots, ['2026-11-11T16:00:00Z'])
})

test('test "booked": no check, straight to times', async () => {
  const t = fakes({ test: { check: null } })
  await t.start(); await t.answered()
  const r = await t.tool('qualified', {})
  assert.deepEqual(r.slots, ['2026-11-11T16:00:00Z'])
})

test('edge function: only a sample lead can carry a test; test_call refuses anything but a +1 number', () => {
  const src = readFileSync(new URL('../supabase/functions/ai-caller/index.ts', import.meta.url), 'utf8')
  assert.match(src, /l\.is_sample && qa\.test/)
  assert.match(src, /E164 = \/\^\\\+1\[2-9\]\\d\{9\}\$\//)
  assert.match(src, /is_sample: true/)
  assert.doesNotMatch(src, /ai_caller_live['"]?\s*[:=]\s*true/)
})
