// P926 — the Retell agent, built from our rules (P892/P903). Plain JS (imports rules.js only) so the edge function,
// the portal and node --test build the same thing. index.ts `retell_setup` sends these bodies to Retell's
// create/update-retell-llm and create/update-agent; the webhook URL (with its secret) is added there, never here.
//
// Field names: Retell API reference, read Nov 10 2026 (create-retell-llm, create-agent, custom-function,
// transfer-call). The call flow is ours: Retell's LLM calls our custom functions and does what each reply says.
import { AI_RULES, ASK_AGENT_REASONS, SAID_OUTCOMES, TRANSFER_WORDS, WAIT_QUESTIONS, WAIT_RULE } from './rules.js'

export const RETELL_MODEL = 'gpt-4.1' // standard tier, about $0.045 a minute; Retell's best-tested tool caller
// Sounds like a person: normal speed, answers quickly, lets the caller cut in, small "mm-hm"s.
export const RETELL_VOICE_DEFAULTS = { voice_speed: 1, responsiveness: 0.9, interruption_sensitivity: 0.8, enable_backchannel: true, backchannel_frequency: 0.6 }

// How the LLM uses our replies. Every custom function returns JSON; these keys mean the same thing everywhere.
export const REPLY_RULES = [
  'Every function returns JSON. If it has "say", say those words exactly, then follow the rest of it.',
  'If it has "slots": offer at most three of those times, read in the caller’s own time zone (lead_tz), then call book with the one they pick as "at" (copy the time exactly as given).',
  'If it has "next": "check_status", call check_status again after about wait_secs seconds, and keep talking in between (see below).',
  'If it has "transfer_to": say the "say" words, then call transfer_call. Do not speak after that.',
  'If it has "end": true or "end_after": true, thank them warmly in one short sentence and call end_call.',
  'If it has "ok": false with no "say", carry on naturally; never read codes or JSON aloud.',
]

// The words: the draft opening line comes in as {{opening}} (index.ts fills the lead's first name), the rest from rules.js.
export function retellPrompt(questions = []) {
  return [
    '## Who you are',
    'You are Deedstone’s virtual assistant, calling someone who just asked about mortgage protection on our form. Warm, brief, plain words, one question at a time. You already said the opening line.',
    'Never discuss coverage, prices, carriers, or whether they qualify. Never say you are a person. Never hand the caller to anyone but their own agent ({{agent_first_name}}).',
    '## The questions',
    `Ask only these, one at a time, and wait for each answer: ${questions.join(' ')}`,
    `When they are answered, call qualified with a one-line summary.`,
    '## If they ask about coverage or price, or ask for a person',
    `Call ask_agent with reason ${Object.keys(ASK_AGENT_REASONS).join(' or ')} and follow what it returns (it says "${TRANSFER_WORDS.agentWill}" for you).`,
    '## If it is not a good time, not interested, or not them',
    `Not a good time: ask when would be better. If they give a time, call outcome with result not_now and "at" as that time (ISO 8601 with their offset). If not, outcome with result not_now. Not interested: outcome with result hard_no. Not them or never asked: outcome with result wrong_number. Results: ${SAID_OUTCOMES.join(', ')}.`,
    'Stop calling, do not call, take me off your list: say "Understood, we won’t call again." and call stop.',
    '## While their agent is checked',
    `When a reply has keep_talking, never leave silence. Ask these, one at a time: ${WAIT_QUESTIONS.join(' ')} ${WAIT_RULE}`,
    '## The transfer',
    `transfer_call rings {{agent_first_name}} for about ${AI_RULES.ringSecs} seconds; they hear a short note about the caller alone. If you are back with the caller (they did not answer), call transfer_failed and follow what it returns: it says "${TRANSFER_WORDS.bounce.replace('{agent}', '{{agent_first_name}}')}" and gives times to book.`,
    '## Replies from our functions',
    ...REPLY_RULES,
    '## Limits',
    `Keep the call under {{max_secs}} seconds. If a voicemail or machine answers, hang up without a message.`,
  ].join('\n')
}

const obj = (props, required = []) => ({ type: 'object', properties: props, required })
const str = description => ({ type: 'string', description })

// Our custom functions. `url` is the ai-caller webhook (with ?k=); Retell posts { name, args, call }.
export function retellTools(url) {
  const fn = (name, description, parameters = obj({}), extra = {}) => ({
    type: 'custom', name, description, url, method: 'POST', parameters, timeout_ms: 8000, speak_during_execution: false, speak_after_execution: true, ...extra,
  })
  return [
    fn('qualified', 'The questions are answered. Returns what to do next.', obj({ summary: str('One line: who it is for, age band, state, what they want.') }, ['summary'])),
    fn('ask_agent', 'They asked about coverage or price, or asked for a person.', obj({ reason: { type: 'string', enum: Object.keys(ASK_AGENT_REASONS) }, summary: str('One line so far.') }, ['reason'])),
    // check_status sets {{transfer_to}} and {{whisper}} for transfer_call from our reply.
    fn('check_status', 'Is their agent free? Call again while the reply says next: check_status.', obj({}), { response_variables: { transfer_to: 'transfer_to', whisper: 'whisper' } }),
    fn('transfer_failed', 'You are back with the caller after a transfer that was not answered.'),
    fn('slots', 'Times their agent can call them.'),
    fn('book', 'Book one of the times from slots.', obj({ at: str('The time exactly as given by slots.') }, ['at'])),
    fn('outcome', 'Not now, not interested, or wrong number.', obj({ result: { type: 'string', enum: SAID_OUTCOMES }, at: str('A better time, ISO 8601 with offset, if they gave one.'), summary: str('One line.') }, ['result'])),
    fn('stop', 'They asked not to be called again.'),
    { type: 'transfer_call', name: 'transfer_call', description: 'Connect the caller to their agent. Only after check_status returned transfer_to.',
      transfer_destination: { type: 'predefined', number: '{{transfer_to}}' },
      transfer_option: { type: 'warm_transfer', transfer_ring_duration_ms: AI_RULES.ringSecs * 1000, show_transferee_as_caller: false, on_hold_music: 'ringtone',
        private_handoff_option: { type: 'static_message', message: '{{whisper}}' } },
      speak_during_execution: false },
    { type: 'end_call', name: 'end_call', description: 'End the call after the goodbye, or when a machine answers.' },
  ]
}

export function retellLlm({ prompt, url }) {
  return {
    general_prompt: prompt, begin_message: '{{opening}}', start_speaker: 'agent',
    model_config: { type: 'cascading', primary: { model: RETELL_MODEL, tier: 'standard' }, temperature: 0.2 },
    general_tools: retellTools(url),
  }
}

export function retellAgent({ llmId, voiceId, webhookUrl, maxSecs = AI_RULES.maxCallSecs, voice = {} }) {
  return {
    agent_name: 'Deedstone virtual assistant (new leads)',
    response_engine: { type: 'retell-llm', llm_id: llmId },
    voice_id: voiceId, ...RETELL_VOICE_DEFAULTS, ...voice,
    language: 'en-US', webhook_url: webhookUrl, webhook_events: ['call_started', 'call_ended', 'call_analyzed'],
    end_call_after_silence_ms: 20000, max_call_duration_ms: Math.min(Math.max(maxSecs, 60), 900) * 1000, ring_duration_ms: 30000,
    voicemail_option: { action: { type: 'hangup' } },
    post_call_analysis_data: [{ type: 'system-presets', name: 'call_summary' }],
  }
}

// The voices worth offering: natural US English, from the list Retell returns.
export function pickVoices(list = [], n = 3) {
  const us = list.filter(v => /american|us/i.test(String(v.accent ?? '')) && v.preview_audio_url)
  const rank = v => ({ elevenlabs: 0, cartesia: 1, platform: 2, minimax: 3, openai: 4 }[v.provider] ?? 9)
  return us.sort((a, b) => rank(a) - rank(b)).slice(0, n)
}
