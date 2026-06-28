// ── Setter script v2 — branching discovery flow ───────────────────────────────
// Built from S1–S5 transcript research. Every spoken line is exactly what the
// setter reads. No meta text, no instructions. No closer name — "our team" / "we."
// Dynamic tokens: [Business Name], [First Name], [niche] filled from the lead.
// In-call tokens: [their number], [their estimate], [day], [time], [Tuesday morning],
// [Wednesday afternoon] stay literal as rep guidance during the call.
//
// LINE MARKERS (renderers style these):
//   plain string     a spoken line                      → bullet
//   BRANCH — ...     a decision point (fork)             → fork header
//   ↳ IF ...: ...    a fork option (indented = child)    → indented option
//   ▸ ...            a rep action (set status, log)      → action chip
//   → ...            route to another section            → route step
//   ⊞ ...            data-collect step (inline)          → number inputs
//
// `kind`: 'opener' pins to top, 'branch' scrolls middle, 'close' pins bottom.

export const DATA_COLLECT_FIELDS = [
  { key: 'calls_missed_per_week', label: 'Missed calls / week',   placeholder: '8' },
  { key: 'avg_ticket',            label: 'Average job value ($)', placeholder: '350' },
]

const DATA_COLLECT_STEP = {
  type: 'data_collect',
  label: 'Qualifying Numbers',
  hint: 'Ask and fill in before continuing',
  fields: DATA_COLLECT_FIELDS,
}

export const FIXED_OPENER =
  `"Hey, is this [Business Name]? Is [First Name] around?"`

export const DISCOVERY_SCRIPT = [
  {
    id: 'opener', kind: 'opener', short: 'Opener',
    title: 'Open the Call', trigger: 'Same words, every call — confirm you have the right person',
    goal: 'Get to the owner. If gatekeeper, get a callback. If owner, bridge to the gap question.',
    color: 'var(--accent)', dim: 'rgba(108,99,255,0.08)', border: 'rgba(108,99,255,0.25)',
    lines: [
      `"Hey, is this [Business Name]? Is [First Name] around?"`,
      `BRANCH — Who answers?`,
      `↳ IF Yes / speaking: "Hey [First Name] — saw you guys have a listing up for a [niche] receptionist. Quick question about how you're handling calls while that search is going — you got a minute?"`,
      `   BRANCH — Do they engage?`,
      `   ↳ IF Sure / go ahead: "Quick question — while that search is going, what's actually happening right now when a call comes in and nobody's free to grab it?"`,
      `      → Go to Vitals Check`,
      `   ↳ IF What's this about? / I'm busy: "I know this is out of nowhere — you can totally tell me you're slammed and I'll let you go. Quick question first though: while you're looking for that person, who's catching the phones when your team's tied up?"`,
      `      BRANCH — Do they engage now?`,
      `      ↳ IF They engage: "Quick question — while that search is going, what's actually happening right now when a call comes in and nobody's free to grab it?"`,
      `         → Go to Vitals Check`,
      `      ↳ IF Not interested: ▸ Set status Not Interested.`,
      `↳ IF They're not in / who's calling?: "No worries — do you know when they'd be back? I'll give them a call then."`,
      `   ▸ Set status Follow-Up (log callback time).`,
    ],
    tips: `Warm and casual — you're someone who saw their job post, not a pitch machine. Your only goal in the opener: get to the bridge question ("what's actually happening when a call comes in?"). Everything else is just navigation.`,
  },

  {
    id: 'vitals', kind: 'branch', short: 'Vitals',
    title: 'Vitals Check', trigger: `They answered the bridge question — now map their situation`,
    goal: 'Understand the setup: who covers calls, volume, leakage, ticket value, what they\'ve tried, why now.',
    color: 'var(--accent)', dim: 'rgba(108,99,255,0.08)', border: 'rgba(108,99,255,0.25)',
    lines: [
      `"Most [niche] owners I talk to, their crew's out on jobs and the calls are the thing that slips through the cracks the most — even after they've tried to fix it. Is that kind of the situation, or is it something different for you?"`,
      `"Walk me through what happens right now when a call comes in — who picks it up?"`,
      `"On a normal day, how many calls are you getting in?"`,
      `"And when nobody gets to it, where does it go — voicemail, a cell? Does it ever just not get picked up at all?"`,
      `"How often does that happen — in a given week?"`,
      `"Do you have a rough sense of what one of those calls is worth if it turns into a job?"`,
      `"So if a handful of those are slipping through every week — what's that running you a month?"`,
      `"What's kept you from solving it before now — just the timing, or is it harder than it looks to find the right person?"`,
      `"What made now the time to post for this — was there a specific moment, or has it just been building?"`,
      `⊞ Log the numbers — calls missed per week + average ticket`,
      `→ Go to Pain Amplification`,
    ],
    captures: [
      { match: 'how many calls are you getting', field: 'calls_missed_per_week', label: 'Missed calls / week', placeholder: 'e.g. 10' },
      { match: 'what one of those calls is worth', field: 'avg_ticket', label: 'Avg job value ($)', placeholder: 'e.g. 300' },
    ],
    tips: `Ask and listen. Goal: clear picture of who covers calls, how many slip per week, rough ticket value, and what they've tried. Every answer feeds what our team builds for them. Don't skip the "why now" — it tells you how motivated they are.`,
  },

  {
    id: 'pain', kind: 'branch', short: 'Pain',
    title: 'Pain Amplification', trigger: `You have their vitals — now help them see the gap clearly`,
    goal: 'Surface the real cost. Get them to say a number out loud, then project it forward.',
    color: 'var(--warning)', dim: 'rgba(245,158,11,0.08)', border: 'rgba(245,158,11,0.25)',
    lines: [
      `"So on one side — what's been slipping. On the other — every call caught, every job booked. What does that gap actually look like?"`,
      `BRANCH — How engaged are they?`,
      `↳ IF They gave real numbers / engaged: "So just to make sure I've got this right — when it goes to voicemail, that's not just a missed call. That's probably a job that goes to whoever picks up next. Is that kind of what you're seeing?"`,
      `   BRANCH — Do they confirm?`,
      `   ↳ IF Yeah, exactly / sometimes: "So on one side — [their number] calls a week going unanswered, [their estimate] per job. On the other side, every one of those gets picked up, every estimate gets booked. What does that gap look like over a month?"`,
      `      "If nothing changed — same volume, same leakage — what does that add up to by this time next year?"`,
      `      "And if that gap closed — every call answered, no jobs slipping — what would that actually change for [Business Name] day to day?"`,
      `      → Go to Handoff`,
      `↳ IF Vague / not sure / minimizing: "Most [niche] owners I talk to, even when they feel on top of it, are losing three to five jobs a week they never even know about. Does that resonate at all, or do you feel like you've got it covered?"`,
      `   BRANCH — Does it land?`,
      `   ↳ IF Yeah, probably / fair: "So on one side — [their number] calls a week going unanswered, [their estimate] per job. On the other side, every one of those gets picked up, every estimate gets booked. What does that gap look like over a month?"`,
      `      "If nothing changed — same volume, same leakage — what does that add up to by this time next year?"`,
      `      "And if that gap closed — every call answered, no jobs slipping — what would that actually change for [Business Name] day to day?"`,
      `      → Go to Handoff`,
      `   ↳ IF We're fine / not a big deal: → Go to Handoff`,
    ],
    tips: `You're not closing — you're helping them see the math. Use their own numbers back at them. If they minimize, name the pattern ("three to five jobs a week they never even know about") and let them confirm or deny. Then move to handoff regardless.`,
  },

  {
    id: 'handoff', kind: 'branch', short: 'Handoff',
    title: 'Handoff & Book', trigger: `Pain is established — position our team and lock a time`,
    goal: 'Hand off everything they told you. Get a specific day and time. Handle pushback calmly.',
    color: 'var(--success)', dim: 'rgba(34,197,94,0.08)', border: 'rgba(34,197,94,0.25)',
    lines: [
      `"Okay — here's what I want to do. Everything you just told me — the volume, what's slipping, your typical job value — I'm going to pass all of that to our team, who works specifically with [niche] businesses on this exact problem."`,
      `"They're going to review your situation before the call and put together what would actually make sense for [Business Name] — not some generic package. It's 15 minutes."`,
      `"Does [Tuesday morning] or [Wednesday afternoon] work better for you?"`,
      `BRANCH — How do they respond?`,
      `↳ IF They pick a time: → Go to Close (lock the time and confirm)`,
      `↳ IF Neither / let me think / just send info: → Go to Objections`,
      `↳ IF No time this week: → Go to Objections`,
      `↳ IF Who is this / what company?: → Go to Objections`,
      `↳ IF How much does it cost?: → Go to Objections`,
    ],
    tips: `Two windows — never open-ended. If they pick one, move straight to Close. If they push back, go to Objections — it's one extra step, not a rejection. Stay calm.`,
  },

  {
    id: 'objections', kind: 'branch', short: 'Objections',
    title: 'Booking Objections', trigger: `They pushed back on the time — handle and loop back to book`,
    goal: 'Handle each objection, then re-ask for the time. Every track ends with "Tuesday or Wednesday?"',
    color: 'var(--danger)', dim: 'rgba(239,68,68,0.08)', border: 'rgba(239,68,68,0.25)',
    lines: [
      `BRANCH — What's the objection?`,
      `↳ IF Just send me info / want to see something first: "Yeah, totally — I can do that. The thing is, anything I send is going to be pretty generic. The stuff that actually matters is specific to what you just told me about your setup — that's exactly what our team would be working from. Easier to just grab 15 minutes and have them walk you through it directly."`,
      `   BRANCH — Do they agree?`,
      `   ↳ IF Okay, fair: "Does [Tuesday morning] or [Wednesday afternoon] work better for you?"`,
      `      → Go to Close`,
      `   ↳ IF I still want to see something: "Can I ask — are you actually going to read it? Because I know how packed inboxes get, and I don't want to put something together that just disappears in there. That's why I'd rather get you 15 minutes with someone who can actually answer your questions."`,
      `      BRANCH — Still pushing for it?`,
      `      ↳ IF Okay fine: "Does [Tuesday morning] or [Wednesday afternoon] work better for you?"`,
      `         → Go to Close`,
      `      ↳ IF Yeah, still want it: "Okay — I'll send it over today. And I'm going to drop a 15-minute placeholder on your calendar for [day]. If you read it and it's not worth your time, just decline — no hard feelings. If it's interesting, we're already set."`,
      `         ▸ Set status Follow-Up (send email + placeholder).`,
      `↳ IF No time this week / I'm slammed: "No problem — what works better, [Tuesday of next week] or [Wednesday of next week]?"`,
      `   BRANCH — Do they pick a day?`,
      `   ↳ IF Picks a day: "Does morning or afternoon work better on [day]?"`,
      `      → Go to Close`,
      `   ↳ IF Those don't work either: "Got it — what's a better week for you?"`,
      `      ▸ Set status Follow-Up (log the week they gave).`,
      `↳ IF Who is this / what company?: "We work with [niche] businesses specifically on the call-coverage issue we just walked through. Our team builds out what that looks like for your exact setup — that's the point of the call."`,
      `   "Does [Tuesday morning] or [Wednesday afternoon] work better for you?"`,
      `   → Go to Close`,
      `↳ IF How much does it cost?: "Honestly depends on your call volume and setup — which is exactly what our team figures out on the call. That's why I didn't want to guess at a number before they've seen your actual situation."`,
      `   BRANCH — Do they push for a ballpark?`,
      `   ↳ IF Okay: "Does [Tuesday morning] or [Wednesday afternoon] work better for you?"`,
      `      → Go to Close`,
      `   ↳ IF I just need a ballpark: "The range is wide depending on what you need, which is exactly why the call is worth 15 minutes — they'll give you a real number based on what you just told me."`,
      `      "Does [Tuesday morning] or [Wednesday afternoon] work better for you?"`,
      `      → Go to Close`,
    ],
    tips: `Every track ends the same: "Tuesday or Wednesday?" Handle the objection, then re-ask. Stay calm — objections are navigation, not rejection. Never pitch on price yourself; always redirect to the call.`,
  },

  {
    id: 'close', kind: 'close', short: 'Close',
    title: 'Lock the Time', trigger: `They said yes to a day — confirm time, get number, done`,
    goal: 'Pin the exact time. Get their best number. Give them confidence. Stop talking.',
    color: 'var(--accent)', dim: 'rgba(108,99,255,0.10)', border: 'rgba(108,99,255,0.30)',
    lines: [
      `"What time on [day] works — morning or afternoon?"`,
      `"[Day] at [time] — perfect. I'll send you a quick text right now to confirm. What's the best number for that?"`,
      `"Got it. Our team will have everything you told me today in front of them before the call — you won't have to re-explain anything."`,
      `▸ Set status Appointment Booked. Log the time and number.`,
    ],
    tips: `Confirm the day and time back clearly. Get their number. Then stop talking — they're booked. Don't add more selling after the yes.`,
  },
]

// Substitute a lead's real details into the tree's tokens.
// In-call placeholders ([their number], [their estimate], [day], [time], etc.)
// stay literal as rep guidance during the call.
function fillTokens(text, lead, rep) {
  const biz       = lead.business_name || 'the business'
  const niche     = lead.niche || 'service'
  const city      = lead.city || 'your area'
  const firstName = lead.first_name || lead.contact_name || '[First Name]'
  const repName   = (rep?.full_name || '').trim() || '[Rep Name]'
  return text
    .replace(/\[Business Name\]/gi, biz)
    .replace(/\[First Name\]/gi, firstName)
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
  if (/objection/i.test(t))  return 'objections'
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

// Attach capture configs to matching say steps (recursive over fork options).
function attachCaptures(steps, captures) {
  for (const s of steps) {
    if (s.type === 'say' && captures) {
      for (const c of captures) {
        if (s.text.toLowerCase().includes(c.match.toLowerCase())) {
          s.capture = { field: c.field, label: c.label, placeholder: c.placeholder }
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
