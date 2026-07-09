// ── Setter script v3 — Camden Cash, near-verbatim branching discovery flow ────
// Built from a single full cold-call transcript (see brain/setter-transcripts-
// camden-cash.md), adapted per brain/setter-script-v3-camden-style.md: no
// "ring a bell" name-drop (no public rep brand to lean on), no client-count/
// CEO framing (setter isn't the closer — "our team"), Indeed listing instead
// of a generic hook, and the setter always books the 15-minute call rather
// than closing on the spot. Every spoken line is exactly what the setter reads.
// Dynamic tokens: [Business Name], [job title] (from the lead's
// posting_title, falling back to "front desk role" if unset — e.g.
// Maps-sourced leads with no scraped Indeed posting), [city], [state] (Prompt
// 224 — confirm-time states the lead's real location back before locking an
// appointment time) filled from the lead. [Tuesday morning], [Wednesday
// afternoon], [Tuesday next week], [Wednesday next week] (Prompt 256) are
// computed from the rep's real local calendar day (profiles.timezone) —
// the rendered text is exactly what the rep should say aloud, no day-of-week
// math required live on the call.
// In-call tokens: [Name], [day], [time], [time+1hr], [owner] stay literal as
// rep guidance during the call — they're captured FROM the prospect's own
// words live on the call, not something computable ahead of time. [their
// number], [monthly], [annual], [$ticket] are computed live from the
// setter's own captured vitals — see renderText() in ScriptWalk.jsx.
//
// LINE MARKERS (renderers style these):
//   plain string     a spoken line                      → bullet
//   BRANCH — ...     a decision point (fork)             → fork header
//   ↳ IF ... [TAG]: ...  a fork option (indented = child) → indented option
//                    optional [GOOD] / [HESITANT] / [BAD] tag colors the
//                    option by response CATEGORY (not verbatim quote) — see
//                    CATEGORY_COLORS. Untagged options fall back to the
//                    section's accent color (used for pure routing splits —
//                    who picked up, transferred or not, which objection —
//                    not sentiment triage).
//   ▸ ...            a rep action (set status, log)      → action chip
//   → ...            route to another section            → route step
//   ⊞ ...            data-collect step (inline)          → number inputs
//
// `kind`: 'opener' pins to top, 'branch' scrolls middle, 'close' pins bottom.

import { DEFAULT_TIMEZONE, zonedDateStr } from './timezones'

// Response-category colors for fork options (Prompt 204) — the 4 existing
// DESIGN.md semantic tokens only, no invented colors (Prompt 134 lesson).
export const CATEGORY_COLORS = {
  good:     'var(--success)',
  hesitant: 'var(--warning)',
  bad:      'var(--danger)',
}

// Outcome-name colors for ScriptWalk's merged terminal screen (Prompt 248) —
// reuses the same 3 CATEGORY_COLORS tokens, keyed by the literal status name
// a `▸ Set status X` action ends on (not a fork response category —
// "Appointment Booked" is Close's own terminal outcome, not a response tag).
export const OUTCOME_COLORS = {
  'Appointment Booked': CATEGORY_COLORS.good,
  'Follow-Up': CATEGORY_COLORS.hesitant,
  'Not Interested': CATEGORY_COLORS.bad,
}

// Legacy inline data-collect step (⊞ marker) — unused by v3 (which captures
// via the `captures` array on say-lines instead) but kept as a supported
// marker type for future script authors.
export const DATA_COLLECT_FIELDS = [
  { key: 'calls_missed_per_week', label: 'Missed calls / day',    placeholder: '3' },
  { key: 'avg_ticket',            label: 'Average job value ($)', placeholder: '250' },
]

const DATA_COLLECT_STEP = {
  type: 'data_collect',
  label: 'Qualifying Numbers',
  hint: 'Ask and fill in before continuing',
  fields: DATA_COLLECT_FIELDS,
}

export const FIXED_OPENER =
  `"Hey, is this [Business Name]?"`

export const DISCOVERY_SCRIPT = [
  {
    id: 'opener', kind: 'opener', short: 'Opener',
    title: 'Open the Call', trigger: 'Same words, every call — confirm the business, hook on the Indeed listing, qualify with one yes/no',
    goal: 'Confirm → hook → disarm any pushback → the binary qualifier ("stop missing calls — yes or no?"). Any real resistance gets one disarm attempt, then a clean exit — never a hard sell.',
    color: 'var(--accent)', dim: 'rgba(108,99,255,0.08)', border: 'rgba(108,99,255,0.25)',
    lines: [
      `"Hey, is this [Business Name]?"`,
      `BRANCH — Do they confirm?`,
      `↳ IF Yeah / speaking [GOOD]: "Hey — I saw you were hiring for a [job title]. I was wondering who I should speak to about that."`,
      `   BRANCH — How do they respond?`,
      `   ↳ IF That's me [GOOD]: "Quick question — are missed calls part of the reason you're posting for this role, or are you just growing?"`,
      `      BRANCH — How do they answer?`,
      `      ↳ IF Yeah [GOOD]: → Go to Vitals Check`,
      `      ↳ IF Kind of / it's part of it [HESITANT]: → Go to Vitals Check`,
      `      ↳ IF No, we've got it covered, just growing [BAD]: "I hear you — most people think that until they actually track it for a week and realize a few are slipping through. Has anyone actually counted?"`,
      `         BRANCH — Does a gap surface?`,
      `         ↳ IF Answers, any gap surfaces [HESITANT]: → Go to Vitals Check`,
      `         ↳ IF Genuinely solid, no gap [BAD]: "Okay, well — thank you for your time. Good luck with everything."`,
      `            ▸ Set status Not Interested.`,
      `   ↳ IF Transferring [HESITANT]: "Hey — I saw y'all were hiring for a [job title]. I don't know if you can help me, but are you guys missing calls? Is that part of why you're posting for the role?"`,
      `      BRANCH — How do they answer?`,
      `      ↳ IF Yeah [GOOD]: → Go to Vitals Check`,
      `      ↳ IF Kind of / it's part of it [HESITANT]: → Go to Vitals Check`,
      `      ↳ IF No, we've got it covered, just growing [BAD]: "I hear you — most people think that until they actually track it for a week and realize a few are slipping through. Has anyone actually counted?"`,
      `         BRANCH — Does a gap surface?`,
      `         ↳ IF Answers, any gap surfaces [HESITANT]: → Go to Vitals Check`,
      `         ↳ IF Genuinely solid, no gap [BAD]: "Okay, well — thank you for your time. Good luck with everything."`,
      `            ▸ Set status Not Interested.`,
      `   ↳ IF They're not here right now / I'll leave a message [HESITANT]: "No worries — when's a better time to catch them?"`,
      `      ▸ Set status Follow-Up.`,
      `   ↳ IF What's this about? / pushback [BAD]: "Nothing to sell you here yet — genuinely just want to see if it's actually calls slipping, or something else, before you spend time and money hiring for it."`,
      `      BRANCH — Do they engage?`,
      `      ↳ IF Engages [GOOD]: "Quick question — are missed calls part of the reason you're posting for this role, or are you just growing?"`,
      `         BRANCH — How do they answer?`,
      `         ↳ IF Yeah [GOOD]: → Go to Vitals Check`,
      `         ↳ IF Kind of / it's part of it [HESITANT]: → Go to Vitals Check`,
      `         ↳ IF No, we've got it covered, just growing [BAD]: "I hear you — most people think that until they actually track it for a week and realize a few are slipping through. Has anyone actually counted?"`,
      `            BRANCH — Does a gap surface?`,
      `            ↳ IF Answers, any gap surfaces [HESITANT]: → Go to Vitals Check`,
      `            ↳ IF Genuinely solid, no gap [BAD]: "Okay, well — thank you for your time. Good luck with everything."`,
      `               ▸ Set status Not Interested.`,
      `      ↳ IF Still shuts it down [BAD]: "Totally fair — I'll let you go. Just curious though, are you all catching every call that comes in, or does one ever slip through?"`,
      `         BRANCH — Do they engage this time?`,
      `         ↳ IF Engages [GOOD]: "Quick question — are missed calls part of the reason you're posting for this role, or are you just growing?"`,
      `            BRANCH — How do they answer?`,
      `            ↳ IF Yeah [GOOD]: → Go to Vitals Check`,
      `            ↳ IF Kind of / it's part of it [HESITANT]: → Go to Vitals Check`,
      `            ↳ IF No, we've got it covered, just growing [BAD]: "I hear you — most people think that until they actually track it for a week and realize a few are slipping through. Has anyone actually counted?"`,
      `               BRANCH — Does a gap surface?`,
      `               ↳ IF Answers, any gap surfaces [HESITANT]: → Go to Vitals Check`,
      `               ↳ IF Genuinely solid, no gap [BAD]: "Okay, well — thank you for your time. Good luck with everything."`,
      `                  ▸ Set status Not Interested.`,
      `         ↳ IF Still shuts it down [BAD]: "All good, man — appreciate your time. Take care."`,
      `            ▸ Set status Not Interested.`,
      `↳ IF No [BAD]: "Okay — so just to be sure, you guys weren't the ones hiring for a [job title]?"`,
      `   BRANCH — Do they confirm?`,
      `   ↳ IF Confirms / engages: "Are you still looking to hire for that role?"`,
      `      BRANCH — How do they answer?`,
      `      ↳ IF Yes [GOOD]: "Okay, perfect — I'm wondering who I should speak to about that."`,
      `         BRANCH — How do they respond?`,
      `         ↳ IF That's me [GOOD]: "Quick question — are missed calls part of the reason you're posting for this role, or are you just growing?"`,
      `            BRANCH — How do they answer?`,
      `            ↳ IF Yeah [GOOD]: → Go to Vitals Check`,
      `            ↳ IF Kind of / it's part of it [HESITANT]: → Go to Vitals Check`,
      `            ↳ IF No, we've got it covered, just growing [BAD]: "I hear you — most people think that until they actually track it for a week and realize a few are slipping through. Has anyone actually counted?"`,
      `               BRANCH — Does a gap surface?`,
      `               ↳ IF Answers, any gap surfaces [HESITANT]: → Go to Vitals Check`,
      `               ↳ IF Genuinely solid, no gap [BAD]: "Okay, well — thank you for your time. Good luck with everything."`,
      `                  ▸ Set status Not Interested.`,
      `         ↳ IF Transferring [HESITANT]: "Hey — I saw y'all were hiring for a [job title]. I don't know if you can help me, but are you guys missing calls? Is that part of why you're posting for the role?"`,
      `            BRANCH — How do they answer?`,
      `            ↳ IF Yeah [GOOD]: → Go to Vitals Check`,
      `            ↳ IF Kind of / it's part of it [HESITANT]: → Go to Vitals Check`,
      `            ↳ IF No, we've got it covered, just growing [BAD]: "I hear you — most people think that until they actually track it for a week and realize a few are slipping through. Has anyone actually counted?"`,
      `               BRANCH — Does a gap surface?`,
      `               ↳ IF Answers, any gap surfaces [HESITANT]: → Go to Vitals Check`,
      `               ↳ IF Genuinely solid, no gap [BAD]: "Okay, well — thank you for your time. Good luck with everything."`,
      `                  ▸ Set status Not Interested.`,
      `         ↳ IF They're not here right now / I'll leave a message [HESITANT]: "No worries — when's a better time to catch them?"`,
      `            ▸ Set status Follow-Up.`,
      `         ↳ IF What's this about? / pushback [BAD]: "Nothing to sell you here yet — genuinely just want to see if it's actually calls slipping, or something else, before you spend time and money hiring for it."`,
      `            BRANCH — Do they engage?`,
      `            ↳ IF Engages [GOOD]: "Quick question — are missed calls part of the reason you're posting for this role, or are you just growing?"`,
      `               BRANCH — How do they answer?`,
      `               ↳ IF Yeah [GOOD]: → Go to Vitals Check`,
      `               ↳ IF Kind of / it's part of it [HESITANT]: → Go to Vitals Check`,
      `               ↳ IF No, we've got it covered, just growing [BAD]: "I hear you — most people think that until they actually track it for a week and realize a few are slipping through. Has anyone actually counted?"`,
      `                  BRANCH — Does a gap surface?`,
      `                  ↳ IF Answers, any gap surfaces [HESITANT]: → Go to Vitals Check`,
      `                  ↳ IF Genuinely solid, no gap [BAD]: "Okay, well — thank you for your time. Good luck with everything."`,
      `                     ▸ Set status Not Interested.`,
      `            ↳ IF Still shuts it down [BAD]: "Totally fair — I'll let you go. Just curious though, are you all catching every call that comes in, or does one ever slip through?"`,
      `               BRANCH — Do they engage this time?`,
      `               ↳ IF Engages [GOOD]: "Quick question — are missed calls part of the reason you're posting for this role, or are you just growing?"`,
      `                  BRANCH — How do they answer?`,
      `                  ↳ IF Yeah [GOOD]: → Go to Vitals Check`,
      `                  ↳ IF Kind of / it's part of it [HESITANT]: → Go to Vitals Check`,
      `                  ↳ IF No, we've got it covered, just growing [BAD]: "I hear you — most people think that until they actually track it for a week and realize a few are slipping through. Has anyone actually counted?"`,
      `                     BRANCH — Does a gap surface?`,
      `                     ↳ IF Answers, any gap surfaces [HESITANT]: → Go to Vitals Check`,
      `                     ↳ IF Genuinely solid, no gap [BAD]: "Okay, well — thank you for your time. Good luck with everything."`,
      `                        ▸ Set status Not Interested.`,
      `               ↳ IF Still shuts it down [BAD]: "All good, man — appreciate your time. Take care."`,
      `                  ▸ Set status Not Interested.`,
      `      ↳ IF No, not interested [BAD]: ▸ Set status Not Interested.`,
      `   ↳ IF Genuinely wrong number/business [BAD]: ▸ Set status Not Interested.`,
    ],
    tips: `Confirm → Indeed hook → one clean disarm if they push back ("nothing to sell you, genuinely just a quick question") → the binary qualifier. "Depends" still moves forward — only a genuinely solid "we've got it covered" gets the on-top-of-it check, and only a real no-gap answer there ends the call. Two disarm attempts max, then let them go.`,
  },

  {
    id: 'vitals', kind: 'branch', short: 'Vitals',
    title: 'Vitals', trigger: `They're in — get the three numbers that build the pain`,
    goal: 'Monthly call volume for rapport, then the direct daily-miss number, then ticket value. Three questions, no more.',
    color: 'var(--accent)', dim: 'rgba(108,99,255,0.08)', border: 'rgba(108,99,255,0.25)',
    lines: [
      `"Out of curiosity — how many calls do you think you get in a month?"`,
      `"Ballpark, how many do you think you're missing a day?"`,
      `"And what do you charge a client typically — like [$250] bucks?"`,
      `→ Go to Pain Amplification`,
    ],
    captures: [
      { match: 'missing a day', field: 'calls_missed_per_week', rawField: 'calls_missed_per_day', label: 'Missed calls / day — paste their number, no math', placeholder: 'e.g. 3', multiplier: 5 },
      { match: 'charge a client', field: 'avg_ticket', label: 'Avg job value ($)', placeholder: 'e.g. 250' },
    ],
    tips: `Monthly volume is a warm-up, not a capture — it just gets them talking before the real numbers. The daily-miss question is the one that matters: type in exactly what they say, the app converts it, no math on the call. Ticket value closes out the set.`,
  },

  {
    id: 'pain', kind: 'branch', short: 'Pain',
    title: 'Pain Amplification', trigger: `You have their numbers — do the math out loud, then check if it lands`,
    goal: 'State the monthly/annual number plainly, then ask if it matters to them. Minimizers get named-pain; skeptics get one labeling move; genuine "we\'re fine" gets a clean exit — never a push.',
    color: 'var(--warning)', dim: 'rgba(245,158,11,0.08)', border: 'rgba(245,158,11,0.25)',
    lines: [
      `"So check me out — you're potentially leaving what, like $[monthly] on the table every month. That's, I mean, $[annual] on the table every year from something like [their number] missed calls a day."`,
      `"Is that something you're doing anything about, or not really important to you?"`,
      `BRANCH — How do they respond?`,
      `↳ IF Engaged / "yeah we should" [GOOD]: → Go to Handoff`,
      `↳ IF Minimizes / "we're fine" [HESITANT]: "So if I called you — what time do you close at? [time]. If I called you at [time+1hr] and you're not able to get to the phone, why would I go to you versus somebody that can answer the phone?"`,
      `   BRANCH — Do they engage?`,
      `   ↳ IF Engages [GOOD]: → Go to Handoff`,
      `   ↳ IF Still no [BAD]: "Okay, well, that's a different story then. Okay man, well have a good day, good luck to you."`,
      `      ▸ Set status Not Interested.`,
      `↳ IF Pushback, "you're trying to sell me a service" [BAD]: "Yeah, no, there's nothing to buy, man — I just happen to see you guys. I mean, $[annual] every year — is that like anything you're doing anything about, or not important?"`,
      `   BRANCH — Do they re-engage?`,
      `   ↳ IF Re-engages [GOOD]: → Go to Handoff`,
      `   ↳ IF Still cold [BAD]: "My question for you is — if you're leaving that much money on the table and not doing anything about it, how's that going to affect your ability to compete with everybody else in your area?"`,
      `      BRANCH — Do they engage?`,
      `      ↳ IF Engages [GOOD]: → Go to Handoff`,
      `      ↳ IF Still no [BAD]: "Okay, well, that's a different story then. Okay man, well have a good day, good luck to you."`,
      `         ▸ Set status Not Interested.`,
    ],
    tips: `Say the dollar number plainly, then just ask if it matters — don't oversell it. Minimizers get the "what time do you close" trap (why would I go to you over someone who answers). Skeptics who think you're pitching get the disarm again, then the competition-framing question as a last labeling move. Two real "no"s in a row, and you exit clean — this is not a script to argue with.`,
  },

  {
    id: 'handoff', kind: 'branch', short: 'Handoff',
    title: 'Handoff & Book', trigger: `Pain landed — hand off to the team, describe the product, ask for the time`,
    goal: 'Pass everything to "our team," describe the AI receptionist plainly, then ask for one of two specific windows.',
    color: 'var(--success)', dim: 'rgba(34,197,94,0.08)', border: 'rgba(34,197,94,0.25)',
    lines: [
      `"Look, I don't want to waste your time — like I said, that's money slipping through the cracks. So here's what I'll do for you: we'll build you a system made exactly for this — it catches the calls you'd otherwise miss, answers questions 24/7, and books straight to your calendar. All you have to do is show up. Take 15 minutes — worst case, you see exactly what it looks like. Best case, we get that money hole plugged and you're not wasting any more time. Sounds like a win-win to me — what do you think?"`,
      `BRANCH — How do they respond?`,
      `↳ IF Good / shows interest [GOOD]: "Good — looks like you guys are out in [city], [state]. Do mornings or afternoons work better for you?"`,
      ...timeOfDayOfferFlow('   '),
      `   ↳ IF Still hesitant [HESITANT]: "No worries — like I was saying, it's just 15 minutes. They'll show you exactly how the system works and how it'd actually help your situation. Just hear them out — how's that sound?"`,
      `      BRANCH — Do they engage this time?`,
      `      ↳ IF Engages [GOOD]: "Okay, perfect — do mornings or afternoons work better for you?"`,
      ...timeOfDayOfferFlow('      '),
      `      ↳ IF Still hesitant [HESITANT]: "No worries — is it more of a timing thing, or is this just not a good fit right now?"`,
      `            BRANCH — Which is it?`,
      `            ↳ IF Timing thing [HESITANT]: "Got it — what's a better time to check back in?"`,
      `               ▸ Set status Follow-Up (log the callback window they gave).`,
      `            ↳ IF Not a good fit [BAD]: "All good, man — appreciate your time. Take care."`,
      `               ▸ Set status Not Interested.`,
      `      ↳ IF Still hesitant [HESITANT]: "No worries — is it more of a timing thing, or is this just not a good fit right now?"`,
      `         BRANCH — Which is it?`,
      `         ↳ IF Timing thing [HESITANT]: "Got it — what's a better time to check back in?"`,
      `            ▸ Set status Follow-Up (log the callback window they gave).`,
      `         ↳ IF Not a good fit [BAD]: "All good, man — appreciate your time. Take care."`,
      `            ▸ Set status Not Interested.`,
      `↳ IF Just send me some info [HESITANT]: "Yeah, 100% — but honestly, when's the last time an email did more for you than an actual conversation? Let's hop on a quick call instead — our team will walk you through exactly how this can benefit your situation. All you gotta do is listen. How's that sound?"`,
      `   BRANCH — Do they agree?`,
      `   ↳ IF Okay, fair [GOOD]: "Do mornings or afternoons work better for you?"`,
      ...timeOfDayOfferFlow('      '),
      `      ↳ IF Still hesitant [HESITANT]: "Honestly, I don't really have anything solid to send you — our team walks you through it more like a live presentation, tailored to your situation. How about this — is there a better time to reach out and check back in, see what's going on from there?"`,
      `         BRANCH — Do they give a time, or say they're not interested?`,
      `         ↳ IF Gives a time [HESITANT]: ▸ Set status Follow-Up (log the callback window they gave).`,
      `         ↳ IF Not interested [BAD]: "All good, man — appreciate your time. Take care."`,
      `            ▸ Set status Not Interested.`,
      `   ↳ IF Still wants info first [HESITANT]: "Fair enough — honestly, I don't really have anything solid to send you. Our team walks you through it more like a live presentation, tailored to your situation. Is there a better time to reach out and check back in, see what's going on from there?"`,
      `      BRANCH — Do they give a time, or say they're not interested?`,
      `      ↳ IF Gives a time [HESITANT]: ▸ Set status Follow-Up (log the callback window they gave).`,
      `      ↳ IF Not interested [BAD]: "All good, man — appreciate your time. Take care."`,
      `         ▸ Set status Not Interested.`,
      `↳ IF I don't have time this week [HESITANT]: "No problem — what works better, [Tuesday next week] or [Wednesday next week]?"`,
      `   BRANCH — Do they pick a day?`,
      `   ↳ IF Picks a day [GOOD]: → Go to Close`,
      `   ↳ IF Those don't work either [BAD]: "Okay, yeah, no worries — what's a good time for ya?"`,
      `      BRANCH — Do they give a time, or say they're not interested?`,
      `      ↳ IF Gives a time [HESITANT]: ▸ Set status Follow-Up (log the week they gave).`,
      `      ↳ IF Not interested [BAD]: "All good, man — appreciate your time. Take care."`,
      `         ▸ Set status Not Interested.`,
      `↳ IF Who is this / what company? [BAD]: "Oh — this is [Rep Name] with Ohvara. We build systems that help businesses just like yours stop missing calls and losing money because of it. I mean, we haven't spoken for very long, but you don't strike me as the type of person that wants to lose money, right?"`,
      `   BRANCH — How do they respond?`,
      `   ↳ IF Agrees [GOOD]: "Do mornings or afternoons work better for you?"`,
      ...timeOfDayOfferFlow('      '),
      `      ↳ IF Still hesitant [HESITANT]: "No worries — I'll send some info over, and if the numbers make sense, we can find time later."`,
      `         ▸ Set status Follow-Up (log pricing pushback, send info).`,
      `   ↳ IF Still hesitant [HESITANT]: "No worries — if you don't mind me asking, what's kind of holding you back?"`,
      `      BRANCH — Do they open up, or say they're not interested?`,
      `      ↳ IF Opens up [HESITANT]: "It's really just 15 minutes to see if it's even worth pursuing — no pressure, no commitment. If it's not a fit, we part ways, no hard feelings."`,
      `         BRANCH — Do they engage this time?`,
      `         ↳ IF Engages [GOOD]: "Okay, perfect — do mornings or afternoons work better for you?"`,
      ...timeOfDayOfferFlow('            '),
      `         ↳ IF Still hesitant [HESITANT]: "No worries — is there a better time for me to check back in?"`,
      `            ▸ Set status Follow-Up (log the callback window they gave).`,
      `      ↳ IF Not interested [BAD]: "All good, man — appreciate your time. Take care."`,
      `         ▸ Set status Not Interested.`,
      `↳ IF How much does this cost? [BAD]: "Honestly depends on your call volume and setup — which is exactly what our team figures out on the call. Didn't want to guess at a number before they've seen your actual situation. Does that sound fair?"`,
      `   BRANCH — Do they push for a ballpark?`,
      `   ↳ IF Okay [GOOD]: "Do mornings or afternoons work better for you?"`,
      ...timeOfDayOfferFlow('      '),
      `      ↳ IF Still hesitant [HESITANT]: "No worries — I'll send some info over, and if the numbers make sense, we can find time later."`,
      `         ▸ Set status Follow-Up (log pricing pushback, send info).`,
      `   ↳ IF Just need a ballpark [HESITANT]: "The range is wide depending on what you need, which is exactly why the call is worth 15 minutes — they'll give you a real number based on what you just told me."`,
      `      "Do mornings or afternoons work better for you?"`,
      ...timeOfDayOfferFlow('      '),
      `      ↳ IF Still hesitant [HESITANT]: "No worries — if you don't mind me asking, what's kind of holding you back?"`,
      `         BRANCH — Do they open up, or say they're not interested?`,
      `         ↳ IF Opens up [HESITANT]: "It's really just 15 minutes to see if it's even worth pursuing — no pressure, no commitment. If it's not a fit, we part ways, no hard feelings."`,
      `            BRANCH — Do they engage this time?`,
      `            ↳ IF Engages [GOOD]: "Okay, perfect — do mornings or afternoons work better for you?"`,
      ...timeOfDayOfferFlow('               '),
      `            ↳ IF Still hesitant [HESITANT]: "No worries — is there a better time for me to check back in?"`,
      `               ▸ Set status Follow-Up (log the callback window they gave).`,
      `         ↳ IF Not interested [BAD]: "All good, man — appreciate your time. Take care."`,
      `            ▸ Set status Not Interested.`,
    ],
    tips: `The handoff line packs in their own numbers — [their number]/[$ticket]/[annual] fill in live from what they told you. The product description is the most direct lift from the source call — don't embellish past it, it's already accurate to what we ship. Only one option is a real yes; the other 4 land directly on that objection's real response — no redundant "what's the objection" re-ask, since Handoff already knows which one it was.`,
  },

  {
    id: 'close', kind: 'close', short: 'Close',
    title: 'Lock the Time', trigger: `They picked a window — confirm the exact time, get their number, done`,
    goal: 'State the day/time back, get their best number, remind them our team already has everything. Stop talking.',
    color: 'var(--accent)', dim: 'rgba(108,99,255,0.10)', border: 'rgba(108,99,255,0.30)',
    lines: [
      `"[Day] at [time] — I've got you locked in for that. What's a good number to grab you at real quick to confirm?"`,
      `"Got it. Our team will have everything you told me today in front of them before the call — you won't have to re-explain anything. Thank you for your time — talk soon."`,
      `▸ Set status Appointment Booked. Log the time and number.`,
    ],
    tips: `Say the day/time back, get the number, then stop. Nothing to sell after the yes.`,
  },
]

// Day-offering date math (Prompt 256) — [Tuesday morning]/[Wednesday
// afternoon]/[Tuesday next week]/[Wednesday next week] used to render as
// literal bracket text, forcing the rep to do day-of-week math live on the
// call. Computed here from the rep's own local calendar day (profiles.timezone,
// same zonedDateStr() pattern as every other "today" in this codebase since
// Prompt 244) so the rendered text is exactly what the rep should say aloud.
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

function ordinal(day) {
  if (day % 10 === 1 && day % 100 !== 11) return `${day}st`
  if (day % 10 === 2 && day % 100 !== 12) return `${day}nd`
  if (day % 10 === 3 && day % 100 !== 13) return `${day}rd`
  return `${day}th`
}

// Adds `days` to a "YYYY-MM-DD" calendar date, returning its parts. Pure
// calendar-date math (Date.UTC, no timezone conversion) — zonedDateStr()
// already resolved which local calendar day "today" is.
function addDaysToDateStr(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d + days))
  return { year: dt.getUTCFullYear(), month: dt.getUTCMonth(), day: dt.getUTCDate(), dow: dt.getUTCDay() }
}

function monthDayText({ month, day }) {
  return `${MONTH_NAMES[month]} ${ordinal(day)}`
}

// Next occurrence of `targetDow` (0=Sun..6=Sat) strictly after today — if
// today already IS that weekday, jumps a full week rather than offering a
// same-day ask (Eagle's simpler rule, chosen to avoid a same-day offer
// reading as pushy — see Prompt 256).
function nextOccurrence(todayStr, targetDow) {
  const today = addDaysToDateStr(todayStr, 0)
  const offset = ((targetDow - today.dow + 7) % 7) || 7
  return monthDayText(addDaysToDateStr(todayStr, offset))
}

// The `targetDow` in the NEXT calendar week (Mon–Sun), never this week —
// distinct from nextOccurrence() because "[Tuesday next week]" is only used
// in the "I don't have time this week" branch, where offering something
// still in the current week would contradict what the prospect just said.
function nextCalendarWeekOccurrence(todayStr, targetDow) {
  const today = addDaysToDateStr(todayStr, 0)
  const daysToThisWeekMonday = today.dow === 0 ? -6 : 1 - today.dow
  const thisWeekMonday = addDaysToDateStr(todayStr, daysToThisWeekMonday)
  const thisWeekMondayStr = `${thisWeekMonday.year}-${String(thisWeekMonday.month + 1).padStart(2, '0')}-${String(thisWeekMonday.day).padStart(2, '0')}`
  const targetOffsetFromMonday = (targetDow - 1 + 7) % 7
  return monthDayText(addDaysToDateStr(thisWeekMondayStr, 7 + targetOffsetFromMonday))
}

// Local wall-clock hour (0-23) in `timeZone` at `nowMs` — used to pick the
// [afternoon offer] branch below (Prompt 264: "later today" only reads
// naturally before 5pm local; past that it offers tomorrow afternoon instead).
function zonedHour(nowMs, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timeZone || DEFAULT_TIMEZONE, hourCycle: 'h23', hour: '2-digit',
  }).formatToParts(new Date(nowMs))
  return Number(parts.find(p => p.type === 'hour').value)
}

// Time-of-day-aware morning/afternoon offer flow (Prompt 264) — replaces the
// old static "[Tuesday morning] or [Wednesday afternoon]" line at every
// Handoff site that offers a day/time. Generated once and spliced into each
// site via spread rather than hand-copied 7x: this DSL has no cross-section
// node references (verbatim duplication is the established pattern per
// Prompt 256), but a 3-step branch is too easy to drift out of sync if
// hand-copied at every site, so the block itself is shared while each site
// still gets its own literal, independent set of array entries at build time
// (no runtime references between sites — same as if it had been typed out
// by hand). `indent` matches the depth of the site's existing "BRANCH — Do
// they pick a time?" line it replaces.
function timeOfDayOfferFlow(indent) {
  return [
    `${indent}BRANCH — Mornings or afternoons?`,
    `${indent}↳ IF Mornings [GOOD]: "Does tomorrow morning work for you?"`,
    `${indent}   "What time works best for you?"`,
    `${indent}   → Go to Close`,
    `${indent}↳ IF Afternoon [GOOD]: "[afternoon offer]"`,
    `${indent}   "What time works best for you?"`,
    `${indent}   → Go to Close`,
  ]
}

// Substitute a lead's real details into the tree's tokens.
// In-call placeholders ([Name], [day], [time], [time+1hr], [owner]) stay
// literal as rep guidance — they're captured FROM the prospect's own words
// live on the call, not something computable ahead of time. The day-offering
// tokens ([Tuesday morning] etc.) ARE computable and are filled below.
function fillTokens(text, lead, rep) {
  const biz       = lead.business_name || 'the business'
  const niche     = lead.niche || 'service'
  const city      = lead.city || 'your area'
  const jobTitle  = lead.posting_title || 'front desk role'
  const repName = (rep?.full_name || '').trim() || '[Rep Name]'
  // Prompt 224 — confirm-time states the lead's location back before locking
  // an appointment time (personalization + implicit timezone confirmation).
  // "[city], [state]" is replaced as one composite token so a missing state
  // doesn't leave a dangling comma — falls back to whichever of city/state
  // is present, or "your area" if neither is (real data is 100% populated
  // on both as of this prompt, so this fallback is a safety net, not the
  // common case).
  const cityState = lead.city && lead.state
    ? `${lead.city}, ${lead.state}`
    : (lead.city || lead.state || 'your area')
  const todayStr = zonedDateStr(Date.now(), rep?.timezone || DEFAULT_TIMEZONE)
  const repTimezone = rep?.timezone || DEFAULT_TIMEZONE
  // Prompt 264 — the afternoon arm of the morning/afternoon offer flow reads
  // naturally as "later today" only before 5pm local; past that, offering
  // "later today" is asking for a same-day slot that's mostly already gone.
  const afternoonOffer = zonedHour(Date.now(), repTimezone) < 17
    ? 'Are you free later today?'
    : 'Does tomorrow afternoon work for you?'
  return text
    .replace(/\[Business Name\]/gi, biz)
    .replace(/\[niche\]/gi, niche)
    .replace(/\[city\], \[state\]/gi, cityState)
    .replace(/\[city\]/gi, city)
    .replace(/\[job title\]/gi, jobTitle)
    .replace(/\[Rep Name\]/gi, repName)
    .replace(/\[Tuesday morning\]/gi, `Tuesday morning, ${nextOccurrence(todayStr, 2)}`)
    .replace(/\[Wednesday afternoon\]/gi, `Wednesday afternoon, ${nextOccurrence(todayStr, 3)}`)
    .replace(/\[Tuesday next week\]/gi, `Tuesday, ${nextCalendarWeekOccurrence(todayStr, 2)}`)
    .replace(/\[Wednesday next week\]/gi, `Wednesday, ${nextCalendarWeekOccurrence(todayStr, 3)}`)
    .replace(/\[afternoon offer\]/gi, afternoonOffer)
}

// One section's lines + its coach tip, joined to text. Marker lines
// (BRANCH/↳/▸/→/•/-) keep their own prefix so the renderers can style them;
// plain spoken lines become "- " bullets. The coach tip trails as "💡 ".
function sectionToText(section, lead, rep) {
  const out = section.lines.map(l => {
    const filled = fillTokens(l, lead, rep)
    const t = filled.trimStart()
    if (/^(↳|▸|→|⊞|•|- |BRANCH\b|IF\b)/i.test(t)) return filled
    return `- ${filled}`
  })
  if (section.tips) out.push(`💡 ${fillTokens(section.tips, lead, rep)}`)
  return out.join('\n')
}

// Build the filled tree for a lead: a map of { sectionId: filledText } for
// every block. Fully deterministic — no AI call.
export function buildCallScript(lead, rep) {
  const out = {}
  for (const section of DISCOVERY_SCRIPT) out[section.id] = sectionToText(section, lead, rep)
  return out
}

// ── Click-through flow derivation (CONTENT-FREE) ─────────────────────────────
// Parses each section's EXISTING marker lines into a navigable step tree so the
// same script can drive a one-line-at-a-time guided walk (live Call modal +
// Training practice) WITHOUT changing a single spoken word.

// Leading-whitespace depth of a source line (tabs counted as 3).
function leadingSpaces(s) {
  const m = s.match(/^([ \t]*)/)
  return m ? m[1].replace(/\t/g, '   ').length : 0
}

// A line that hands off to another block.
function isRouteLine(t) {
  return /^→/.test(t) || /run\s+BRANCH\s*[A-E]/i.test(t) || /→\s*CLOSE/i.test(t) || /to\s+CLOSE/i.test(t)
}

// Resolve a route line to a target section id.
function routeTarget(t) {
  if (/vitals/i.test(t))     return 'vitals'
  if (/pain/i.test(t))       return 'pain'
  if (/handoff/i.test(t))    return 'handoff'
  if (/opener/i.test(t))     return 'opener'
  const b = t.match(/BRANCH\s*([A-E])/i)
  if (b) return 'branch' + b[1].toUpperCase()
  return 'close'
}

// "THEY HAVE SOMEONE" → "They have someone"; used for tap-button labels.
function optionLabel(s) {
  const x = s.trim()
  return x.charAt(0).toUpperCase() + x.slice(1).toLowerCase()
}

function shorten(s) {
  const x = s.replace(/^["']|["']$/g, '').trim()
  return x.length > 42 ? x.slice(0, 40).trimEnd() + '…' : x
}

// Turn one trimmed marker line into a step.
// A trailing `[[BREAK]]` (Prompt 215) forces a screen split in a say-chain
// that would otherwise auto-merge with whatever follows it — used when a
// chain is long enough that one continuous block reads as too much at once
// (Handoff's bridge+pitch vs. its ask). Stripped before the text is filled;
// never rendered or spoken.
function makeStep(t, lead, rep) {
  if (/^⊞/.test(t)) return { ...DATA_COLLECT_STEP }
  const route = isRouteLine(t)
  const action = /^▸/.test(t)
  const sub = /^↳/.test(t)
  const screenBreak = /\[\[BREAK\]\]\s*$/.test(t)
  let clean = t.replace(/^(↳|▸|→)\s*/, '')
  if (screenBreak) clean = clean.replace(/\s*\[\[BREAK\]\]\s*$/, '')
  const text = fillTokens(clean, lead, rep)
  if (route)  return { type: 'route', text, target: routeTarget(t) }
  if (action) return { type: 'action', text }
  return { type: 'say', text, ...(sub ? { sub: true } : {}), ...(screenBreak ? { screenBreak: true } : {}) }
}

// Recursive descent over lines[start..]: collect steps at indent ≥ baseIndent.
function parseSteps(lines, start, baseIndent, lead, rep) {
  const steps = []
  let i = start
  while (i < lines.length) {
    const raw = lines[i]
    if (leadingSpaces(raw) < baseIndent) break
    const t = raw.trim()

    if (/^BRANCH\b/i.test(t)) {
      const q = fillTokens(t.replace(/^BRANCH\s*[—-]\s*/i, ''), lead, rep)
      i++
      const options = []
      let optIndent = null
      while (i < lines.length) {
        const oraw = lines[i]
        const ot = oraw.trim()
        if (!/^↳/.test(ot)) break
        const oind = leadingSpaces(oraw)
        if (optIndent === null) optIndent = oind
        if (oind !== optIndent) break
        const body = ot.replace(/^↳\s*/, '')
        // Optional [GOOD]/[HESITANT]/[BAD] response-category tag (Prompt 204,
        // fix 4) — colors the option by category, not by verbatim quote.
        const mTag = body.match(/^IF\s+([^:]+?)\s*\[(GOOD|HESITANT|BAD)\]\s*:\s*(.*)$/i)
        const m = mTag || body.match(/^IF\s+([^:]+):\s*(.*)$/i) || body.match(/^([^:]{1,32}):\s+(.*)$/)
        const label = m ? optionLabel(m[1]) : shorten(body)
        const rest = mTag ? mTag[3] : (m ? m[2] : body)
        const category = mTag ? mTag[2].toLowerCase() : null
        const optSteps = []
        if (rest && rest.trim()) optSteps.push(makeStep(rest.trim(), lead, rep))
        i++
        const child = parseSteps(lines, i, optIndent + 1, lead, rep)
        optSteps.push(...child.steps)
        i = child.next
        options.push({ label, steps: optSteps, category })
      }
      steps.push({ type: 'fork', q, options })
      continue
    }

    steps.push(makeStep(t, lead, rep))
    i++
  }
  return { steps, next: i }
}

// Attach capture configs to matching say steps (recursive over fork options).
function attachCaptures(steps, captures) {
  for (const s of steps) {
    if (s.type === 'say' && captures) {
      for (const c of captures) {
        if (s.text.toLowerCase().includes(c.match.toLowerCase())) {
          s.capture = { field: c.field, label: c.label, placeholder: c.placeholder, multiplier: c.multiplier, rawField: c.rawField }
          break
        }
      }
    }
    if (s.type === 'fork') {
      for (const opt of s.options) attachCaptures(opt.steps, captures)
    }
  }
}

// Derive the full navigable flow for a lead.
export function buildScriptFlow(lead, rep, script = DISCOVERY_SCRIPT) {
  const byId = {}
  for (const section of script) {
    const { steps } = parseSteps(section.lines, 0, 0, lead, rep)
    if (section.captures) attachCaptures(steps, section.captures)
    byId[section.id] = {
      id: section.id, kind: section.kind, short: section.short,
      title: section.title, trigger: section.trigger, goal: section.goal,
      color: section.color, dim: section.dim, border: section.border,
      tips: section.tips ? fillTokens(section.tips, lead, rep) : '',
      steps,
      booksNate: flowHasRoute(steps),
      outcome: flowOutcome(steps),
    }
  }
  return {
    byId,
    opener: byId.opener,
    branches: script.filter(s => s.kind === 'branch').map(s => byId[s.id]),
    close: byId.close,
  }
}

// Does any step (including inside fork options) route onward to another block?
function flowHasRoute(steps) {
  for (const s of steps) {
    if (s.type === 'route') return true
    if (s.type === 'fork' && s.options.some(o => flowHasRoute(o.steps))) return true
  }
  return false
}

// Pulls the status name out of a `▸ Set status X[.…]` action's text — shared
// by flowOutcome (section-wide scan, below) and ScriptWalk's per-path
// terminal card (Prompt 248), so both read a status action the same way.
export function extractSetStatus(actionText) {
  const m = actionText.match(/set status\s+([A-Za-z][A-Za-z -]*?)(?:\s*\(|\.|$)/i)
  return m ? m[1].trim() : null
}

// The status a path ends on, read from its last "Set status X" action.
function flowOutcome(steps) {
  let found = null
  const scan = arr => {
    for (const s of arr) {
      if (s.type === 'action') {
        const m = extractSetStatus(s.text)
        if (m) found = m
      }
      if (s.type === 'fork') s.options.forEach(o => scan(o.steps))
    }
  }
  scan(steps)
  return found
}
