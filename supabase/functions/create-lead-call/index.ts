// create-lead-call — starts a Retell web call in "sales coach" mode.
//
// The AI acts as a real-time sales coach (not a prospect).
// The rep simultaneously dials the lead via their phone (tel: link).
// The browser WebRTC session gives the rep script prompts while on the call.
//
// If RETELL_API_KEY is not configured → returns { notConfigured: true }
// so the client falls back to the tel: link flow.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const retellApiKey = Deno.env.get('RETELL_API_KEY')
    if (!retellApiKey) {
      return new Response(
        JSON.stringify({ notConfigured: true }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const { business_name, contact_name, niche, city, phone, pain_points, notes } = await req.json()

    const agentPrompt = `You are an AI sales coach helping a rep make a live cold call right now.

The rep is calling: ${business_name || 'a business'} (${contact_name || 'the owner'}) in ${city || 'their area'}.
Niche: ${niche || 'service business'}
Pain points: ${pain_points || 'not noted yet'}
Rep notes: ${notes || 'none'}

YOUR ROLE:
- You are NOT the prospect. You are the coach in the rep's ear.
- Speak directly to the rep in short, actionable cues (max 2 sentences).
- Start by giving them the opener to say.
- After each response from you, wait for the rep to ask what to say next.
- When the rep asks "what now", give the next talking point.
- If rep says "objection", give them the handle.
- If rep says "book it", give the exact close line.
- Keep it calm, confident, and brief.

SCRIPT SECTIONS:
1. OPENER: "Hey, is this ${business_name}? Hey [Name], I was looking at your Indeed listing for a receptionist/dispatcher — how's that search going?"
2. PROBLEM: "Quick question — when your team's out on jobs, how are you handling missed calls right now?" [pause, listen] "How many calls a week do you think you're missing?"
3. PIVOT: "So what we do is set up a 24/7 AI receptionist that answers every call, qualifies the lead, and books it on your calendar — no voicemail, no missed jobs."
4. OBJECTION (not interested): "Totally get it. Real quick — how many calls do you miss in a week right now? [pause] That's usually the reason people eventually circle back to us."
5. CLOSE: "I'd love to show you how it works — takes 15 minutes on a screen share. You free [Thursday at 2 or Friday morning]?"`

    // Get or create the sales coach agent
    let agentId = Deno.env.get('RETELL_COACH_AGENT_ID')

    if (!agentId) {
      const agentRes = await fetch('https://api.retellai.com/v2/create-agent', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${retellApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          agent_name: 'Ohvara Sales Coach',
          voice_id: 'eleven_labs_adam',
          language: 'en-US',
          general_prompt: agentPrompt,
          begin_message: `Start now — say this opener: "Hey, is this ${business_name}?"`,
          enable_backchannel: false,
          responsiveness: 0.9,
          interruption_sensitivity: 0.5,
        }),
      })

      if (!agentRes.ok) {
        const err = await agentRes.text()
        console.error('[create-lead-call] Agent creation failed:', err)
        return new Response(
          JSON.stringify({ error: `Agent creation failed: ${err}` }),
          { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      const agent = await agentRes.json()
      agentId = agent.agent_id
      console.log('[create-lead-call] Created coach agent:', agentId, '— set RETELL_COACH_AGENT_ID to cache')
    }

    // Create web call
    const callRes = await fetch('https://api.retellai.com/v2/create-web-call', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${retellApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ agent_id: agentId }),
    })

    if (!callRes.ok) {
      const err = await callRes.text()
      return new Response(
        JSON.stringify({ error: `Web call creation failed: ${err}` }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const call = await callRes.json()

    return new Response(
      JSON.stringify({
        access_token: call.access_token,
        call_id: call.call_id,
        agent_id: agentId,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[create-lead-call]', msg)
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
