// P940 — the AI gets through call screeners (iPhone, Google, Samsung) and leaves a short voicemail with a callback number.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AI_QUESTIONS } from './lib/aiCaller.js'
import { retellPrompt, retellAgent, SCREEN_LINE, SCREEN_GOODBYE, VOICEMAIL_LINE, SCREEN_OPTION } from '../supabase/functions/ai-caller/retellSpec.js'
import { spokenNumber } from '../supabase/functions/ai-caller/core.ts'

const HOOK = 'https://x.supabase.co/functions/v1/ai-caller?k=secret'

test('screening line is Brayden’s words, with the lead’s first name', () => {
  assert.equal(SCREEN_LINE, 'Hi, this is Max with Deedstone Insurance, calling for {{first_name}} about the mortgage protection information they requested.')
})

test('prompt: screener is not a hang-up, says the line, waits ~20 s, polite goodbye, no outcome; still a virtual assistant to the person', () => {
  const p = retellPrompt(AI_QUESTIONS)
  assert.ok(p.includes(SCREEN_LINE))
  assert.match(p, /do not hang up/)
  assert.match(p, /about 20 seconds/)
  assert.ok(p.includes(SCREEN_GOODBYE))
  assert.match(p, /Do not call outcome/)
  assert.match(p, /virtual assistant/)
  assert.doesNotMatch(p, /hang up without a message/)
})

test('agent: voicemail leaves the message with the callback number, screeners are not voicemail, no IVR hang-up, 20 s silence stop', () => {
  const a = retellAgent({ llmId: 'llm_1', voiceId: 'v1', webhookUrl: HOOK })
  assert.deepEqual(a.voicemail_option.action, { type: 'static_text', text: VOICEMAIL_LINE })
  assert.match(VOICEMAIL_LINE, /\{\{callback_number\}\}/)
  assert.match(VOICEMAIL_LINE, /Max with Deedstone Insurance/)
  assert.match(a.voicemail_option.detection_prompt, /screening assistant .* is NOT voicemail/)
  assert.equal(a.ivr_option, null)
  assert.deepEqual(a.call_screening_option, SCREEN_OPTION)
  assert.ok(SCREEN_OPTION.agent_identity.length <= 100 && SCREEN_OPTION.call_purpose.length <= 300)
  assert.equal(a.end_call_after_silence_ms, 20000)
  assert.ok(a.begin_message_delay_ms > 0 && a.begin_message_delay_ms <= 5000)
})

test('spokenNumber: E.164 to 737-338-3859', () => {
  assert.equal(spokenNumber('+17373383859'), '737-338-3859')
  assert.equal(spokenNumber(null), '')
})
