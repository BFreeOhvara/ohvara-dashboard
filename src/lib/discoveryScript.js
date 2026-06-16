// ── The ONE universal call script — a DECISION TREE ──────────────────────────
// Single source of truth for the rep call flow. Rendered as the live "Call Now"
// cheat sheet (rep CallModal), the closer reference (AIScriptPanel), and the
// learning reference (Training Center). Every rep opens with the SAME fixed
// opener, then the prospect's response routes them down one branch (A–E). Every
// path ends the same way — booking Nate (the CLOSE block).
//
// Personalization = plugging THIS lead's business/niche/city + the rep's name
// into the tree's tokens; the words never change per lead, only the blanks.
//
// LINE MARKERS (the renderers style these):
//   "..."          a spoken line                       → bullet
//   BRANCH — ...    a decision point (yes/no fork)      → fork header
//   ↳ ...           a fork option / sub-branch          → indented, in color
//   ▸ ...           an action the rep takes (set status)→ action chip
//   → ...           a route to another block (e.g. CLOSE)→ routing line
//   tips            coach note                          → 💡 prose line
//
// `kind` places the section in the Call Now modal: 'opener' pins to the top,
// 'branch' scrolls in the middle, 'close' pins to the bottom (always visible).

// The fixed opener — word for word, every call. Only [Business Name] is filled.
export const FIXED_OPENER =
  `"Hey, is this [Business Name]? I saw y'all had a listing for a receptionist on Indeed — I was wondering who I should speak to about that?"`

export const DISCOVERY_SCRIPT = [
  {
    id: 'opener', kind: 'opener', short: 'Opener',
    title: 'Fixed Opener', trigger: 'Same words, every single call',
    goal: 'Sound like a person who saw their post — not a telemarketer. Ask for the right person, then listen.',
    color: 'var(--accent)', dim: 'rgba(108,99,255,0.08)', border: 'rgba(108,99,255,0.25)',
    lines: [
      FIXED_OPENER,
    ],
    tips: `Say it word for word, friendly and casual. You're not pitching — you're asking who to talk to. Then listen to WHO answers and HOW, and pick your branch below.`,
  },

  {
    id: 'branchA', kind: 'branch', short: 'A',
    title: 'Owner / Decision-Maker', trigger: `They're the owner, or "that's me / speaking"`,
    goal: 'You have the decision-maker. Diagnose the pain, then route to the close.',
    color: 'var(--success)', dim: 'rgba(34,197,94,0.08)', border: 'rgba(34,197,94,0.25)',
    lines: [
      `▸ You've got the decision-maker — go straight into discovery.`,
      `"Awesome — so the reason I'm reaching out: I work with a lot of [niche] businesses, and the ones hiring usually have calls slipping through the cracks. Mind if I ask you a couple quick questions?"`,
      `"Who's handling your calls right now when you and the crew are out on jobs?"`,
      `BRANCH — Do they have someone on the phones, or is it just them?`,
      `↳ IF THEY HAVE SOMEONE: "Got it — and when they're slammed, off, or it's after hours, where do those calls go?"`,
      `↳ IF IT'S JUST THEM: "So when you're heads-down on a job, that call's basically going to voicemail — fair to say?"`,
      `"Roughly how many calls a week would you say you're just not getting to?"`,
      `"And what's a typical job worth to you, start to finish — ballpark average ticket?"`,
      `"Have you tried anything to fix it — answering service, hiring someone before? How'd that go?"`,
      `"Even 2–3 missed jobs a week at [their ticket] each is real money walking to whoever picks up first. Does that surprise you?"`,
      `→ Go to CLOSE (book Nate).`,
    ],
    tips: `Write every answer in Call Notes — who answers now, calls/week, average ticket, what they've tried. That's exactly what Nate builds the fix from. The average-ticket number is gold.`,
  },

  {
    id: 'branchB', kind: 'branch', short: 'B',
    title: 'Gatekeeper', trigger: `Receptionist / office manager / employee answers`,
    goal: 'Reach the owner or get a clean callback. Never pitch the gatekeeper.',
    color: 'var(--info)', dim: 'rgba(56,189,248,0.08)', border: 'rgba(56,189,248,0.25)',
    lines: [
      `▸ Do NOT pitch the gatekeeper. Goal: reach the owner, or get a name + callback time.`,
      `BRANCH — Are they transferring you, or is the owner not available?`,
      `↳ IF TRANSFERRING: "Perfect, thank you so much." — stay on the line.`,
      `   ↳ When the owner picks up → run BRANCH A from the top.`,
      `↳ IF NOT AVAILABLE: "No worries at all — who's the best person to ask for? And is mornings or afternoons better to catch them?"`,
      `   ↳ "Great — I'll give them a call back then. Really appreciate your help!"`,
      `▸ Log the owner's name + best callback time in Call Notes; set status Follow-Up (or No Answer).`,
    ],
    tips: `Gatekeepers are allies, not obstacles. Warm, brief, get the name + best time, get off the phone. Pitching them just gets you screened out.`,
  },

  {
    id: 'branchC', kind: 'branch', short: 'C',
    title: '"Position\'s Already Filled"', trigger: `They say they already hired someone`,
    goal: 'Congratulate, then pivot to the real problem. Filling a seat ≠ fixing the leak.',
    color: 'var(--warning)', dim: 'rgba(245,158,11,0.08)', border: 'rgba(245,158,11,0.25)',
    lines: [
      `"Oh perfect — congrats! Sounds like business is picking up."`,
      `"Actually, the reason I reach out to [niche] businesses that are hiring is they're usually dealing with call volume or follow-up slipping through the cracks. Is that something you're running into at all?"`,
      `BRANCH — Did the pivot land — are they feeling a problem?`,
      `↳ IF YES: run the discovery + pain questions from BRANCH A, then → CLOSE.`,
      `↳ IF NO: "Totally fair — appreciate the minute. Have a good one."`,
      `   ▸ Set status Not Interested.`,
    ],
    tips: `A new hire still misses after-hours, lunch, and overflow calls — the pivot reopens the door without being pushy. If they're genuinely fine, exit clean; don't force it.`,
  },

  {
    id: 'branchD', kind: 'branch', short: 'D',
    title: 'Hostile / Hard No', trigger: `"Not interested," hangs up, or aggressive`,
    goal: 'Exit politely and protect the brand. Never push.',
    color: '#EF4444', dim: 'rgba(239,68,68,0.08)', border: 'rgba(239,68,68,0.25)',
    lines: [
      `"No worries at all — sorry to bother you. Have a good one."`,
      `▸ Set status Not Interested. Do not push, do not rebut.`,
    ],
    tips: `Never argue. A clean exit protects the brand and saves your energy for the next dial. One hard no is not worth ten minutes.`,
  },

  {
    id: 'branchE', kind: 'branch', short: 'E',
    title: 'Voicemail', trigger: `No pickup — goes to voicemail`,
    goal: 'Leave the fixed message, log it, move on.',
    color: '#94A3B8', dim: 'rgba(148,163,184,0.08)', border: 'rgba(148,163,184,0.25)',
    lines: [
      `Leave word for word:`,
      `"Hey, this is [Rep Name] calling — I came across your Indeed listing for a receptionist and wanted to reach out. Give me a call back when you get a chance at [your number]. Thanks!"`,
      `▸ Set status No Answer (voicemail) in the dropdown.`,
    ],
    tips: `Keep it short and warm — you're a person who saw their post, not a robocall. Say your callback number slowly, twice if you can.`,
  },

  {
    id: 'close', kind: 'close', short: 'Close',
    title: 'Close — Hand Off to Nate & Book', trigger: `Used at the end of Branch A and Branch C-yes`,
    goal: 'Position Nate as the specialist, deflect price, lock a specific time.',
    color: 'var(--accent)', dim: 'rgba(108,99,255,0.10)', border: 'rgba(108,99,255,0.30)',
    lines: [
      `IF THEY ASK ABOUT PRICE: "That's actually something our specialist Nate goes over — he'll look at everything you told me and put together exactly what makes sense for your business. That's why I want to get you two connected."`,
      `"Nate usually has openings in the mornings or afternoons — what works better for you?"`,
      `↳ ONCE THEY PICK: lock a specific day + time, then confirm it back —`,
      `   "Perfect — [day] at [time]. Nate will give you a call then. What's the best number to reach you?"`,
    ],
    tips: `Never price it yourself — that's Nate's job. Offer two windows, pin ONE exact time, confirm it back to them, then stop selling.`,
  },
]

// Substitute a lead's (and the rep's) real details into the tree's tokens.
// In-call choice placeholders ([their ticket], [day], [time], [your number])
// stay literal as rep guidance.
function fillTokens(text, lead, rep) {
  const biz   = lead.business_name || 'the business'
  const niche = lead.niche || 'service'
  const city  = lead.city || 'your area'
  const repName = (rep?.full_name || '').trim() || '[Rep Name]'
  return text
    .replace(/\[Business Name\]/gi, biz)
    .replace(/\[niche\]/gi, niche)
    .replace(/\[city\]/gi, city)
    .replace(/\[Rep Name\]/gi, repName)
}

// One section's lines + its coach tip, joined to text. Marker lines
// (BRANCH/↳/▸/→/•/-) keep their own prefix so the renderers can style them;
// plain spoken lines become "- " bullets. The coach tip trails as "💡 ".
function sectionToText(section, lead, rep) {
  const out = section.lines.map(l => {
    const filled = fillTokens(l, lead, rep)
    const t = filled.trimStart()
    if (/^(↳|▸|→|•|- |BRANCH\b|IF\b)/i.test(t)) return filled
    return `- ${filled}`
  })
  if (section.tips) out.push(`💡 ${fillTokens(section.tips, lead, rep)}`)
  return out.join('\n')
}

// Build the filled tree for a lead: a map of { sectionId: filledText } for
// every block (opener, branchA–E, close). Fully deterministic — no AI call.
// `rep` is optional (used to fill [Rep Name] in the voicemail).
export function buildCallScript(lead, rep) {
  const out = {}
  for (const section of DISCOVERY_SCRIPT) out[section.id] = sectionToText(section, lead, rep)
  return out
}
