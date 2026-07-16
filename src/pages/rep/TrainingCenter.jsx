import { useState, useEffect, useRef, useMemo, forwardRef, useImperativeHandle } from 'react'
import { createPortal } from 'react-dom'
import { Play, BookOpen, Mic, FileText, Lock, Shuffle, ChevronLeft, ChevronRight, Check, X, ClipboardCheck, Loader2, PhoneOff, RotateCcw, Award, AlertCircle } from 'lucide-react'
import { FLASHCARDS, CATEGORY_LABELS, CATEGORY_COLORS } from '../../data/flashcards'
import { supabase } from '../../lib/supabase'
import { useCapability } from '../../contexts/SecretsContext'
import { useAuth } from '../../hooks/useAuth'
import {
  useTrainingProgress, useSaveTrainingProgress, trainingChecks, isTrainingComplete,
  TOTAL_VIDEOS, QUIZ_QUESTIONS, QUIZ_PASS_PCT, ROLEPLAY_PASS_SCORE, ROLEPLAY_PASS_GRADE, gradeFromScore,
} from '../../hooks/useTraining'
import { buildScriptFlow } from '../../lib/discoveryScript'
import { ScriptWalk } from '../../components/rep/ScriptWalk'

// ── Constants ─────────────────────────────────────────────────────────────────

const LS_VIDEOS           = 'ohvara_training_videos'
const LS_VIDEO_POSITIONS  = 'ohvara_training_video_positions'

// 8 topics locked 2026-06-30 — see brain/training-videos.md. Durations
// verified live via Chrome on 2026-06-30, all under 10 minutes.
const TRAINING_VIDEOS = [
  { id: 1, title: 'What an AI Receptionist Does',        description: 'Feature overview: talks to callers, collects info, books appointments, warm-transfers calls, and sends call summaries/transcripts/recordings.', duration: '6:30', category: 'Product',    youtubeId: 'AUEr1jPJsi8' },
  { id: 2, title: 'Tonality & Delivery',                  description: 'Sounding like a peer who found them a fix, not a telemarketer.', duration: '9:35', category: 'Delivery',   youtubeId: 'vjj9qOxGCgk' },
  { id: 3, title: 'The Discovery Script',                 description: 'Why questions about missed calls beat pitching the AI upfront.', duration: '4:34', category: 'Discovery',  youtubeId: 'dDGX95UkV10' },
  { id: 4, title: 'Getting Past the Gatekeeper',          description: 'Reaching the owner without sounding like "another AI sales call."', duration: '7:40', category: 'Gatekeeper', youtubeId: 'krveop9O-ik' },
  { id: 5, title: 'Handling Objections',                  description: '"We already have a system," "AI feels impersonal," "send me an email."', duration: '8:59', category: 'Objections', youtubeId: 'mDWUpuumAuo' },
  { id: 6, title: 'Qualifying the Prospect',               description: 'BANT — Budget, Authority, Need, Timeline — the framework for qualifying before you invest more time.', duration: '9:16', category: 'Qualifying', youtubeId: 'dj3J75I0GYQ' },
  { id: 7, title: 'Booking & Handoff',                    description: 'Framing Nate as the AI/automation specialist, not "the closer."', duration: '8:23', category: 'Booking',    youtubeId: '4mrM8GO6SS0' },
  { id: 8, title: 'Time Management & Call Discipline',    description: 'Structuring the 150-lead day in this specific niche.', duration: '7:08', category: 'Mindset',    youtubeId: 'ga5_EizLwdw' },
]

// Real quiz content from brain/training-quiz-content.md (v2, Prompt 183, 2026-07-01 —
// standalone knowledge questions, no "per the video" references).
// Mini-quiz: 4 questions per video (non-gating, formative). correctIndex is 0-based.
// Final exam: 30 questions covering all 8 videos (85% gate).

const FINAL_QUIZ_PASS_PCT = 85

const MINI_QUIZ_CONTENT = {
  1: [
    { id: '1-mini-0', question: 'What can an AI receptionist do beyond just answering the phone?', options: ['Only play a recorded greeting', 'Collect caller info, schedule appointments, and transfer calls when needed', 'Nothing else — it just answers and hangs up', 'Only work during business hours'], correctIndex: 1 },
    { id: '1-mini-1', question: 'What does a business typically receive after an AI receptionist finishes a call?', options: ["Nothing — calls aren't logged anywhere", 'A summary, transcript, and recording of the call', 'Only a missed-call notification', 'A single-line note with no detail'], correctIndex: 1 },
    { id: '1-mini-2', question: 'How do you teach an AI receptionist about a specific business?', options: ['It requires hiring a developer to write custom code', 'Give it plain-English information and instructions — no AI expertise needed', 'It learns everything automatically with zero setup', "You can't customize what it knows"], correctIndex: 1 },
    { id: '1-mini-3', question: 'What is a "warm transfer"?', options: ['Sending the caller straight to voicemail', "The AI briefing a human on who's calling and why before connecting them", 'A transfer that happens with no context at all', 'A transfer that only works after hours'], correctIndex: 1 },
  ],
  2: [
    { id: '2-mini-0', question: 'Roughly how much of total communication impact comes from tonality and body language combined?', options: ['About 10%', 'About 50%', 'About 90%', 'About 25%'], correctIndex: 2 },
    { id: '2-mini-1', question: 'What three things must you establish in the first four seconds of a call?', options: ['Name, company, and price', 'Sharp/on the ball, enthusiastic, and perceived as an expert', 'Greeting, pitch, and close', 'Problem, solution, and price'], correctIndex: 1 },
    { id: '2-mini-2', question: 'What are the two core elements of rapport?', options: ["Talking a lot and smiling often", "Matching the other person's volume and speed", 'The prospect feeling you care about them, and feeling you\'re similar to them', 'Agreeing with everything they say'], correctIndex: 2 },
    { id: '2-mini-3', question: 'What three things make up charisma?', options: ['Natural talent, confidence, and luck', 'Being loud, being persistent, and memorizing a script', 'Effective tonality, appropriate body language, and not saying foolish things', 'Volume, speed, and eye contact only'], correctIndex: 2 },
  ],
  3: [
    { id: '3-mini-0', question: "What's the simplest follow-up technique when a prospect uses an emotional word like \"stressed\"?", options: ['Change the subject right away', 'Repeat the word back as a question — "stressed?"', 'Apologize for bringing it up', 'Offer a discount immediately'], correctIndex: 1 },
    { id: '3-mini-1', question: 'What does asking "how long has that been going on for?" accomplish?', options: ['Confirms a callback time', 'Qualifies their budget', 'Gets the prospect to relive the pain of the problem', 'Ends the conversation politely'], correctIndex: 2 },
    { id: '3-mini-2', question: 'Why is the word "trying" (as in "we\'ve been trying to...") worth calling out?', options: ["It means they're not a real lead", 'It signals frustration and is a good opening to probe deeper', 'It means they already solved the problem', 'It\'s a signal to end the call'], correctIndex: 1 },
    { id: '3-mini-3', question: "What's the overall goal of clarifying and probing questions?", options: ['Fill time before pitching', 'Make small talk to build comfort', 'Confirm contact information', 'Get the prospect to reveal the real problem and feel the emotion behind it'], correctIndex: 3 },
  ],
  4: [
    { id: '4-mini-0', question: "What's the goal when a gatekeeper answers the phone?", options: ['Convince the gatekeeper to buy', 'Get past them to reach an actual decision-maker', 'End the call immediately', 'Leave a detailed voicemail'], correctIndex: 1 },
    { id: '4-mini-1', question: 'What tone works best when greeting a gatekeeper?', options: ['Very formal and corporate', 'Apologetic and unsure', 'Casual and confident, as if you already know the person you\'re calling for', 'Reading a long scripted introduction'], correctIndex: 2 },
    { id: '4-mini-2', question: "What's a key mistake to avoid once the gatekeeper starts asking questions?", options: ['Saying your own name', 'Asking for the owner by name', 'Over-explaining yourself instead of staying brief', 'Speaking too quietly'], correctIndex: 2 },
    { id: '4-mini-3', question: "What's an effective response if the gatekeeper asks who's calling or why?", options: ['A full explanation of your product', 'A brief reply like "is he not there? Should I call back later?"', 'Hanging up', 'Asking for their manager instead'], correctIndex: 1 },
  ],
  5: [
    { id: '5-mini-0', question: 'What are the two biggest emotional drivers that cause someone to want to change?', options: ['Greed and excitement', 'Pain and the fear of future pain', 'Trust and logic', 'Guilt and obligation'], correctIndex: 1 },
    { id: '5-mini-1', question: "What's the purpose of asking a \"consequence question\" when a prospect brushes you off?", options: ['To confirm a meeting time', "To deframe the prospect and get them thinking about what happens if they don't act", 'To ask for payment information', 'To politely end the call'], correctIndex: 1 },
    { id: '5-mini-2', question: 'Why might you intentionally use a "concerned" tone when challenging an objection?', options: ['It makes you sound unsure of your product', 'It has no real effect either way', "It seeds doubt that the prospect might be missing something, lowering their guard", "It signals the call is ending"], correctIndex: 2 },
    { id: '5-mini-3', question: 'What is the "identity frame" technique meant to do?', options: ["Compare your price to a competitor's", 'Get the prospect to avoid identifying with people who keep delaying and never fix the problem', 'Ask for a referral', 'Confirm the appointment time'], correctIndex: 1 },
  ],
  6: [
    { id: '6-mini-0', question: 'What does BANT stand for?', options: ['Budget, Authority, Need, Timeline', 'Best, Aggressive, New, Targeted', 'Buyer, Attitude, Numbers, Trust', 'Budget, Ability, Need, Trust'], correctIndex: 0 },
    { id: '6-mini-1', question: 'Why should you gather BANT information during the conversation rather than as a separate step afterward?', options: ["It's required by law", "It lets you qualify while you're already building value and rapport", "It's not actually recommended — better to ask after the pitch", 'Prospects prefer written questionnaires'], correctIndex: 1 },
    { id: '6-mini-2', question: "What's the point of asking about a prospect's decision-making process?", options: ['To make small talk', "To find out if you're talking to someone who can actually say yes", 'To fill time on the call', "It's not important"], correctIndex: 1 },
    { id: '6-mini-3', question: "What's the risk of skipping qualifying questions and just pitching?", options: ['None — pitching first always works better', 'You waste time building a full pitch for someone who was never a fit', 'It makes you sound more confident', "It's actually faster overall"], correctIndex: 1 },
  ],
  7: [
    { id: '7-mini-0', question: "When is it okay to be more assertive about booking the appointment?", options: ['Right at the start of the call', 'Only with hesitant prospects', "After you've built rapport, provided value, and qualified them", 'Never — always let them decide'], correctIndex: 2 },
    { id: '7-mini-1', question: 'What does "assume the appointment" mean?', options: ['Always double-confirm before booking', 'Ask permission before every step', 'Move forward with booking instead of asking "would you like to?"', 'Wait for the prospect to bring it up'], correctIndex: 2 },
    { id: '7-mini-2', question: "When's the best time to ask for a referral?", options: ['At the very start of the call', 'Right after handling an objection', 'When the prospect is expressing thanks or gratitude', "Setters shouldn't ask for referrals"], correctIndex: 2 },
    { id: '7-mini-3', question: 'Why ask for a small, specific amount of time, like "two minutes"?', options: ['It sounds more official', 'It avoids legal issues', "It's required by every script", "It's a small ask that makes it easy for the prospect to say yes"], correctIndex: 3 },
  ],
  8: [
    { id: '8-mini-0', question: 'Why are morning dial blocks especially effective?', options: ["It's required by company policy", 'Prospects are more likely to be asleep', 'Connect rates are better and it builds early momentum', 'It avoids using a CRM'], correctIndex: 2 },
    { id: '8-mini-1', question: "What's one of the main mistakes that causes reps to underperform?", options: ['Making too many calls', 'Reacting to whatever comes up instead of planning the day', 'Following up too quickly', 'Taking too many breaks'], correctIndex: 1 },
    { id: '8-mini-2', question: 'What should you do in the last few minutes of the day?', options: ['Schedule personal appointments', 'Clear your entire email inbox', 'Reflect on what worked and what to carry into tomorrow', 'Call your manager for a debrief'], correctIndex: 2 },
    { id: '8-mini-3', question: "Which of these is a core takeaway for structuring your day well?", options: ['Always answer Slack messages immediately', 'Multitask calls and emails together', 'Protect your call blocks like they\'re meetings', 'Make calls only in the afternoon'], correctIndex: 2 },
  ],
}

const FINAL_EXAM_QUESTIONS = [
  // Video 1 — What an AI receptionist does
  { id: 'f1', category: 'What an AI Receptionist Does', question: "What's a simple way to describe what an AI receptionist does?", options: [{ text: 'It only plays a recorded greeting on a loop', correct: false }, { text: 'It talks with callers, answers questions, and can schedule appointments or transfer calls', correct: true }, { text: "It's just a basic voicemail box", correct: false }, { text: "It replaces a business's phone number entirely", correct: false }] },
  { id: 'f2', category: 'What an AI Receptionist Does', question: 'What does a business get after an AI receptionist handles a call?', options: [{ text: 'A summary, transcript, and recording', correct: true }, { text: "Nothing — calls aren't logged", correct: false }, { text: 'Only a busy-signal report', correct: false }, { text: 'A handwritten note from the AI', correct: false }] },
  { id: 'f3', category: 'What an AI Receptionist Does', question: "What's required to teach an AI receptionist about a specific business's details?", options: [{ text: 'Hiring a developer to write custom code', correct: false }, { text: 'Plain-English information and instructions — no technical expertise needed', correct: true }, { text: "Nothing — it can't be customized", correct: false }, { text: 'A month of manual training calls', correct: false }] },
  { id: 'f4', category: 'What an AI Receptionist Does', question: 'What happens when a call is flagged as an emergency and set to transfer to a human?', options: [{ text: "It's always ignored", correct: false }, { text: 'The AI briefs the human on the caller and reason before connecting (a warm transfer)', correct: true }, { text: 'It goes straight to voicemail regardless of settings', correct: false }, { text: 'It automatically hangs up', correct: false }] },
  // Video 2 — Tonality & delivery
  { id: 'f5', category: 'Tonality & Delivery', question: 'What does effective tonality give you in a conversation?', options: [{ text: 'Control over how your message is perceived', correct: true }, { text: 'A bigger paycheck automatically', correct: false }, { text: "Nothing — words matter more", correct: false }, { text: "It's only relevant in person, not on the phone", correct: false }] },
  { id: 'f6', category: 'Tonality & Delivery', question: 'Which of these is NOT one of the three things to establish in your first four seconds?', options: [{ text: 'Sharp/on the ball', correct: false }, { text: 'Enthusiastic', correct: false }, { text: 'An expert in your field', correct: false }, { text: 'Your exact pricing', correct: true }] },
  { id: 'f7', category: 'Tonality & Delivery', question: 'What two things make up the bulk of communication impact?', options: [{ text: 'Words and tone', correct: false }, { text: 'Body language and price', correct: false }, { text: 'Tonality and body language', correct: true }, { text: 'Confidence and price', correct: false }] },
  { id: 'f8', category: 'Tonality & Delivery', question: 'What must a prospect unconsciously feel for rapport to exist?', options: [{ text: "You're the cheapest option", correct: false }, { text: "You're more educated than them", correct: false }, { text: "That you care about them and that you're similar to them", correct: true }, { text: "You'll never ask them for anything", correct: false }] },
  // Video 3 — The discovery script
  { id: 'f9', category: 'The Discovery Script', question: 'What\'s the purpose of "clarifying and probing" questions?', options: [{ text: 'To confirm contact information', correct: false }, { text: 'To get the prospect to reveal the real problem beneath the surface', correct: true }, { text: 'To end the call faster', correct: false }, { text: 'To upsell immediately', correct: false }] },
  { id: 'f10', category: 'The Discovery Script', question: 'If a prospect says they\'re "frustrated," what\'s the simplest follow-up?', options: [{ text: 'Change the subject', correct: false }, { text: 'Repeat the word back as a question: "frustrated?"', correct: true }, { text: 'Apologize', correct: false }, { text: 'Offer a discount', correct: false }] },
  { id: 'f11', category: 'The Discovery Script', question: 'What does asking "what\'s causing this to happen?" help uncover?', options: [{ text: 'Their budget range', correct: false }, { text: 'Their preferred callback time', correct: false }, { text: 'The root cause behind their stated problem', correct: true }, { text: 'Their job title', correct: false }] },
  { id: 'f29', category: 'The Discovery Script', question: 'What does asking "how long has this been going on for?" accomplish?', options: [{ text: 'Confirms a callback time', correct: false }, { text: 'Qualifies their budget', correct: false }, { text: 'Gets the prospect to relive the pain of the problem', correct: true }, { text: 'Ends the conversation politely', correct: false }] },
  // Video 4 — Getting past the gatekeeper
  { id: 'f12', category: 'Getting Past the Gatekeeper', question: 'Who is generally the best person to reach when cold calling a business?', options: [{ text: 'The receptionist', correct: false }, { text: 'Any available employee', correct: false }, { text: 'The owner or a decision-maker', correct: true }, { text: 'The IT department', correct: false }] },
  { id: 'f13', category: 'Getting Past the Gatekeeper', question: 'What kind of tone works best with a gatekeeper?', options: [{ text: 'Very formal and scripted', correct: false }, { text: 'Apologetic', correct: false }, { text: 'Loud and aggressive', correct: false }, { text: "Casual and confident, like you already have a relationship with the person you're calling for", correct: true }] },
  { id: 'f14', category: 'Getting Past the Gatekeeper', question: "What's a risk of over-explaining yourself to a gatekeeper?", options: [{ text: 'Nothing — more detail always helps', correct: false }, { text: 'You lose control of the conversation and give them a reason to screen you out', correct: true }, { text: "It's required for compliance", correct: false }, { text: 'It speeds up the call', correct: false }] },
  // Video 5 — Handling objections
  { id: 'f15', category: 'Handling Objections', question: 'What two emotions drive a person to actually want to change?', options: [{ text: 'Excitement and hope', correct: false }, { text: 'Pain and fear of future pain', correct: true }, { text: 'Trust and logic', correct: false }, { text: 'Guilt and obligation', correct: false }] },
  { id: 'f16', category: 'Handling Objections', question: 'What is a "consequence question" used for?', options: [{ text: 'To confirm a meeting time', correct: false }, { text: 'To ask for payment info', correct: false }, { text: "To deframe a brush-off objection and get the prospect thinking about what happens if they don't act", correct: true }, { text: 'To end the call', correct: false }] },
  { id: 'f17', category: 'Handling Objections', question: 'Why might a salesperson intentionally use a "concerned" tone when challenging an objection?', options: [{ text: 'To sound less confident on purpose', correct: false }, { text: 'To seed doubt that the prospect may be missing something, lowering their guard', correct: true }, { text: 'It has no real effect', correct: false }, { text: 'To rush the prospect along', correct: false }] },
  { id: 'f18', category: 'Handling Objections', question: 'What does the "identity frame" technique push a prospect to avoid?', options: [{ text: 'Identifying with their own family', correct: false }, { text: 'Comparing prices', correct: false }, { text: 'Talking about their job', correct: false }, { text: 'Identifying with other people who keep delaying and never solve their problem', correct: true }] },
  // Video 6 — Qualifying the prospect (BANT, revised 2026-07-01)
  { id: 'f19', category: 'Qualifying the Prospect', question: 'What does the BANT framework stand for?', options: [{ text: 'Budget, Authority, Need, Timeline', correct: true }, { text: 'Best, Aggressive, New, Targeted', correct: false }, { text: 'Buyer, Attitude, Numbers, Trust', correct: false }, { text: 'Budget, Ability, Need, Trust', correct: false }] },
  { id: 'f20', category: 'Qualifying the Prospect', question: 'Why gather budget, authority, need, and timeline information during the conversation instead of after?', options: [{ text: "It's required by policy", correct: false }, { text: "It lets you qualify while you're already building value, without a separate step", correct: true }, { text: 'It only works in writing', correct: false }, { text: "It doesn't matter when you ask", correct: false }] },
  { id: 'f21', category: 'Qualifying the Prospect', question: "What's the risk of not confirming you're speaking with the actual decision-maker?", options: [{ text: 'None — everyone can approve a purchase', correct: false }, { text: "You could spend a lot of time and follow-up on someone who ultimately can't say yes", correct: true }, { text: 'It speeds up the sale', correct: false }, { text: 'It guarantees a close', correct: false }] },
  // Video 7 — Booking & handoff
  { id: 'f22', category: 'Booking & Handoff', question: 'What should an appointment setter do before being more assertive about booking?', options: [{ text: 'Send a contract immediately', correct: false }, { text: 'Ask for payment', correct: false }, { text: 'Build rapport, provide value, and qualify the prospect first', correct: true }, { text: 'Nothing — assertiveness should come first', correct: false }] },
  { id: 'f23', category: 'Booking & Handoff', question: "What's the recommended phrasing style for confirming a prospect has time?", options: [{ text: 'An open-ended "you got a sec?"', correct: false }, { text: 'No need to ask at all', correct: false }, { text: 'A small, specific ask like "do you have two minutes?"', correct: true }, { text: 'A 30-minute time block request', correct: false }] },
  { id: 'f24', category: 'Booking & Handoff', question: 'What does "assume the appointment" mean in practice?', options: [{ text: 'Always double-confirm before booking', correct: false }, { text: 'Let the prospect suggest the time', correct: false }, { text: 'Skip qualifying entirely', correct: false }, { text: 'Move forward with booking rather than asking permission to proceed', correct: true }] },
  { id: 'f25', category: 'Booking & Handoff', question: 'When is the ideal moment to ask for a referral?', options: [{ text: "Before you've provided any value", correct: false }, { text: 'During an objection', correct: false }, { text: 'When the prospect is expressing thanks or gratitude', correct: true }, { text: "Never — setters shouldn't ask", correct: false }] },
  // Video 8 — Time management & call discipline
  { id: 'f26', category: 'Time Management & Call Discipline', question: "What's one of the biggest mistakes that causes reps to underperform?", options: [{ text: 'Making too many calls', correct: false }, { text: 'Taking detailed notes', correct: false }, { text: 'Reacting to the day instead of planning it', correct: true }, { text: 'Following up too quickly', correct: false }] },
  { id: 'f27', category: 'Time Management & Call Discipline', question: 'Why are morning dial blocks especially effective?', options: [{ text: "It's mandatory company policy", correct: false }, { text: 'Prospects prefer being called early no matter what', correct: false }, { text: "It avoids using a CRM", correct: false }, { text: 'Connect rates are better and it builds early momentum', correct: true }] },
  { id: 'f28', category: 'Time Management & Call Discipline', question: "What's the recommended way to close out the work day?", options: [{ text: 'Immediately log off without review', correct: false }, { text: 'Schedule more calls for the night', correct: false }, { text: 'A few minutes of reflection on what worked and what to carry into tomorrow', correct: true }, { text: 'Clear all browser tabs', correct: false }] },
  { id: 'f30', category: 'Time Management & Call Discipline', question: "What's a key way to build tomorrow's pipeline today?", options: [{ text: 'Randomly cold calling with no list', correct: false }, { text: 'A dedicated sourcing block to find new target contacts', correct: true }, { text: 'Waiting until tomorrow morning to find leads', correct: false }, { text: 'Skipping prep entirely and improvising', correct: false }] },
]

// Shared A/B/C/D badge letters — used by both the mini-quiz and final exam
// option lists so the two stay visually identical (Prompt 193).
const OPTION_LETTERS = ['A', 'B', 'C', 'D']

// ── ErrorToast — one-off inline validation message, same mechanics as
// NotificationToast.jsx's ToastCard (position, card style, exit-only slide
// animation, dismiss timing) but not routed through the notifications
// table/bell (Prompt 199). `onDone` is captured in a ref so the mount effect
// only runs once — the caller passes a fresh inline arrow every render, and
// depending on it directly would tear down/reschedule the dismiss timers on
// every re-render instead of once (Prompt 200 fix).
function ErrorToast({ message, onDone }) {
  const [exiting, setExiting] = useState(false)
  const onDoneRef = useRef(onDone)
  useEffect(() => { onDoneRef.current = onDone })

  useEffect(() => {
    const toExit = setTimeout(() => setExiting(true), 4500)
    const toDone = setTimeout(() => onDoneRef.current(), 4850)
    return () => { clearTimeout(toExit); clearTimeout(toDone) }
  }, [])

  return createPortal(
    <div style={{ position: 'fixed', top: 16, right: 16, zIndex: 10000, pointerEvents: 'none' }}>
      <div style={{
        display: 'flex', alignItems: 'flex-start', gap: 10,
        padding: '11px 14px',
        background: '#13131F',
        border: '0.5px solid var(--border)',
        borderRadius: 10,
        boxShadow: '0 8px 32px rgba(0,0,0,0.45)',
        width: 300,
        pointerEvents: 'auto',
        opacity: exiting ? 0 : 1,
        transform: exiting ? 'translateX(110%)' : 'translateX(0)',
        transition: 'opacity 0.3s ease, transform 0.3s ease',
      }}>
        <div style={{
          width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
          background: 'var(--danger-dim)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <AlertCircle size={13} style={{ color: 'var(--danger)' }} />
        </div>
        <p style={{
          flex: 1, fontSize: 12.5, color: 'var(--text-primary)',
          margin: 0, lineHeight: 1.45, paddingTop: 4,
        }}>
          {message}
        </p>
      </div>
    </div>,
    document.body
  )
}

function buildMiniQuiz(video) {
  return MINI_QUIZ_CONTENT[video.id] || []
}

function buildFinalQuizPool() {
  return shuffle(FINAL_EXAM_QUESTIONS)
}

const CATEGORY_FILTERS = [
  { key: 'all', label: 'All Cards', count: FLASHCARDS.length },
  ...Object.entries(CATEGORY_LABELS).map(([key, label]) => ({
    key, label, count: FLASHCARDS.filter(c => c.category === key).length,
  })),
]

// DISCOVERY_SCRIPT (the universal discovery script) now lives in
// src/lib/discoveryScript.js — imported above and shared with the Call Now
// modal so Training and a live call show the exact same script.

function shuffle(arr) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// ── LockedVideoPlayer — YouTube IFrame API, blocks seeking ahead ──────────────
// Only player chrome allowed is fullscreen + volume. We can't strip YouTube's
// own seekbar, but we snap any forward seek back to the furthest-watched
// point every second, and disable keyboard shortcuts (arrow-key skip).
// `startAt` resumes a previously-exited video from its saved position
// (Prompt 232 item E) — where playback picks up on reopen.
// `maxWatched` (Prompt 239) is a separate high-water mark — the furthest
// point ever reached, which only ever increases. The anti-skip-forward
// ceiling seeds from `maxWatched`, not `startAt`, so a rep who rewinds
// before exiting (or reopens after rewinding) can still freely re-skip
// forward up to ground they've already earned, without re-lowering the
// ceiling itself. `getCurrentTime`/`getMaxWatched` are exposed via ref so
// the exit control can read both live values when the rep backs out,
// without threading them through state on every tick.

const LockedVideoPlayer = forwardRef(function LockedVideoPlayer({ video, onEnded, startAt = 0, maxWatched = 0 }, ref) {
  const containerRef = useRef(null)
  const playerRef    = useRef(null)
  const maxTimeRef   = useRef(Math.max(startAt, maxWatched))
  const endedRef     = useRef(false)

  useImperativeHandle(ref, () => ({
    getCurrentTime: () => {
      const p = playerRef.current
      if (p && typeof p.getCurrentTime === 'function') {
        try { return p.getCurrentTime() } catch { /* ignore */ }
      }
      return maxTimeRef.current
    },
    getMaxWatched: () => maxTimeRef.current,
  }), [])

  useEffect(() => {
    let cancelled = false
    maxTimeRef.current = Math.max(startAt, maxWatched)
    endedRef.current = false

    function createPlayer() {
      if (cancelled || !containerRef.current) return
      playerRef.current = new window.YT.Player(containerRef.current, {
        videoId: video.youtubeId,
        playerVars: {
          autoplay: 1, controls: 1, modestbranding: 1, rel: 0, fs: 1, disablekb: 1, playsinline: 1,
          start: Math.floor(startAt),
        },
        events: {
          onStateChange: (e) => {
            if (e.data === window.YT.PlayerState.ENDED && !endedRef.current) {
              endedRef.current = true
              onEnded()
            }
          },
        },
      })
    }

    if (window.YT && window.YT.Player) {
      createPlayer()
    } else {
      if (!document.getElementById('yt-iframe-api')) {
        const tag = document.createElement('script')
        tag.id = 'yt-iframe-api'
        tag.src = 'https://www.youtube.com/iframe_api'
        document.body.appendChild(tag)
      }
      const prevReady = window.onYouTubeIframeAPIReady
      window.onYouTubeIframeAPIReady = () => { prevReady?.(); createPlayer() }
    }

    return () => {
      cancelled = true
      try { playerRef.current?.destroy?.() } catch { /* ignore */ }
    }
  }, [video.youtubeId, startAt, maxWatched])

  // Block scrubbing ahead — snap back to furthest-watched position
  useEffect(() => {
    const interval = setInterval(() => {
      const p = playerRef.current
      if (!p || typeof p.getCurrentTime !== 'function') return
      const t = p.getCurrentTime()
      if (t > maxTimeRef.current + 1.5) {
        p.seekTo(maxTimeRef.current, true)
      } else if (t > maxTimeRef.current) {
        maxTimeRef.current = t
      }
    }, 1000)
    return () => clearInterval(interval)
  }, [])

  return <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
})

// ── MiniQuiz — per-video, formative only, never blocks progress ──────────────

function MiniQuiz({ video, onDone }) {
  const [questions]  = useState(() => buildMiniQuiz(video))
  const [index, setIndex] = useState(0)
  const [picked, setPicked] = useState(null)

  function pick(i) {
    if (picked !== null) return
    setPicked(i)
    setTimeout(() => {
      if (index + 1 >= questions.length) {
        onDone()
      } else {
        setIndex(v => v + 1)
        setPicked(null)
      }
    }, 700)
  }

  const q = questions[index]
  return (
    <div style={{ padding: '36px 44px' }}>
      <p style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--accent)', margin: '0 0 18px' }}>
        Quick Check · {index + 1}/{questions.length}
      </p>
      <div className="glass" style={{ borderRadius: 12, padding: '40px 44px', marginBottom: 24, minHeight: 160, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        <p style={{ fontSize: 21, fontWeight: 500, color: 'var(--text-primary)', lineHeight: 1.5, margin: 0 }}>
          {q.question}
        </p>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {q.options.map((opt, i) => {
          const showFeedback = picked !== null
          const isCorrect = i === q.correctIndex
          const isPicked = picked === i
          const badgeBg = !showFeedback ? 'var(--accent)' : isCorrect ? 'var(--success)' : isPicked ? 'var(--danger)' : 'var(--accent)'
          const border  = !showFeedback ? 'var(--border)' : isCorrect ? 'var(--success)' : isPicked ? 'var(--danger)' : 'var(--border)'
          const bg      = showFeedback && isCorrect ? 'rgba(34,197,94,0.08)' : showFeedback && isPicked ? 'rgba(239,68,68,0.08)' : 'var(--bg-elevated)'
          const textColor = showFeedback ? (isCorrect ? 'var(--success)' : isPicked ? 'var(--danger)' : 'var(--text-secondary)') : 'var(--text-secondary)'
          return (
            <button
              key={i}
              onClick={() => pick(i)}
              disabled={picked !== null}
              style={{
                display: 'flex', alignItems: 'center', gap: 14, textAlign: 'left', padding: '18px 20px',
                background: bg, border: `0.5px solid ${border}`, borderRadius: 10,
                cursor: picked === null ? 'pointer' : 'default', fontSize: 14, lineHeight: 1.55,
                color: textColor,
              }}
            >
              <span style={{
                flexShrink: 0, width: 26, height: 26, borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 12, fontWeight: 500, fontFamily: 'var(--font-mono)',
                background: badgeBg, color: 'white',
              }}>
                {OPTION_LETTERS[i]}
              </span>
              <span style={{ flex: 1 }}>{opt}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

// Per-video position entries used to be a bare number (last exit position,
// Prompt 232E). Prompt 239 splits that into `{ position, maxWatched }` so
// rewinding before exit can't drag the anti-skip ceiling backward. Existing
// rows still hold the old bare-number shape — normalize on read so both
// shapes coexist without a column migration; the object shape gets written
// back on the next save.
function normalizePositionEntry(raw) {
  if (typeof raw === 'number') return { position: raw, maxWatched: raw }
  if (raw && typeof raw === 'object') {
    const position = typeof raw.position === 'number' ? raw.position : 0
    const maxWatched = typeof raw.maxWatched === 'number' ? Math.max(raw.maxWatched, position) : position
    return { position, maxWatched }
  }
  return { position: 0, maxWatched: 0 }
}

function normalizePositions(raw) {
  const out = {}
  for (const [id, v] of Object.entries(raw || {})) out[id] = normalizePositionEntry(v)
  return out
}

// ── VideoLibrary ──────────────────────────────────────────────────────────────

function VideoLibrary({ progress, saveProgress }) {
  // Watched state lives in training_progress (it gates lead access);
  // localStorage stays as a fallback merge for pre-gate completions.
  const [watched, setWatched] = useState(() => {
    const fromDb = Array.isArray(progress?.videos_watched) ? progress.videos_watched : []
    let fromLs = []
    try { fromLs = JSON.parse(localStorage.getItem(LS_VIDEOS) || '[]') } catch { /* ignore */ }
    return [...new Set([...fromDb, ...fromLs])]
  })
  // Per-video position, keyed by video id (Prompt 232 item E, reshaped by
  // Prompt 239) — `position` is where playback resumes, `maxWatched` is the
  // furthest-ever-reached high-water mark that seeds the anti-skip ceiling.
  const [positions, setPositions] = useState(() => {
    const fromDb = progress?.video_positions && typeof progress.video_positions === 'object' ? progress.video_positions : {}
    let fromLs = {}
    try { fromLs = JSON.parse(localStorage.getItem(LS_VIDEO_POSITIONS) || '{}') } catch { /* ignore */ }
    return normalizePositions({ ...fromLs, ...fromDb })
  })
  const [activeVideo, setActiveVideo] = useState(null)
  // 'playing' while locked, 'quiz' once the video ends and the mini quiz shows
  const [stage, setStage] = useState('playing')
  const playerRef = useRef(null)

  // DB row loads async — merge it in when it arrives
  useEffect(() => {
    const fromDb = Array.isArray(progress?.videos_watched) ? progress.videos_watched : []
    if (fromDb.length) setWatched(prev => prev.length === new Set([...prev, ...fromDb]).size ? prev : [...new Set([...prev, ...fromDb])])
    const fromDbPositions = progress?.video_positions
    if (fromDbPositions && typeof fromDbPositions === 'object') {
      setPositions(prev => ({ ...normalizePositions(fromDbPositions), ...prev }))
    }
  }, [progress])

  function savePosition(id, seconds, maxWatched) {
    setPositions(prev => {
      const prevEntry = prev[id] || { position: 0, maxWatched: 0 }
      const next = { ...prev, [id]: { position: seconds, maxWatched: Math.max(prevEntry.maxWatched, maxWatched, seconds) } }
      localStorage.setItem(LS_VIDEO_POSITIONS, JSON.stringify(next))
      saveProgress({ video_positions: next })
      return next
    })
  }

  function clearPosition(id) {
    setPositions(prev => {
      if (!(id in prev)) return prev
      const next = { ...prev }
      delete next[id]
      localStorage.setItem(LS_VIDEO_POSITIONS, JSON.stringify(next))
      saveProgress({ video_positions: next })
      return next
    })
  }

  function markWatched(id) {
    clearPosition(id)
    setWatched(prev => {
      if (prev.includes(id)) return prev
      const next = [...prev, id]
      localStorage.setItem(LS_VIDEOS, JSON.stringify(next))
      saveProgress({ videos_watched: next })
      return next
    })
  }

  function openVideo(v) {
    setActiveVideo(v)
    setStage('playing')
  }

  // Exit mid-watch — saves the live playback position so the next open of
  // this same video resumes from here, then closes the modal. Only reachable
  // during the 'playing' stage. Saves current position and furthest-reached
  // separately (Prompt 239) — the anti-skip-forward ceiling on resume comes
  // from maxWatched, not the exit position, so exiting after a rewind can't
  // drag the ceiling backward.
  function exitVideo() {
    const t = playerRef.current?.getCurrentTime?.()
    const maxWatched = playerRef.current?.getMaxWatched?.() ?? 0
    if (activeVideo && typeof t === 'number' && t > 0) savePosition(activeVideo.id, t, maxWatched)
    closeVideo()
  }

  function closeVideo() {
    setActiveVideo(null)
    setStage('playing')
  }

  const isPlaceholder = (id) => id.startsWith('PLACEHOLDER')

  return (
    <div>
      {/* Heads-up notice — static copy, shown before any video is picked (Prompt 198) */}
      <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 10 }}>
        Heads up — you'll get a quick mini quiz after every video.
      </p>

      {/* Progress strip */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        background: 'var(--bg-surface)', border: '0.5px solid var(--border)',
        borderRadius: 10, padding: '10px 16px', marginBottom: 20,
      }}>
        <div style={{ flex: 1, height: 4, background: 'var(--bg-elevated)', borderRadius: 2, overflow: 'hidden' }}>
          <div style={{
            height: '100%',
            width: `${(watched.length / TRAINING_VIDEOS.length) * 100}%`,
            background: 'var(--success)', borderRadius: 2,
            transition: 'width 0.4s ease',
          }} />
        </div>
        <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)', flexShrink: 0 }}>
          {watched.length} / {TRAINING_VIDEOS.length} watched
        </span>
      </div>

      {/* Grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
        gap: 14,
      }}>
        {TRAINING_VIDEOS.map(v => {
          const done = watched.includes(v.id)
          return (
            <div
              key={v.id}
              className="glass"
              style={{ padding: 16, cursor: 'pointer', transition: 'border-color 0.15s', position: 'relative' }}
              onClick={() => !isPlaceholder(v.youtubeId) && openVideo(v)}
            >
              {/* Thumbnail — flush with the card's top corners (.glass is
                  12px radius, card padding 16px → negative margins) */}
              <div style={{
                position: 'relative', overflow: 'hidden',
                margin: '-16px -16px 12px',
                height: 120,
                borderRadius: '12px 12px 0 0',
                background: 'var(--bg-elevated)',
              }}>
                {isPlaceholder(v.youtubeId) ? (
                  <div style={{
                    height: '100%', background: 'var(--accent-dim)',
                    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <div style={{
                      width: 40, height: 40,
                      background: 'rgba(108,99,255,0.2)',
                      borderRadius: '50%',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      marginBottom: 8,
                    }}>
                      <Play size={16} style={{ color: 'var(--accent)', marginLeft: 2 }} />
                    </div>
                    <p style={{ fontSize: 10, color: 'var(--text-muted)', margin: 0 }}>Coming Soon</p>
                  </div>
                ) : (
                  <>
                    <img
                      src={`https://img.youtube.com/vi/${v.youtubeId}/hqdefault.jpg`}
                      alt={v.title}
                      loading="lazy"
                      style={{
                        display: 'block', width: '100%', height: '100%',
                        objectFit: 'cover',
                      }}
                    />
                    {/* Play overlay — white semi-transparent circle + CSS triangle */}
                    <div style={{
                      position: 'absolute', top: '50%', left: '50%',
                      transform: 'translate(-50%, -50%)',
                      width: 42, height: 42, borderRadius: '50%',
                      background: 'rgba(255,255,255,0.78)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      <span style={{
                        display: 'block', width: 0, height: 0, marginLeft: 4,
                        borderTop: '8px solid transparent',
                        borderBottom: '8px solid transparent',
                        borderLeft: '13px solid rgba(8,8,16,0.85)',
                      }} />
                    </div>
                    {/* Watched badge */}
                    {done && (
                      <span style={{
                        position: 'absolute', top: 8, right: 8,
                        width: 22, height: 22, borderRadius: '50%',
                        background: 'var(--success)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 12, color: 'white', fontWeight: 500,
                        boxShadow: '0 1px 6px rgba(0,0,0,0.4)',
                      }}>
                        ✓
                      </span>
                    )}
                  </>
                )}
                {/* Duration badge */}
                <span style={{
                  position: 'absolute', bottom: 6, right: 8,
                  fontSize: 10, fontFamily: 'var(--font-mono)',
                  color: 'white', background: 'rgba(8,8,16,0.75)',
                  padding: '1px 5px', borderRadius: 3,
                }}>
                  {v.duration}
                </span>
              </div>

              {/* Meta */}
              <div style={{ fontSize: 10, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>
                {v.category}
              </div>
              <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)', marginBottom: 4, lineHeight: 1.3 }}>
                {v.title}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                {v.description}
              </div>

              {/* Completion status — only earned by watching the video through (locked player) */}
              <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  background: done ? 'rgba(34,197,94,0.08)' : 'transparent',
                  border: `0.5px solid ${done ? 'rgba(34,197,94,0.3)' : 'var(--border)'}`,
                  borderRadius: 5, padding: '4px 8px',
                  fontSize: 11, color: done ? 'var(--success)' : 'var(--text-muted)',
                }}>
                  {done ? <Check size={10} /> : null}
                  {done ? 'Completed' : 'Not watched'}
                </span>
              </div>
            </div>
          )
        })}
      </div>

      {/* Video modal — no backdrop close, no skip ahead. An exit control
          (Prompt 232 item E) lets the rep back out mid-watch and resume
          later from that position; it does not relax the anti-skip-forward
          restriction. The mini-quiz that follows the video is still fully
          locked (Prompt 193) — it only ever closes itself via onDone, never
          by user dismissal. */}
      {activeVideo && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 200,
            background: 'rgba(8,8,16,0.92)', backdropFilter: 'blur(8px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 24,
          }}
        >
          <div
            style={{
              width: '100%', maxWidth: stage === 'quiz' ? 900 : 720,
              maxHeight: stage === 'quiz' ? '88vh' : undefined,
              background: 'var(--bg-surface)', borderRadius: 14,
              overflowY: stage === 'quiz' ? 'auto' : 'hidden', overflowX: 'hidden',
              border: '0.5px solid var(--border)',
            }}
          >
            {stage === 'playing' && (
              <div style={{ padding: '14px 20px', borderBottom: '0.5px solid var(--border)', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                <div>
                  <p style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)', margin: 0 }}>{activeVideo.title}</p>
                  <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>
                    {activeVideo.category} · {activeVideo.duration}
                    <span style={{ color: 'var(--warning)' }}> · no skipping ahead</span>
                  </p>
                </div>
                <button
                  onClick={exitVideo}
                  title="Exit — your progress will be saved"
                  style={{
                    flexShrink: 0, width: 26, height: 26, borderRadius: 6,
                    background: 'var(--bg-elevated)', border: '0.5px solid var(--border)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: 'var(--text-muted)', cursor: 'pointer',
                  }}
                >
                  <X size={13} />
                </button>
              </div>
            )}

            {stage === 'playing' ? (
              <div style={{ position: 'relative', paddingTop: '56.25%' }}>
                <div style={{ position: 'absolute', inset: 0 }}>
                  <LockedVideoPlayer
                    ref={playerRef}
                    video={activeVideo}
                    startAt={positions[activeVideo.id]?.position || 0}
                    maxWatched={positions[activeVideo.id]?.maxWatched || 0}
                    onEnded={() => setStage('quiz')}
                  />
                </div>
              </div>
            ) : (
              <MiniQuiz video={activeVideo} onDone={() => { markWatched(activeVideo.id); closeVideo() }} />
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── FlashcardDeck ─────────────────────────────────────────────────────────────

function FlashcardDeck({ progress, saveProgress, onAllMastered }) {
  const [filter, setFilter]     = useState('all')
  const [deck, setDeck]         = useState(() => FLASHCARDS)
  const [index, setIndex]       = useState(0)
  const [flipped, setFlipped]   = useState(false)
  // Tracks whether the current card has been flipped to its answer face at
  // least once — required before it can be marked mastered (Prompt 199).
  // Resets whenever the card in view changes; does NOT reset just from
  // flipping back to the front, so re-flipping doesn't lose credit.
  const [viewed, setViewed]     = useState(false)
  // Mastery lives in training_progress.flashcards_mastered, scoped by
  // rep_id — same pattern as videos_watched. Previously this was an
  // unscoped localStorage set with no per-user boundary at all, so a
  // brand-new account on a browser that had mastered cards before
  // inherited that mastery (Prompt 283 bug). No localStorage fallback
  // here on purpose: unlike videos, flashcards never had legitimate
  // pre-DB progress worth preserving.
  const [mastered, setMastered] = useState(() => {
    const fromDb = Array.isArray(progress?.flashcards_mastered) ? progress.flashcards_mastered : []
    return new Set(fromDb)
  })
  const [animDir, setAnimDir]   = useState(null) // 'left' | 'right'
  const [allMasteredMsg, setAllMasteredMsg] = useState(false)

  // DB row loads async — merge it in when it arrives (mirrors VideoLibrary).
  useEffect(() => {
    const fromDb = Array.isArray(progress?.flashcards_mastered) ? progress.flashcards_mastered : []
    if (fromDb.length) setMastered(prev => prev.size === new Set([...prev, ...fromDb]).size ? prev : new Set([...prev, ...fromDb]))
  }, [progress])

  const filteredDeck = deck.filter(c => filter === 'all' || c.category === filter)
  const card = filteredDeck[index] || null
  const masteredInDeck = filteredDeck.filter(c => mastered.has(c.id)).length

  function saveMastered(next) {
    saveProgress({ flashcards_mastered: [...next] })
  }

  function handleShuffle() {
    setDeck(shuffle(FLASHCARDS))
    setIndex(0)
    setFlipped(false)
    setViewed(false)
  }

  function handleFilter(key) {
    setFilter(key)
    setIndex(0)
    setFlipped(false)
    setViewed(false)
  }

  function navigate(dir) {
    if (!filteredDeck.length) return
    setAnimDir(dir)
    setFlipped(false)
    setTimeout(() => {
      setIndex(i => {
        if (dir === 'next') return (i + 1) % filteredDeck.length
        return (i - 1 + filteredDeck.length) % filteredDeck.length
      })
      setAnimDir(null)
      setViewed(false)
    }, 180)
  }

  function handleFlip() {
    setFlipped(v => {
      const next = !v
      if (next) setViewed(true)
      return next
    })
  }

  // One-way: requires the card to have been flipped/viewed first, and once
  // mastered there's no toggling back (Prompt 199).
  function handleMaster() {
    if (!card || !viewed || mastered.has(card.id)) return
    setMastered(prev => {
      const next = new Set(prev)
      next.add(card.id)
      saveMastered(next)
      if (next.size >= FLASHCARDS.length) {
        setAllMasteredMsg(true)
        onAllMastered?.()
      }
      return next
    })
  }

  const isMastered = card ? mastered.has(card.id) : false
  const catColor   = card ? (CATEGORY_COLORS[card.category] || 'var(--accent)') : 'var(--accent)'

  return (
    <div>
      <style>{`
        .fc-container { perspective: 1200px; }
        .fc-inner {
          position: relative; transition: transform 0.5s cubic-bezier(0.4,0,0.2,1);
          transform-style: preserve-3d;
        }
        .fc-inner.is-flipped { transform: rotateY(180deg); }
        .fc-face {
          backface-visibility: hidden;
          -webkit-backface-visibility: hidden;
        }
        .fc-back-face { transform: rotateY(180deg); }
        .fc-slide-left  { animation: fcSlideLeft  0.18s ease forwards; }
        .fc-slide-right { animation: fcSlideRight 0.18s ease forwards; }
        @keyframes fcSlideLeft  { from { opacity: 1; transform: translateX(0);    } to { opacity: 0; transform: translateX(-20px); } }
        @keyframes fcSlideRight { from { opacity: 1; transform: translateX(0);    } to { opacity: 0; transform: translateX(20px);  } }
        .cat-pill { padding: 3px 10px; border-radius: 20px; font-size: 10px; font-weight: 500; letter-spacing: 0.06em; text-transform: uppercase; cursor: pointer; transition: all 0.12s; }
      `}</style>

      {/* Mastery progress strip — matches VideoLibrary's X/8 watched bar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        background: 'var(--bg-surface)', border: '0.5px solid var(--border)',
        borderRadius: 10, padding: '10px 16px', marginBottom: 20,
      }}>
        <div style={{ flex: 1, height: 4, background: 'var(--bg-elevated)', borderRadius: 2, overflow: 'hidden' }}>
          <div style={{
            height: '100%',
            width: `${(mastered.size / FLASHCARDS.length) * 100}%`,
            background: 'var(--success)', borderRadius: 2,
            transition: 'width 0.4s ease',
          }} />
        </div>
        <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)', flexShrink: 0 }}>
          {mastered.size} / {FLASHCARDS.length} mastered
        </span>
      </div>

      {/* Controls row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        {/* Category filters */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {CATEGORY_FILTERS.map(f => {
            const active = filter === f.key
            return (
              <button
                key={f.key}
                className="cat-pill"
                onClick={() => handleFilter(f.key)}
                style={{
                  background: active ? 'var(--accent-dim)' : 'var(--bg-surface)',
                  color: active ? 'var(--accent)' : 'var(--text-muted)',
                  border: `0.5px solid ${active ? 'var(--accent-border)' : 'var(--border)'}`,
                }}
              >
                {f.label} · {f.count}
              </button>
            )
          })}
        </div>

        {/* Right controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
            {masteredInDeck} / {filteredDeck.length} mastered
          </span>
          <button
            onClick={handleShuffle}
            style={{
              display: 'flex', alignItems: 'center', gap: 5,
              background: 'var(--bg-surface)', border: '0.5px solid var(--border)',
              borderRadius: 6, padding: '5px 10px', fontSize: 12,
              color: 'var(--text-secondary)', cursor: 'pointer', transition: 'all 0.12s',
            }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--border-hover)'; e.currentTarget.style.color = 'var(--text-primary)' }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-secondary)' }}
          >
            <Shuffle size={12} /> Shuffle
          </button>
        </div>
      </div>

      {/* All-mastered success message */}
      {allMasteredMsg && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '10px 14px', marginBottom: 16,
          background: 'rgba(34,197,94,0.08)', border: '0.5px solid rgba(34,197,94,0.25)',
          borderRadius: 10, fontSize: 13, color: 'var(--success)',
        }}>
          <Check size={14} />
          Training complete — your leads will come in on the next refresh.
        </div>
      )}

      {/* Progress bar */}
      <div style={{ height: 3, background: 'var(--bg-elevated)', borderRadius: 2, marginBottom: 20, overflow: 'hidden' }}>
        <div style={{
          height: '100%',
          width: filteredDeck.length ? `${((index + 1) / filteredDeck.length) * 100}%` : '0%',
          background: catColor, borderRadius: 2, transition: 'width 0.3s ease',
        }} />
      </div>

      {/* Card counter */}
      <div style={{ textAlign: 'center', marginBottom: 16 }}>
        <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
          {filteredDeck.length ? `${index + 1} / ${filteredDeck.length}` : '—'}
        </span>
      </div>

      {/* Flip card */}
      {card ? (
        <div
          className={`fc-container ${animDir === 'next' ? 'fc-slide-left' : animDir === 'prev' ? 'fc-slide-right' : ''}`}
          style={{ maxWidth: 560, margin: '0 auto', cursor: 'pointer', userSelect: 'none' }}
          onClick={handleFlip}
        >
          <div className={`fc-inner ${flipped ? 'is-flipped' : ''}`} style={{ minHeight: 220 }}>
            {/* Front face */}
            <div className="fc-face" style={{
              position: flipped ? 'absolute' : 'relative',
              inset: 0,
              background: 'var(--bg-surface)',
              border: `0.5px solid ${isMastered ? 'rgba(34,197,94,0.3)' : 'var(--border)'}`,
              borderRadius: 14,
              padding: '36px 32px 28px',
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              textAlign: 'center', minHeight: 220,
              boxShadow: '0 4px 24px rgba(0,0,0,0.3)',
            }}>
              {/* Category badge */}
              <div style={{
                position: 'absolute', top: 12, left: 14,
                fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em',
                color: catColor,
                padding: '2px 8px', borderRadius: 20,
                background: `${catColor}18`, border: `0.5px solid ${catColor}33`,
              }}>
                {CATEGORY_LABELS[card.category]}
              </div>
              {isMastered && (
                <div style={{
                  position: 'absolute', top: 12, right: 14,
                  background: 'rgba(34,197,94,0.1)', border: '0.5px solid rgba(34,197,94,0.25)',
                  borderRadius: 4, padding: '2px 6px',
                  fontSize: 10, color: 'var(--success)',
                }}>
                  ✓ Mastered
                </div>
              )}
              <p style={{ fontSize: 18, fontWeight: 500, color: 'var(--text-primary)', lineHeight: 1.4, margin: 0 }}>
                {card.front}
              </p>
              <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 20, letterSpacing: '0.04em' }}>
                Tap to reveal answer
              </p>
            </div>

            {/* Back face */}
            <div className="fc-face fc-back-face" style={{
              position: 'absolute', inset: 0,
              background: 'var(--bg-surface)',
              border: `0.5px solid ${catColor}40`,
              borderRadius: 14,
              padding: '36px 32px 28px',
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              textAlign: 'center', minHeight: 220,
              boxShadow: `0 4px 24px rgba(0,0,0,0.3), 0 0 0 1px ${catColor}20`,
            }}>
              <div style={{
                position: 'absolute', top: 12, left: 14,
                fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em',
                color: catColor,
                padding: '2px 8px', borderRadius: 20,
                background: `${catColor}18`, border: `0.5px solid ${catColor}33`,
              }}>
                Answer
              </div>
              <p style={{ fontSize: 15, color: catColor, lineHeight: 1.6, margin: 0 }}>
                {card.back}
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div style={{ textAlign: 'center', padding: '60px 20px' }}>
          <p style={{ fontSize: 14, color: 'var(--text-muted)' }}>No cards in this filter.</p>
        </div>
      )}

      {/* Action row */}
      {card && (
        <div style={{ maxWidth: 560, margin: '16px auto 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          {/* Prev */}
          <button
            onClick={() => navigate('prev')}
            style={{
              width: 40, height: 40, borderRadius: '50%',
              background: 'var(--bg-surface)', border: '0.5px solid var(--border)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', color: 'var(--text-muted)', transition: 'all 0.12s',
            }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--border-hover)'; e.currentTarget.style.color = 'var(--text-primary)' }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-muted)' }}
          >
            <ChevronLeft size={16} />
          </button>

          {/* Master button — disabled until the card's been flipped; once
              mastered it's a static indicator, not a toggle (Prompt 199) */}
          <button
            onClick={handleMaster}
            disabled={isMastered || !viewed}
            style={{
              flex: 1, height: 40,
              background: isMastered ? 'rgba(34,197,94,0.1)' : 'var(--bg-surface)',
              border: `0.5px solid ${isMastered ? 'rgba(34,197,94,0.35)' : 'var(--border)'}`,
              borderRadius: 8,
              fontSize: 13, fontWeight: 500,
              color: isMastered ? 'var(--success)' : 'var(--text-secondary)',
              cursor: isMastered ? 'default' : viewed ? 'pointer' : 'not-allowed',
              opacity: !isMastered && !viewed ? 0.45 : 1,
              transition: 'all 0.15s',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            }}
          >
            <Check size={13} />
            {isMastered ? 'Mastered ✓' : viewed ? 'Mark Mastered' : 'Flip card first'}
          </button>

          {/* Next */}
          <button
            onClick={() => navigate('next')}
            style={{
              width: 40, height: 40, borderRadius: '50%',
              background: 'var(--accent)', border: 'none',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', color: 'white', transition: 'all 0.12s',
              boxShadow: '0 0 16px rgba(108,99,255,0.3)',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--accent-hover)' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'var(--accent)' }}
          >
            <ChevronRight size={16} />
          </button>
        </div>
      )}
    </div>
  )
}

// ── DiscoveryScript ───────────────────────────────────────────────────────────
// The Script tab. Drops straight into Practice mode (Prompt 209 — no outline
// landing page in front of it) — same ScriptWalk shell the live Call modal
// uses, derived from the shared DISCOVERY_SCRIPT so it can't drift.

function DiscoveryScript() {
  // A neutral demo lead so practice reads naturally without a real lead.
  const flow = useMemo(
    () => buildScriptFlow({ business_name: 'the business', niche: 'service', city: 'your area' }, null),
    []
  )

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', display: 'flex', flexDirection: 'column', height: 'calc(100vh - 160px)' }}>
      <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: 16, maxWidth: 720, flexShrink: 0 }}>
        Practice the call script one line at a time — pick what the prospect says, see what comes
        next. The Call Now button on each lead runs this same walk, personalized to that business.
      </p>
      <div style={{ flex: 1, minHeight: 0, border: '0.5px solid var(--border)', borderRadius: 14, overflow: 'hidden', background: 'var(--bg-inset)' }}>
        <ScriptWalk flow={flow} mode="practice" />
      </div>
    </div>
  )
}

// ── QuizTab — 20 questions auto-generated from the flashcard deck ─────────────
// Pass mark is 85% (17/20). Passing is one of the three lead-unlock checks.

function generateQuiz() {
  const pool = shuffle(FLASHCARDS).slice(0, QUIZ_QUESTIONS)
  return pool.map(card => {
    // 3 distractors — same-category answers first so options read plausibly
    const sameCat  = FLASHCARDS.filter(c => c.id !== card.id && c.category === card.category)
    const otherCat = FLASHCARDS.filter(c => c.id !== card.id && c.category !== card.category)
    const distractors = shuffle([...shuffle(sameCat).slice(0, 3), ...shuffle(otherCat)]).slice(0, 3)
    return {
      id: card.id,
      category: card.category,
      question: card.front,
      options: shuffle([
        { text: card.back, correct: true },
        ...distractors.map(d => ({ text: d.back, correct: false })),
      ]),
    }
  })
}

function QuizTab({ progress, saveProgress }) {
  const [questions, setQuestions] = useState(null) // null = idle screen
  const [index, setIndex]         = useState(0)
  const [picked, setPicked]       = useState(null) // option index while showing feedback
  const [correct, setCorrect]     = useState(0)
  const [finished, setFinished]   = useState(false)

  const bestPct = progress?.quiz_score != null
    ? Math.round((progress.quiz_score / (progress.quiz_total || 1)) * 100)
    : null
  const passed = !!progress?.quiz_passed_at

  function start() {
    setQuestions(generateQuiz())
    setIndex(0)
    setPicked(null)
    setCorrect(0)
    setFinished(false)
  }

  function pick(i) {
    if (picked !== null) return
    setPicked(i)
    const isRight = questions[index].options[i].correct
    const nextCorrect = correct + (isRight ? 1 : 0)
    setCorrect(nextCorrect)
    setTimeout(() => {
      if (index + 1 >= questions.length) {
        finish(nextCorrect)
      } else {
        setIndex(v => v + 1)
        setPicked(null)
      }
    }, 900)
  }

  function finish(finalCorrect) {
    setFinished(true)
    const pct = Math.round((finalCorrect / questions.length) * 100)
    const patch = {}
    // Keep the best attempt on record
    if (bestPct === null || pct > bestPct) {
      patch.quiz_score = finalCorrect
      patch.quiz_total = questions.length
    }
    if (pct >= QUIZ_PASS_PCT && !progress?.quiz_passed_at) {
      patch.quiz_passed_at = new Date().toISOString()
    }
    if (Object.keys(patch).length) saveProgress(patch)
  }

  // ── Results screen — animated score ring, badge-style reveal ──
  if (finished) {
    const pct = Math.round((correct / questions.length) * 100)
    const didPass = pct >= QUIZ_PASS_PCT
    const ringColor = didPass ? 'var(--success)' : 'var(--danger)'
    const R = 54, C = 2 * Math.PI * R
    return (
      <div className="quiz-reveal" style={{ maxWidth: 480, margin: '0 auto', textAlign: 'center', padding: '40px 24px' }}>
        {/* Circular score ring with a badge medallion at center */}
        <div style={{ position: 'relative', width: 140, height: 140, margin: '0 auto 22px' }}>
          <svg width="140" height="140" viewBox="0 0 140 140" style={{ transform: 'rotate(-90deg)' }}>
            <circle cx="70" cy="70" r={R} fill="none" stroke="var(--bg-elevated)" strokeWidth="9" />
            <circle
              cx="70" cy="70" r={R} fill="none" stroke={ringColor} strokeWidth="9" strokeLinecap="round"
              strokeDasharray={C}
              strokeDashoffset={C - (Math.min(pct, 100) / 100) * C}
              style={{ transition: 'stroke-dashoffset 1s cubic-bezier(0.4,0,0.2,1)' }}
            />
          </svg>
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ fontSize: 32, fontFamily: 'var(--font-mono)', fontWeight: 600, color: ringColor, letterSpacing: '-0.02em', lineHeight: 1 }}>{pct}%</span>
            <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', marginTop: 3 }}>{correct}/{questions.length}</span>
          </div>
          {/* Pass/fail medallion badge */}
          <div style={{
            position: 'absolute', bottom: -2, right: 8,
            width: 34, height: 34, borderRadius: '50%',
            background: didPass ? 'var(--success)' : 'var(--danger)',
            border: '3px solid var(--bg-base, #0B0B12)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: `0 0 16px ${didPass ? 'rgba(34,197,94,0.5)' : 'rgba(239,68,68,0.4)'}`,
          }}>
            {didPass ? <Check size={18} color="white" /> : <X size={18} color="white" />}
          </div>
        </div>
        <p style={{ fontSize: 17, color: 'var(--text-primary)', fontWeight: 600, margin: '0 0 6px', letterSpacing: '-0.01em' }}>
          {didPass ? 'Quiz Passed!' : `${QUIZ_PASS_PCT}% needed to pass`}
        </p>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6, margin: '0 auto 24px', maxWidth: 360 }}>
          {didPass
            ? 'Quiz check complete. This counts toward unlocking your leads.'
            : 'Review the flashcards and try again — the questions change every attempt.'}
        </p>
        <button
          onClick={start}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            height: 42, padding: '0 22px',
            background: didPass ? 'var(--bg-surface)' : 'var(--accent)',
            border: didPass ? '0.5px solid var(--border)' : 'none',
            borderRadius: 10, fontSize: 13, fontWeight: 500,
            color: didPass ? 'var(--text-secondary)' : 'white',
            cursor: 'pointer',
            boxShadow: didPass ? 'none' : '0 0 20px rgba(108,99,255,0.25)',
          }}
        >
          <RotateCcw size={14} />
          {didPass ? 'Take it again' : 'Retry quiz'}
        </button>
      </div>
    )
  }

  // ── Idle screen ── score ring (best vs pass threshold) + at-a-glance chips
  if (!questions) {
    const RC = 2 * Math.PI * 30 // ring circumference, r=30
    const ringPct = Math.min(bestPct ?? 0, 100)
    return (
      <div style={{ maxWidth: 480, margin: '0 auto', textAlign: 'center', padding: '48px 24px' }}>
        <div style={{ position: 'relative', width: 84, height: 84, margin: '0 auto 18px' }}>
          <svg width="84" height="84" style={{ transform: 'rotate(-90deg)' }}>
            <circle cx="42" cy="42" r="30" fill="none" stroke="var(--bg-elevated)" strokeWidth="6" />
            {bestPct !== null && (
              <circle
                cx="42" cy="42" r="30" fill="none"
                stroke={passed ? 'var(--success)' : 'var(--warning)'} strokeWidth="6" strokeLinecap="round"
                strokeDasharray={RC} strokeDashoffset={RC - (ringPct / 100) * RC}
                style={{ transition: 'stroke-dashoffset 700ms ease' }}
              />
            )}
          </svg>
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
            {bestPct !== null
              ? <span style={{ fontSize: 19, fontWeight: 600, fontFamily: 'var(--font-mono)', color: passed ? 'var(--success)' : 'var(--warning)' }}>{bestPct}%</span>
              : <ClipboardCheck size={26} color="var(--accent)" />}
          </div>
        </div>
        <h2 style={{ fontSize: 19, fontWeight: 500, color: 'var(--text-primary)', margin: '0 0 10px', letterSpacing: '-0.01em' }}>
          Flashcard Quiz
        </h2>
        <p style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.7, margin: '0 0 12px' }}>
          {QUIZ_QUESTIONS} questions drawn at random from the flashcard deck — objections,
          scripts, and product knowledge.
        </p>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)', background: 'var(--bg-elevated)', border: '0.5px solid var(--border)', borderRadius: 20, padding: '3px 10px' }}>
            {QUIZ_QUESTIONS} questions
          </span>
          <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)', background: 'var(--bg-elevated)', border: '0.5px solid var(--border)', borderRadius: 20, padding: '3px 10px' }}>
            Pass ≥ {QUIZ_PASS_PCT}%
          </span>
          {bestPct !== null && (
            <span style={{
              fontSize: 11, fontFamily: 'var(--font-mono)', fontWeight: 600,
              color: passed ? 'var(--success)' : 'var(--warning)',
              background: passed ? 'rgba(34,197,94,0.12)' : 'rgba(245,158,11,0.12)',
              border: `0.5px solid ${passed ? 'rgba(34,197,94,0.3)' : 'rgba(245,158,11,0.3)'}`,
              borderRadius: 20, padding: '3px 10px',
            }}>
              {passed ? 'Passed ✓' : `Best ${bestPct}%`}
            </span>
          )}
        </div>
        <button
          onClick={start}
          className="hover:!brightness-110"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            height: 42, padding: '0 24px', marginTop: 4,
            background: 'var(--accent)', border: 'none',
            borderRadius: 10, fontSize: 14, fontWeight: 500, color: 'white',
            cursor: 'pointer', boxShadow: '0 0 20px rgba(108,99,255,0.25)',
            transition: 'filter 120ms ease',
          }}
        >
          <Play size={15} />
          Start Quiz
        </button>
      </div>
    )
  }

  // ── Question screen — segmented progress, lettered options, answer feedback ──
  const q = questions[index]
  const catColor = CATEGORY_COLORS[q.category] || 'var(--accent)'
  const LETTERS = ['A', 'B', 'C', 'D', 'E']
  return (
    <div style={{ maxWidth: 640, margin: '0 auto' }}>
      {/* Progress: question counter, running score, segmented bar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)' }}>
          Question <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>{index + 1}</span> of {questions.length}
        </span>
        <span style={{
          fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--success)',
          background: 'rgba(34,197,94,0.1)', border: '0.5px solid rgba(34,197,94,0.25)',
          borderRadius: 20, padding: '2px 9px',
        }}>
          {correct} correct
        </span>
      </div>
      <div style={{ display: 'flex', gap: 3, marginBottom: 20 }}>
        {questions.map((_, i) => (
          <div key={i} style={{
            flex: 1, height: 4, borderRadius: 2,
            background: i < index ? 'var(--success)' : i === index ? 'var(--accent)' : 'var(--bg-elevated)',
            transition: 'background 0.3s ease',
          }} />
        ))}
      </div>

      {/* Question */}
      <div className="glass" style={{ borderRadius: 12, padding: '22px 24px', marginBottom: 16 }}>
        <p style={{
          fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em',
          color: catColor, margin: '0 0 8px', fontWeight: 600,
        }}>
          {CATEGORY_LABELS[q.category]}
        </p>
        <p style={{ fontSize: 16, fontWeight: 500, color: 'var(--text-primary)', lineHeight: 1.5, margin: 0 }}>
          {q.question}
        </p>
      </div>

      {/* Options — lettered chips + correct/incorrect feedback icons */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {q.options.map((opt, i) => {
          const showFeedback = picked !== null
          const isPicked  = picked === i
          const highlight = showFeedback && (opt.correct || isPicked)
          const color = !showFeedback ? 'var(--border)'
            : opt.correct ? 'rgba(34,197,94,0.5)'
            : isPicked ? 'rgba(239,68,68,0.5)'
            : 'var(--border)'
          const fg = highlight ? (opt.correct ? 'var(--success)' : 'var(--danger)') : 'var(--text-secondary)'
          return (
            <button
              key={i}
              onClick={() => pick(i)}
              disabled={picked !== null}
              className={picked === null ? 'quiz-option' : undefined}
              style={{
                display: 'flex', alignItems: 'center', gap: 12,
                textAlign: 'left', padding: '13px 14px',
                background: !showFeedback ? 'var(--bg-surface)'
                  : opt.correct ? 'rgba(34,197,94,0.08)'
                  : isPicked ? 'rgba(239,68,68,0.08)'
                  : 'var(--bg-surface)',
                border: `0.5px solid ${color}`,
                borderRadius: 10, cursor: picked === null ? 'pointer' : 'default',
                fontSize: 13, lineHeight: 1.55, color: fg,
                transition: 'all 0.18s ease',
                opacity: showFeedback && !highlight ? 0.45 : 1,
              }}
            >
              {/* Letter chip / feedback icon */}
              <span style={{
                flexShrink: 0, width: 24, height: 24, borderRadius: 7,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 11, fontWeight: 600, fontFamily: 'var(--font-mono)',
                background: highlight ? (opt.correct ? 'var(--success)' : 'var(--danger)') : 'var(--bg-elevated)',
                color: highlight ? 'white' : 'var(--text-muted)',
                border: highlight ? 'none' : '0.5px solid var(--border)',
                transition: 'all 0.18s ease',
              }}>
                {highlight ? (opt.correct ? <Check size={13} /> : <X size={13} />) : LETTERS[i]}
              </span>
              <span style={{ flex: 1 }}>{opt.text}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ── FinalQuizTab — 30 questions covering all 8 videos, gates completion ──────
// Combined with flashcard mastery via onPass (see TrainingCenter below).

function FinalQuizTab({ watchedCount, passed, onPass, flashcardsMastered }) {
  const [questions, setQuestions] = useState(null)
  const [index, setIndex]   = useState(0)
  // Answers persist per question index (answers[qIndex] = chosen option index),
  // so Back/Next can move freely between answered and unanswered questions
  // without losing prior picks. Score is only computed at finish time.
  const [answers, setAnswers] = useState([])
  const [finished, setFinished] = useState(false)
  const [toastMsg, setToastMsg] = useState(null)

  const locked = watchedCount < TRAINING_VIDEOS.length

  function start() {
    setQuestions(buildFinalQuizPool())
    setIndex(0)
    setAnswers([])
    setFinished(false)
  }

  // Gate at the action level, not a full-screen lock (Prompt 283) — the real
  // exam landing page always renders; clicking Start when a prerequisite
  // isn't met surfaces a slide-in toast instead (same pattern the flashcard
  // half of this gate already used, Prompt 199).
  function handleStartClick() {
    if (locked) {
      setToastMsg(`Watch all 8 videos first — ${watchedCount}/${TRAINING_VIDEOS.length} watched.`)
      return
    }
    if (!flashcardsMastered) {
      setToastMsg('Master all flashcards before taking the Final Exam.')
      return
    }
    start()
  }

  // Clicking an answer only *selects* it — no advance, no right/wrong reveal.
  // Advancing is a separate "Next" click.
  function pick(i) {
    setAnswers(prev => {
      const next = [...prev]
      next[index] = i
      return next
    })
  }

  function next() {
    if (index + 1 >= questions.length) finish()
    else setIndex(v => v + 1)
  }

  function back() {
    setIndex(v => Math.max(0, v - 1))
  }

  function finish() {
    setFinished(true)
    const finalCorrect = answers.reduce(
      (acc, ans, qi) => acc + (ans != null && questions[qi].options[ans].correct ? 1 : 0), 0)
    const pct = Math.round((finalCorrect / questions.length) * 100)
    if (pct >= FINAL_QUIZ_PASS_PCT && !passed) onPass()
  }

  // Only reachable once the exam is finished — locked (no dismiss) while in progress.
  function exit() {
    setQuestions(null)
    setFinished(false)
  }

  if (!questions) {
    const EXAM_STATS = [
      { label: 'Questions', value: String(FINAL_EXAM_QUESTIONS.length) },
      { label: 'To Pass', value: `${FINAL_QUIZ_PASS_PCT}%` },
      { label: 'Videos Covered', value: String(TRAINING_VIDEOS.length) },
    ]
    return (
      <div style={{ maxWidth: 560, margin: '0 auto', textAlign: 'center', padding: '48px 24px' }}>
        <ClipboardCheck size={26} color="var(--accent)" style={{ marginBottom: 14 }} />
        <h2 style={{ fontSize: 19, fontWeight: 500, color: 'var(--text-primary)', margin: '0 0 10px' }}>Final Exam</h2>
        <p style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.7, margin: '0 0 20px' }}>
          {FINAL_EXAM_QUESTIONS.length} questions covering all 8 training videos.
        </p>

        {passed && (
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 8, padding: '8px 16px', marginBottom: 20,
            background: 'var(--bg-surface)', border: '0.5px solid var(--border)', borderRadius: 8,
          }}>
            <Check size={13} color="var(--success)" />
            <span style={{ fontSize: 12, color: 'var(--success)' }}>Passed — you can retake it any time.</span>
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
          {EXAM_STATS.map(s => (
            <div key={s.label} style={{ flex: 1, background: 'var(--bg-elevated)', border: '0.5px solid var(--border)', borderRadius: 10, padding: '14px 10px' }}>
              <p style={{ fontSize: 20, fontFamily: 'var(--font-mono)', fontWeight: 500, color: 'var(--text-primary)', margin: '0 0 4px' }}>{s.value}</p>
              <p style={{ fontSize: 11, color: 'var(--text-secondary)', margin: 0 }}>{s.label}</p>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'center', marginBottom: 24 }}>
          {Object.entries(CATEGORY_LABELS).map(([key, label]) => (
            <span key={key} style={{
              display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 10px',
              background: 'var(--bg-surface)', border: `0.5px solid ${CATEGORY_COLORS[key]}`, borderRadius: 8,
              fontSize: 11, color: 'var(--text-secondary)',
            }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: CATEGORY_COLORS[key] }} />
              {label}
            </span>
          ))}
        </div>

        <button
          onClick={handleStartClick}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 8, height: 42, padding: '0 24px',
            background: 'var(--accent)', border: 'none', borderRadius: 10,
            fontSize: 14, fontWeight: 500, color: 'white', cursor: 'pointer',
          }}
        >
          <Play size={15} />
          Start Final Exam
        </button>

        {toastMsg && <ErrorToast message={toastMsg} onDone={() => setToastMsg(null)} />}
      </div>
    )
  }

  // Taking the exam or viewing the result — both locked-modal like the video
  // player (Prompt 174): full-screen overlay, no backdrop-click-to-close and
  // no X while in progress. Only the finished result screen can be dismissed.
  const q = questions[index]
  const selectedForCurrent = answers[index]
  const correct = answers.reduce(
    (acc, ans, qi) => acc + (ans != null && questions[qi].options[ans].correct ? 1 : 0), 0)
  const pct = finished ? Math.round((correct / questions.length) * 100) : null
  const didPass = finished && pct >= FINAL_QUIZ_PASS_PCT
  const isLast = index + 1 >= questions.length

  // Portaled to document.body — DashboardLayout's `.page-enter` wrapper has a
  // persisted CSS transform (fadeSlideUp, fill-mode: both), which makes it the
  // containing block for any `position: fixed` descendant. Left un-portaled,
  // this modal was fixed relative to that (scrollable, often-taller-than-the-
  // viewport) wrapper instead of the real viewport — scrolling the page pushed
  // it off-screen above the fold (Prompt 185 regression).
  return createPortal(
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 200,
        background: 'rgba(8,8,16,0.92)', backdropFilter: 'blur(8px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24,
      }}
      onClick={() => { if (finished) exit() }}
    >
      <div
        style={{
          width: '100%', maxWidth: 900, maxHeight: '88vh', overflowY: 'auto',
          background: 'var(--bg-surface)', border: '0.5px solid var(--border)',
          borderRadius: 14, padding: '36px 44px', position: 'relative',
        }}
        onClick={e => e.stopPropagation()}
      >
        {finished && (
          <button
            onClick={exit}
            style={{ position: 'absolute', top: 18, right: 18, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 4 }}
          >
            <X size={18} />
          </button>
        )}

        {finished ? (
          <div style={{ textAlign: 'center', padding: '24px 0' }}>
            <p style={{ fontSize: 40, fontFamily: 'var(--font-mono)', fontWeight: 500, color: didPass ? 'var(--success)' : 'var(--danger)', margin: '0 0 10px' }}>{pct}%</p>
            <p style={{ fontSize: 14, color: 'var(--text-muted)', marginBottom: 20 }}>{correct}/{questions.length} correct</p>
            <p style={{ fontSize: 17, fontWeight: 500, color: 'var(--text-primary)', marginBottom: 24 }}>
              {didPass ? 'Final exam passed — training complete.' : `${FINAL_QUIZ_PASS_PCT}% needed to pass`}
            </p>
            <button
              onClick={start}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 8, height: 42, padding: '0 22px',
                background: didPass ? 'var(--bg-elevated)' : 'var(--accent)',
                border: didPass ? '0.5px solid var(--border)' : 'none',
                borderRadius: 10, fontSize: 13, fontWeight: 500,
                color: didPass ? 'var(--text-secondary)' : 'white', cursor: 'pointer',
              }}
            >
              <RotateCcw size={14} />
              {didPass ? 'Take it again' : 'Retry exam'}
            </button>
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
              <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                Question <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>{index + 1}</span> of {questions.length}
              </span>
              <span style={{ fontSize: 11, color: 'var(--warning)' }}>Locked until you submit</span>
            </div>
            <div className="glass" style={{ borderRadius: 12, padding: '40px 44px', marginBottom: 24, minHeight: 160, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
              <p style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--accent)', margin: '0 0 12px' }}>{q.category}</p>
              <p style={{ fontSize: 21, fontWeight: 500, color: 'var(--text-primary)', lineHeight: 1.5, margin: 0 }}>{q.question}</p>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {q.options.map((opt, i) => {
                const selected = selectedForCurrent === i
                return (
                  <button
                    key={i}
                    onClick={() => pick(i)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 14, textAlign: 'left', padding: '18px 20px',
                      background: selected ? 'var(--accent-dim)' : 'var(--bg-elevated)',
                      border: selected ? '0.5px solid var(--accent)' : '0.5px solid var(--border)',
                      borderRadius: 10, cursor: 'pointer', fontSize: 14, lineHeight: 1.55,
                      color: selected ? 'var(--text-primary)' : 'var(--text-secondary)',
                    }}
                  >
                    <span style={{
                      flexShrink: 0, width: 26, height: 26, borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 12, fontWeight: 500, fontFamily: 'var(--font-mono)',
                      background: 'var(--accent)', color: 'var(--text-primary)',
                    }}>
                      {OPTION_LETTERS[i]}
                    </span>
                    <span style={{ flex: 1 }}>{opt.text}</span>
                  </button>
                )
              })}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 24 }}>
              <button
                onClick={back}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6, height: 40, padding: '0 16px',
                  background: 'transparent', border: '0.5px solid var(--border)', borderRadius: 10,
                  fontSize: 13, fontWeight: 500, color: 'var(--text-secondary)',
                  cursor: index === 0 ? 'default' : 'pointer',
                  visibility: index === 0 ? 'hidden' : 'visible',
                }}
              >
                <ChevronLeft size={15} />
                Back
              </button>
              <button
                onClick={next}
                disabled={selectedForCurrent == null}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6, height: 40, padding: '0 20px',
                  background: 'var(--accent)', border: 'none', borderRadius: 10,
                  fontSize: 13, fontWeight: 500, color: 'white',
                  cursor: selectedForCurrent == null ? 'default' : 'pointer',
                  opacity: selectedForCurrent == null ? 0.4 : 1,
                }}
              >
                {isLast ? 'Finish' : 'Next'}
                {!isLast && <ChevronRight size={15} />}
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body
  )
}

// ── AIRoleplay — live voice practice scored by "Phoenix" (claude-haiku) ───────
// Calls Retell ("Mike", a gruff HVAC owner), transcribes live, and on hang-up
// sends the transcript to score-roleplay. B+ or higher (9/12) passes the gate.

function RoleplayComingSoon() {
  return (
    <div style={{ maxWidth: 480, margin: '0 auto', textAlign: 'center', padding: '56px 24px' }}>
      <div style={{
        width: 64, height: 64, borderRadius: 16,
        background: 'var(--accent-dim)', border: '0.5px solid var(--accent-border)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        margin: '0 auto 20px',
      }}>
        <Lock size={26} color="var(--accent)" />
      </div>

      <h2 style={{ fontSize: 19, fontWeight: 500, color: 'var(--text-primary)', margin: '0 0 10px', letterSpacing: '-0.01em' }}>
        AI Voice Roleplay — Coming Soon
      </h2>
      <p style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.7, margin: '0 0 24px' }}>
        Practice live cold calls against an AI business owner who pushes back like the real
        thing — then get scored on your opener, discovery, objection handling, and close.
      </p>

      {/* What's coming */}
      <div style={{ textAlign: 'left', marginBottom: 24 }}>
        {[
          'Live voice conversation with a realistic owner persona',
          'Real objections — "not interested", "too busy", "send an email"',
          'Instant scorecard with tips after every call',
        ].map((item, i) => (
          <div key={i} style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '10px 14px', marginBottom: 6,
            background: 'var(--bg-surface)', border: '0.5px solid var(--border)',
            borderRadius: 8,
          }}>
            <Mic size={13} color="var(--accent)" style={{ flexShrink: 0 }} />
            <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{item}</span>
          </div>
        ))}
      </div>

      <div style={{
        display: 'inline-flex', alignItems: 'center', gap: 8,
        padding: '8px 16px', borderRadius: 8,
        background: 'rgba(245,158,11,0.08)', border: '0.5px solid rgba(245,158,11,0.2)',
      }}>
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--warning)', flexShrink: 0 }} />
        <span style={{ fontSize: 12, color: 'var(--warning)' }}>
          Unlocks when <code style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>RETELL_API_KEY</code> is configured
        </span>
      </div>

      <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 20 }}>
        In the meantime, master the <strong style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>Script</strong> tab — that's what you'll be scored on.
      </p>
    </div>
  )
}

function AIRoleplay({ progress, saveProgress, examPassed }) {
  const hasRetell = useCapability('has_retell')
  const [phase, setPhase]           = useState('idle') // idle | connecting | live | scoring | scored | error
  const [transcript, setTranscript] = useState([])
  const [score, setScore]           = useState(null)
  const [error, setError]           = useState('')
  const [toastMsg, setToastMsg]     = useState(null)
  const clientRef     = useRef(null)
  const transcriptRef = useRef([])
  const scrollRef     = useRef(null)
  // Same neutral demo-lead flow as the Script tab (Prompt 209) — reused here
  // (Prompt 277) so the reference panel never drifts from the real script.
  const scriptFlow = useMemo(
    () => buildScriptFlow({ business_name: 'the business', niche: 'service', city: 'your area' }, null),
    []
  )

  useEffect(() => () => { clientRef.current?.stopCall?.() }, [])

  // Keep the live transcript pinned to the latest line
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [transcript])

  // Live call timer (visual only) — ticks while the call is connected
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    if (phase !== 'live') { setElapsed(0); return }
    const t = setInterval(() => setElapsed(e => e + 1), 1000)
    return () => clearInterval(t)
  }, [phase])
  const mmss = `${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}`
  // "Mike is thinking" when the rep spoke last and no AI reply has landed yet
  const aiThinking = phase === 'live' && transcript.length > 0 && transcript[transcript.length - 1]?.role === 'user'

  // Gates the initial entry point — reusable for the idle-phase Start button
  // rather than folded into startCall itself, since retries after a passing
  // exam shouldn't need to re-check (Prompt 199).
  function handleStartClick() {
    if (!examPassed) {
      setToastMsg('Pass the Final Exam before starting AI Roleplay.')
      return
    }
    startCall()
  }

  async function startCall() {
    setPhase('connecting')
    setError('')
    setTranscript([])
    transcriptRef.current = []
    setScore(null)
    try {
      const { data, error: fnError } = await supabase.functions.invoke('create-roleplay-call')
      if (fnError || !data?.access_token) throw new Error(data?.error || fnError?.message || 'Could not start the practice call')

      const { RetellWebClient } = await import('retell-client-js-sdk')
      // Fresh client per call — reusing one across calls leaks listeners
      const client = new RetellWebClient()
      clientRef.current = client

      client.on('call_started', () => setPhase('live'))
      client.on('update', (update) => {
        if (update?.transcript?.length) {
          transcriptRef.current = update.transcript
          setTranscript(update.transcript)
        }
      })
      client.on('call_ended', () => scoreCall())
      client.on('error', (e) => {
        setError(typeof e === 'string' ? e : 'Call dropped — try again')
        setPhase('error')
        client.stopCall()
      })

      await client.startCall({ accessToken: data.access_token })
    } catch (err) {
      setError(err.message || 'Could not start the practice call')
      setPhase('error')
    }
  }

  function endCall() {
    clientRef.current?.stopCall()
  }

  async function scoreCall() {
    const finalTranscript = transcriptRef.current
    if (!finalTranscript.length) {
      setError('No conversation recorded — make sure your mic is allowed and try again.')
      setPhase('error')
      return
    }
    setPhase('scoring')
    try {
      const { data, error: fnError } = await supabase.functions.invoke('score-roleplay', {
        body: { transcript: finalTranscript },
      })
      if (fnError || !data?.scores) throw new Error(data?.error || fnError?.message || 'Scoring failed')

      const total = data.total ?? 0
      const grade = gradeFromScore(total)
      const passedNow = total >= ROLEPLAY_PASS_SCORE
      setScore({ ...data, grade, passedNow })
      setPhase('scored')

      const patch = { roleplay_score: total, roleplay_grade: grade }
      if (passedNow && !progress?.roleplay_passed_at) {
        patch.roleplay_passed_at = new Date().toISOString()
      }
      saveProgress(patch)
    } catch (err) {
      setError(err.message || 'Scoring failed — the call still counts, try again for a grade')
      setPhase('error')
    }
  }

  if (!hasRetell) return <RoleplayComingSoon />

  // ── Scorecard ──
  if (phase === 'scored' && score) {
    const dims = [
      { key: 'opener',            label: 'Opener',             max: 2 },
      { key: 'painDiscovery',     label: 'Pain Discovery',     max: 3 },
      { key: 'objectionHandling', label: 'Objection Handling', max: 2 },
      { key: 'bookingAsk',        label: 'Booking Ask',        max: 2 },
      { key: 'tone',              label: 'Tone',               max: 3 },
    ]
    return (
      <div style={{ maxWidth: 560, margin: '0 auto' }}>
        <div className="glass quiz-reveal" style={{ borderRadius: 14, padding: '28px 28px', textAlign: 'center', marginBottom: 16 }}>
          {(() => {
            const maxTotal = score.maxTotal ?? 12
            const gradeColor = score.passedNow ? 'var(--success)' : 'var(--warning)'
            const R = 50, C = 2 * Math.PI * R
            const frac = Math.min((score.total ?? 0) / maxTotal, 1)
            return (
              <div style={{ position: 'relative', width: 128, height: 128, margin: '0 auto 14px' }}>
                <svg width="128" height="128" viewBox="0 0 128 128" style={{ transform: 'rotate(-90deg)' }}>
                  <circle cx="64" cy="64" r={R} fill="none" stroke="var(--bg-elevated)" strokeWidth="8" />
                  <circle cx="64" cy="64" r={R} fill="none" stroke={gradeColor} strokeWidth="8" strokeLinecap="round"
                    strokeDasharray={C} strokeDashoffset={C - frac * C}
                    style={{ transition: 'stroke-dashoffset 1s cubic-bezier(0.4,0,0.2,1)' }} />
                </svg>
                <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                  <span style={{ fontSize: 34, fontFamily: 'var(--font-mono)', fontWeight: 600, color: gradeColor, lineHeight: 1, letterSpacing: '-0.02em' }}>{score.grade}</span>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', marginTop: 3 }}>{score.total}/{maxTotal}</span>
                </div>
                <div style={{
                  position: 'absolute', bottom: 0, right: 4, width: 30, height: 30, borderRadius: '50%',
                  background: gradeColor, border: '3px solid var(--bg-base, #0B0B12)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  boxShadow: `0 0 14px ${score.passedNow ? 'rgba(34,197,94,0.5)' : 'rgba(245,158,11,0.45)'}`,
                }}>
                  {score.passedNow ? <Check size={16} color="white" /> : <Award size={15} color="white" />}
                </div>
              </div>
            )
          })()}
          <p style={{ fontSize: 13, color: score.passedNow ? 'var(--success)' : 'var(--text-secondary)', margin: 0, lineHeight: 1.6 }}>
            {score.passedNow
              ? 'Roleplay check passed — this counts toward unlocking your leads.'
              : `${ROLEPLAY_PASS_GRADE} (${ROLEPLAY_PASS_SCORE}/12) or higher passes. Run it again — Mike's always up for round two.`}
          </p>
        </div>

        {/* Dimension bars */}
        <div className="glass" style={{ borderRadius: 12, padding: '18px 20px', marginBottom: 16 }}>
          {dims.map(d => {
            const v = score.scores?.[d.key] ?? 0
            const frac = v / d.max
            const barColor = frac >= 1 ? 'var(--success)' : frac >= 0.5 ? 'var(--accent)' : 'var(--warning)'
            return (
              <div key={d.key} style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
                <span style={{ flex: '0 0 150px', fontSize: 12, color: 'var(--text-secondary)' }}>{d.label}</span>
                <div style={{ flex: 1, height: 5, background: 'var(--bg-elevated)', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{
                    height: '100%', width: `${frac * 100}%`,
                    background: barColor, borderRadius: 3,
                    transition: 'width 0.7s cubic-bezier(0.4,0,0.2,1)',
                  }} />
                </div>
                <span style={{ flex: '0 0 34px', fontSize: 12, fontFamily: 'var(--font-mono)', color: barColor, textAlign: 'right' }}>
                  {v}/{d.max}
                </span>
              </div>
            )
          })}
        </div>

        {score.summary && (
          <div className="glass" style={{ borderRadius: 12, padding: '16px 20px', marginBottom: 16 }}>
            <p style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', margin: '0 0 6px' }}>Coach's Assessment</p>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.65, margin: 0 }}>{score.summary}</p>
            {score.tips?.length > 0 && (
              <ul style={{ margin: '10px 0 0', paddingLeft: 18 }}>
                {score.tips.map((tip, i) => (
                  <li key={i} style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6 }}>{tip}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div style={{ textAlign: 'center' }}>
          <button
            onClick={startCall}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              height: 42, padding: '0 24px',
              background: 'var(--accent)', border: 'none',
              borderRadius: 10, fontSize: 14, fontWeight: 500, color: 'white', cursor: 'pointer',
            }}
          >
            <Mic size={15} />
            Practice Again
          </button>
        </div>
      </div>
    )
  }

  // ── Live call / connecting / scoring ──
  if (phase === 'connecting' || phase === 'live' || phase === 'scoring') {
    return (
      <div style={{ maxWidth: 960, margin: '0 auto', display: 'flex', gap: 20, alignItems: 'flex-start', flexWrap: 'wrap' }}>
      <div style={{ flex: '1 1 560px', minWidth: 320, maxWidth: 560 }}>
        <div className="glass" style={{ borderRadius: 14, padding: '20px 22px', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 16 }}>
          {/* Persona avatar — pulsing ring while the call is live */}
          <div style={{ position: 'relative', width: 52, height: 52, flexShrink: 0 }}>
            {phase === 'live' && <span className="call-pulse" style={{ position: 'absolute', inset: 0, borderRadius: '50%', border: '2px solid var(--success)' }} />}
            <div style={{
              position: 'relative', width: 52, height: 52, borderRadius: '50%',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 18, fontWeight: 600, fontFamily: 'var(--font-mono)',
              color: phase === 'live' ? 'var(--success)' : 'var(--accent)',
              background: phase === 'live' ? 'rgba(34,197,94,0.12)' : 'var(--accent-dim)',
              border: `0.5px solid ${phase === 'live' ? 'rgba(34,197,94,0.35)' : 'var(--accent-border)'}`,
            }}>
              {phase === 'scoring'
                ? <Loader2 size={20} color="var(--accent)" style={{ animation: 'spin 1s linear infinite' }} />
                : 'M'}
            </div>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', margin: 0, letterSpacing: '-0.01em' }}>
              Mike — HVAC Owner
            </p>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '2px 0 0', display: 'flex', alignItems: 'center', gap: 6 }}>
              {phase === 'connecting' && <><Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} /> Dialing…</>}
              {phase === 'live' && <><span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--success)' }} /> Live · <span style={{ fontFamily: 'var(--font-mono)' }}>{mmss}</span> · Dallas, TX</>}
              {phase === 'scoring' && 'Phoenix is reviewing the transcript…'}
            </p>
          </div>
          {phase === 'live' && (
            <button
              onClick={endCall}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                height: 38, padding: '0 16px',
                background: 'var(--danger)', border: 'none',
                borderRadius: 999, fontSize: 12, fontWeight: 500, color: 'white', cursor: 'pointer',
              }}
            >
              <PhoneOff size={13} />
              End Call
            </button>
          )}
        </div>

        <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>

        {/* Live transcript */}
        <div
          ref={scrollRef}
          className="glass scrollbar-thin"
          style={{ borderRadius: 12, padding: '16px 18px', height: 320, overflowY: 'auto' }}
        >
          {transcript.length === 0 ? (
            <p style={{ fontSize: 13, color: 'var(--text-muted)', textAlign: 'center', marginTop: 130 }}>
              {phase === 'live' ? 'Say hello — Mike answered.' : 'Transcript appears here once the call connects.'}
            </p>
          ) : (
            <>
            {transcript.map((t, i) => {
              const isYou = t.role === 'user'
              return (
                <div key={i} style={{ marginBottom: 12, display: 'flex', flexDirection: isYou ? 'row-reverse' : 'row', alignItems: 'flex-end', gap: 8 }}>
                  {/* Speaker avatar */}
                  <div style={{
                    flexShrink: 0, width: 26, height: 26, borderRadius: '50%',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 11, fontWeight: 600, fontFamily: 'var(--font-mono)',
                    color: isYou ? 'var(--accent)' : 'var(--text-secondary)',
                    background: isYou ? 'var(--accent-dim)' : 'var(--bg-elevated)',
                    border: `0.5px solid ${isYou ? 'var(--accent-border)' : 'var(--border)'}`,
                  }}>
                    {isYou ? 'Y' : 'M'}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: isYou ? 'flex-end' : 'flex-start', maxWidth: '80%' }}>
                    <span style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', margin: '0 4px 2px' }}>
                      {isYou ? 'You' : 'Mike'}
                    </span>
                    <p style={{
                      fontSize: 13, lineHeight: 1.55, margin: 0,
                      padding: '8px 12px',
                      borderRadius: isYou ? '12px 12px 3px 12px' : '12px 12px 12px 3px',
                      background: isYou ? 'var(--accent-dim)' : 'var(--bg-elevated)',
                      border: `0.5px solid ${isYou ? 'var(--accent-border)' : 'var(--border)'}`,
                      color: 'var(--text-secondary)',
                    }}>
                      {t.content}
                    </p>
                  </div>
                </div>
              )
            })}
            {/* Mike "thinking" indicator while awaiting his reply */}
            {aiThinking && (
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, marginBottom: 12 }}>
                <div style={{
                  flexShrink: 0, width: 26, height: 26, borderRadius: '50%',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 11, fontWeight: 600, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)',
                  background: 'var(--bg-elevated)', border: '0.5px solid var(--border)',
                }}>M</div>
                <div style={{ display: 'flex', gap: 4, padding: '11px 14px', borderRadius: '12px 12px 12px 3px', background: 'var(--bg-elevated)', border: '0.5px solid var(--border)' }}>
                  <span className="typing-dot" style={{ animationDelay: '0ms' }} />
                  <span className="typing-dot" style={{ animationDelay: '160ms' }} />
                  <span className="typing-dot" style={{ animationDelay: '320ms' }} />
                </div>
              </div>
            )}
            </>
          )}
        </div>
      </div>

      {/* Script reference — same ScriptWalk shell as the Script tab and the
          live Call modal (Prompt 277), a synthetic generic lead since there's
          no real business here. Always visible alongside the call rather than
          a toggle, so the rep can glance at it without breaking flow. */}
      <div style={{ flex: '1 1 320px', minWidth: 300, maxWidth: 380, height: 426, border: '0.5px solid var(--border)', borderRadius: 14, overflow: 'hidden', background: 'var(--bg-inset)' }}>
        <ScriptWalk flow={scriptFlow} mode="practice" />
      </div>
      </div>
    )
  }

  // ── Idle / error ── persona avatar + scenario chips + grade badge
  const rpGrade = progress?.roleplay_grade
  const rpPassed = !!progress?.roleplay_passed_at
  return (
    <div style={{ maxWidth: 480, margin: '0 auto', textAlign: 'center', padding: '48px 24px' }}>
      {/* scenario persona — Mike, the HVAC owner you're cold-calling */}
      <div style={{ position: 'relative', width: 76, height: 76, margin: '0 auto 18px' }}>
        <div style={{
          width: 76, height: 76, borderRadius: '50%',
          background: 'linear-gradient(135deg, var(--accent), #8B5CF6)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 28, fontWeight: 600, color: 'white', fontFamily: 'var(--font-mono)',
          boxShadow: '0 0 24px rgba(108,99,255,0.3)',
        }}>
          M
        </div>
        <div style={{
          position: 'absolute', bottom: -2, right: -2,
          width: 28, height: 28, borderRadius: '50%',
          background: 'var(--bg-surface)', border: '1.5px solid var(--bg-1)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Mic size={13} color="var(--accent)" />
        </div>
      </div>
      <h2 style={{ fontSize: 19, fontWeight: 500, color: 'var(--text-primary)', margin: '0 0 4px', letterSpacing: '-0.01em' }}>
        AI Voice Roleplay
      </h2>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap', margin: '0 0 12px' }}>
        {['Cold call', 'Mike · HVAC owner, Dallas', `Pass ≥ ${ROLEPLAY_PASS_GRADE}`].map(t => (
          <span key={t} style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)', background: 'var(--bg-elevated)', border: '0.5px solid var(--border)', borderRadius: 20, padding: '3px 10px' }}>
            {t}
          </span>
        ))}
      </div>
      <p style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.7, margin: '0 0 12px' }}>
        Open clean, dig into his missed-call pain, survive one objection, and book the
        15-minute call. Phoenix, our AI coach, grades the whole conversation.
      </p>
      {rpGrade && (
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 8, marginBottom: 4,
          background: rpPassed ? 'rgba(34,197,94,0.12)' : 'rgba(245,158,11,0.12)',
          border: `0.5px solid ${rpPassed ? 'rgba(34,197,94,0.3)' : 'rgba(245,158,11,0.3)'}`,
          borderRadius: 20, padding: '4px 12px',
        }}>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Last grade</span>
          <span style={{ fontSize: 15, fontWeight: 700, fontFamily: 'var(--font-mono)', color: rpPassed ? 'var(--success)' : 'var(--warning)' }}>{rpGrade}</span>
          {rpPassed && <span style={{ fontSize: 11, color: 'var(--success)', fontWeight: 600 }}>Passed ✓</span>}
        </div>
      )}
      {error && (
        <p style={{ fontSize: 12, color: 'var(--danger)', margin: '8px 0 0', lineHeight: 1.5 }}>{error}</p>
      )}
      <div>
        <button
          onClick={handleStartClick}
          className="hover:!brightness-110"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            height: 42, padding: '0 24px', marginTop: 14,
            background: 'var(--accent)', border: 'none',
            borderRadius: 10, fontSize: 14, fontWeight: 500, color: 'white',
            cursor: 'pointer', boxShadow: '0 0 20px rgba(108,99,255,0.25)',
            transition: 'filter 120ms ease',
          }}
        >
          <Mic size={15} />
          Start Practice Call
        </button>
      </div>
      <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 14 }}>
        Uses your microphone — allow access when the browser asks.
      </p>
      {toastMsg && <ErrorToast message={toastMsg} onDone={() => setToastMsg(null)} />}
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}

// ── Main Training Center page ─────────────────────────────────────────────────

const TABS = [
  { id: 'script',      label: 'Script',      icon: FileText,       count: null },
  { id: 'videos',      label: 'Videos',      icon: Play,           count: `${TRAINING_VIDEOS.length} videos` },
  { id: 'flashcards',  label: 'Flashcards',  icon: BookOpen,       count: `${FLASHCARDS.length} cards` },
  { id: 'final-exam',  label: 'Final Exam',  icon: Award,          count: null },
  { id: 'roleplay',    label: 'AI Roleplay', icon: Mic,            count: null },
]

export default function TrainingCenter() {
  const [tab, setTab] = useState('script')
  const { profile } = useAuth()
  const { data: progress } = useTrainingProgress()
  const saveMutation = useSaveTrainingProgress()
  const saveProgress = (patch) => saveMutation.mutate(patch)

  // Combined gate: profiles.training_completed set only when both flashcards
  // mastered AND final exam passed. Mastery is DB-backed (training_progress.
  // flashcards_mastered, per rep_id) — flashcardsMasteredLocal is purely an
  // optimistic flag for the instant after mastering the last card, before
  // the query refetches; it starts false every mount (Prompt 283 — the old
  // version read an unscoped localStorage key here, which is exactly what
  // caused a brand-new account to inherit another account's mastery).
  const [flashcardsMasteredLocal, setFlashcardsMasteredLocal] = useState(false)
  const flashcardsMastered = flashcardsMasteredLocal ||
    (Array.isArray(progress?.flashcards_mastered) && progress.flashcards_mastered.length >= FLASHCARDS.length)
  // Final exam pass is persisted to training_progress.final_exam_passed_at
  // (Prompt 276 fix) so it survives across browsers/devices. finalQuizPassedLocal
  // is the same same-session-optimistic pattern as flashcardsMasteredLocal above
  // — it used to read an unscoped localStorage flag on mount (Prompt 283: same
  // class of bug as the flashcards one), which falsely showed "passed" for a
  // brand-new account on a browser that had passed it before.
  const [finalQuizPassedLocal, setFinalQuizPassedLocal] = useState(false)
  const finalQuizPassed = finalQuizPassedLocal || !!progress?.final_exam_passed_at

  async function maybeCompleteTraining(nextFC, nextFQ) {
    if (!profile?.id || profile?.training_completed) return
    if (nextFC && nextFQ) {
      await supabase.from('profiles').update({ training_completed: true }).eq('id', profile.id)
    }
  }

  function handleAllFlashcardsMastered() {
    setFlashcardsMasteredLocal(true)
    maybeCompleteTraining(true, finalQuizPassed)
  }

  function handleFinalQuizPassed() {
    setFinalQuizPassedLocal(true)
    if (!progress?.final_exam_passed_at) saveProgress({ final_exam_passed_at: new Date().toISOString() })
    maybeCompleteTraining(flashcardsMastered, true)
  }

  const checks   = trainingChecks(progress)
  const complete = isTrainingComplete(progress)
  const watchedCount = checks.videosWatched
  const gateSteps = [
    { label: `Videos ${watchedCount}/${TOTAL_VIDEOS}`, done: checks.videosDone,   goTab: 'videos' },
    { label: `Final Exam ${FINAL_QUIZ_PASS_PCT}%+`,    done: finalQuizPassed,     goTab: 'final-exam' },
    { label: `Roleplay ${ROLEPLAY_PASS_GRADE}+`,        done: checks.roleplayDone, goTab: 'roleplay' },
  ]

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 18, fontWeight: 500, color: 'var(--text-primary)', margin: 0, letterSpacing: '-0.01em' }}>
          Training Center
        </h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>
          Videos, flashcards, the discovery script, quiz, and AI voice roleplay
        </p>
      </div>

      {/* Unlock progress — shown until all gate checks pass */}
      {!complete && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
          background: 'var(--accent-dim)', border: '0.5px solid var(--accent-border)',
          borderRadius: 10, padding: '10px 16px', marginBottom: 20,
        }}>
          <Lock size={14} color="var(--accent)" style={{ flexShrink: 0 }} />
          <span style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 500 }}>
            Complete all to unlock your leads:
          </span>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {gateSteps.map((s, i) => (
              <button
                key={i}
                onClick={() => setTab(s.goTab)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 5,
                  padding: '4px 10px', borderRadius: 6,
                  background: s.done ? 'rgba(34,197,94,0.1)' : 'var(--bg-surface)',
                  border: `0.5px solid ${s.done ? 'rgba(34,197,94,0.3)' : 'var(--border)'}`,
                  fontSize: 11, fontWeight: 500, cursor: 'pointer',
                  color: s.done ? 'var(--success)' : 'var(--text-secondary)',
                }}
              >
                {s.done ? <Check size={11} /> : <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--text-dim)' }} />}
                {s.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Tab bar */}
      <div style={{
        display: 'flex', gap: 4, marginBottom: 24,
        background: 'var(--bg-surface)', border: '0.5px solid var(--border)',
        borderRadius: 10, padding: 4,
        width: 'fit-content', flexWrap: 'wrap',
      }}>
        {TABS.map(t => {
          const active = tab === t.id
          const Icon   = t.icon
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 7,
                padding: '7px 14px', borderRadius: 7, border: 'none',
                background: active ? 'var(--bg-elevated)' : 'transparent',
                color: active ? 'var(--text-primary)' : 'var(--text-muted)',
                fontSize: 13, fontWeight: active ? 500 : 400,
                cursor: 'pointer', transition: 'all 0.12s',
                boxShadow: active ? '0 1px 4px rgba(0,0,0,0.2)' : 'none',
              }}
            >
              <Icon size={13} style={{ color: active ? 'var(--accent)' : 'inherit' }} />
              {t.label}
              {t.count && (
                <span style={{
                  fontSize: 10, padding: '1px 5px', borderRadius: 3,
                  background: active ? 'var(--accent-dim)' : 'var(--bg-elevated)',
                  color: active ? 'var(--accent)' : 'var(--text-muted)',
                  fontFamily: 'var(--font-mono)',
                }}>
                  {t.count}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* Tab content */}
      {tab === 'videos'     && <VideoLibrary progress={progress} saveProgress={saveProgress} />}
      {tab === 'flashcards' && <FlashcardDeck progress={progress} saveProgress={saveProgress} onAllMastered={handleAllFlashcardsMastered} />}
      {tab === 'final-exam' && <FinalQuizTab watchedCount={watchedCount} passed={finalQuizPassed} onPass={handleFinalQuizPassed} flashcardsMastered={flashcardsMastered} />}
      {tab === 'script'     && <DiscoveryScript />}
      {tab === 'roleplay'   && <AIRoleplay progress={progress} saveProgress={saveProgress} examPassed={finalQuizPassed} />}
    </div>
  )
}
