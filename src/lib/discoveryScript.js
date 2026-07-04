// ── Setter script v3 — Camden Cash, near-verbatim branching discovery flow ────
// Built from a single full cold-call transcript (see brain/setter-transcripts-
// camden-cash.md), adapted per brain/setter-script-v3-camden-style.md: no
// "ring a bell" name-drop (no public rep brand to lean on), no client-count/
// CEO framing (setter isn't the closer — "our team"), Indeed listing instead
// of a generic hook, and the setter always books the 15-minute call rather
// than closing on the spot. Every spoken line is exactly what the setter reads.
// Dynamic tokens: [Business Name], [First Name], [job title] (from the
// lead's posting_title, falling back to "front desk role" if unset — e.g.
// Maps-sourced leads with no scraped Indeed posting) filled from the lead.
// In-call tokens: [Name], [day], [time], [time+1hr], [owner], [Tuesday morning],
// [Wednesday afternoon], [Tuesday next week], [Wednesday next week] stay
// literal as rep guidance during the call. [their number], [monthly], [annual],
// [$ticket] are computed live from the setter's own captured vitals — see
// renderText() in ScriptWalk.jsx.
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

// Response-category colors for fork options (Prompt 204) — the 4 existing
// DESIGN.md semantic tokens only, no invented colors (Prompt 134 lesson).
export const CATEGORY_COLORS = {
  good:     'var(--success)',
  hesitant: 'var(--warning)',
  bad:      'var(--danger)',
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
      `BRANCH — Do they confirm or get transferred?`,
      `↳ IF Yeah / speaking: "Hey — I saw you were hiring for a [job title]. I was wondering who I should speak to about that."`,
      `   BRANCH — How do they respond?`,
      `   ↳ IF That's me [GOOD]: "Quick question — are missed calls part of the reason you're posting for this role, or are you just growing?"`,
      `      BRANCH — How do they answer?`,
      `      ↳ IF Yeah [GOOD]: → Go to Vitals Check`,
      `      ↳ IF Kind of / it's part of it [HESITANT]: → Go to Vitals Check`,
      `      ↳ IF No, we've got it covered, just growing [BAD]: "You're pretty on top of it, I got you — is it more that calls just aren't the bottleneck right now, or you've got someone dedicated catching every one?"`,
      `         BRANCH — Does a gap surface?`,
      `         ↳ IF Answers, any gap surfaces [HESITANT]: → Go to Vitals Check`,
      `         ↳ IF Genuinely solid, no gap [BAD]: "Okay, well, that's a different story then. Okay man, well have a good day, good luck to you."`,
      `            ▸ Set status Not Interested.`,
      `   ↳ IF Transferring [GOOD]: "Quick question — are missed calls part of the reason you're posting for this role, or are you just growing?"`,
      `      BRANCH — How do they answer?`,
      `      ↳ IF Yeah [GOOD]: → Go to Vitals Check`,
      `      ↳ IF Kind of / it's part of it [HESITANT]: → Go to Vitals Check`,
      `      ↳ IF No, we've got it covered, just growing [BAD]: "You're pretty on top of it, I got you — is it more that calls just aren't the bottleneck right now, or you've got someone dedicated catching every one?"`,
      `         BRANCH — Does a gap surface?`,
      `         ↳ IF Answers, any gap surfaces [HESITANT]: → Go to Vitals Check`,
      `         ↳ IF Genuinely solid, no gap [BAD]: "Okay, well, that's a different story then. Okay man, well have a good day, good luck to you."`,
      `            ▸ Set status Not Interested.`,
      `   ↳ IF What's this about? / pushback [BAD]: "Nothing to sell you here yet — genuinely just want to see if it's actually calls slipping, or something else, before you spend time and money hiring for it."`,
      `      BRANCH — Do they engage?`,
      `      ↳ IF Engages [GOOD]: "Quick question — are missed calls part of the reason you're posting for this role, or are you just growing?"`,
      `         BRANCH — How do they answer?`,
      `         ↳ IF Yeah [GOOD]: → Go to Vitals Check`,
      `         ↳ IF Kind of / it's part of it [HESITANT]: → Go to Vitals Check`,
      `         ↳ IF No, we've got it covered, just growing [BAD]: "You're pretty on top of it, I got you — is it more that calls just aren't the bottleneck right now, or you've got someone dedicated catching every one?"`,
      `            BRANCH — Does a gap surface?`,
      `            ↳ IF Answers, any gap surfaces [HESITANT]: → Go to Vitals Check`,
      `            ↳ IF Genuinely solid, no gap [BAD]: "Okay, well, that's a different story then. Okay man, well have a good day, good luck to you."`,
      `               ▸ Set status Not Interested.`,
      `      ↳ IF Still shuts it down [BAD]: ▸ Set status Not Interested.`,
      `↳ IF Transferred: "Hey [Name] — I saw your Indeed listing for a [job title]. That's usually a sign calls are slipping somewhere — got a quick sec?"`,
      `   BRANCH — Do they engage?`,
      `   ↳ IF Engages: "Quick question — are missed calls part of the reason you're posting for this role, or are you just growing?"`,
      `      BRANCH — How do they answer?`,
      `      ↳ IF Yeah [GOOD]: → Go to Vitals Check`,
      `      ↳ IF Kind of / it's part of it [HESITANT]: → Go to Vitals Check`,
      `      ↳ IF No, we've got it covered, just growing [BAD]: "You're pretty on top of it, I got you — is it more that calls just aren't the bottleneck right now, or you've got someone dedicated catching every one?"`,
      `         BRANCH — Does a gap surface?`,
      `         ↳ IF Answers, any gap surfaces [HESITANT]: → Go to Vitals Check`,
      `         ↳ IF Genuinely solid, no gap [BAD]: "Okay, well, that's a different story then. Okay man, well have a good day, good luck to you."`,
      `            ▸ Set status Not Interested.`,
      `   ↳ IF Pushback: "Nothing to sell you here yet — genuinely just want to see if it's actually calls slipping, or something else, before you spend time and money hiring for it."`,
      `      BRANCH — Do they engage?`,
      `      ↳ IF Engages [GOOD]: "Quick question — are missed calls part of the reason you're posting for this role, or are you just growing?"`,
      `         BRANCH — How do they answer?`,
      `         ↳ IF Yeah [GOOD]: → Go to Vitals Check`,
      `         ↳ IF Kind of / it's part of it [HESITANT]: → Go to Vitals Check`,
      `         ↳ IF No, we've got it covered, just growing [BAD]: "You're pretty on top of it, I got you — is it more that calls just aren't the bottleneck right now, or you've got someone dedicated catching every one?"`,
      `            BRANCH — Does a gap surface?`,
      `            ↳ IF Answers, any gap surfaces [HESITANT]: → Go to Vitals Check`,
      `            ↳ IF Genuinely solid, no gap [BAD]: "Okay, well, that's a different story then. Okay man, well have a good day, good luck to you."`,
      `               ▸ Set status Not Interested.`,
      `      ↳ IF Still shuts it down [BAD]: ▸ Set status Not Interested.`,
      `↳ IF No: "Okay — were you hiring for a [job title]?"`,
      `   BRANCH — Do they confirm?`,
      `   ↳ IF Confirms / engages: "Are you actively looking to hire for that?"`,
      `      BRANCH — How do they answer?`,
      `      ↳ IF Yes [GOOD]: "Hey — I saw you were hiring for a [job title]. I was wondering who I should speak to about that."`,
      `         BRANCH — How do they respond?`,
      `         ↳ IF That's me [GOOD]: "Quick question — are missed calls part of the reason you're posting for this role, or are you just growing?"`,
      `            BRANCH — How do they answer?`,
      `            ↳ IF Yeah [GOOD]: → Go to Vitals Check`,
      `            ↳ IF Kind of / it's part of it [HESITANT]: → Go to Vitals Check`,
      `            ↳ IF No, we've got it covered, just growing [BAD]: "You're pretty on top of it, I got you — is it more that calls just aren't the bottleneck right now, or you've got someone dedicated catching every one?"`,
      `               BRANCH — Does a gap surface?`,
      `               ↳ IF Answers, any gap surfaces [HESITANT]: → Go to Vitals Check`,
      `               ↳ IF Genuinely solid, no gap [BAD]: "Okay, well, that's a different story then. Okay man, well have a good day, good luck to you."`,
      `                  ▸ Set status Not Interested.`,
      `         ↳ IF Transferring [GOOD]: "Quick question — are missed calls part of the reason you're posting for this role, or are you just growing?"`,
      `            BRANCH — How do they answer?`,
      `            ↳ IF Yeah [GOOD]: → Go to Vitals Check`,
      `            ↳ IF Kind of / it's part of it [HESITANT]: → Go to Vitals Check`,
      `            ↳ IF No, we've got it covered, just growing [BAD]: "You're pretty on top of it, I got you — is it more that calls just aren't the bottleneck right now, or you've got someone dedicated catching every one?"`,
      `               BRANCH — Does a gap surface?`,
      `               ↳ IF Answers, any gap surfaces [HESITANT]: → Go to Vitals Check`,
      `               ↳ IF Genuinely solid, no gap [BAD]: "Okay, well, that's a different story then. Okay man, well have a good day, good luck to you."`,
      `                  ▸ Set status Not Interested.`,
      `         ↳ IF What's this about? / pushback [BAD]: "Nothing to sell you here yet — genuinely just want to see if it's actually calls slipping, or something else, before you spend time and money hiring for it."`,
      `            BRANCH — Do they engage?`,
      `            ↳ IF Engages [GOOD]: "Quick question — are missed calls part of the reason you're posting for this role, or are you just growing?"`,
      `               BRANCH — How do they answer?`,
      `               ↳ IF Yeah [GOOD]: → Go to Vitals Check`,
      `               ↳ IF Kind of / it's part of it [HESITANT]: → Go to Vitals Check`,
      `               ↳ IF No, we've got it covered, just growing [BAD]: "You're pretty on top of it, I got you — is it more that calls just aren't the bottleneck right now, or you've got someone dedicated catching every one?"`,
      `                  BRANCH — Does a gap surface?`,
      `                  ↳ IF Answers, any gap surfaces [HESITANT]: → Go to Vitals Check`,
      `                  ↳ IF Genuinely solid, no gap [BAD]: "Okay, well, that's a different story then. Okay man, well have a good day, good luck to you."`,
      `                     ▸ Set status Not Interested.`,
      `            ↳ IF Still shuts it down [BAD]: ▸ Set status Not Interested.`,
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
      `"I don't want to waste your time here. I have a team that works with businesses just like yours. If you're missing [their number] calls a day and your average client's worth [$ticket], that's $[annual] you're leaving on the table every year from calls that just don't get picked up."`,
      `"Basically, instead of filling this role with a person, we'd build you an AI receptionist made for exactly this — not some robot press-one thing, a real human feel, we can even make it your voice — it catches the calls you'd otherwise miss, does missed-call text-back, answers questions, and books appointments straight to your calendar. All you'd have to do is show up to the meeting — and it means you might not even need to finish out this hire the way you'd planned."`,
      `"Take 15 minutes. Worst case scenario, you get to see what it looks like and stop wasting your time. Best case scenario, our team shows you exactly how you're leaving money on the table and how to fix it. How's that sound? [Tuesday morning] or [Wednesday afternoon]?"`,
      `BRANCH — How do they respond?`,
      `↳ IF Picks a time [GOOD]: → Go to Close (lock the time and confirm)`,
      `↳ IF Just send me some info: "I could send that over, but honestly — when was the last time an email did more for you than an actual conversation? Let's hop on a quick call instead, [time] tomorrow — I'll show you, there's nothing to buy."`,
      `   BRANCH — Do they agree?`,
      `   ↳ IF Okay, fair [GOOD]: "Does [Tuesday morning] or [Wednesday afternoon] work better for you?"`,
      `      → Go to Close`,
      `   ↳ IF Still wants info first [HESITANT]: "Fair enough — I'll send it over today. And I'm going to drop a 15-minute placeholder on your calendar for [day]. If you read it and it's not worth your time, just decline, no hard feelings. If it's interesting, we're already set."`,
      `      ▸ Set status Follow-Up (send info + placeholder).`,
      `↳ IF I don't have time this week: "No problem — what works better, [Tuesday next week] or [Wednesday next week]?"`,
      `   BRANCH — Do they pick a day?`,
      `   ↳ IF Picks a day [GOOD]: → Go to Close`,
      `   ↳ IF Those don't work either [BAD]: "Got it — what's a better week for you?"`,
      `      ▸ Set status Follow-Up (log the week they gave).`,
      `↳ IF Who is this / what company?: "Who would be responsible for looking at any possible hidden gaps in your call flow system that could be causing you guys to miss out on thousands of dollars every month? Is that you?"`,
      `   BRANCH — Are they the decision maker?`,
      `   ↳ IF That's me: → Go to Vitals Check`,
      `   ↳ IF That's [owner]: "No worries — do you know a good time [owner] is usually in later this week?"`,
      `      BRANCH — Do they give a window?`,
      `      ↳ IF Gives a window: ▸ Set status Follow-Up (log the callback window).`,
      `      ↳ IF Only reachable by email: "No worries — what's the best email?"`,
      `         ▸ Set status Follow-Up (logged email, thanked and exited).`,
      `↳ IF How much does this cost?: "Honestly depends on your call volume and setup — which is exactly what our team figures out on the call. Didn't want to guess at a number before they've seen your actual situation."`,
      `   BRANCH — Do they push for a ballpark?`,
      `   ↳ IF Okay [GOOD]: "Does [Tuesday morning] or [Wednesday afternoon] work better for you?"`,
      `      → Go to Close`,
      `   ↳ IF Just need a ballpark [HESITANT]: "The range is wide depending on what you need, which is exactly why the call is worth 15 minutes — they'll give you a real number based on what you just told me."`,
      `      "Does [Tuesday morning] or [Wednesday afternoon] work better for you?"`,
      `      → Go to Close`,
    ],
    tips: `The handoff line packs in their own numbers — [their number]/[$ticket]/[annual] fill in live from what they told you. The product description is the most direct lift from the source call — don't embellish past it, it's already accurate to what we ship. Only one option is a real yes; the other 4 land directly on that objection's real response — no redundant "what's the objection" re-ask, since Handoff already knows which one it was.`,
  },

  {
    id: 'close', kind: 'close', short: 'Close',
    title: 'Lock the Time', trigger: `They picked a window — confirm the exact time, get their number, done`,
    goal: 'State the day/time back, get their best number, remind them our team already has everything. Stop talking.',
    color: 'var(--accent)', dim: 'rgba(108,99,255,0.10)', border: 'rgba(108,99,255,0.30)',
    lines: [
      `"[Day] at [time] — I'm going to see what I can do for you. There's nothing, you don't got to buy anything. What's the best number so I can send you a quick text right now to confirm?"`,
      `"Got it. Our team will have everything you told me today in front of them before the call — you won't have to re-explain anything."`,
      `▸ Set status Appointment Booked. Log the time and number.`,
    ],
    tips: `Say the day/time back, get the number, then stop. Nothing to sell after the yes.`,
  },
]

// Substitute a lead's real details into the tree's tokens.
// In-call placeholders ([Name], [day], [time], [time+1hr], [owner],
// [Tuesday morning], etc.) stay literal as rep guidance during the call.
function fillTokens(text, lead, rep) {
  const biz       = lead.business_name || 'the business'
  const niche     = lead.niche || 'service'
  const city      = lead.city || 'your area'
  const jobTitle  = lead.posting_title || 'front desk role'
  const repName = (rep?.full_name || '').trim() || '[Rep Name]'
  return text
    .replace(/\[Business Name\]/gi, biz)
    .replace(/\[niche\]/gi, niche)
    .replace(/\[city\]/gi, city)
    .replace(/\[job title\]/gi, jobTitle)
    .replace(/\[Rep Name\]/gi, repName)
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
function makeStep(t, lead, rep) {
  if (/^⊞/.test(t)) return { ...DATA_COLLECT_STEP }
  const route = isRouteLine(t)
  const action = /^▸/.test(t)
  const sub = /^↳/.test(t)
  const clean = t.replace(/^(↳|▸|→)\s*/, '')
  const text = fillTokens(clean, lead, rep)
  if (route)  return { type: 'route', text, target: routeTarget(t) }
  if (action) return { type: 'action', text }
  return { type: 'say', text, ...(sub ? { sub: true } : {}) }
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

// The status a path ends on, read from its last "Set status X" action.
function flowOutcome(steps) {
  let found = null
  const scan = arr => {
    for (const s of arr) {
      if (s.type === 'action') {
        const m = s.text.match(/set status\s+([A-Za-z][A-Za-z -]*?)(?:\s*\(|\.|$)/i)
        if (m) found = m[1].trim()
      }
      if (s.type === 'fork') s.options.forEach(o => scan(o.steps))
    }
  }
  scan(steps)
  return found
}
