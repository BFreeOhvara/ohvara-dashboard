// ── The ONE universal discovery script ───────────────────────────────────────
// Single source of truth for the question-based diagnostic model. Rendered as
// the learning reference on the Training Center page AND filled with a lead's
// real details for the "Call Now" cheat sheet (rep CallModal + closer
// AIScriptPanel). Every setter sees the SAME 5-section script — personalization
// means plugging THIS lead's business/niche/city/name into it, never generating
// different content per lead. Section colors match the Call Now modal so reps
// see the same color system in Training and on a live call.
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
          `"I was looking at your Indeed listing for the [receptionist/front desk/phone] position — how's that search going?"`,
          `If no Indeed listing: "I work with [niche] owners in [city] — quick question, are you the one who handles the phones when the crew's out on jobs?"`,
        ],
        tips: 'Slow down. Lower your tone. The goal of the opener is not to pitch — it is to earn the next 30 seconds.',
      },
      {
        label: `🚛 Indeed — Dispatcher/Coordinator Lead`,
        lines: [
          `"Hey, is this [Business Name]? [First name]? Perfect — super quick."`,
          `"I saw you're looking for a [dispatcher/coordinator/logistics] — is that because scheduling and routing calls is eating up your day?"`,
          `If no Indeed listing: "I work with [niche] owners in [city] — quick question, who's handling your dispatch and scheduling calls right now?"`,
        ],
        tips: `They posted the job because they're drowning in coordination. Let them say it — don't say it for them.`,
      },
      {
        label: `🗺️ Maps — No Website / Low Reviews Lead`,
        lines: [
          `"Hey, is this [Business Name]? [First name]? Perfect — real quick."`,
          `"I was actually looking at your Google listing — are you the owner?"`,
          `"Quick question — when someone finds you on Google and wants to reach out, where are they going right now?"`,
        ],
        tips: `They don't know they have a problem until you make them picture it. A customer who can't find your website calls your competitor instead.`,
      },
    ],
  },
  {
    id: 'discovery',
    title: 'Problem Discovery',
    goal: 'Get them talking about missed calls and lost jobs. Ask, then shut up.',
    color: 'var(--info)',    dim: 'rgba(56,189,248,0.08)',  border: 'rgba(56,189,248,0.25)',
    lines: [
      `"When a customer calls and everyone's on a job — what happens to that call?"`,
      `"Roughly how many calls a week would you say go to voicemail?"`,
      `"And of those, how many do you think actually leave a message versus just calling the next company on the list?"`,
      `"What's a typical job worth for you, start to finish — like, what's your average ticket?"`,
    ],
    tips: 'Every question should make the problem bigger in THEIR head. You are not telling them they have a problem — they are telling you. The average-ticket number is gold for Nate — it sizes the pricing.',
  },
  {
    id: 'pain',
    title: 'Pain Amplification',
    goal: 'Turn "yeah we miss some calls" into a dollar figure they can feel.',
    color: 'var(--warning)', dim: 'rgba(245,158,11,0.08)',  border: 'rgba(245,158,11,0.25)',
    lines: [
      `"Let's do quick math — if you're missing 8 calls a week and even 3 of those are real jobs at, what, $400 each? That's close to $5K a month walking to a competitor."`,
      `"And that's not counting the after-hours calls. What happens when someone calls at 7pm with a burst pipe?"`,
      `"Most owners I talk to know they're losing jobs — they just haven't put a number on it. Does that number surprise you?"`,
    ],
    tips: 'Use THEIR numbers from discovery, not yours. A number they gave you is a number they believe.',
  },
  {
    id: 'objections',
    title: 'Objection Handling',
    goal: 'Acknowledge, reframe, ask one more question. Never argue.',
    color: 'var(--danger)',  dim: 'rgba(239,68,68,0.08)',   border: 'rgba(239,68,68,0.25)',
    lines: [
      `"Not interested" → "Totally fair — most owners say that until they see the missed-call math. One question and I'll let you go: what happens to a call you can't answer right now?"`,
      `"Too busy" → "That's exactly why I called. This takes 15 minutes and it's about getting you hours back, not taking them."`,
      `"We have someone for that" → "Nice — does that cover after-hours and weekends too? That's usually where the gap is."`,
      `"Send me an email" → "Happy to — but honestly the email won't mean much without the numbers. Let's grab 15 minutes and I'll walk you through it live."`,
    ],
    tips: 'One objection handled well earns the close. Two objections means let go gracefully — leave the door open and log it as a callback.',
  },
  {
    id: 'close',
    title: 'Close / Book',
    goal: 'Ask for the 15-minute call. Offer two times. Confirm and get off the phone.',
    color: 'var(--success)', dim: 'rgba(34,197,94,0.08)',   border: 'rgba(34,197,94,0.25)',
    lines: [
      `"Look, I don't want to eat up your morning. Let's do a quick 15-minute call this week — I'll show you exactly how many calls you're missing and what they're worth."`,
      `"Does Tuesday afternoon or Thursday morning work better?"`,
      `After they pick: "Perfect — [day] at [time]. You'll get a text reminder. What's the best cell for that?"`,
    ],
    tips: 'Always offer two specific times — never "when works for you?". Confirm the number, confirm the time, end the call. Do not keep selling after the yes.',
  },
]

// Substitute a lead's real details into the script's tokens. Only lead-data
// tokens are filled — in-call choice placeholders ([receptionist/front desk/
// phone], [dispatcher/...], [day], [time]) stay literal as rep guidance.
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

// One section's lines (as "- " bullets) + its coach tip (as a trailing prose
// line). The Call Now modal renders "- " lines as bullets and other lines as
// prose; AIScriptPanel renders each line as a paragraph. Both handle this shape.
function sectionToText(lines, tips, lead) {
  const bullets = lines.map(l => `- ${fillTokens(l, lead)}`)
  if (tips) bullets.push(`💡 ${fillTokens(tips, lead)}`)
  return bullets.join('\n')
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

// Build the "Call Now" cheat sheet for a lead: the SAME universal 5-section
// script with this lead's details filled in. Fully deterministic — no AI call,
// no pain_points. Returns the 5 keys the call panels render
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
