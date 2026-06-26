// ── Closer Script — Call 2 (the locked stack pitch) ─────────────────────────
// Nate's script for the 15-minute closer call.
// Only literal say-this lines are included — stage directions and instructional
// meta-text have been removed per Brayden's rule: the popup and canvas should
// show what to say, never what to do.

import { buildScriptFlow } from './discoveryScript'

export const CLOSER_SCRIPT = [
  {
    id: 'opener', kind: 'opener', short: 'Opener',
    title: 'Reconnect & Confirm Pain', trigger: 'Start here — every Call 2',
    color: 'var(--accent)', dim: 'rgba(108,99,255,0.08)', border: 'rgba(108,99,255,0.25)',
    lines: [
      `"Hey, is this [Business Name]? Hey — this is Nate over at Ohvara. [Rep Name] passed your info along, told me you two had a great conversation. How's it going?"`,
      `"So [Rep Name] filled me in on your situation — sounds like missed calls and follow-up slipping through are the main headaches right now. Is that still the biggest thing, or has anything changed since you two talked?"`,
      `"Perfect — same spot they left it. That's exactly what I put together for you today."`,
      `"Tell me a bit more — what's shifted since you spoke?"`,
      `"Got it — that actually changes the picture a little. Let me still walk you through what we put together, because most of it still applies."`,
    ],
  },

  {
    id: 'stack', kind: 'branch', short: 'Stack',
    title: "The Locked Stack — What You're Getting", trigger: 'After pain is confirmed',
    color: 'var(--success)', dim: 'rgba(34,197,94,0.08)', border: 'rgba(34,197,94,0.25)',
    lines: [
      `"So here's exactly what we build for [niche] businesses like yours — same setup every time, because the problems are always the same."`,
      `"The front-runner is an AI Receptionist. It answers every single call — days, nights, weekends. Qualifies the caller, books the appointment straight onto your calendar. No more voicemail black holes, no more missed jobs because you were on a job."`,
      `"For operations running multiple crews like yours, we actually lead with an AI Dispatcher instead — same concept, but it routes jobs to the right tech or driver automatically based on location and schedule."`,
      `"And does your site have a live chat or AI chatbot on it?"`,
      `"Perfect — you're already covered there. We leave the site and chatbot alone and just integrate the AI Receptionist on the backend."`,
      `"We also add an AI chatbot to your existing site — same technology as the phone agent. Captures leads who browse but never call."`,
      `"We also build a clean landing page for you and add the chatbot — captures everyone who Googles you but doesn't call. You get both channels covered."`,
      `"On top of the AI Receptionist, we plug in five automations that run completely in the background:"`,
      `"Review Generation — after every completed job, it follows up automatically and asks for a Google review. Most businesses we work with see 3–5× more reviews in the first 30 days."`,
      `"Lead Follow-Up — if someone called or inquired but didn't book, it texts and emails them over the next week until they do. Recovers jobs that would've just gone quiet."`,
      `"Appointment Reminders — texts the customer 24 hours out and again an hour before the job. Cuts no-shows in half."`,
      `"Appointment Cancellation — if someone cancels, it immediately tries to rebook them. If that doesn't work, it texts your next few upcoming customers: 'A slot just opened up — first to reply YES gets it.' Slot fills automatically."`,
      `"And SMS Marketing — a quarterly text blast to your past customers. Keeps you top of mind without you doing anything. One blast per quarter usually books 5–10 jobs on its own."`,
      `"That's the full stack. All of it running 24/7. You don't hire anyone, you don't manage anything — it just runs."`,
    ],
  },

  {
    id: 'close', kind: 'close', short: 'Close',
    title: 'Price, Stripe Links & Close', trigger: 'After walking the full stack',
    color: 'var(--accent)', dim: 'rgba(108,99,255,0.10)', border: 'rgba(108,99,255,0.30)',
    lines: [
      `"So that's the full stack — AI Receptionist, all five plug-ins, and the website piece if you needed it. Everything running 24/7, hands-off."`,
      `"Now for the investment. There's a one-time setup fee of $297 — covers building everything out and getting it live. Then a monthly rate that's formula-based on your numbers."`,
      `"[Rep Name] logged what you told them — [calls missed] missed calls a week, [ticket] average job value. Running the math on that, your monthly comes out to [monthly price]."`,
      `"I know $[monthly price] sounds like a number — but let's anchor it. A part-time receptionist alone runs you $2,800 to $4,000 a month. This is the AI that never calls in sick, never misses a call, and runs five other automations on top of it. Even if it recovers two missed jobs a month at [ticket] each, it's already paid for itself twice over."`,
      `"Does that number make sense given what you told [Rep Name] about what you're losing right now?"`,
      `"Perfect. I'm going to send you two links right now — one for the $297 setup, one for the [monthly price] monthly. Takes about 60 seconds on your end."`,
      `"Once those are done, we start building within the week. You'll hear from us on next steps."`,
      `"What's the main thing holding you back — the investment, the timing, or something else you want to think through?"`,
      `"No problem at all — when's a good time tomorrow to reconnect?"`,
    ],
  },
]

export function buildCloserScriptFlow(lead, rep) {
  return buildScriptFlow(lead, rep, CLOSER_SCRIPT)
}
