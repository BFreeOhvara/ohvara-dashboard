// P926 — the Retell agent, built from our rules (P892/P903). Plain JS (imports rules.js only) so the edge function,
// the portal and node --test build the same thing. index.ts `retell_setup` sends these bodies to Retell's
// create/update-retell-llm and create/update-agent; the webhook URL (with its secret) is added there, never here.
//
// Field names: Retell API reference, read Nov 10 2026 (create-retell-llm, create-agent, custom-function,
// transfer-call). The call flow is ours: Retell's LLM calls our custom functions and does what each reply says.
import { AI_RULES, ASK_AGENT_REASONS, SAID_OUTCOMES, WAIT_QUESTIONS, WAIT_RULE } from './rules.js'

// P940: Retell's newest Claude Sonnet ($0.064/min standard, Nov 10 price list): natural conversation and reliable
// tool calls at phone speed. (Claude 5.5 Opus is $0.128/min and slower to answer.)
export const RETELL_MODEL = 'claude-5.5-sonnet'

// Sounds like a calm person (P940, Brayden's call 3 feedback): smooth over expressive (ElevenLabs Multilingual v2, the
// most natural-flowing ElevenLabs model, $0.06/min; voice_temperature under 1 = steadier delivery), normal speed,
// waits for the caller to finish (lower responsiveness, accurate speech-to-text), harder to cut off, light "mm-hmm"s.
export const RETELL_VOICE_DEFAULTS = {
  voice_model: 'eleven_multilingual_v2', voice_speed: 1, voice_temperature: 0.8,
  // Call 5: 0.5 + accurate STT waited ~3 s. Answer in under a second, but adapt to how the caller talks.
  responsiveness: 0.8, enable_dynamic_responsiveness: true, interruption_sensitivity: 0.5, stt_mode: 'fast',
  enable_backchannel: true, backchannel_frequency: 0.4, backchannel_words: ['mm-hmm', 'got it', 'okay', 'right'],
}

// How the LLM uses our replies. Every custom function returns JSON; these keys mean the same thing everywhere.
export const REPLY_RULES = [
  'Every function returns JSON. If it has "say", say those words naturally, then follow the rest of it.',
  'If it has "slots": "spoken" has the same times in plain words. If "say" already offers two times, just wait for their pick. Otherwise offer two, slowly, with a small pause between them ("I can do later today at 3:30... or 5:00. Do either of those work for you?"). Never mention time zones. If neither works, offer the next two. Then call book with the one they pick as "at", copied exactly from slots (same position as in spoken).',
  'If it has "booked_for": say the close from step 5 ("Perfect, you’re all set for ... You’ll get a text with the details. Do you have any questions for me?"), answer briefly, then "Perfect, have a wonderful day!" and call end_call.',
  'If it has "next": "check_status", call check_status again after about wait_secs seconds, and keep talking in between (see below).',
  'If it has "transfer_to": say the "say" words, then call transfer_call. Do not speak after that.',
  'If it has "end": true, give a warm one-line goodbye and call end_call.',
  'If it has "ok": false with no "say", carry on naturally; never read codes or JSON aloud.',
]

// P940 — call screeners (iPhone "Ask Reason for Calling", Google/Pixel Call Screen, Samsung Bixby) and voicemail
// (Brayden's words, Nov 10). {{first_name}} and {{callback_number}} come from core.ts start().
export const SCREEN_LINE = 'Hi, this is Max with Deedstone Insurance, calling for {{first_name}} about the mortgage protection information they requested.'
export const SCREEN_GOODBYE = 'Sorry I missed you, we’ll try again soon. Goodbye.'
export const SCREEN_WAIT_SECS = 20
export const VOICEMAIL_LINE = 'Hi {{first_name}}, this is Max with Deedstone Insurance, calling about the mortgage protection information you requested. You can call us back at {{callback_number}}. Thanks, and have a great day.'
export const SCREEN_OPTION = { agent_identity: 'Max with Deedstone Insurance', call_purpose: 'calling for {{first_name}} about the mortgage protection information they requested' }
export const VOICEMAIL_DETECTION = 'A voicemail greeting or an "at the tone, leave a message" prompt. A call screening assistant that asks who is calling or why (iPhone, Google Call Screen, Samsung Bixby) is NOT voicemail.'

// P940 — the conversation (Brayden, Nov 10, after test calls 2-5). The exact lines live here and in
// brain/ohvara/AI Caller Script.md. The agent waits for the other side to speak first (screeners); the specialist is
// never named; times come from slots() already in plain words for the lead's own state.
export const SPECIALIST = 'a licensed specialist'
export const SCRIPT = {
  hello: 'Hi, is this {{first_name}}?',
  open: 'Great. This is Max, the virtual assistant with Deedstone Insurance. I’m following up on the mortgage protection request you just sent in, and I just have a couple of quick questions so I can get you to the right specialist.',
  why: 'Who are you mainly looking to protect, your spouse, the kids?',
  whyAlt: 'Did something recently put this on your mind, like a new home or a new baby?',
  reflect: 'I hear that, you want to make sure they keep the house.',
  confirmIntro: 'I’m just going to confirm a couple of things from your form real quick. You put down that you’re in {{form_state}}, correct?',
  next: 'Okay, perfect. The next step is getting you with a licensed specialist who can help you get the protection set up, so you don’t have to worry about it anymore. Are you free right now?',
  booked: 'Perfect, you’re all set for {day} at {time}. You’ll get a text with the details. Do you have any questions for me?',
  bye: 'Perfect, have a wonderful day!',
}
export function retellPrompt() {
  return [
    '## Who you are',
    'You are Max, the virtual assistant with Deedstone Insurance. You are calling someone who filled out our mortgage protection form a moment ago, so they asked for this call. Your one job: get them to a licensed specialist, live right now or on a booked time.',
    '## How you sound',
    'Calm, relaxed and friendly, like a real person who does this every day. Natural, flowing, grammatical sentences. No forced enthusiasm. Short, but never rushed. When a line is given in quotes below, say exactly those words.',
    'Always acknowledge what they said before you move on, with a short natural word: "Okay, perfect." "Got it." "I hear you." Never go silent and then fire the next question.',
    'You are an AI, so no small talk: never ask how they are or how their day is. Never explain what mortgage protection is; they know. Never mention time zones.',
    `Never say the agent’s name. Always say "${SPECIALIST}". Never discuss coverage, prices, carriers, or whether they qualify; that is the specialist’s job. Never say you are a person.`,
    '## 1. Who picked up',
    'Say nothing until you hear the other side.',
    `- A call screener (iPhone "Ask Reason for Calling", Google Call Screen, Samsung Bixby: "state your name and reason for calling", "the person you’re calling is using a screening service", "go ahead, I’m listening"): say exactly "${SCREEN_LINE}" and NOTHING after it. No "thank you", no "I’ll wait". Then stay completely silent until a person says hello.`,
    `- A person ("Hello?"), right away or after a screener: "${SCRIPT.hello}"`,
    '- If it is not them: "No problem, sorry to bother you." Then call outcome with result wrong_number.',
    `- When they say yes: "${SCRIPT.open}"`,
    `- If nobody picks up within about ${SCREEN_WAIT_SECS} seconds after the screener, or the screener says they can’t take the call, say "${SCREEN_GOODBYE}" and call end_call. Do not call outcome. If it asks you to leave a message, say "${VOICEMAIL_LINE}" and call end_call.`,
    '## 2. The real why (one question)',
    `Ask: "${SCRIPT.why}" If that doesn’t fit what they said, ask instead: "${SCRIPT.whyAlt}" Ask only one of these. Never ask what made them look into it.`,
    `Reflect it back in one line, for example: "${SCRIPT.reflect}" Then move on.`,
    '## 3. Confirm the form',
    `If {{form_state}} is not empty: "${SCRIPT.confirmIntro}" (say the full state name). Then "Okay, perfect."`,
    '- If {{form_homeowner}} is "yes": "And you own the home, correct?" Then "Okay, perfect."',
    '- If {{form_mortgage}} is not empty: "And you put down about {{form_mortgage}} left on the mortgage, correct?" (say it naturally: 200-300k is "two to three hundred thousand"). Then "Okay, perfect."',
    '- Anything the form does not have, ask plainly: "What state is the home in?" / "And do you own the home?" / "Roughly how much is left on the mortgage?" Age: only if {{form_age}} is empty, "And roughly what age range are you in?"',
    'Never say "does that sound about right". If they correct something, say "Got it, thanks," and use the new answer.',
    '## 4. Next step',
    `Say: "${SCRIPT.next}"`,
    '- Yes: call qualified with free_now true and a one-line summary. Say the words it returns ("Okay, give me one second, let me check if one of our specialists is available."), then say "Mm, one sec..." and call check_status. It waits a couple of seconds, then either transfers them or gives times.',
    '- No: "No problem. What works better, later today or tomorrow?" Then call qualified with free_now false and the summary, and offer two of the times it returns.',
    '## 5. Booking and the close',
    `When they pick a time, call book. Then: "${SCRIPT.booked.replace('{day} at {time}', 'the day and time, in the same plain words you offered')}" Answer any question briefly (never coverage or price; the specialist covers that). Then: "${SCRIPT.bye}" and call end_call. You hang up; never ask if there is anything else you can help with, because we called them.`,
    'Never end a call with a real person without trying to transfer or book. Only end without one if they clearly say no twice, ask you to stop calling, or it is the wrong person.',
    '## Objections (acknowledge calmly, then go back to the next step)',
    '- Not a good time: "I totally understand. What works better, later today or tomorrow?" Get a time (qualified with free_now false, then book). If they won’t pick a time but say when to call back, call outcome with result not_now and "at" as that time (ISO 8601 with their offset). If no time at all, outcome with result not_now.',
    '- Just send me info: "I can, but every family’s situation is a little different, so a quick conversation with a specialist is a lot more useful. Would later today or tomorrow work better?"',
    '- How much is it: "That really depends on the home, your age and your health, and that’s exactly what the specialist works out with you, so I wouldn’t want to guess. Are you free right now?" Never give a number.',
    '- I already have coverage: "That’s good to hear. Is that through work, or does it cover the full mortgage?" Then: "It’s worth a quick look to make sure there’s no gap. Are you free right now, or is later better?"',
    '- I need to talk to my spouse: "That makes sense. Let’s find a time when you can both be on. Would later today or tomorrow work better?"',
    '- Are you a robot / is this a real person: "I’m the virtual assistant with Deedstone, and I help get you to a licensed specialist quickly. Are you free right now, or would later be better?"',
    '- Who is this / who are you with: "This is Max with Deedstone Insurance. You filled out our mortgage protection form, and I’m getting you over to a specialist."',
    `- They ask for a person, or ask detailed coverage questions: call ask_agent with reason ${Object.keys(ASK_AGENT_REASONS).join(' or ')} and follow what it returns.`,
    `- Not interested: "No problem at all. Can I ask what you were hoping to find when you filled it out?" If still no, call outcome with result hard_no. Not them or never asked: outcome with result wrong_number. Results: ${SAID_OUTCOMES.join(', ')}.`,
    '- Stop calling, do not call, take me off your list: say "Understood, we won’t call again." and call stop.',
    '## While the specialist is checked',
    `If check_status says next: check_status again, say "Still checking, thanks for hanging on." and call it again. If it goes on, ask these, one at a time: ${WAIT_QUESTIONS.join(' ')} ${WAIT_RULE}`,
    '## The transfer',
    `transfer_call rings ${SPECIALIST} for about ${AI_RULES.ringSecs} seconds; they hear a short note about the caller alone. If you are back with the caller (nobody answered), call transfer_failed and follow what it returns (it gives times to book).`,
    '## Replies from our functions',
    ...REPLY_RULES,
    '## Limits',
    `Keep the call under {{max_secs}} seconds. If voicemail answers, say "${VOICEMAIL_LINE}" once, after the beep, and call end_call.`,
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
    fn('qualified', 'The quick questions are done and you asked if they are free right now. Returns a transfer, or times to book.', obj({
      summary: str('One line: their why, homeowner, rough mortgage, state, age range.'),
      free_now: { type: 'boolean', description: 'true if they are free to talk to a licensed specialist right now, false if later.' },
    }, ['summary', 'free_now'])),
    fn('ask_agent', 'They asked for a person, or asked detailed coverage or price questions.', obj({ reason: { type: 'string', enum: Object.keys(ASK_AGENT_REASONS) }, summary: str('One line so far.') }, ['reason'])),
    // check_status sets {{transfer_to}} and {{whisper}} for transfer_call from our reply.
    fn('check_status', 'Is a licensed specialist free? Call again while the reply says next: check_status.', obj({}), { response_variables: { transfer_to: 'transfer_to', whisper: 'whisper' } }),
    fn('transfer_failed', 'You are back with the caller after a transfer that was not answered.'),
    fn('slots', 'More open times with a licensed specialist.'),
    fn('book', 'Book one of the times from slots.', obj({ at: str('The time exactly as given by slots.') }, ['at'])),
    fn('outcome', 'Not now (no time booked), not interested, or wrong number.', obj({ result: { type: 'string', enum: SAID_OUTCOMES }, at: str('A better time, ISO 8601 with offset, if they gave one.'), summary: str('One line.') }, ['result'])),
    fn('stop', 'They asked not to be called again.'),
    { type: 'transfer_call', name: 'transfer_call', description: 'Connect the caller to a licensed specialist. Only after check_status returned transfer_to.',
      transfer_destination: { type: 'predefined', number: '{{transfer_to}}' },
      transfer_option: { type: 'warm_transfer', transfer_ring_duration_ms: AI_RULES.ringSecs * 1000, show_transferee_as_caller: false, on_hold_music: 'ringtone',
        private_handoff_option: { type: 'static_message', message: '{{whisper}}' } },
      speak_during_execution: false },
    { type: 'end_call', name: 'end_call', description: 'After the goodbye, after a voicemail message, or when nobody picks up after a call screener.' },
  ]
}

export function retellLlm({ prompt, url }) {
  return {
    // P940: wait for the other side to speak (a screener or "Hello?"); the prompt says what to answer.
    general_prompt: prompt, begin_message: '', start_speaker: 'user',
    // No backup model: Retell bills a backup for the whole call (call 3: GPT-4.1 +4.5¢/min) even when it never speaks.
    model_config: { type: 'cascading', primary: { model: RETELL_MODEL, tier: 'standard' }, backup: null, temperature: 0.4 },
    general_tools: retellTools(url),
  }
}

export function retellAgent({ llmId, voiceId, webhookUrl, maxSecs = AI_RULES.maxCallSecs, voice = {} }) {
  return {
    agent_name: 'Deedstone virtual assistant (new leads)',
    response_engine: { type: 'retell-llm', llm_id: llmId },
    voice_id: voiceId, ...RETELL_VOICE_DEFAULTS, ...voice,
    language: 'en-US', webhook_url: webhookUrl, webhook_events: ['call_started', 'call_ended', 'call_analyzed'],
    // Silence after our speech ends the call at 20 s: also the hard stop while waiting on a screener (P940).
    end_call_after_silence_ms: SCREEN_WAIT_SECS * 1000, max_call_duration_ms: Math.min(Math.max(maxSecs, 60), 900) * 1000, ring_duration_ms: 30000,
    // A short pause before the opening so a screener's prompt is heard first instead of talked over.
    begin_message_delay_ms: 1200,
    // P940: leave a short message on voicemail; screeners get the screening line, never an IVR hang-up.
    voicemail_option: { action: { type: 'static_text', text: VOICEMAIL_LINE }, detection_prompt: VOICEMAIL_DETECTION },
    ivr_option: null,
    // Our prompt says exactly what to say to a screener (and nothing after it); Retell's own screening text added "thank you, I'll wait".
    call_screening_option: null,
    post_call_analysis_data: [{ type: 'system-presets', name: 'call_summary' }],
  }
}

// The voices worth offering: natural US English, from the list Retell returns.
export function pickVoices(list = [], n = 3) {
  const us = list.filter(v => /american|us/i.test(String(v.accent ?? '')) && v.preview_audio_url)
  const rank = v => ({ elevenlabs: 0, cartesia: 1, platform: 2, minimax: 3, openai: 4 }[v.provider] ?? 9)
  return us.sort((a, b) => rank(a) - rank(b)).slice(0, n)
}
