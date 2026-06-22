// Scores a rep's roleplay call transcript using Claude.
// Takes the conversation transcript and returns structured feedback.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface TranscriptEntry {
  role: 'agent' | 'user'
  content: string
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { transcript } = await req.json() as { transcript: TranscriptEntry[] }

    if (!transcript?.length) {
      return new Response(
        JSON.stringify({ error: 'No transcript provided' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const demoMode = Deno.env.get('DEMO_MODE') === 'true'
    const anthropicKey = demoMode ? null : Deno.env.get('ANTHROPIC_API_KEY')
    if (!anthropicKey) {
      if (demoMode) {
        // DEMO_MODE — realistic pre-baked score, no Anthropic call, same shape as the live path.
        return new Response(
          JSON.stringify({
            scores: { opener: 2, painDiscovery: 2, objectionHandling: 1, bookingAsk: 2, tone: 2 },
            total: 9,
            maxTotal: 12,
            summary: 'Solid call — clean opener and good pain discovery. Objection handling felt a little rushed; slow down and let the prospect finish before pivoting to the close.',
            tips: ['Pause after pain questions instead of filling silence', 'Acknowledge the objection before reframing it', 'Confirm the booked time back to the prospect explicitly'],
            highlights: ['Referenced the Indeed posting naturally in the opener', 'Asked about after-hours coverage, not just missed calls'],
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
      // Return a default score if Claude isn't available
      return new Response(
        JSON.stringify({
          scores: { opener: 1, painDiscovery: 1, objectionHandling: 1, bookingAsk: 1, tone: 1 },
          total: 5,
          maxTotal: 12,
          summary: 'Call completed. Set ANTHROPIC_API_KEY to enable AI scoring.',
          tips: ['Configure ANTHROPIC_API_KEY in Edge Function secrets for detailed feedback.'],
          notScored: true,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Format transcript for Claude
    const formatted = transcript
      .map(t => `${t.role === 'user' ? 'REP' : 'PROSPECT'}: ${t.content}`)
      .join('\n')

    const prompt = `You are a sales coach reviewing a cold call roleplay transcript.

The rep was calling a prospect (Mike, HVAC owner) who was advertising for a receptionist on Indeed. The rep's goal was to:
1. Deliver a clean opener referencing Indeed
2. Ask pain questions (missed calls, after-hours coverage, cost of a hire)
3. Handle one objection
4. Book a 15-minute discovery call

Score this call on each dimension (integers only):

TRANSCRIPT:
${formatted}

Respond with ONLY valid JSON (no markdown, no explanation):
{
  "scores": {
    "opener": <0-2>,
    "painDiscovery": <0-3>,
    "objectionHandling": <0-2>,
    "bookingAsk": <0-2>,
    "tone": <0-3>
  },
  "total": <sum, 0-12>,
  "maxTotal": 12,
  "summary": "<2-3 sentence honest assessment>",
  "tips": ["<specific tip 1>", "<specific tip 2>", "<specific tip 3>"],
  "highlights": ["<thing they did well>", "<another good thing>"]
}`

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 800,
        messages: [{ role: 'user', content: prompt }],
      }),
    })

    if (!res.ok) {
      throw new Error(`Claude API error: ${await res.text()}`)
    }

    const completion = await res.json()
    const text = completion.content?.[0]?.text || '{}'

    let scoreData
    try {
      scoreData = JSON.parse(text)
    } catch {
      // Fallback if Claude returns something non-JSON
      scoreData = {
        scores: { opener: 1, painDiscovery: 1, objectionHandling: 1, bookingAsk: 1, tone: 1 },
        total: 5,
        maxTotal: 12,
        summary: 'Call completed. Analysis unavailable.',
        tips: ['Keep practicing — consistency is key.'],
        highlights: [],
      }
    }

    return new Response(
      JSON.stringify(scoreData),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[score-roleplay]', msg)
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
