// ── The ONE universal discovery script ───────────────────────────────────────
// Single source of truth for the question-based diagnostic model. Rendered as
// the learning reference on the Training Center page AND filled with a lead's
// real details for the "Call Now" cheat sheet (rep CallModal + closer
// AIScriptPanel). Every setter reads the SAME fixed script — personalization
// means plugging THIS lead's business/niche/city/name into it, never generating
// different content per lead.
//
// The rep is DIAGNOSING, not selling: ask questions, surface pain, gather the
// facts the AI stack recommender needs (business type, current setup/problem,
// volume & ticket size, what they've tried, openness), then hand off to Nate —
// the specialist who builds the fix — and book the 15-minute call.
//
// LIGHT BRANCHING: a few lines start with "↳" — those are yes/no branch
// follow-ups the rep picks based on the prospect's answer. CallModal renders
// "↳" lines indented in the section color; TrainingCenter shows them as their
// own steps. Section colors match the Call Now modal so reps see the same
// color system in Training and on a live call.
export const DISCOVERY_SCRIPT = [
  {
    id: 'opener',
    title: 'Opener',
    goal: 'Survive the first 10 seconds. Sound like a peer, not a telemarketer.',
    color: 'var(--accent)',  dim: 'rgba(108,99,255,0.08)',  border: 'rgba(108,99,255,0.25)',
    variations: [
      {
        label: `📞 Indeed — Phone Coverage Lead`,
        lines: [
          `"Hey, is this [Business Name]? [First name]? Perfect — I'll be quick, I know you're mid-day."`,
          `"I saw your Indeed post for the [receptionist/front desk/phone] role — figured you're hiring because the phones are getting away from you. Am I close?"`,
          `If no Indeed listing: "I work with [niche] owners in [city] — quick question, are you the one who handles the phones when the crew's out on jobs?"`,
        ],
        tips: `They posted the job because they're already feeling the pain. Name it, then let them confirm — don't pitch anything yet.`,
      },
      {
        label: `🚛 Indeed — Dispatcher/Coordinator Lead`,
        lines: [
          `"Hey, is this [Business Name]? [First name]? Perfect — super quick."`,
          `"I saw you're hiring a [dispatcher/coordinator/logistics] — is that because scheduling and routing calls is eating your whole day?"`,
          `If no Indeed listing: "I work with [niche] owners in [city] — quick question, who's handling your dispatch and scheduling calls right now?"`,
        ],
        tips: `They're drowning in coordination — that's why the job is posted. Let them say it; don't say it for them.`,
      },
      {
        label: `🗺️ Maps — No Website / Low Reviews Lead`,
        lines: [
          `"Hey, is this [Business Name]? [First name]? Perfect — real quick."`,
          `"I was looking at your Google listing — are you the owner?"`,
          `"Quick question: when someone finds you on Google and wants to book, where does that call actually go right now?"`,
        ],
        tips: `They don't picture the problem until you make them. A customer who can't reach you calls your competitor instead.`,
      },
    ],
  },
  {
    id: 'discovery',
    title: 'Discovery — Diagnose, Don\'t Sell',
    goal: 'Gather the facts: current setup, volume, ticket size, what they\'ve tried. Ask, then shut up and write it down.',
    color: 'var(--info)',    dim: 'rgba(56,189,248,0.08)',  border: 'rgba(56,189,248,0.25)',
    lines: [
      `"Walk me through what happens right now when a call comes in and you're on a job or with a customer."`,
      `BRANCH — "Do you have someone answering the phones for you right now, or is it mostly you and the crew?"`,
      `↳ IF THEY HAVE SOMEONE: "Got it — and when they're slammed, off, or it's after hours, where do those calls go?"`,
      `↳ IF IT'S JUST THEM: "So when you're heads-down on a job, that call's basically going to voicemail — fair to say?"`,
      `"Roughly how many calls a week would you say you're just not getting to?"`,
      `"And what's a typical job worth to you, start to finish — ballpark average ticket?"`,
      `"Have you tried anything to fix it yet — answering service, hiring a receptionist, anything like that? How'd that go?"`,
    ],
    tips: `Write every answer in Call Notes — business type, who answers now, calls/week, average ticket, what they've tried. That's exactly what Nate builds the fix from. The average-ticket number is gold; it sizes the whole thing.`,
  },
  {
    id: 'pain',
    title: 'Pain Amplification',
    goal: 'Turn "yeah we miss some calls" into a dollar figure they can feel — using THEIR numbers.',
    color: 'var(--warning)', dim: 'rgba(245,158,11,0.08)',  border: 'rgba(245,158,11,0.25)',
    lines: [
      `BRANCH — did they give you real numbers in discovery?`,
      `↳ IF YES: "Let's do quick math — [their #] missed calls a week, even a third of those real jobs at [their ticket] each… that's thousands a month walking to whoever picks up first."`,
      `↳ IF NOT SURE: "Most owners I talk to are missing 8–10 a week without realizing it. Even 3 real jobs at your ticket size — that adds up fast, right?"`,
      `"And that's just business hours. What happens to the 7pm 'my [heater/pipe/roof]'s out' call — the emergency that pays the most?"`,
      `"Most owners know they're losing some jobs — they've just never put a number on it. Does that number surprise you?"`,
    ],
    tips: `Use THEIR numbers, not yours — a number they gave you is a number they believe. Don't solve it here; just let the cost sink in.`,
  },
  {
    id: 'objections',
    title: 'Objection Handling',
    goal: 'Acknowledge, reframe, ask one more question. Never argue. You\'re booking a call, not closing a deal.',
    color: 'var(--danger)',  dim: 'rgba(239,68,68,0.08)',   border: 'rgba(239,68,68,0.25)',
    lines: [
      `"Not interested" → "Totally fair — most owners say that until they see the missed-call math. One question and I'll let you go: what happens to a call you can't answer right now?"`,
      `"Too busy" → "That's exactly why I called. The whole point is getting you hours back, not taking them — and the call with Nate is 15 minutes."`,
      `"We have someone for that" → "Nice — does that cover after-hours and weekends too? That's usually where the gap is."`,
      `"How much is it?" → "Honestly that's Nate's call once he sees your setup — there's a few options depending on what you actually need. That's exactly what the 15 minutes is for."`,
      `"Send me an email" → "Happy to — but the email won't mean much without your numbers. Let's grab 15 minutes with Nate and he'll walk you through it live."`,
    ],
    tips: `One objection handled well earns the booking. Two means let go gracefully — leave the door open and log it as a callback. Never quote price; that's Nate's job.`,
  },
  {
    id: 'close',
    title: 'Handoff to Nate & Book',
    goal: 'Position Nate as the expert who fixes exactly what they described, then lock a date/time. That\'s the whole job.',
    color: 'var(--success)', dim: 'rgba(34,197,94,0.08)',   border: 'rgba(34,197,94,0.25)',
    lines: [
      `"Here's what I'd do. I don't build these myself — but the guy who does, Nate, is the best I've seen at it. He'll take exactly what you just told me and show you how to plug those leaks."`,
      `"It's a quick 15-minute call — no pressure pitch. He'll map out how many calls you're missing, what they're worth, and what it'd take to fix it. You decide from there."`,
      `"Does Tuesday afternoon or Thursday morning work better for a quick call with him?"`,
      `↳ ONCE THEY PICK: "Perfect — [day] at [time]. Nate will call you then. What's the best cell for that?"`,
      `↳ IF THEY HESITATE: "Totally fair — worst case you spend 15 minutes and learn exactly what you're losing. Best case Nate saves you a few jobs a month. Tuesday or Thursday?"`,
    ],
    tips: `Nate is the hero — you're the trusted intro. Offer two specific times, never "when works for you?". Confirm the time, confirm the cell, end the call. Don't keep selling after the yes.`,
  },
]

// Substitute a lead's real details into the script's tokens. Only lead-data
// tokens are filled — in-call choice placeholders ([receptionist/front desk/
// phone], [heater/pipe/roof], [day], [time], [their #], [their ticket]) stay
// literal as rep guidance.
function fillTokens(text, lead) {
  const biz   = lead.business_name || 'the business'
  const first = (lead.contact_name || '').trim().split(/\s+/)[0] || 'there'
  const niche = lead.niche || 'service'
  const city  = lead.city || 'your area'
  return text
    .replace(/\[Business Name\]/gi, biz)
    .replace(/\[First name\]/gi, first)
    .replace(/\[niche\]/gi, niche)
    .replace(/\[city\]/gi, city)
}

// One section's lines + its coach tip, joined as text. Question lines become
// "- " bullets; branch lines (already prefixed with "↳") and inline labels
// ("BRANCH —") keep their own marker so the renderers can style them. The
// coach tip trails as a "💡 " prose line.
function sectionToText(lines, tips, lead) {
  const out = lines.map(l => {
    const filled = fillTokens(l, lead)
    const t = filled.trim()
    // Branch follow-ups (↳) and branch headers (BRANCH —) keep their own
    // marker; everything else is a spoken-line bullet.
    if (t.startsWith('↳') || t.startsWith('•') || t.startsWith('- ') || /^BRANCH\b/i.test(t)) return filled
    return `- ${filled}`
  })
  if (tips) out.push(`💡 ${fillTokens(tips, lead)}`)
  return out.join('\n')
}

// Pick the opener variation that fits this lead — deterministic, by source +
// niche/title. Indeed dispatch-style roles → dispatcher opener; other Indeed →
// phone-coverage opener; Maps/other source → the Google-listing opener.
function pickOpener(openerSection, lead) {
  const v = openerSection.variations
  const hay = `${lead.niche || ''} ${lead.job_title || ''}`.toLowerCase()
  const isDispatch = /tow|dispatch|logistic|coordinator/.test(hay)
  if (lead.source === 'indeed') return isDispatch ? v[1] : v[0]
  return v[2]
}

// Build the "Call Now" cheat sheet for a lead: the SAME universal fixed script
// with this lead's details filled in. Fully deterministic — no AI call, no
// pain_points. Returns the 5 keys the call panels render
// (opener/problem/solution/objections/close).
export function buildCallScript(lead) {
  const byId = Object.fromEntries(DISCOVERY_SCRIPT.map(s => [s.id, s]))
  const opener = pickOpener(byId.opener, lead)
  return {
    opener:     sectionToText(opener.lines,           opener.tips,           lead),
    problem:    sectionToText(byId.discovery.lines,   byId.discovery.tips,   lead),
    solution:   sectionToText(byId.pain.lines,        byId.pain.tips,        lead),
    objections: sectionToText(byId.objections.lines,  byId.objections.tips,  lead),
    close:      sectionToText(byId.close.lines,        byId.close.tips,       lead),
  }
}
