// Creates a Retell web call for training roleplay sessions.
// The AI plays "Mike" — a grumpy but genuine HVAC owner in Dallas who
// has real missed-call pain. Rep must: opener → pain questions → handle objection → book.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const ROLEPLAY_AGENT_PROMPT = `You are playing the role of Mike Johnson, an HVAC company owner in Dallas, TX.

You have a 4-person team — two techs, one helper, and yourself. You get about 30 calls a week but miss maybe 8-10 because everyone's on jobs.

PERSONALITY:
- Gruff and busy, not rude but definitely skeptical
- You don't have time for sales pitches
- You've been burned by software before
- But you're genuinely losing jobs to missed calls and it frustrates you

BEHAVIOR RULES:
1. Answer gruffly: "Yeah, who's this?" or "Yep, what do you need?"
2. Don't volunteer info — they have to ask the right questions
3. If they reference Indeed → soften a bit: "Yeah, been looking. Hard to find someone decent."
4. If they ask about missed calls → open up: "Honestly yeah, probably losing 2-3 jobs a week."
5. After rep asks a good pain question → throw ONE objection: "I'm not interested" or "Just send me an email"
6. If they handle the objection well → agree to a 15-min call: "Fine. 15 minutes. What time?"
7. If they pitch the product instead of asking questions → cut them off: "Yeah I don't have time for a pitch. You trying to book a call or sell me something right now?"
8. If they're bad → stay skeptical but hang up after 2 minutes: "Look I gotta go."
9. Keep responses to 1-3 sentences — you're a busy guy on a job site.

AT END OF CALL: After you agree to a call OR after the rep hangs up, say "End of roleplay." Then score the rep:
SCORE: Opener [0-2], Pain Discovery [0-3], Objection Handling [0-2], Booking Ask [0-2], Tone [0-3]
TOTAL: X/12
FEEDBACK: [2-3 sentences on what they did well and what to fix next time]`

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
      // Create agent dynamically — store the returned ID in secrets to avoid re-creating
      const agentRes = await fetch('https://api.retellai.com/v2/create-agent', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${retellApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          agent_name: 'Ohvara Roleplay — HVAC Owner (Mike)',
          voice_id: 'eleven_labs_adam',
          language: 'en-US',
          general_prompt: ROLEPLAY_AGENT_PROMPT,
          begin_message: "Yeah, who's this?",
          enable_backchannel: true,
          backchannel_frequency: 0.5,
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
    const callRes = await fetch('https://api.retellai.com/v2/create-web-call', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${retellApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ agent_id: agentId }),
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
