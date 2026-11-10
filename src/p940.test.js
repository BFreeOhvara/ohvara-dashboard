// P940 — the AI caller as a warm appointment setter: gets through call screeners, leaves a short voicemail with a
// callback number, never names the agent ("a licensed specialist"), always goes for a transfer or a booked time.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { retellPrompt, retellAgent, retellLlm, retellTools, SCREEN_LINE, SCREEN_GOODBYE, VOICEMAIL_LINE, SCREEN_OPTION, RETELL_VOICE_DEFAULTS } from '../supabase/functions/ai-caller/retellSpec.js'
import { AI_CALL_WORDS } from '../supabase/functions/ai-caller/rules.js'
import * as core from '../supabase/functions/ai-caller/core.ts'
import { noProvider } from '../supabase/functions/ai-caller/providers.ts'

const HOOK = 'https://x.supabase.co/functions/v1/ai-caller?k=secret'

test('screening line is Brayden’s words, with the lead’s first name', () => {
  assert.equal(SCREEN_LINE, 'Hi, this is Max with Deedstone Insurance, calling for {{first_name}} about the mortgage protection information they requested.')
})

test('prompt: screener is not a hang-up, says the line, waits ~20 s, polite goodbye, no outcome', () => {
  const p = retellPrompt()
  assert.ok(p.includes(SCREEN_LINE))
  assert.match(p, /do not hang up/)
  assert.match(p, /about 20 seconds/)
  assert.ok(p.includes(SCREEN_GOODBYE))
  assert.match(p, /Do not call outcome/)
  assert.doesNotMatch(p, /hang up without a message/)
})

test('prompt: no small talk, why NOW reflected back, form answers confirmed not asked, free now → check out loud → transfer or two times', () => {
  const p = retellPrompt()
  assert.match(p, /never ask how they are or how their day is going/)
  assert.doesNotMatch(p, /How’s your day going\?"$/m)
  assert.match(p, /What has you looking into mortgage protection right now\?/)
  assert.match(p, /Reflect it back in one natural sentence/)
  assert.match(p, /No other filler questions/)
  assert.match(p, /I see you’re in \{\{form_state\}\}, is that right\?/)
  for (const v of ['form_homeowner', 'form_mortgage', 'form_age']) assert.ok(p.includes(`{{${v}}}`), v)
  assert.match(p, /only if \{\{form_age\}\} is empty/)
  assert.match(p, /natural, flowing sentences/)
  assert.match(p, /Do not force enthusiasm/)
  assert.match(p, /Is there anything else I can help with\?/)
  assert.match(p, /let them hang up first/)
  assert.match(p, /Are you free right now\? I can bring a licensed specialist on the line\./)
  assert.match(p, /What works better, later today or tomorrow\?/)
  assert.match(p, /offer TWO of those times/)
  assert.match(p, /You’ll get a text confirming it/)
  for (const w of [AI_CALL_WORDS.check, AI_CALL_WORDS.connecting, AI_CALL_WORDS.bounce]) assert.ok(p.includes(w), w)
  assert.match(p, /Never end a call with a real person without trying to transfer or book/)
  for (const o of [/Just send me info/, /How much is it/, /already have coverage/, /spouse/, /robot/, /Not interested/, /Stop calling/]) assert.match(p, o)
})

test('prompt and tools never name the agent', () => {
  const p = retellPrompt()
  assert.doesNotMatch(p, /agent_first_name|Test Agent/)
  assert.match(p, /Never say the agent’s name\. Always say "a licensed specialist"/)
  const t = JSON.stringify(retellTools(HOOK))
  assert.doesNotMatch(t, /agent_first_name/)
  for (const w of Object.values(AI_CALL_WORDS)) assert.doesNotMatch(w, /\{agent\}/)
  assert.ok(retellTools(HOOK).find(x => x.name === 'qualified').parameters.required.includes('free_now'))
})

test('model and voice: Claude Sonnet 5.5, no billed backup; smooth voice, waits its turn, harder to interrupt', () => {
  const l = retellLlm({ prompt: 'p', url: HOOK })
  assert.equal(l.model_config.primary.model, 'claude-5.5-sonnet')
  assert.equal(l.model_config.backup, null)
  const a = retellAgent({ llmId: 'llm_1', voiceId: 'v1', webhookUrl: HOOK })
  assert.equal(a.voice_speed, 1)
  assert.equal(a.voice_model, 'eleven_multilingual_v2')
  assert.ok(a.voice_temperature < 1)
  assert.ok(a.responsiveness <= 0.6 && a.interruption_sensitivity <= 0.6)
  assert.equal(a.stt_mode, 'accurate')
  assert.equal(a.enable_backchannel, true)
  assert.deepEqual(a.backchannel_words, RETELL_VOICE_DEFAULTS.backchannel_words)
})

test('opening line: who it is and why it is calling, no small talk; test leads carry the form answers', () => {
  const src = readFileSync(new URL('../supabase/functions/ai-caller/index.ts', import.meta.url), 'utf8')
  assert.match(src, /opening: 'Hi \{first\}, this is Max, the virtual assistant with Deedstone Insurance\. I’m following up on the mortgage protection request you just sent in\./)
  assert.doesNotMatch(src, /opening: '[^']*(how’s your day|how are you)/i)
  assert.match(src, /homeowner: true, mortgage_balance_band: '200-300k'/)
})

test('agent: voicemail leaves the message with the callback number, screeners are not voicemail, no IVR hang-up, 20 s silence stop', () => {
  const a = retellAgent({ llmId: 'llm_1', voiceId: 'v1', webhookUrl: HOOK })
  assert.deepEqual(a.voicemail_option.action, { type: 'static_text', text: VOICEMAIL_LINE })
  assert.match(VOICEMAIL_LINE, /\{\{callback_number\}\}/)
  assert.match(a.voicemail_option.detection_prompt, /screening assistant .* is NOT voicemail/)
  assert.equal(a.ivr_option, null)
  assert.deepEqual(a.call_screening_option, SCREEN_OPTION)
  assert.ok(SCREEN_OPTION.agent_identity.length <= 100 && SCREEN_OPTION.call_purpose.length <= 300)
  assert.equal(a.end_call_after_silence_ms, 20000)
  assert.ok(a.begin_message_delay_ms > 0 && a.begin_message_delay_ms <= 5000)
})

test('spokenNumber: E.164 to 737-338-3859', () => {
  assert.equal(core.spokenNumber('+17373383859'), '737-338-3859')
  assert.equal(core.spokenNumber(null), '')
})

// A small in-memory store: the Test Agent takes live transfers in hours (mode both, all-day hours on a test lead).
function fakes() {
  const log = []
  const call = { id: '33333333-3333-4333-8333-333333333333', lead_id: 'l1', agent_id: 'ag', attempt: 1, status: 'talking', provider_call_id: 'p1', check_id: null, routed: null, summary: null, booked_for: null }
  const store = {
    call: async () => ({ ...call }), callByProvider: async () => ({ ...call }),
    lead: async () => ({ id: 'l1', first: 'Brayden', phone: '+15125550123', state: 'TX', tz: 'America/Chicago', test: { check: 'yes' } }),
    agent: async () => ({ id: 'ag', first: 'Test', phone: '+15125550100', mode: 'both', hours: {}, tz: 'America/Chicago', reachable: true }),
    status: async (_id, st, patch = {}) => { log.push(['status', st, patch.routed]); Object.assign(call, { status: st }) },
    result: async (_id, o) => { log.push(['result', o]); call.status = 'done' },
    slots: async () => ['2026-11-10T22:00:00Z', '2026-11-11T16:30:00Z'],
    insertCheck: async () => { log.push(['check']); return { id: 'chk' } },
    markCheck: async () => {}, sendCheck: async () => true, check: async () => ({ id: 'chk', answer: 'yes' }), clearCheck: async () => {},
    endStats: async (_id, p) => { log.push(['endStats', p.duration_secs, p.cost_cents]) },
  }
  const provider = { ...noProvider(), key: 'retell', ready: true, talksWhileWaiting: true, toolReply: (_id, r) => r }
  const env = { now: () => Date.parse('2026-11-10T19:00:00Z'), from: '+17373383859', words: { opening: '' } }
  return { log, call, store, provider, env }
}

test('free_now true but no specialist can take it (appointments only): the check line, then "all with clients", then times', async () => {
  const f = fakes()
  f.store.agent = async () => ({ id: 'ag', first: 'Test', phone: '+15125550100', mode: 'appts', hours: {}, tz: 'America/Chicago', reachable: true })
  f.store.lead = async () => ({ id: 'l1', first: 'Brayden', phone: '+15125550123', state: 'TX', tz: 'America/Chicago', test: null })
  const r = await core.tool(f.store, f.provider, f.env, { ...f.call }, 'qualified', { summary: 's', free_now: true })
  assert.equal(r.say, `${AI_CALL_WORDS.check} ${AI_CALL_WORDS.bounce}`)
  assert.equal(r.slots.length, 2)
})

test('free_now false: no agent check, straight to times', async () => {
  const f = fakes()
  const r = await core.tool(f.store, f.provider, f.env, { ...f.call }, 'qualified', { summary: 's', free_now: false })
  assert.deepEqual(r.slots, ['2026-11-10T22:00:00Z', '2026-11-11T16:30:00Z'])
  assert.ok(!f.log.some(x => x[0] === 'check'))
  assert.deepEqual(f.log[0], ['status', 'booking', 'lead_not_free'])
})

test('free_now true: the agent is checked (transfer path)', async () => {
  const f = fakes()
  const r = await core.tool(f.store, f.provider, f.env, { ...f.call }, 'qualified', { summary: 's', free_now: true })
  assert.equal(r.next, 'check_status')
  assert.ok(f.log.some(x => x[0] === 'check'))
})

test('a call that ended with a result mid-call still gets its minutes and cost', async () => {
  const f = fakes()
  f.call.status = 'done'
  await core.onEvent(f.store, f.provider, f.env, { type: 'ended', providerCallId: 'p1', callId: f.call.id, reason: 'hangup', durationSecs: 96, costCents: 26.88 })
  assert.deepEqual(f.log.at(-1), ['endStats', 96, 26.88])
})
