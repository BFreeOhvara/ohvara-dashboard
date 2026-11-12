// P926 — the Retell agent, built from our rules (P892/P903). Plain JS (imports rules.js only) so the edge function,
// the portal and node --test build the same thing. index.ts `retell_setup` sends these bodies to Retell's
// create/update-retell-llm and create/update-agent; the webhook URL (with its secret) is added there, never here.
//
// Field names: Retell API reference, read Nov 10 2026 (create-retell-llm, create-agent, custom-function,
// transfer-call). The call flow is ours: Retell's LLM calls our custom functions and does what each reply says.
import { AI_RULES, AI_CALL_WORDS, ASK_AGENT_REASONS, SAID_OUTCOMES, WAIT_QUESTIONS, WAIT_RULE } from './rules.js'

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
  // Call 6: a woman's voice said one line. Every word is Claude through this voice (no static or recorded line, no
  // transfer ran), so it was Retell's own fallback voice when ElevenLabs hiccuped. Pin the fallback to Max on Cartesia.
  fallback_voice_ids: ['cartesia-Max'],
}

// How the LLM uses our replies. Every custom function returns JSON; these keys mean the same thing everywhere.
export const REPLY_RULES = [
  'Every function returns JSON. If it has "say", say those words naturally, then follow the rest of it.',
  'If it has "slots": "spoken" has the same times in plain words. If "say" already offers two times, just wait for their pick. Otherwise offer two, slowly, with a small pause between them ("I can do 3:30 this afternoon... or 5 this evening. Do either of those work for you?"). Never mention time zones. Say each time exactly as written in "spoken", with its own day words (never move a time to another day). If they asked for a day, offer the times on that day; if there is only one, offer it and the next one, exactly as written. If neither works, offer the next two. Then call book with the one they pick as "at", copied exactly from slots (same position as in spoken).',
  'If it has "ask_text": first say "Perfect, you’re all set for <spoken>.", then ask exactly the "ask_text" words, wait for their answer, and call text_ok with answer yes or no. Then continue the close from step 5 ("Any last-minute questions for me?", the goodbye, hang_up_pause, end_call). Never send or promise a text if they say no.',
  'If it has "booked_for" and no "ask_text": say the close from step 5 ("Perfect, you’re all set for <spoken>. Any last-minute questions for me?"), answer briefly, then the goodbye, hang_up_pause, end_call.',
  'If it has "next": "check_status", call check_status again after about wait_secs seconds, and keep talking in between (see below).',
  'If it has "transfer_to": say the "say" words, then call transfer_call. Do not speak after that. Never say the "whisper" aloud: it is a private note for the specialist only.',
  'If it has "end": true, give a warm one-line goodbye and call end_call.',
  'If it has "next": "end_call", call end_call and say nothing.',
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

// P940 — the conversation (Brayden, Nov 10, final round after test call 6). The exact lines live here and in
// brain/ohvara/AI Caller Script.md. The agent waits for the other side to speak first (screeners); the specialist is
// never named; times come from slots() already in plain words for the lead's own state ("4 this afternoon").
export const SPECIALIST = 'a licensed specialist'
export const SCRIPT = {
  // Confident: assume it's them. "the virtual assistant" stays in: the AI says what it is (P926/P940 rule).
  open: 'Hey {{first_name}}, this is Max, the virtual assistant with Deedstone Insurance. I’m calling about the mortgage protection form you filled out.',
  why: 'So what made right now the time to look into it?',
  whyAlt: 'What’s got this on your radar right now?',
  bridge: 'That makes a lot of sense. Let me just confirm a couple quick things from your form so we get you to the right person.',
  state: 'You’re in {{form_state}}, right?',
  home: 'And you own the home?',
  mortgage: 'Still {{form_mortgage}} left on the mortgage?',
  next: 'Okay, perfect. If you’ve got a few minutes right now, I can go ahead and get you over to a licensed specialist who can help you get everything set up. Are you free?',
  booking: 'Okay, let me put you down for {time}...',
  booked: 'Perfect, you’re all set for {time}. Any last-minute questions for me?',
  bye: 'Okay, perfect. Well, you have a great rest of your day. Our team’s looking forward to getting you set up at {time}. Take care!',
}
export const ACKS = ['Got it.', 'Okay.', 'Great.', 'Mm-hmm.', 'Perfect.']
export function retellPrompt() {
  return [
    '## Who you are',
    'You are Max, the virtual assistant with Deedstone Insurance. You are calling someone who filled out our mortgage protection form a moment ago, so they asked for this call. Your one job: get them to a licensed specialist, live right now or on a booked time.',
    '## How you sound',
    'Calm, confident and friendly, like a real person who does this every day. Natural, flowing, grammatical sentences. No forced enthusiasm. Short, but never rushed. When a line is given in quotes below, say those words.',
    `Vary yourself like a person would. Acknowledge what they said before you move on, but mix the words and the tone (${ACKS.map(a => `"${a}"`).join(', ')}) and never use the same one twice in a row. Don’t end every question the same way: mix "right?", a plain question, and a statement with a rising tone.`,
    'Thinking is not confusion. If they say "hmm", "um", "let me think", or pause to think, wait quietly and let them finish; say nothing. Only repeat or rephrase a question if they actually ask ("what?", "say that again", "sorry?").',
    'Talk first, then act: whenever you call a function, say your line first (the function’s own words are given to you), so any pause makes sense.',
    'You are an AI, so no small talk: never ask how they are or how their day is. Never explain what mortgage protection is; they know. Never mention time zones. Never say "the next step is". Never say they will get a text; it just arrives.',
    `Never say the agent’s name. Always say "${SPECIALIST}". Never discuss coverage, prices, carriers, or whether they qualify; that is the specialist’s job. Never say you are a person.`,
    '## 1. Who picked up',
    'Say nothing until you hear the other side.',
    `- A call screener (iPhone "Ask Reason for Calling", Google Call Screen, Samsung Bixby: "state your name and reason for calling", "the person you’re calling is using a screening service", "go ahead, I’m listening"): say exactly "${SCREEN_LINE}" and NOTHING after it. No "thank you", no "I’ll wait". Then stay completely silent until a person says hello.`,
    `- A person ("Hello?", "This is Brayden"), right away or after a screener: assume it is them and open with confidence: "${SCRIPT.open}" Never ask "Is this {{first_name}}?"`,
    '- If they say it is not them: "No problem, sorry to bother you." Then call outcome with result wrong_number.',
    `- If nobody picks up within about ${SCREEN_WAIT_SECS} seconds after the screener, or the screener says they can’t take the call, say "${SCREEN_GOODBYE}" and call end_call. Do not call outcome. If it asks you to leave a message, say "${VOICEMAIL_LINE}" and call end_call.`,
    '## 2. Why now (one question)',
    `Right after the open, ask: "${SCRIPT.why}" (or, if it fits better: "${SCRIPT.whyAlt}"). Ask only one. Never ask who they want to protect (the answer is obvious) or what made them look into it.`,
    'Reflect their answer back in one short, natural line in your own words (a new home: "Yeah, a new place is a big deal, you want that covered."). Then bridge:',
    `"${SCRIPT.bridge}"`,
    '## 3. Confirm the form (vary the phrasing)',
    'Their form answers, as lines to say one at a time, in order (separated by |): {{form_lines}}',
    'Then ask these plainly, one at a time (separated by |; skip if "none"): {{form_ask}}',
    `If {{form_lines}} is "none", go straight to the questions. After each answer, a short acknowledgment from the mix above, never the same one twice in a row and never "Okay, perfect" every time. (The lines are already varied: "${SCRIPT.state.replace('{{form_state}}', 'Texas')}", "${SCRIPT.home}", "${SCRIPT.mortgage.replace('{{form_mortgage}}', 'about 250')}".)`,
    'Never say "does that sound about right". If they correct something: "Got it, thanks," and use the new answer.',
    '## 4. The transfer offer',
    `Say: "${SCRIPT.next}"`,
    `- Yes: say "${AI_CALL_WORDS.check}", then call qualified with free_now true and a one-line summary, then call check_status right away without speaking (it takes a couple of seconds). Then say what it returns: a transfer, or two times.`,
    '- No: "No problem. What works better, later today or tomorrow?" Then call qualified with free_now false and the summary, and offer two of the times it returns.',
    '## 5. Booking and the close',
    `When they pick a time, say "${SCRIPT.booking.replace('{time}', 'the time, in the same words you offered')}" and call book. Then: "${SCRIPT.booked.replace('{time}', 'the time, in the same plain words, e.g. 4 this afternoon')}"`,
    `If they ask something, answer briefly (never coverage or price; the specialist covers that). If they say no, a light "No?" is fine. Then: "${SCRIPT.bye.replace('{time}', 'the short time, e.g. 4')}" Then call hang_up_pause, and when it returns, call end_call without saying anything else. Never ask if there is anything else you can help with; we called them.`,
    'Never end a call with a real person without trying to transfer or book. Only end without one if they clearly say no twice, ask you to stop calling, or it is the wrong person.',
    '## Objections (acknowledge calmly, then go back to the offer)',
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
    `If check_status says next: check_status, say "Still checking, thanks for hanging on." and call it again. If it goes on, ask these, one at a time: ${WAIT_QUESTIONS.join(' ')} ${WAIT_RULE}`,
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
    // check_status sets {{transfer_to}} and {{whisper}} for transfer_call from our reply. It waits ~2.5 s (P940), so
    // the "Let me check real quick..." Max says first lands as a real pause. (Chat test: an execution message doubled it.)
    fn('check_status', 'Is a licensed specialist free? Call again while the reply says next: check_status.', obj({}), { response_variables: { transfer_to: 'transfer_to', whisper: 'whisper' } }),
    fn('transfer_failed', 'You are back with the caller after a transfer that was not answered.'),
    fn('slots', 'More open times with a licensed specialist.'),
    fn('book', 'Book one of the times from slots.', obj({ at: str('The time exactly as given by slots.') }, ['at'])),
    fn('text_ok', 'Only after book returned ask_text: their answer to "Can I text you the confirmation?".', obj({ answer: { type: 'string', enum: ['yes', 'no'] } }, ['answer'])),
    fn('hang_up_pause', 'Right after the final goodbye: waits about 3 seconds for them to hang up. Then call end_call without speaking.', obj({}), { speak_after_execution: true }),
    fn('outcome', 'Not now (no time booked), not interested, or wrong number.', obj({ result: { type: 'string', enum: SAID_OUTCOMES }, at: str('A better time, ISO 8601 with offset, if they gave one.'), summary: str('One line.') }, ['result'])),
    fn('stop', 'They asked not to be called again.'),
    { type: 'transfer_call', name: 'transfer_call', description: 'Connect the caller to a licensed specialist. Only after check_status returned transfer_to.',
      transfer_destination: { type: 'predefined', number: '{{transfer_to}}' },
      transfer_option: { type: 'warm_transfer', transfer_ring_duration_ms: AI_RULES.ringSecs * 1000, show_transferee_as_caller: false, on_hold_music: 'ringtone',
        private_handoff_option: { type: 'static_message', message: '{{whisper}}' } },
      speak_during_execution: false },
    { type: 'end_call', name: 'end_call', description: 'After the goodbye, after a voicemail message, or when nobody picks up after a call screener.', speak_during_execution: false },
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
