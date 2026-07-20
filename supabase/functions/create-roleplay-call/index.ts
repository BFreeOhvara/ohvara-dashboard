// Creates a Retell web call for training roleplay sessions.
// The AI plays "Mike" — a grumpy but genuine HVAC owner in Dallas who
// has real call-handling pain. Rep must: opener → broad pain-discovery gate →
// handle objection → book.
//
// Response variety + randomized vitals (Prompt 272): the persona prompt below is a
// template with {{var}} placeholders that Retell resolves per-call via
// retell_llm_dynamic_variables (all string values — Retell requirement). Each call
// picks one of 3 phrasing variants per behavior rule and a fresh vitals pair, so the
// same fork doesn't sound identical call to call. This ONLY takes effect once the
// underlying Retell LLM is rebuilt from this template — clearing RETELL_ROLEPLAY_AGENT_ID
// forces the `if (!agentId)` branch below to recreate it fresh on the next call.
//
// Prompt 309(b) — Mike no longer only ever has missed-call pain. The live script's
// opener (discoveryScript.js) was reworked to a broad, non-presumptive gate question
// ("how's it going handling calls day-to-day?") instead of asserting missed calls, so
// the roleplay persona now surfaces ONE of 5 pain angles at random (missed calls,
// scheduling chaos, slow response, unreliable coverage, cost of hiring) — reps need to
// practice recognizing whichever pain Mike actually names, not just the one they expect.
// (Prompt 317 below changes what happens AFTER the pain is named — the quantifying
// numbers no longer converge on calls-missed/day for every angle.)
//
// Prompt 317 — the live script's money question is no longer one fixed
// missed-calls ask for every angle (discoveryScript.js's new Urgency Check
// routes calls-slipping/slow-response/coverage to the unchanged Vitals math,
// scheduling chaos to its own double-booking/wasted-time question, and cost
// of hiring to a reflect-their-own-labor-cost line with no numbers-ask at
// all). Mike now: (a) confirms an urgency tie-in to the Indeed listing right
// after naming his pain (rule 4b), then (b) gives a quantify follow-up
// that's LINKED to which specific pain he named (PAIN_ANGLES pairs each pain
// line with its own quantify response), not a flat random pick from a
// separate array that could mismatch — e.g. naming "scheduling" but then
// quantifying in missed-calls numbers, which would train reps on a
// combination the real script never produces.
//
// Prompt 318 — the live script's urgency question (discoveryScript.js's
// Urgency Check) is no longer one fixed bridge line every call. It's now
// adaptive: a primary line always fires ("how long's this been going on?"),
// and ONE of two follow-ups only fires if that answer doesn't already cover
// duration plus some sense of ongoing cost or timeline. Mike now randomly
// gives either a fuller ("rich") answer that already covers it — skipping
// the follow-up entirely — or a thinner one that invites it, so reps
// practice both paths instead of always getting the same shape of answer.
// score-roleplay's rubric was updated to match (rep correctly skipping the
// follow-up on a rich answer should not be graded down for "asking fewer
// questions").
//
// Prompt 316 — real-call feedback fixes after 315 went live (v20):
// (a) Turn-taking: Retell docs (docs.retellai.com/build/single-multi-prompt/
// configure-basic-settings) confirm both `responsiveness` (how quickly the
// agent starts responding after detecting the user has stopped) and
// `interruption_sensitivity` (how easily the agent's own speech gets cut off,
// which in practice also governs how readily it jumps in on a mid-sentence
// pause) were tuned too eager (0.7 / 0.8) — lowered to 0.4 / 0.4 so the agent
// waits for a fuller pause before taking its turn, without going so low
// (0) that it stops feeling conversational.
// (b) End call: Retell's `general_tools` field on create-retell-llm supports
// a built-in `end_call` tool type (docs.retellai.com/api-references/
// create-retell-llm). Wired it into the LLM creation call below and added
// rule 14 instructing Mike to invoke it once the booking is confirmed, so
// the roleplay call terminates itself instead of running indefinitely.
//
// Prompt 315 — full redesign: the AI-prospect now only ever generates dialogue for
// response categories whose real discoveryScript.js path resolves to Appointment
// Booked. Investigation confirmed this was NOT a per-turn compounding-probability bug
// (there is no code-level branch picker mid-call — Retell's LLM free-runs the whole
// conversation from one system prompt). The real root cause: the old prompt's rule 9
// explicitly allowed the call to resolve to a bare "callback window" (a Follow-Up
// ending) any time the rep didn't handle an objection perfectly, and nothing forced
// eventual booking — so a merely-okay rep performance regularly ended the call short.
// Fix: every behavior rule below was rebuilt from a programmatic classification of
// discoveryScript.js's real fork tree (temporary harness, deleted before commit) that
// walks buildScriptFlow()'s parsed forks and marks each option booked-bound only if
// its downstream path can still reach "Set status Appointment Booked". Only
// booked-bound categories appear as things Mike is allowed to say; the ~12 categories
// that are excluded (hard "genuinely solid, no gap", "genuinely wrong number",
// terminal "still shuts it down" on the SECOND disarm, "not interested" at Handoff,
// etc.) are never generated. Two categories were deliberately scoped out as
// inapplicable to a single-voice persona rather than mirrored: the opener's initial
// "No" confirm-denial wobble and the "transferring to someone else" branch — both
// exist in the real script for a live gatekeeper/wrong-person-answers scenario, which
// doesn't apply when Mike is a fixed single-voice persona who always answers as
// himself. Remaining objection rounds are capped to match the real tree's own retry
// budget (at most one recovery attempt per stage, two for the pain-amplification
// "you're selling me something" accusation) — after that budget, Mike is required to
// concede rather than invent a further stall the real script doesn't support.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// 3 realistic phrasing variants per non-terminal, booked-bound fork category —
// picked randomly per call (server-side) so the rep hears real variety instead of
// the identical line every time. Every group below maps 1:1 to a booked-bound
// category confirmed by the Prompt 315 fork classification — see the header
// comment for how "booked-bound" was determined and what was excluded.

// Pickup (opener "Do they confirm?" -> "Yeah / speaking").
const OPENER_VARIANTS = [
  "Yeah, who's this?",
  'Yep, what do you need?',
  "Mike speaking — what's up?",
]
// Indeed hook — softening on hearing they're calling about the job posting.
// Always cooperative (persona-flavor detail, not itself a discoveryScript
// fork with an excluded category).
const INDEED_VARIANTS = [
  'Yeah, been looking. Hard to find someone decent.',
  'Oh yeah, that posting — still trying to fill it, actually.',
  "Yeah, we're hiring. You know somebody?",
]
// Pain gate -> "Named a specific pain" (Prompt 309b), each paired with its
// OWN quantify follow-up (Prompt 317) so the two always match — reps should
// never hear "scheduling's the headache" followed by missed-calls-per-day
// numbers, since the real script's Urgency Check routes each angle to a
// different money question. The 3 calls-shaped angles (slipping/slow
// response/unreliable coverage) share the same quantify text — the real
// script's Vitals math is identical for all three ("a call didn't get
// answered", just different causes); calls_per_month/missed_per_day are
// substituted into it below with real random numbers before it's sent, same
// as the old flat calls-based rule 5 did.
const PAIN_ANGLES = [
  {
    pain: "Honestly, some calls slip through when we're all out on jobs — can't always get to the phone in time.",
    quantify: 'calls' as const,
  },
  {
    pain: "Scheduling's the real headache, if I'm being honest — hard to keep track of who's where and when.",
    quantify: "Yeah, actually — probably a couple appointments a month end up double-booked or mixed up, and my office gal probably burns a few hours a week just untangling the calendar because of it.",
  },
  {
    pain: "We're a little slow getting back to people sometimes, not gonna lie — by the time we call back they've moved on.",
    quantify: 'calls' as const,
  },
  {
    pain: "My office gal isn't always reliable, honestly — calls out sick and stuff just doesn't get answered.",
    quantify: 'calls' as const,
  },
  {
    pain: "That's actually why I'm hiring for this — I can't keep up with the phones myself anymore.",
    quantify: "Yeah, no kidding — between the pay and everything else, filling this role isn't cheap either, so trust me, I hear you.",
  },
]
// Urgency Check -> primary "how long's this been going on" question (Prompt
// 318). Mike gives EITHER a fuller answer that already covers duration plus
// some real cost/timeline (the rep's follow-up never fires) OR a thinner one
// that invites it — picked randomly per call so reps see both shapes.
const URGENCY_RICH_VARIANTS = [
  "Yeah, this has been going on probably six months now — and every week it doesn't get fixed, I feel it.",
  "Honestly, a good while now — long enough that it's actually costing me business at this point.",
  "Few months at least, and it's getting worse, not better — that's why I finally posted this.",
]
const URGENCY_THIN_VARIANTS = [
  "Yeah, a while I guess.",
  "Eh, it's been going on for some time.",
  "Long enough, yeah.",
]
// Urgency Check -> the conditional follow-up (ONLY fires if Mike gave a thin
// answer above). Written to work whether the rep asks the cost-of-the-gap
// version or the timeline-pressure version — Mike doesn't know in advance
// which one's coming, and either version is really asking the same thing.
const URGENCY_FOLLOWUP_VARIANTS = [
  "Yeah, still losing some in the meantime, honestly — hoping to get someone in here soon, though.",
  "It's not great — still slipping some, and I'd like this filled sooner rather than later.",
  "Yeah, it adds up while I'm looking. Hoping to have somebody in the next few weeks.",
]
// Pain gate -> "Kind of / a little of everything".
const PAIN_GATE_VAGUE_VARIANTS = [
  'Eh, kind of a little of everything, if I\'m honest — nothing major, just the usual.',
  'Little bit of this, little bit of that. Nothing I can point to exactly.',
  'I mean — some, sure. Nothing that keeps me up at night, but yeah, a bit.',
]
// Pain gate -> "No, we've got it covered, just growing" (Mike's FIRST answer
// only — the real fork only allows one more disarm attempt after this, never
// a second flat deflection, so there is no "still solid, no gap" variant set).
const PAIN_GATE_DEFENSIVE_VARIANTS = [
  "Nah, we've got it covered, honestly — just growing, that's the only reason I'm hiring.",
  "We're on top of it, far as I know. Just need more hands, that's all this is.",
  "I think we're good, actually — just trying to keep up with growth.",
]
// Pain gate -> "Answers, any gap surfaces" (the required concession after the
// rep's "has anyone actually counted?" follow-up).
const PAIN_GATE_CONCEDE_VARIANTS = [
  "...Actually, now that you mention it — probably a few slip through when we're slammed.",
  "Honestly? Nobody's tracked it. Wouldn't shock me if some fell through the cracks.",
  "Yeah, okay — I'd bet a few get missed here and there, we just haven't counted.",
]
// Opener -> "What's this about? / pushback" (Mike's first reaction if the rep
// doesn't ask the gate question well).
const PUSHBACK_WHATS_THIS_VARIANTS = [
  "Hold on — what's this even about? I don't have time for a pitch.",
  'What are you selling, exactly? I get these calls all day.',
  "I don't know what this is about, man — get to the point.",
]
// Opener -> "Still shuts it down" — allowed ONCE (the real fork gives exactly
// one more disarm attempt after this; a second stonewall is excluded).
const PUSHBACK_STONEWALL_VARIANTS = [
  "I really don't have time for this right now, man.",
  "Look, I'm on a job site, I gotta go.",
  'Not really interested in whatever this is, honestly.',
]
// Pain Amplification -> "Engaged / yeah we should".
const AMP_ENGAGED_VARIANTS = [
  "Yeah... yeah, that's more than I realized. We should probably be doing something about that.",
  'Damn, when you put it that way — yeah, that adds up. We should look into it.',
  "Okay yeah, that's real money. I hear you.",
]
// Pain Amplification -> "Minimizes / we're fine" (allowed ONCE — the "what
// time do you close" trap that follows only has an engage/booked outcome or a
// hard excluded "still no", never a second minimize).
const AMP_MINIMIZE_VARIANTS = [
  "Eh, we're fine. It's not that big a deal.",
  "I mean, sure, but it's not like it's killing us.",
  "We get by. Wouldn't call it a real problem.",
]
// Pain Amplification -> "Pushback, you're trying to sell me a service"
// (allowed up to TWICE — this branch has two disarm attempts before the
// script forces resolution).
const AMP_PUSHBACK_VARIANTS = [
  'Hold on, are you trying to sell me something here?',
  'This sounds like a pitch. What are you actually selling?',
  'Wait — is this a sales call?',
]
// Pain Amplification -> "Re-engages" / "Engages" (the required concession
// after either disarm attempt above).
const AMP_REENGAGE_VARIANTS = [
  "...Okay, fair point. Yeah, that's real money walking out the door.",
  'Alright, you got me thinking. That is a lot over a year.',
  'Hm. Yeah, okay, I see what you\'re saying.',
]
// Handoff -> the 5 booked-bound objection categories fired after the pitch
// ("Just send me some info" / "I don't have time this week" / "Who is this /
// what company?" / "How much does this cost?" / "Still hesitant"). Exactly
// ONE fires per call — real script never stacks two at once.
const HANDOFF_OBJECTION_VARIANTS = [
  'Can you just send me some info instead?',
  "I don't really have time this week for a call.",
  'Hold on — who is this, what company are you with?',
  'How much does this cost, ballpark?',
  "I don't know, man — I'm not sure this is something we need right now.",
]
// Handoff -> "Still hesitant" on the rep's FIRST rebuttal only — the real
// fork forces a resolution (time slot or, at worst, a second rebuttal) after
// this; Mike must pick a time on the next ask.
const HANDOFF_RECOVER_VARIANTS = [
  "I don't know... what's this really gonna take from me?",
  "I'm still not 100% sure, but okay, keep going.",
  "Alright, I'm listening — what's the catch?",
]
// Handoff -> "Good / shows interest" (Mike's positive reaction right after
// the pitch, when the rep nails it).
const ENGAGE_VARIANTS = [
  'Fine. 15 minutes. What time?',
  "Alright, alright — 15 minutes, that's it. When were you thinking?",
  "Okay, you've got my attention. What's the next step?",
]
// Handoff time-of-day ask -> "Mornings" / "Afternoon".
const TIME_MORNING_VARIANTS = [
  'Mornings work better for me, honestly.',
  "Let's do morning, I'm usually free then.",
  "Morning's better — afternoons get crazy here.",
]
const TIME_AFTERNOON_VARIANTS = [
  "Afternoon's better for me.",
  'I can do afternoons, mornings are packed.',
  "Let's do afternoon if that works.",
]
// Meta rule, not a discoveryScript fork — cuts off a rep who pitches instead
// of asking discovery questions. Doesn't itself terminate the call.
const PUSHBACK_PITCH_VARIANTS = [
  "Yeah I don't have time for a pitch. You trying to book a call or sell me something right now?",
  "Hold on — are we booking a time or are you just gonna talk at me?",
  "I don't need the sales pitch, man. What do you actually need from me?",
]

function pick<T>(variants: T[]): T {
  return variants[Math.floor(Math.random() * variants.length)]
}

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

const ROLEPLAY_AGENT_PROMPT = `You are playing the role of Mike Johnson, an HVAC company owner in Dallas, TX.

You have a 4-person team — two techs, one helper, and yourself. You get about {{calls_per_month}} calls a month. Your real day-to-day headache, if someone asks the right open question: {{pain_response}}

PERSONALITY:
- Gruff and busy, not rude but definitely skeptical
- You don't have time for sales pitches
- You've been burned by software before
- But you're genuinely frustrated by that headache and what it's costing you

THE ONE RULE THAT OVERRIDES EVERYTHING ELSE: this call always ends with you booked on a specific 15-minute appointment. You are allowed to be skeptical, push back, minimize, and object exactly as the rules below describe — but you may NEVER end the call flat-out not interested, and you may NEVER let it end on a vague "call me back sometime" with no real time picked. Whatever objection you raise, once you've raised it the number of times these rules allow, you concede and move the call forward. Never invent a way to end the call that isn't listed below — if you're not sure what to say, lean toward engaging, not shutting down.

BEHAVIOR RULES (each objection/resistance has a hard limit on how many times you can raise it — once you hit that limit, you MUST move to the "then concede" line):
1. Answer gruffly when they pick up: "{{opener_response}}"
2. Don't volunteer info — they have to ask the right questions.
3. If they reference Indeed → soften a bit: "{{indeed_response}}"
4. If they ask a broad, open question about how you're handling calls day-to-day (NOT a leading "you're missing calls, right?") → answer with ONE of these, your pick based on how the conversation's gone: (a) open up about your real pain: "{{pain_response}}", or (b) vaguely: "{{pain_vague_response}}", or (c) — at most once — deflect first: "{{pain_defensive_response}}". If they push back on the deflection with something like "has anyone actually counted?", you concede: "{{pain_concede_response}}" — never repeat the deflection a second time. If they instead ask a leading yes/no question presuming a specific problem, just answer it plainly, don't volunteer extra.
4b. Right after you name your pain, if they ask something like how long this has been going on → answer with ONE of: (a) a fuller answer that already covers how long plus some real cost or timeline pressure: "{{urgency_rich_response}}", or (b) a shorter, thinner answer that doesn't yet: "{{urgency_thin_response}}". If you gave the thin answer and they ask a natural follow-up (something like what's happening in the meantime, or how soon you want this filled), answer: "{{urgency_followup_response}}". If you already gave the fuller answer, they shouldn't ask a follow-up — if they do anyway, don't repeat yourself, just briefly reaffirm what you already said.
5. If they follow up asking to quantify it (how many calls, how often, appointments mixed up, what you're paying for the hire, etc.) → respond with: "{{quantify_response}}" — this already matches whatever pain you named above, don't invent different numbers.
6. If instead of asking the gate question well they seem vague or salesy, you can push back once: "{{pushback_whats_this_response}}". If they disarm you (something like "nothing to sell you, genuinely just a quick question"), engage with the pain question. If you're still not convinced, you get ONE more stonewall, max: "{{pushback_stonewall_response}}" — but on their SECOND disarm attempt you must engage, no third stonewall exists.
7. Once the rep does the math out loud and asks if it matters to you, respond with ONE of: (a) genuinely moved: "{{amp_engaged_response}}", or (b) minimize it — allowed ONCE only: "{{amp_minimize_response}}", or (c) accuse them of selling — allowed up to TWICE: "{{amp_pushback_response}}". Whichever resistance you pick, when the rep comes back with their follow-up (the "why would I go to you" question, or asking again if it matters), you concede: "{{amp_reengage_response}}" — you cannot minimize or accuse a second/third time, you must move forward.
8. After the pitch/handoff, throw exactly ONE objection: "{{objection_line}}"
9. If they handle that objection well → show real interest: "{{engage_response}}", then when asked mornings or afternoons, answer honestly: mornings say "{{time_morning_response}}", afternoons say "{{time_afternoon_response}}".
10. If you're still not sold after their first rebuttal, you get ONE more round of hesitation, max: "{{handoff_recover_response}}" — but the very next time they ask, you must pick a morning or afternoon (rule 9) and move to booking a real time. No second round of hesitation exists.
11. If they pitch the product instead of asking questions → cut them off: "{{pushback_pitch_response}}"
12. Once a day/time gets picked, cooperate fully — give your callback number when asked and confirm the booking. This is where every call lands.
13. Keep responses to 1-3 sentences — you're a busy guy on a job site.
14. Once the rep has confirmed your booked day/time back to you and you've given your number, the call is done — use the end_call tool to hang up. Say a short natural goodbye first (e.g. "Alright, sounds good — talk soon.") as the message you give when ending. Never end the call before the booking is confirmed, and never just go silent — always use the tool.`

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const retellApiKey = Deno.env.get('RETELL_API_KEY')

    if (!retellApiKey) {
      return new Response(
        JSON.stringify({ error: 'RETELL_API_KEY not configured', notConfigured: true }),
        { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // ── Step 1: Get or create the roleplay agent ──────────────────────────────
    let agentId = Deno.env.get('RETELL_ROLEPLAY_AGENT_ID')

    if (!agentId) {
      // Create the agent dynamically — Retell v2 requires the persona to
      // live in a Retell LLM, wired to the agent via response_engine.
      // Store the returned ID in secrets to avoid re-creating.
      const headers = {
        'Authorization': `Bearer ${retellApiKey}`,
        'Content-Type': 'application/json',
      }

      const llmRes = await fetch('https://api.retellai.com/create-retell-llm', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          general_prompt: ROLEPLAY_AGENT_PROMPT,
          begin_message: "Yeah, who's this?",
          general_tools: [
            {
              type: 'end_call',
              name: 'end_call',
              description: 'End the call once the appointment is booked and confirmed back to the rep — see rule 14.',
            },
          ],
        }),
      })

      if (!llmRes.ok) {
        const errText = await llmRes.text()
        console.error('[create-roleplay-call] LLM creation failed:', errText)
        return new Response(
          JSON.stringify({ error: `Agent creation failed: ${errText}` }),
          { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
      const llm = await llmRes.json()

      const agentRes = await fetch('https://api.retellai.com/create-agent', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          agent_name: 'Mike - HVAC Owner',
          voice_id: '11labs-Adrian',
          language: 'en-US',
          response_engine: { type: 'retell-llm', llm_id: llm.llm_id },
          enable_backchannel: true,
          responsiveness: 0.4,
          interruption_sensitivity: 0.4,
        }),
      })

      if (!agentRes.ok) {
        const errText = await agentRes.text()
        console.error('[create-roleplay-call] Agent creation failed:', errText)
        return new Response(
          JSON.stringify({ error: `Agent creation failed: ${errText}` }),
          { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      const agent = await agentRes.json()
      agentId = agent.agent_id
      console.log('[create-roleplay-call] Created agent:', agentId, '— set RETELL_ROLEPLAY_AGENT_ID to avoid re-creating')
    }

    // ── Step 2: Create web call ───────────────────────────────────────────────
    // Fresh pick every call — this is what makes the practice call sound different
    // from the last one instead of reciting the same fixed persona verbatim.
    // Pick ONE angle and derive its matching quantify response together, so
    // pain_response and quantify_response can never mismatch (Prompt 317).
    const callsPerMonth = randInt(15, 60)
    const missedPerDay = randInt(1, 6)
    const angle = pick(PAIN_ANGLES)
    const quantifyResponse = angle.quantify === 'calls'
      ? `Sure — probably ${missedPerDay} calls a day slip through or don't get handled right, out of about ${callsPerMonth} a month.`
      : angle.quantify

    const dynamicVariables = {
      calls_per_month: String(callsPerMonth),
      missed_per_day: String(missedPerDay),
      opener_response: pick(OPENER_VARIANTS),
      indeed_response: pick(INDEED_VARIANTS),
      pain_response: angle.pain,
      quantify_response: quantifyResponse,
      urgency_rich_response: pick(URGENCY_RICH_VARIANTS),
      urgency_thin_response: pick(URGENCY_THIN_VARIANTS),
      urgency_followup_response: pick(URGENCY_FOLLOWUP_VARIANTS),
      pain_vague_response: pick(PAIN_GATE_VAGUE_VARIANTS),
      pain_defensive_response: pick(PAIN_GATE_DEFENSIVE_VARIANTS),
      pain_concede_response: pick(PAIN_GATE_CONCEDE_VARIANTS),
      pushback_whats_this_response: pick(PUSHBACK_WHATS_THIS_VARIANTS),
      pushback_stonewall_response: pick(PUSHBACK_STONEWALL_VARIANTS),
      amp_engaged_response: pick(AMP_ENGAGED_VARIANTS),
      amp_minimize_response: pick(AMP_MINIMIZE_VARIANTS),
      amp_pushback_response: pick(AMP_PUSHBACK_VARIANTS),
      amp_reengage_response: pick(AMP_REENGAGE_VARIANTS),
      objection_line: pick(HANDOFF_OBJECTION_VARIANTS),
      handoff_recover_response: pick(HANDOFF_RECOVER_VARIANTS),
      engage_response: pick(ENGAGE_VARIANTS),
      time_morning_response: pick(TIME_MORNING_VARIANTS),
      time_afternoon_response: pick(TIME_AFTERNOON_VARIANTS),
      pushback_pitch_response: pick(PUSHBACK_PITCH_VARIANTS),
    }

    const callRes = await fetch('https://api.retellai.com/v2/create-web-call', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${retellApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ agent_id: agentId, retell_llm_dynamic_variables: dynamicVariables }),
    })

    if (!callRes.ok) {
      const errText = await callRes.text()
      console.error('[create-roleplay-call] Web call creation failed:', errText)
      return new Response(
        JSON.stringify({ error: `Web call failed: ${errText}` }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const call = await callRes.json()

    return new Response(
      JSON.stringify({
        access_token: call.access_token,
        call_id:      call.call_id,
        agent_id:     agentId,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[create-roleplay-call]', msg)
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
