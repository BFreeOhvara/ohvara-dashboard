// P892 — AI speed to lead for the portal: the shared rules (supabase/functions/ai-caller/rules.js, the same file the
// edge function runs), the draft words, the provider choices and the sample calls. Admin and VA screens only: agent
// screens use agentLine() and never say "AI".
import { AI_RULES, ASK_AGENT_REASONS, SAID_OUTCOMES, TRANSFER_WORDS, WAIT_QUESTIONS, WAIT_RULE, transferBeats } from '../../supabase/functions/ai-caller/rules.js'
import { OUTCOME_LABEL } from '../../supabase/functions/_shared/leadFlows.js'
import { SCRIPTS } from '../template/ful/p879.js'
import { CALLER_VOICES as CALLER_VOICES_LOCAL, CALLER_SPLIT as CALLER_SPLIT_LOCAL } from '../../supabase/functions/ai-caller/retellSpec.js'
export * from '../../supabase/functions/ai-caller/rules.js'

// DRAFT wording, for Brayden and a lawyer. Nothing here is said to a lead until he approves it and switches the AI on.
export const DRAFT_WORDS = {
  opening: 'Hi {first}, this is Deedstone’s virtual assistant, calling about the request you just sent us. Is now a good time for two quick questions?',
  hold: TRANSFER_WORDS.check, // P903: then light questions while the agent decides (WAIT_QUESTIONS)
  connecting: TRANSFER_WORDS.connecting,
  bounce: TRANSFER_WORDS.bounce,
  agentWill: TRANSFER_WORDS.agentWill, // P902: asks for a person, coverage or price → then Check agent
  noTimes: TRANSFER_WORDS.noTimes,
  consent: 'The Deedstone form’s consent line must name calls “using an artificial or prerecorded voice” before any lead is called by the AI.',
  recording: 'Recording and transcripts: no notice wording yet. The AI runs with recording off until Brayden picks a notice.',
}

// The engines the adapter can run on (supabase/functions/ai-caller/providers.ts). Prices are list prices, Nov 2026,
// to check on each provider's own page before signing up. Nothing is signed up for.
export const PROVIDERS = [
  { key: 'retell', name: 'Retell AI', recommended: true, perMin: 'about $0.155 a minute on our setup (voice engine $0.055 + ElevenLabs voice $0.04 + gpt-4.1 $0.045 + phone line $0.015; Retell price list, Nov 10 2026), billed per second, only answered calls',
    outbound: 'Yes: one API call per lead', transfer: 'Cold and warm transfer built in', transcripts: 'Kept by Retell per call (transcript + summary sent to our webhook); storage can be turned down' },
  { key: 'vapi', name: 'Vapi', perMin: '$0.05 platform + voice, model and phone line; about $0.10–$0.30 a minute',
    outbound: 'Yes: one API call per lead', transfer: 'Transfer tool (cold or warm)', transcripts: 'Kept by Vapi per call, sent to our webhook at the end' },
  { key: 'ghl', name: 'GoHighLevel Voice AI', perMin: 'about $0.045 engine + voice ($0.015+) + model + LC Phone minutes',
    outbound: 'Beta: started from a GoHighLevel workflow, per-location call limits', transfer: 'Transfer to a number from the workflow', transcripts: 'Kept in GoHighLevel on the contact' },
]
export const beatsOf = c => (c?.transfer ? transferBeats(c.transfer) : [])
export const providerOf = key => PROVIDERS.find(p => p.key === key) || null

export const SAMPLE_CENTS_PER_MIN = 13

// Sample AI calls, one or more in each outcome (admin AI calls view, sample mode).
// P903: transfer calls carry `transfer` (rules.js transferBeats) so the admin timeline shows each branch beat by beat.
export const SAMPLE_AI_CALLS = [
  // P902: Joyce asked for a person: "Your agent will go over that with you", Priya said No, the AI booked her.
  { id: 'ai-12', lead_id: 'l-12', name: 'Joyce Bell', state: 'GA', agent: 'Priya Shah', at: 'Today, 2:32 PM', attempt: 1, voice: 'mark', secs: 7, duration: 158, outcome: 'booked', note: 'Asked for a person · Priya said No · booked Fri 9:30 AM ET',
    transfer: { agent: 'Priya', check: 'no', answerSecs: 6, bookedFor: 'Fri 9:30 AM ET' } },
  { id: 'ai-11', lead_id: 'l-11', name: 'Walter Kim', state: 'TX', agent: 'Dana Walker', at: 'Today, 2:05 PM', attempt: 1, voice: 'hope', secs: 9, duration: 262, outcome: 'booked', note: 'Dana said Yes, phone not answered: booked Thu 2:30 PM CT',
    transfer: { agent: 'Dana', check: 'yes', answerSecs: 9, phone: 'no_answer', bookedFor: 'Thu 2:30 PM CT' } },
  { id: 'ai-10', lead_id: 'l-10', name: 'Carol Burke', state: 'FL', agent: 'Priya Shah', at: 'Today, 1:40 PM', attempt: 1, voice: 'mark', secs: 8, duration: 236, outcome: 'booked', note: 'No answer to the check: booked Thu 11:00 AM ET',
    transfer: { agent: 'Priya', check: 'none', bookedFor: 'Thu 11:00 AM ET' } },
  { id: 'ai-1', lead_id: 'l-1', name: 'Shirley Adams', state: 'FL', agent: 'Priya Shah', at: 'Today, 1:12 PM', attempt: 1, voice: 'hope', secs: 7, duration: 214, outcome: 'transferred', note: 'Check agent: Yes in 11 s',
    transfer: { agent: 'Priya', check: 'yes', answerSecs: 11, phone: 'answered' } },
  { id: 'ai-2', lead_id: 'l-2', name: 'Marcus Hill', state: 'TX', agent: 'Dana Walker', at: 'Today, 12:40 PM', attempt: 1, voice: 'mark', secs: 9, duration: 251, outcome: 'booked', note: 'Booked Thu 6:30 PM CT (agent said No)',
    transfer: { agent: 'Dana', check: 'no', answerSecs: 14, bookedFor: 'Thu 6:30 PM CT' } },
  { id: 'ai-3', lead_id: 'l-3', name: 'Teresa Lane', state: 'AZ', agent: 'Marcus Reed', at: 'Today, 11:58 AM', attempt: 1, voice: 'hope', secs: 8, duration: 188, outcome: 'booked', note: 'Appointments only: booked Fri 10:00 AM MST' },
  { id: 'ai-4', lead_id: 'l-4', name: 'Gloria Price', state: 'TX', agent: 'Dana Walker', at: 'Today, 11:20 AM', attempt: 1, voice: 'mark', secs: 8, duration: 96, outcome: 'not_now', callback_at: 'Tue 5:30 PM CT', note: 'Not a good time · callback Tue 5:30 PM CT (booked texts)' },
  { id: 'ai-5', lead_id: 'l-5', name: 'Daniel Ruiz', state: 'FL', agent: 'Priya Shah', at: 'Today, 10:21 AM', attempt: 1, voice: 'hope', secs: 6, duration: 0, outcome: 'no_answer', note: 'Try 2 in 2 minutes' },
  { id: 'ai-6', lead_id: 'l-5', name: 'Daniel Ruiz', state: 'FL', agent: 'Priya Shah', at: 'Today, 10:23 AM', attempt: 2, voice: 'hope', secs: 126, duration: 0, outcome: 'no_answer', note: 'No-answer texts started' },
  { id: 'ai-7', lead_id: 'l-7', name: 'Joan Miles', state: 'KY', agent: 'Dana Walker', at: 'Today, 9:50 AM', attempt: 1, voice: 'mark', secs: 9, duration: 41, outcome: 'opt_out', note: 'Said stop calling: do not call everywhere' },
  { id: 'ai-8', lead_id: 'l-8', name: 'Ray Ortiz', state: 'OK', agent: 'Priya Shah', at: 'Today, 9:47 AM', attempt: 1, voice: 'hope', secs: 10, duration: 77, outcome: 'hard_no', note: 'Not interested, already covered' },
  { id: 'ai-9', lead_id: 'l-9', name: 'Lena Fox', state: 'GA', agent: 'Marcus Reed', at: 'Today, 9:05 AM', attempt: 1, voice: 'mark', secs: 7, duration: 132, outcome: 'not_now', note: 'Not a good time, no time given · Marcus follows up' },
  { id: 'ai-13', lead_id: 'l-13', name: 'Brian Cole', state: 'OH', agent: 'Marcus Reed', at: 'Today, 8:02 AM', attempt: 1, voice: 'hope', secs: 8, duration: 22, outcome: 'wrong_number', note: 'Never asked: closed as a bad lead, on Lead quality' },
]

// P976 — the caller's voice split (Hope and Mark alternate). Per voice: calls, answered, booked, the booked rate
// (booked of answered), minutes and cost. Tests are left out. Sample: from the calls above (each carries `voice`);
// real: admin_ai_calls_view's by_voice (migration 271, the whole period, not just the shown rows).
export { CALLER_VOICES, CALLER_SPLIT } from '../../supabase/functions/ai-caller/retellSpec.js'
const voiceRow = (voice, r) => {
  const answered = r.answered || 0, booked = r.booked || 0
  return { voice, label: CALLER_VOICES_LOCAL[voice]?.label || voice, calls: r.calls || 0, answered, booked, transferred: r.transferred || 0,
    rate: answered ? Math.round((booked / answered) * 100) : 0, minutes: Math.round((r.minutes || 0) * 10) / 10, costCents: r.costCents ?? null }
}
export function voiceStats(calls = [], centsPerMin = 0) {
  const by = {}
  for (const c of calls) {
    if (!c.voice || c.test) continue
    const v = (by[c.voice] ||= { calls: 0, answered: 0, booked: 0, transferred: 0, minutes: 0, costCents: 0 })
    v.calls += 1
    if (c.outcome && c.outcome !== 'no_answer') v.answered += 1
    if (c.outcome === 'booked') v.booked += 1
    if (c.outcome === 'transferred') v.transferred += 1
    v.minutes += (c.duration || 0) / 60
    v.costCents += c.costCents != null ? c.costCents : c.duration ? Math.ceil(c.duration / 60) * centsPerMin : 0
  }
  return orderVoices(Object.entries(by).map(([k, r]) => voiceRow(k, r)))
}
export const voiceStatsFromView = (rows = []) => orderVoices(rows.map(r => voiceRow(r.voice, { ...r, costCents: r.cost_cents == null ? null : Number(r.cost_cents) })))
const orderVoices = rows => rows.sort((a, b) => (CALLER_SPLIT_LOCAL.indexOf(a.voice) + 1 || 99) - (CALLER_SPLIT_LOCAL.indexOf(b.voice) + 1 || 99))

// P902: wrong numbers close the lead as a bad lead and land on admin's Lead quality list (spend check per agent).
export const SAMPLE_BAD_LEADS = [
  { lead_id: 'l-13', name: 'Brian Cole', state: 'OH', agent: 'Marcus Reed', at: 'Today, 8:02 AM', reason: 'Wrong number', by: 'AI call', campaign: 'Marcus · Meta form' },
  { lead_id: 'l-31', name: 'Kim Adler', state: 'TX', agent: 'Dana Walker', at: 'Yesterday, 4:40 PM', reason: 'Wrong number', by: 'VA call', campaign: 'Dana · Meta form' },
  { lead_id: 'l-32', name: 'Ted Moss', state: 'FL', agent: 'Priya Shah', at: 'Fri, 11:15 AM', reason: 'Never asked', by: 'AI call', campaign: 'Priya · Meta form' },
]

// Sample settings (admin Settings › AI caller).
export const SAMPLE_AI_SETTINGS = { live: false, agents: ['ag-dana', 'ag-priya', 'ag-marcus'], maxCallSecs: AI_RULES.maxCallSecs, provider: 'none' }

// P902: the first-call outcomes (supabase/functions/_shared/leadFlows.js).
export const OUTCOME_WORD = OUTCOME_LABEL
export const OUTCOME_TONE = { booked: 'green', transferred: 'blue', not_now: 'teal', hard_no: 'mute', wrong_number: 'warn', no_answer: 'warn', opt_out: 'warn' }

// The questions the AI asks: the VA speed-to-lead script's required questions (P872/P877), nothing else.
export const AI_QUESTIONS = SCRIPTS.lead.lines.filter(([k, , req]) => req && !['hello', 'next'].includes(k)).map(([, line]) => line)

// The provider's agent prompt (pasted into Retell / Vapi / GoHighLevel when Brayden connects one). Draft.
export function agentPrompt(words = DRAFT_WORDS) {
  return [
    `You are Deedstone's virtual assistant. Open with exactly: "${words.opening}"`,
    `Ask only these, one at a time: ${AI_QUESTIONS.join(' ')}`,
    'Never discuss coverage, prices, carriers or whether they qualify. Never hand the caller to anyone but their agent.',
    `If they ask about coverage or price, or ask for a person: say "${words.agentWill}" and call ask_agent with reason ${Object.keys(ASK_AGENT_REASONS).join(' or ')}. Then follow what it returns, exactly as after qualified.`,
    `If they say now is not a good time: ask when would be better. If they give a time, call outcome with result not_now and that time as at (ISO, their time zone). If not, call outcome with result not_now. If they are not interested: call outcome with result hard_no. If this is not them or they never asked: call outcome with result wrong_number. Results: ${SAID_OUTCOMES.join(', ')}.`,
    'If they say stop calling, do not call, or take me off your list: say "Understood, we won’t call again." and call stop.',
    'When the questions are answered, call qualified with a one-line summary. Then follow what it returns: check_status while the agent is checked, transfer when it says so, or read the times it returns in the lead’s own time zone and call book.',
    `While check_status says keep_talking, never leave silence: ask these, one at a time: ${WAIT_QUESTIONS.join(' ')} ${WAIT_RULE}`,
    `When it returns transfer_to: say "${words.connecting}" with the agent's first name, then transfer. The agent hears the whisper alone; you leave the call. If they don't answer in ${AI_RULES.ringSecs} seconds you are back with the caller: call transfer_failed, say "${words.bounce}" and book.`,
    `Keep the call under ${Math.round(AI_RULES.maxCallSecs / 60)} minutes. No voicemail: if a machine answers, hang up.`,
  ].join('\n')
}
