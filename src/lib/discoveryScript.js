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

// The two pricing inputs the rep logs mid-call (Prompt 53, Change 3). A
// `data_collect` step renders these as number inputs in the live walk (PATCHed
// onto the lead) and as a non-interactive preview on the training canvas. Keys
// match the leads columns added in migration 050.
export const DATA_COLLECT_FIELDS = [
  { key: 'calls_missed_per_week', label: 'Calls missed / week', placeholder: 'e.g. 5' },
  { key: 'avg_ticket_value',      label: 'Avg ticket value ($)', placeholder: 'e.g. 300' },
]

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
      `"Awesome — so the reason I'm reaching out: I work with a lot of [niche] businesses, and the ones hiring usually have calls slipping through the cracks. Mind if I ask you a couple quick questions?"`,
      `"Who's handling your calls right now when you and the crew are out on jobs?"`,
      `BRANCH — Do they have someone on the phones, or is it just them?`,
      `↳ IF THEY HAVE SOMEONE: "Got it — and when they're slammed, off, or it's after hours, where do those calls go?"`,
      `↳ IF IT'S JUST THEM: "So when you're heads-down on a job, that call's basically going to voicemail — fair to say?"`,
      `"Roughly how many calls a week would you say you're just not getting to?"`,
      `"And what's a typical job worth to you, start to finish — ballpark average ticket?"`,
      `"Have you tried anything to fix it — answering service, hiring someone before? How'd that go?"`,
      `"What's costing you the most right now — missed calls, slow response, no-shows, or leads who called but never booked?"`,
      `"What do you have in place today to handle that?"`,
      `"Anything else slipping through the cracks?"`,
      `"Even 2–3 missed jobs a week at [their ticket] each is real money walking to whoever picks up first. Does that surprise you?"`,
      `⊞ Log the numbers — calls missed per week + average ticket. Both feed the custom stack Nate builds.`,
      `→ Go to CLOSE (book Nate).`,
    ],
    tips: `Write every answer in Call Notes AND the discovery fields below — who answers now, calls/week, average ticket, biggest pain, what they've tried, what else is slipping. That's exactly what Nate's custom stack gets built from. The average-ticket number is gold.`,
  },

  {
    id: 'branchB', kind: 'branch', short: 'B',
    title: 'Gatekeeper', trigger: `Receptionist / office manager / employee answers`,
    goal: 'Reach the owner or get a clean callback. Never pitch the gatekeeper.',
    color: 'var(--info)', dim: 'rgba(56,189,248,0.08)', border: 'rgba(56,189,248,0.25)',
    lines: [
      // ⚡ CC DRAFT (2026-06-22) — spoken opening line for gatekeeper. Pending Brayden + Nate review.
      `"Oh hey — is the owner or manager around? Just had a real quick question about how y'all handle phones right now."`,
      `▸ Keep it short and warm — your only goal is the owner's name and a callback time. Don't pitch.`,
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
      `↳ IF YES: → run BRANCH A from the top.`,
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
      `BRANCH — Did they ask about price?`,
      `↳ IF YES: "That's actually something our specialist Nate goes over — he'll look at everything you told me and put together exactly what makes sense for your business. That's why I want to get you two connected."`,
      `↳ IF NO:`,
      `"Nate usually has openings in the mornings or afternoons — what works better for you?"`,
      `▸ Once they pick a window, lock a specific time and confirm it back:`,
      `"Perfect — [day] at [time]. Nate will give you a call then. What's the best number to reach you?"`,
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
    if (/^(↳|▸|→|⊞|•|- |BRANCH\b|IF\b)/i.test(t)) return filled
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

// ── Click-through flow derivation (CONTENT-FREE) ─────────────────────────────
// Parses each section's EXISTING marker lines into a navigable step tree so the
// same script can drive a one-line-at-a-time guided walk (live Call modal +
// Training practice) WITHOUT changing a single spoken word. This is a pure view
// over DISCOVERY_SCRIPT — no forked/duplicated script data, no routing content
// added to the source. If the wording changes later (pending Brayden + Nate),
// the walk re-derives automatically as long as the line markers are preserved.
//
// Step shapes:
//   { type:'say',    text }                       a line to read aloud
//   { type:'action', text }                       a ▸ thing the rep does
//   { type:'route',  text, target }               jump to another block id
//   { type:'fork',   q, options:[{label, steps}] } tap the prospect's response

// Leading-whitespace depth of a source line (tabs counted as 3).
function leadingSpaces(s) {
  const m = s.match(/^([ \t]*)/)
  return m ? m[1].replace(/\t/g, '   ').length : 0
}

// A line that hands off to another block: "→ …", or any "run BRANCH x" /
// "→ CLOSE" reference embedded mid-line (the cross-branch routes).
function isRouteLine(t) {
  return /^→/.test(t) || /run\s+BRANCH\s*[A-E]/i.test(t) || /→\s*CLOSE/i.test(t) || /to\s+CLOSE/i.test(t)
}

// Resolve a route line to a target section id. A branch reference wins (e.g.
// "run BRANCH A" → branchA, which itself ends by routing to the close);
// otherwise it points at the close.
function routeTarget(t) {
  const b = t.match(/BRANCH\s*([A-E])/i)
  if (b) return 'branch' + b[1].toUpperCase()
  return 'close'
}

// "THEY HAVE SOMEONE" → "They have someone"; used for the tap-button labels.
function optionLabel(s) {
  const x = s.trim()
  return x.charAt(0).toUpperCase() + x.slice(1).toLowerCase()
}

function shorten(s) {
  const x = s.replace(/^["']|["']$/g, '').trim()
  return x.length > 42 ? x.slice(0, 40).trimEnd() + '…' : x
}

// Turn one trimmed marker line into a step. Marker is detected, then stripped
// from the display text so the UI styles it (a ▸ chip, a route button, …).
function makeStep(t, lead, rep) {
  // ⊞ — an inline data-collection step (Prompt 53). Fixed two-field set.
  if (/^⊞/.test(t)) {
    return { type: 'data_collect', title: fillTokens(t.replace(/^⊞\s*/, ''), lead, rep), fields: DATA_COLLECT_FIELDS }
  }
  const route = isRouteLine(t)
  const action = /^▸/.test(t)
  const sub = /^↳/.test(t)
  const clean = t.replace(/^(↳|▸|→)\s*/, '')
  const text = fillTokens(clean, lead, rep)
  if (route)  return { type: 'route', text, target: routeTarget(t) }
  if (action) return { type: 'action', text }
  return { type: 'say', text, ...(sub ? { sub: true } : {}) }
}

// Recursive descent over lines[start..]: collect steps at indent ≥ baseIndent,
// returning { steps, next }. A "BRANCH —" opens a fork; the sibling ↳ lines are
// its tap options, and each option's deeper-indented lines are its child steps.
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
        const m = body.match(/^IF\s+([^:]+):\s*(.*)$/i) || body.match(/^([^:]{1,32}):\s+(.*)$/)
        const label = m ? optionLabel(m[1]) : shorten(body)
        const rest = m ? m[2] : body
        const optSteps = []
        if (rest && rest.trim()) optSteps.push(makeStep(rest.trim(), lead, rep))
        i++
        const child = parseSteps(lines, i, optIndent + 1, lead, rep)
        optSteps.push(...child.steps)
        i = child.next
        options.push({ label, steps: optSteps })
      }
      steps.push({ type: 'fork', q, options })
      continue
    }

    steps.push(makeStep(t, lead, rep))
    i++
  }
  return { steps, next: i }
}

// Derive the full navigable flow for a lead. Returns the opener, the ordered
// branches, the close, and a byId map — every block carries its parsed `steps`
// plus the display metadata (color/label/trigger/goal/tips) from the source.
// Each branch also gets derived flags for the flowchart: `booksNate` (it has a
// path that routes onward to the close) and `outcome` (the status it ends on).
export function buildScriptFlow(lead, rep) {
  const byId = {}
  for (const section of DISCOVERY_SCRIPT) {
    const { steps } = parseSteps(section.lines, 0, 0, lead, rep)
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
    branches: DISCOVERY_SCRIPT.filter(s => s.kind === 'branch').map(s => byId[s.id]),
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
