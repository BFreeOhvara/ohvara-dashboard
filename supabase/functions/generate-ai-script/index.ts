import Anthropic from 'npm:@anthropic-ai/sdk'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const body = await req.json()
  const {
    mode = 'script',
    business_name,
    contact_name,
    niche,
    city,
    pain_points,
    notes,
    // pitch_anchor extras
    job_title,
    monthly_labor_cost,
    recommended_tier,
    recommended_price,
  } = body

  const anthropic = new Anthropic({
    apiKey: Deno.env.get('ANTHROPIC_API_KEY')!,
  })

  let prompt: string

  // ---- PITCH ANCHOR mode ----
  if (mode === 'pitch_anchor') {
    const costDisplay = monthly_labor_cost ? `$${Number(monthly_labor_cost).toLocaleString()}/month` : 'unknown'
    const saving = monthly_labor_cost && recommended_price
      ? `$${Math.round(Number(monthly_labor_cost) - Number(recommended_price)).toLocaleString()}/month`
      : null

    prompt = `You are a sales strategist. Write ONE sentence — a pitch anchor — for a closer about to call ${business_name}.

Facts:
- Business niche: ${niche || 'unknown'}
- Job title being replaced/augmented: ${job_title || 'staff'}
- Current monthly labor cost: ${costDisplay}
- Recommended Ohvara tier: ${recommended_tier || 'unknown'} at $${recommended_price || 'unknown'}/month
- Monthly savings if they sign: ${saving || 'significant'}
- Pain points: ${pain_points || 'none noted'}

Write exactly one confident, specific, punchy sentence the closer can use to open with financial framing. Use the actual numbers. No fluff, no "I" subject — start with the business name or the cost angle.`

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 120,
      messages: [{ role: 'user', content: prompt }],
    })

    return new Response(
      JSON.stringify({ pitch_anchor: message.content[0].type === 'text' ? message.content[0].text.trim() : '' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // ---- BRIEFING mode ----
  if (mode === 'briefing') {
    prompt = `You are a sales coach preparing a closer for a discovery/sales call.

Business: ${business_name}
Contact: ${contact_name || 'Unknown'}
Niche: ${niche || 'Unknown'}
City: ${city || 'Unknown'}
Rep notes: ${notes || 'None'}
Pain points identified: ${pain_points || 'None noted'}

Write a concise 150-word prep briefing for the closer. Cover: (1) likely pain points to probe, (2) the strongest value angle to lead with, (3) one likely objection and how to handle it. Be direct and tactical — this person is about to get on a call.`

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 400,
      messages: [{ role: 'user', content: prompt }],
    })

    return new Response(
      JSON.stringify({ briefing: message.content[0].type === 'text' ? message.content[0].text : '' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // mode === 'script'
  prompt = `You are an expert cold call script writer for a web design agency that targets local service businesses with no website.

Lead info:
- Business: ${business_name}
- Contact: ${contact_name || 'the owner'}
- Niche: ${niche || 'service business'}
- City: ${city || 'their area'}
- Known pain points: ${pain_points || 'none noted'}
- Rep notes: ${notes || 'none'}

Write a complete cold call script in JSON format. The script should sound natural, conversational, and confident — not salesy.

Return ONLY valid JSON with these keys:
{
  "opener": "...",
  "problem": "...",
  "solution": "...",
  "objections": "...",
  "close": "..."
}

Each section should be 3-5 sentences. The objections section should cover 2-3 common objections with responses. Use the business name and contact name naturally throughout.`

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1000,
    messages: [{ role: 'user', content: prompt }],
  })

  const rawText = message.content[0].type === 'text' ? message.content[0].text : '{}'
  let script
  try {
    script = JSON.parse(rawText)
  } catch {
    // Extract JSON from markdown code block if present
    const match = rawText.match(/```(?:json)?\s*([\s\S]*?)```/)
    script = match ? JSON.parse(match[1]) : { opener: rawText, problem: '', solution: '', objections: '', close: '' }
  }

  return new Response(
    JSON.stringify({ script }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
})
