// ── Closer Script — Call 2 (the locked stack pitch) ─────────────────────────
// Nate's script for the 15-minute closer call. The rep gathered pain on Call 1
// (calls missed/week + average ticket). Nate's job: validate the pain, walk the
// locked standard stack, present pricing, and get the yes + send Stripe links.
//
// LOCKED STACK (2026-06-25, Brayden):
//   Front-runner: AI Receptionist (AI Dispatcher alternate for dispatch-heavy niches)
//   Sub-agents:   Review Generation, Lead Follow-Up, Appointment Reminders,
//                 Appointment Cancellation, SMS Marketing
//   Website/chatbot:
//     - No site + no chatbot → both added
//     - Site but no chatbot  → chatbot added only
//     - Site + chatbot       → both excluded (only exclusion case)
//
// Pricing formula: callsMissedPerWeek × 4.33 × avgTicket × 0.15
//   Floor $397/mo — Ceiling $1,997/mo — rounded to nearest $10
//   Setup fee: $297 flat, one-time (always presented separately)
//
// Same marker system as discoveryScript.js:
//   "..."     spoken line   → say step
//   ▸ ...     action        → action chip
//   BRANCH —  decision fork
//   ↳ IF/↳   fork option
//   → ...     route to another section

import { buildScriptFlow } from './discoveryScript'

export const CLOSER_SCRIPT = [
  {
    id: 'opener', kind: 'opener', short: 'Opener',
    title: 'Reconnect & Confirm Pain', trigger: 'Start here — every Call 2',
    goal: 'Warm the prospect up, confirm the pain the rep logged, and set up the solution delivery.',
    color: 'var(--accent)', dim: 'rgba(108,99,255,0.08)', border: 'rgba(108,99,255,0.25)',
    lines: [
      `"Hey, is this [Business Name]? Hey — this is Nate over at Ohvara. [Rep Name] passed your info along, told me you two had a great conversation. How's it going?"`,
      `▸ Keep it warm and brief. You're the specialist they're being handed to. Don't over-introduce.`,
      `"So [Rep Name] filled me in on your situation — sounds like missed calls and follow-up slipping through are the main headaches right now. Is that still the biggest thing, or has anything changed since you two talked?"`,
      `BRANCH — Did the pain stick, or did something change?`,
      `↳ IF PAIN CONFIRMED: "Perfect — same spot they left it. That's exactly what I put together for you today."`,
      `   → Go to Stack.`,
      `↳ IF SOMETHING CHANGED: "Tell me a bit more — what's shifted since you spoke?"`,
      `   ▸ Listen, update your read on the situation, then pivot forward.`,
      `   "Got it — that actually changes the picture a little. Let me still walk you through what we put together, because most of it still applies."`,
      `   → Go to Stack.`,
    ],
    tips: `Your job in the opener is validation, not re-discovery. The rep already did the discovery. Reference the pain they logged and confirm it's still real. Don't run a new discovery call — you already have the numbers. If something changed, note it and keep moving.`,
  },

  {
    id: 'stack', kind: 'branch', short: 'Stack',
    title: 'The Locked Stack — What You\'re Getting', trigger: 'After pain is confirmed',
    goal: 'Walk every agent in the locked stack, in order. No improvising — same flow every call.',
    color: 'var(--success)', dim: 'rgba(34,197,94,0.08)', border: 'rgba(34,197,94,0.25)',
    lines: [
      `"So here's exactly what we build for [niche] businesses like yours — same setup every time, because the problems are always the same."`,
      `"The front-runner is an AI Receptionist. It answers every single call — days, nights, weekends. Qualifies the caller, books the appointment straight onto your calendar. No more voicemail black holes, no more missed jobs because you were on a job."`,
      `BRANCH — Are they dispatch-heavy? (Multiple crews, routing, delivery)`,
      `↳ IF DISPATCH-HEAVY: "For operations running multiple crews like yours, we actually lead with an AI Dispatcher instead — same concept, but it routes jobs to the right tech or driver automatically based on location and schedule."`,
      `↳ IF NOT DISPATCH-HEAVY: "That's the core — the AI Receptionist handles everything inbound. You never miss a call again."`,
      `BRANCH — Do they have a website?`,
      `↳ IF YES: "And does your site have a live chat or AI chatbot on it?"`,
      `   BRANCH — Does the site have a chatbot?`,
      `   ↳ IF YES: "Perfect — you're already covered there. We leave the site and chatbot alone and just integrate the AI Receptionist on the backend."`,
      `   ↳ IF NO: "We also add an AI chatbot to your existing site — same technology as the phone agent. Captures leads who browse but never call."`,
      `↳ IF NO: "We also build a clean landing page for you and add the chatbot — captures everyone who Googles you but doesn't call. You get both channels covered."`,
      `"On top of the AI Receptionist, we plug in five automations that run completely in the background:"`,
      `"Review Generation — after every completed job, it follows up automatically and asks for a Google review. Most businesses we work with see 3–5× more reviews in the first 30 days."`,
      `"Lead Follow-Up — if someone called or inquired but didn't book, it texts and emails them over the next week until they do. Recovers jobs that would've just gone quiet."`,
      `"Appointment Reminders — texts the customer 24 hours out and again an hour before the job. Cuts no-shows in half."`,
      `"Appointment Cancellation — if someone cancels, it immediately tries to rebook them. If that doesn't work, it texts your next few upcoming customers: 'A slot just opened up — first to reply YES gets it.' Slot fills automatically."`,
      `"And SMS Marketing — a quarterly text blast to your past customers. Keeps you top of mind without you doing anything. One blast per quarter usually books 5–10 jobs on its own."`,
      `"That's the full stack. All of it running 24/7. You don't hire anyone, you don't manage anything — it just runs."`,
      `→ Go to CLOSE.`,
    ],
    tips: `Walk every agent — don't skip any because you think it won't land. Each one solves a different leak. Let each benefit statement breathe before moving to the next. The goal is "I didn't know that was a thing" × 5. Don't get technical — tell them what it does for them, not how it works.`,
  },

  {
    id: 'close', kind: 'close', short: 'Close',
    title: 'Price, Stripe Links & Close', trigger: 'After walking the full stack',
    goal: 'Present pricing confidently, handle the objection fork, generate both Stripe links, get the yes.',
    color: 'var(--accent)', dim: 'rgba(108,99,255,0.10)', border: 'rgba(108,99,255,0.30)',
    lines: [
      `"So that's the full stack — AI Receptionist, all five plug-ins, and the website piece if you needed it. Everything running 24/7, hands-off."`,
      `"Now for the investment. There's a one-time setup fee of $297 — covers building everything out and getting it live. Then a monthly rate that's formula-based on your numbers."`,
      `"[Rep Name] logged what you told them — [calls missed] missed calls a week, [ticket] average job value. Running the math on that, your monthly comes out to [monthly price]."`,
      `BRANCH — Are they reacting to price?`,
      `↳ IF ASKING / PUSHING BACK: "I know $[monthly price] sounds like a number — but let's anchor it. A part-time receptionist alone runs you $2,800 to $4,000 a month. This is the AI that never calls in sick, never misses a call, and runs five other automations on top of it. Even if it recovers two missed jobs a month at [ticket] each, it's already paid for itself twice over."`,
      `↳ IF QUIET / PROCESSING: "Does that number make sense given what you told [Rep Name] about what you're losing right now?"`,
      `▸ Listen. Give them a beat to respond. Don't fill the silence.`,
      `BRANCH — Are they in, or do they need more?`,
      `↳ IF READY TO GO: "Perfect. I'm going to send you two links right now — one for the $297 setup, one for the [monthly price] monthly. Takes about 60 seconds on your end."`,
      `   ▸ Generate Stripe link 1: $297 setup fee (one-time).`,
      `   ▸ Generate Stripe link 2: [monthly price]/mo subscription.`,
      `   ▸ Text or email both links to [Business Name] immediately.`,
      `   "Once those are done, we start building within the week. You'll hear from us on next steps."`,
      `↳ IF HESITATING: "What's the main thing holding you back — the investment, the timing, or something else you want to think through?"`,
      `   ▸ Listen to the specific objection. Common ones:`,
      `   ▸ "Need to think about it" → "What part specifically? I'd rather answer it now."`,
      `   ▸ "Too expensive" → Anchor to hire cost. "What are you paying now to handle calls?"`,
      `   ▸ "Not sure it works" → "Fair — what would you need to see to feel confident?"`,
      `   ▸ If they want time: lock a follow-up. "No problem at all — when's a good time tomorrow to reconnect?"`,
    ],
    tips: `Present the price as a conclusion, not a question. "$297 setup + [monthly]" is the answer to a problem they already confirmed costs more than that. ROI anchor is always a human hire ($2,800–$6,000+/mo) — never price compare to competitors. Generate both Stripe links the moment they say yes — don't defer it. Setup fee ($297) is always framed as one-time and separate from the monthly.`,
  },
]

export function buildCloserScriptFlow(lead, rep) {
  return buildScriptFlow(lead, rep, CLOSER_SCRIPT)
}
