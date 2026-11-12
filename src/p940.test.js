// P940 — the AI caller as a warm appointment setter: gets through call screeners, leaves a short voicemail with a
// callback number, never names the agent ("a licensed specialist"), always goes for a transfer or a booked time.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { retellPrompt, retellAgent, retellLlm, retellTools, SCREEN_LINE, SCREEN_GOODBYE, VOICEMAIL_LINE, SCRIPT, RETELL_VOICE_DEFAULTS } from '../supabase/functions/ai-caller/retellSpec.js'
import { AI_CALL_WORDS } from '../supabase/functions/ai-caller/rules.js'
import * as core from '../supabase/functions/ai-caller/core.ts'
import { noProvider } from '../supabase/functions/ai-caller/providers.ts'

const HOOK = 'https://x.supabase.co/functions/v1/ai-caller?k=secret'

test('screening line is Brayden’s words, with the lead’s first name', () => {
  assert.equal(SCREEN_LINE, 'Hi, this is {{ai_name}} with Deedstone Insurance, calling for {{first_name}} about the mortgage protection information they requested.')
})

test('prompt: screener is not a hang-up, says the line, waits ~20 s, polite goodbye, no outcome', () => {
  const p = retellPrompt()
  assert.ok(p.includes(SCREEN_LINE))
  assert.match(p, /NOTHING after it/)
  assert.match(p, /stay completely silent/)
  assert.match(p, /about 20 seconds/)
  assert.ok(p.includes(SCREEN_GOODBYE))
  assert.match(p, /Do not call outcome/)
  assert.doesNotMatch(p, /hang up without a message/)
})

test('prompt: no small talk, why reflected back, form confirmed not asked, free now → check out loud → transfer or two times, the AI hangs up', () => {
  const p = retellPrompt()
  assert.match(p, /never ask how they are or how their day is/)
  assert.doesNotMatch(p, /How’s your day/)
  assert.match(p, /Never explain what mortgage protection is/)
  assert.match(p, /Never mention time zones/)
  assert.doesNotMatch(p, /Who are you mainly looking to protect/)
  assert.match(p, /Never ask who they want to protect/)
  assert.equal(p.split('Is this {{first_name}}?').length, 2) // only inside the Never rule
  assert.match(p, /Never ask "Is this \{\{first_name\}\}\?"/)
  assert.doesNotMatch(p, /Hi, is this \{\{first_name\}\}\?/)
  assert.match(p, /Thinking is not confusion/)
  assert.match(p, /hang_up_pause/)
  assert.match(p, /call hang_up_pause, and when it returns, call end_call/)
  assert.doesNotMatch(p, /You’ll get a text/)
  assert.equal(p.split(/the next step is/i).length, 2) // only inside the Never rule
  assert.match(p, /Never say "the next step is"/)
  assert.ok(!('hello' in SCRIPT) && !('reflect' in SCRIPT) && !('confirmIntro' in SCRIPT))
  for (const k of ['open', 'why', 'whyAlt', 'bridge', 'state', 'home', 'mortgage', 'next', 'booking', 'booked', 'bye']) {
    // the prompt swaps the {time} placeholder for its own wording; check the text before it
    const head = SCRIPT[k].split('{time}')[0].replace('{{form_state}}', 'Texas').replace('{{form_mortgage}}', 'about 250')
    assert.ok(p.includes(head), k)
  }
  // the form answers arrive as ready lines (Retell's LLM skipped lines built on empty-or-not variables)
  assert.ok(p.includes('{{form_lines}}') && p.includes('{{form_ask}}'))
  assert.deepEqual(core.formLines({ state: 'TX', homeowner: true, mortgage: '200-300k', age: '45-54' }),
    { form_lines: 'You’re in Texas, right? | And you own the home? | Still about 250 left on the mortgage?', form_ask: 'none' })
  assert.deepEqual(core.formLines({ state: 'tx' }), { form_lines: 'You’re in Texas, right?', form_ask: 'And do you own the home? | Roughly how much is left on the mortgage? | And roughly what age range are you in?' })
  assert.equal(core.spokenBalance('500k+'), 'over 500')
  assert.equal(core.spokenBalance('under-100k'), 'under 100')
  assert.ok(p.includes(SCRIPT.booked.replace('{time}', 'the time, in the same plain words, e.g. 4 this afternoon')))
  assert.ok(p.includes(SCRIPT.bye.replace('{time}', 'the short time, e.g. 4')))
  assert.ok(p.includes(SCRIPT.booking.replace('{time}', 'the time, in the same words you offered')))
  assert.match(SCRIPT.bye, /Take care!$/)
  for (const v of ['form_lines', 'form_ask']) assert.ok(p.includes(`{{${v}}}`), v)
  assert.match(p, /Natural, flowing, grammatical sentences/)
  assert.match(p, /No forced enthusiasm/)
  assert.match(p, /NOTHING after it/)
  assert.ok(/end_call/.test(p)) // the bye line is checked above (its {time} is filled in by the prompt)
  assert.match(p, /never ask if there is anything else you can help with/i) // the AI hangs up itself
  assert.doesNotMatch(p, /let them hang up first/)
  assert.doesNotMatch(p, /What has you looking into mortgage protection right now/)
  assert.match(p, /What works better, later today or tomorrow\?/)
  assert.match(p, /Never say "does that sound about right"/)
  assert.equal(p.split(/does that sound about right/i).length, 2) // only inside the "Never say" rule
  assert.match(p, /Are you free right now\?/) // objection answers
  assert.ok(SCRIPT.next.endsWith('Are you free?'))
  assert.ok(p.includes(AI_CALL_WORDS.check))
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
  assert.equal(a.responsiveness, 0.8)
  assert.equal(a.enable_dynamic_responsiveness, true)
  assert.equal(a.interruption_sensitivity, 0.5)
  assert.equal(a.voice_temperature, 0.8)
  assert.equal(a.stt_mode, 'fast')
  assert.equal(a.enable_backchannel, true)
  assert.deepEqual(a.backchannel_words, RETELL_VOICE_DEFAULTS.backchannel_words)
})

test('opening line: who it is and why it is calling, no small talk; test leads carry the form answers', () => {
  const src = readFileSync(new URL('../supabase/functions/ai-caller/index.ts', import.meta.url), 'utf8')
  assert.match(src, /opening: 'Hey \{first\}, this is Max, the virtual assistant with Deedstone Insurance\. I’m calling about the mortgage protection form you filled out\./)
  assert.doesNotMatch(src, /opening: '[^']*(how’s your day|how are you)/i)
  assert.match(src, /homeowner: true, mortgage_balance_band: '200-300k'/)
})

test('agent: voicemail leaves the message with the callback number, screeners are not voicemail, no IVR hang-up, 20 s silence stop', () => {
  const a = retellAgent({ llmId: 'llm_1', voiceId: 'v1', webhookUrl: HOOK })
  assert.deepEqual(a.voicemail_option.action, { type: 'static_text', text: VOICEMAIL_LINE })
  assert.match(VOICEMAIL_LINE, /\{\{callback_number\}\}/)
  assert.match(a.voicemail_option.detection_prompt, /screening assistant .* is NOT voicemail/)
  assert.equal(a.ivr_option, null)
  assert.equal(a.call_screening_option, null) // our prompt says the screening line itself
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
  assert.equal(r.say, undefined) // the check line is spoken by Retell via check_status
  assert.deepEqual([r.next, r.wait_secs], ['check_status', 0])
  assert.ok(f.log.some(x => x[0] === 'status' && x[1] === 'booking') && !f.log.some(x => x[0] === 'check'))
  const b = await core.tool(f.store, f.provider, f.env, { ...f.call, status: 'booking' }, 'check_status', {})
  assert.ok(b.say.startsWith('Okay, so unfortunately all of our specialists are with clients right now, but I can put you down for '))
  assert.ok(b.say.endsWith('Do either of those work for you?') && !b.say.includes('{times}'))
  assert.equal(b.slots.length, 2)
  assert.equal(b.next, 'book')
  assert.equal(b.spoken.length, 2)
})

test('check_status and book are spoken by Retell itself; hang_up_pause ends the call', async () => {
  const t = retellTools(HOOK)
  const cs = t.find(x => x.name === 'check_status')
  assert.equal(cs.speak_during_execution, false) // Max says the check line himself first (an execution message doubled it in chat)
  assert.ok(retellPrompt().includes(`say "${AI_CALL_WORDS.check}", then call qualified`))
  assert.equal(t.find(x => x.name === 'end_call').speak_during_execution, false)
  assert.match(retellPrompt(), /Never say the "whisper" aloud/)
  assert.ok(t.some(x => x.name === 'hang_up_pause'))
  assert.deepEqual(RETELL_VOICE_DEFAULTS.fallback_voice_ids, ['cartesia-Max'])
  const f = fakes()
  assert.equal((await core.tool(f.store, f.provider, f.env, { ...f.call }, 'hang_up_pause', {})).next, 'end_call')
})

test('free_now false: no agent check, straight to times', async () => {
  const f = fakes()
  const r = await core.tool(f.store, f.provider, f.env, { ...f.call }, 'qualified', { summary: 's', free_now: false })
  assert.deepEqual(r.slots, ['2026-11-10T22:00:00Z', '2026-11-11T16:30:00Z'])
  assert.ok(!f.log.some(x => x[0] === 'check'))
  assert.equal(f.log[0][1], 'booking'); assert.ok(['in_hours', 'out_of_hours', 'appts_only', 'not_reachable'].includes(f.log[0][2])) // ai_calls_routed_check
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

test('spokenSlot and twoTimes: plain-word times for the lead’s own state', () => {
  const now = Date.parse('2026-11-10T19:00:00Z')
  const sp = iso => core.spokenSlot(iso, 'America/Chicago', now).replace(/\s/g, ' ')
  assert.equal(sp('2026-11-10T21:30:00Z'), '3:30 this afternoon')
  assert.equal(sp('2026-11-10T23:00:00Z'), '5 this evening')
  assert.equal(sp('2026-11-11T16:00:00Z'), '10 tomorrow morning')
  assert.equal(sp('2026-11-12T15:00:00Z'), 'Thursday at 9 in the morning')
  assert.equal(core.twoTimes(['3:30 this afternoon', '5 this evening']), '3:30 this afternoon, or 5 this evening')
})
