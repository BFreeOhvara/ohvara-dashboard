// ── Closer Script — Call 2 (consultative rewrite) ────────────────────────────
// Nate's script for the 15-minute closer call.
// Lines marked [ASK] are questions — they get a distinct visual indicator in
// the SAY THIS stepper. Everything else is a talking point; Nate delivers it in
// his own words. Quoted phrases are anchor phrases that should land close to
// as-written. Bracketed placeholders are filled live.

import { buildScriptFlow } from './discoveryScript'

export const CLOSER_SCRIPT = [
  {
    id: 'opener', kind: 'opener', short: 'Opener',
    title: 'Reconnect & Confirm Pain', trigger: 'Start here — every Call 2',
    color: 'var(--accent)', dim: 'rgba(108,99,255,0.08)', border: 'rgba(108,99,255,0.25)',
    lines: [
      `Reconnect warmly — drop [Rep Name]'s name, reference that they had a good conversation.`,
      `[ASK] "Sounds like missed calls and stuff falling through the cracks was the big one — is that still the main thing, or has anything changed since you talked to [Rep Name]?"`,
      `Let them answer fully. Don't jump in. This is the only information you need before the rest of the call.`,
      `Reflect back specifically what they just said — in their words, not yours — before moving on. "So really it's [their specific situation] that's costing you the most right now."`,
      `If something's changed since the rep call: [ASK] "What's shifted?" — then bridge: most of what we built still applies, here's why.`,
    ],
  },

  {
    id: 'stack', kind: 'branch', short: 'Stack',
    title: 'Problem → Fix (Not Feature Tour)', trigger: 'After pain is confirmed and reflected back',
    color: 'var(--success)', dim: 'rgba(34,197,94,0.08)', border: 'rgba(34,197,94,0.25)',
    lines: [
      `Bridge line: "Based on exactly what you just told me, here's what we'd build for you" — not "here's our stack."`,
      `Name the core problem in their words again, then introduce AI Receptionist as the direct fix. "You said calls go to voicemail when your guys are on a job — that's the exact gap this closes: answers every call, qualifies them, books it on your calendar, day or night."`,
      `[ASK] "Does that match what you're dealing with, or is there more to it?"`,
      `If multi-crew or dispatch-heavy: pivot to AI Dispatcher as the lead — same fix, but routes to the right tech/driver automatically based on location and schedule.`,
      `[ASK] "Does your site have a chatbot or live chat on it right now?" — branch: already covered (leave it, integrate on backend) / needs chatbot added / needs site + chatbot.`,
      `"Jobs finish and nobody asks for a review" → "Most clients see 3–5x more reviews in 30 days once this runs automatically."`,
      `[ASK] "How many people would you say call or message and just never book?" → "That's what Lead Follow-Up catches — it keeps after them till they do or tell us no."`,
      `"No-shows costing you a wasted slot?" → "Reminders at 24hr and 1hr cut that in half."`,
      `"Someone cancels and that slot sits empty" → "It auto-offers the spot to your next few upcoming customers — first to say yes gets it."`,
      `"Quarterly text blast to past customers, zero effort from you — usually books 5–10 jobs a quarter on its own."`,
      `Close the section: "None of this is extra software for you to manage — it's the stuff that's currently costing you money, running in the background instead."`,
      `[ASK] "Anything in there that doesn't fit how you operate, or does it all track?"`,
    ],
  },

  {
    id: 'close', kind: 'close', short: 'Close',
    title: 'Cost of Inaction → Price → Stripe', trigger: 'After stack is confirmed as a fit',
    color: 'var(--accent)', dim: 'rgba(108,99,255,0.10)', border: 'rgba(108,99,255,0.30)',
    lines: [
      `[ASK] "Just so I'm clear — what's it actually costing you right now, the calls and jobs that slip through? Even a rough number." — let them say it themselves before you anchor anything.`,
      `Bridge: "That's exactly the number this is built to fix." Then price: one-time $297 setup, monthly formula-based on what they told the rep.`,
      `State their specific monthly number — "[monthly price]" — tied directly to what they told [Rep Name] ([calls missed] missed calls/week at [ticket] average ticket).`,
      `Anchor against a hire: "A part-time receptionist alone runs $2,800–$4,000/month. This never calls in sick, never misses a call, and runs five other automations on top." Tie back to the number they gave you — show it pays for itself.`,
      `[ASK] "Does that number make sense against what you told me it's costing you right now?"`,
      `Close: "I'll send two links right now — setup and monthly, 60 seconds to handle both. We start building within the week."`,
      `[ASK] If hesitation: "What's the main thing holding you back — the investment, the timing, or something else?" — handle the real objection, don't re-pitch.`,
      `If not closing today: lock a specific reconnect time before hanging up. "When's a good time tomorrow?"`,
    ],
  },
]

export function buildCloserScriptFlow(lead, rep) {
  return buildScriptFlow(lead, rep, CLOSER_SCRIPT)
}
