// P892 — AI speed to lead for the portal: the shared rules (supabase/functions/ai-caller/rules.js, the same file the
// edge function runs), the draft words, the provider choices and the sample calls. Admin and VA screens only: agent
// screens use agentLine() and never say "AI".
import { AI_RULES, HANDOFF_REASONS } from '../../supabase/functions/ai-caller/rules.js'
import { SCRIPTS, BOUNDARY } from '../template/ful/p879.js'
export * from '../../supabase/functions/ai-caller/rules.js'

// DRAFT wording, for Brayden and a lawyer. Nothing here is said to a lead until he approves it and switches the AI on.
export const DRAFT_WORDS = {
  opening: 'Hi {first}, this is Deedstone’s virtual assistant, calling about the request you just sent us. Is now a good time for two quick questions?',
  hold: 'One moment, I’m checking if your licensed agent can talk right now.',
  toPerson: 'Let me get one of our team on the line for you. One moment.',
  noPerson: 'Everyone on our team is with someone right now. One of us will call you back in a few minutes.',
  consent: 'The Deedstone form’s consent line must name calls “using an artificial or prerecorded voice” before any lead is called by the AI.',
  recording: 'Recording and transcripts: no notice wording yet. The AI runs with recording off until Brayden picks a notice.',
}

// The engines the adapter can run on (supabase/functions/ai-caller/providers.ts). Prices are list prices, Nov 2026,
// to check on each provider's own page before signing up. Nothing is signed up for.
export const PROVIDERS = [
  { key: 'retell', name: 'Retell AI', recommended: true, perMin: 'about $0.07–$0.31 a minute all in (voice $0.055 + model + phone line); expect about $0.13',
    outbound: 'Yes: one API call per lead', transfer: 'Cold and warm transfer built in', transcripts: 'Kept by Retell per call (transcript + summary sent to our webhook); storage can be turned down' },
  { key: 'vapi', name: 'Vapi', perMin: '$0.05 platform + voice, model and phone line; about $0.10–$0.30 a minute',
    outbound: 'Yes: one API call per lead', transfer: 'Transfer tool (cold or warm)', transcripts: 'Kept by Vapi per call, sent to our webhook at the end' },
  { key: 'ghl', name: 'GoHighLevel Voice AI', perMin: 'about $0.045 engine + voice ($0.015+) + model + LC Phone minutes',
    outbound: 'Beta: started from a GoHighLevel workflow, per-location call limits', transfer: 'Transfer to a number from the workflow', transcripts: 'Kept in GoHighLevel on the contact' },
]
export const providerOf = key => PROVIDERS.find(p => p.key === key) || null

export const SAMPLE_CENTS_PER_MIN = 13

// Sample AI calls, one or more in each outcome (admin AI calls view, sample mode).
export const SAMPLE_AI_CALLS = [
  { id: 'ai-1', lead_id: 'l-1', name: 'Shirley Adams', state: 'FL', agent: 'Priya Shah', at: 'Today, 1:12 PM', attempt: 1, secs: 7, duration: 214, outcome: 'transferred', note: 'Check agent: Yes in 11 s' },
  { id: 'ai-2', lead_id: 'l-2', name: 'Marcus Hill', state: 'TX', agent: 'Dana Walker', at: 'Today, 12:40 PM', attempt: 1, secs: 9, duration: 251, outcome: 'booked', note: 'Booked Thu 6:30 PM CT (agent said No)' },
  { id: 'ai-3', lead_id: 'l-3', name: 'Teresa Lane', state: 'AZ', agent: 'Marcus Reed', at: 'Today, 11:58 AM', attempt: 1, secs: 8, duration: 188, outcome: 'booked', note: 'Appointments only: booked Fri 10:00 AM MST' },
  { id: 'ai-4', lead_id: 'l-4', name: 'Gloria Price', state: 'TX', agent: 'Dana Walker', at: 'Today, 11:20 AM', attempt: 1, secs: 8, duration: 96, outcome: 'handed_to_va', note: 'Asked about coverage or price · Maya took it in 14 s' },
  { id: 'ai-5', lead_id: 'l-5', name: 'Daniel Ruiz', state: 'FL', agent: 'Priya Shah', at: 'Today, 10:21 AM', attempt: 1, secs: 6, duration: 0, outcome: 'no_answer', note: 'Try 2 in 2 minutes' },
  { id: 'ai-6', lead_id: 'l-5', name: 'Daniel Ruiz', state: 'FL', agent: 'Priya Shah', at: 'Today, 10:23 AM', attempt: 2, secs: 126, duration: 0, outcome: 'no_answer', note: 'No-answer texts and VA call tasks took over' },
  { id: 'ai-7', lead_id: 'l-7', name: 'Ray Ortiz', state: 'OK', agent: 'Dana Walker', at: 'Today, 9:47 AM', attempt: 1, secs: 9, duration: 41, outcome: 'opt_out', note: 'Said stop calling: do not call everywhere' },
  { id: 'ai-8', lead_id: 'l-8', name: 'Lena Fox', state: 'GA', agent: 'Priya Shah', at: 'Today, 9:05 AM', attempt: 1, secs: 10, duration: 77, outcome: 'reached', note: 'Not interested, already covered' },
  { id: 'ai-9', lead_id: 'l-9', name: 'Owen Price', state: 'NV', agent: 'Marcus Reed', at: 'Today, 8:31 AM', attempt: 1, secs: 7, duration: 132, outcome: 'handed_to_va', note: 'Asked for a person · no VA free in 60 s: callback task' },
]

// Sample settings (admin Settings › AI caller).
export const SAMPLE_AI_SETTINGS = { live: false, agents: ['ag-dana', 'ag-priya', 'ag-marcus'], maxCallSecs: AI_RULES.maxCallSecs, provider: 'none' }

export const OUTCOME_WORD = {
  reached: 'Reached', booked: 'Booked', transferred: 'Transferred', handed_to_va: 'Handed to VA', no_answer: 'No answer', opt_out: 'Opted out',
}
export const OUTCOME_TONE = { reached: 'mute', booked: 'green', transferred: 'blue', handed_to_va: 'teal', no_answer: 'warn', opt_out: 'warn' }

// The questions the AI asks: the VA speed-to-lead script's required questions (P872/P877), nothing else.
export const AI_QUESTIONS = SCRIPTS.lead.lines.filter(([k, , req]) => req && !['hello', 'next'].includes(k)).map(([, line]) => line)

// The provider's agent prompt (pasted into Retell / Vapi / GoHighLevel when Brayden connects one). Draft.
export function agentPrompt(words = DRAFT_WORDS) {
  return [
    `You are Deedstone's virtual assistant. Open with exactly: "${words.opening}"`,
    `Ask only these, one at a time: ${AI_QUESTIONS.join(' ')}`,
    'Never discuss coverage, prices, carriers or whether they qualify. If asked, say: "' + BOUNDARY + '" and call handoff with reason coverage_or_price.',
    `Call handoff when they ask for a person (asked_person), are confused or upset (confused_upset), or something goes wrong (ai_failed). Reasons: ${Object.keys(HANDOFF_REASONS).join(', ')}.`,
    'If they say stop calling, do not call, or take me off your list: say "Understood, we won’t call again." and call stop.',
    'When the questions are answered, call qualified with a one-line summary. Then follow what it returns: check_status while the agent is checked, transfer when it says so, or read the times it returns in the lead’s own time zone and call book.',
    `Keep the call under ${Math.round(AI_RULES.maxCallSecs / 60)} minutes. No voicemail: if a machine answers, hang up.`,
  ].join('\n')
}
