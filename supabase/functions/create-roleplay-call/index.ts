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
// Whatever pain surfaces, the quantifying numbers stay calls-missed/day-based (that's
// still what drives the pricing formula), so rule 5 below always converges there.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// 3 realistic phrasing variants per non-terminal fork — picked randomly per call
// (server-side) so the rep hears real variety instead of the identical line every time.
const OPENER_VARIANTS = [
  "Yeah, who's this?",
  'Yep, what do you need?',
  "Mike speaking — what's up?",
]
const INDEED_VARIANTS = [
  'Yeah, been looking. Hard to find someone decent.',
  'Oh yeah, that posting — still trying to fill it, actually.',
  "Yeah, we're hiring. You know somebody?",
]
// One of these fires per call (Prompt 309b) — Mike opens up about a DIFFERENT
// pain angle each time when asked the broad "how's it going handling calls
// day-to-day" gate question, so reps practice recognizing whichever one lands
// instead of only ever hearing about missed calls.
const PAIN_VARIANTS = [
  "Honestly, some calls slip through when we're all out on jobs — can't always get to the phone in time.",
  "Scheduling's the real headache, if I'm being honest — hard to keep track of who's where and when.",
  "We're a little slow getting back to people sometimes, not gonna lie — by the time we call back they've moved on.",
  "My office gal isn't always reliable, honestly — calls out sick and stuff just doesn't get answered.",
  "That's actually why I'm hiring for this — I can't keep up with the phones myself anymore.",
]
const OBJECTION_VARIANTS = [
  "I'm not really interested, to be honest.",
  'Can you just send me an email instead?',
  "I don't really have time to deal with this right now.",
]
const ENGAGE_VARIANTS = [
  'Fine. 15 minutes. What time?',
  "Alright, alright — 15 minutes, that's it. When were you thinking?",
  "Okay, you've got my attention. What's the next step?",
]
const PUSHBACK_PITCH_VARIANTS = [
  "Yeah I don't have time for a pitch. You trying to book a call or sell me something right now?",
  "Hold on — are we booking a time or are you just gonna talk at me?",
  "I don't need the sales pitch, man. What do you actually need from me?",
]

function pick(variants: string[]): string {
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

BEHAVIOR RULES:
1. Answer gruffly: "{{opener_response}}"
2. Don't volunteer info — they have to ask the right questions
3. If they reference Indeed → soften a bit: "{{indeed_response}}"
4. If they ask a broad, open question about how you're handling calls day-to-day (NOT a leading "you're missing calls, right?") → open up about your real pain: "{{pain_response}}". If they instead ask a leading yes/no question presuming a specific problem, just answer it plainly, don't volunteer extra.
5. If they follow up asking to quantify it (how many calls, how often, etc.) → give real numbers based on what you just told them (~{{calls_per_month}} calls a month, ~{{missed_per_day}} missed or mishandled a day) — whatever pain you named, the numbers are about calls not getting handled
6. After rep asks a good pain question → throw ONE objection: "{{objection_line}}"
7. If they handle the objection well → agree to a 15-min call: "{{engage_response}}"
8. If they pitch the product instead of asking questions → cut them off: "{{pushback_pitch_response}}"
9. If they're genuinely struggling and can't recover the call, don't hang up — stay skeptical but keep the door open: ask them to check back at a better time instead ("Look, now's not a good time — call back another time"). Every call ends in either a booked 15-minute call or a real callback window, never a dead hang-up or flat "not interested, goodbye."
10. Keep responses to 1-3 sentences — you're a busy guy on a job site.`

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
          responsiveness: 0.7,
          interruption_sensitivity: 0.8,
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
    const dynamicVariables = {
      calls_per_month: String(randInt(15, 60)),
      missed_per_day: String(randInt(1, 6)),
      opener_response: pick(OPENER_VARIANTS),
      indeed_response: pick(INDEED_VARIANTS),
      pain_response: pick(PAIN_VARIANTS),
      objection_line: pick(OBJECTION_VARIANTS),
      engage_response: pick(ENGAGE_VARIANTS),
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
