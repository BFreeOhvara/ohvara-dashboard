import Anthropic from 'npm:@anthropic-ai/sdk'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// ── Fallback script template (used when API key missing or call fails) ────────
// Bullet cheat-sheet format — every line starts with "- " so the modal
// renders it as a scannable list, not prose.
function buildFallbackScript(businessName: string, niche: string, jobTitle: string) {
  return {
    opener: `- "Hey, is this ${businessName}? Saw your listing for a ${jobTitle} — how's that search going?"\n- Casual, peer-to-peer. You're not a telemarketer.\n- Smile when you dial — tone carries.`,
    problem: `- "Who's grabbing the phone when the crew's out on jobs?"\n- "How many calls a week would you guess hit voicemail?"\n- Let them talk — the pauses do the work.`,
    solution: `- Use THEIR numbers: "Say half those calls are real jobs…"\n- "What's an average job worth for you?"\n- Every missed call is revenue walking to a competitor — most ${niche} shops lose 8-10/week.`,
    objections: `- "Not interested" → "Fair — what happens to a call you can't answer right now?"\n- "Too busy" → "Exactly why I'm calling. 15 minutes, that's it."\n- One objection, one comeback, then move to the close.`,
    close: `- The only goal: book the 15-minute call. Nothing else.\n- Offer two times: "Tuesday at 2, or Thursday morning?"\n- Confirm the time, then get off the phone.`,
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {

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

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) {
    // No API key — return fallback script immediately
    const fb = buildFallbackScript(business_name || 'this business', niche || 'service business', job_title || 'receptionist')
    return new Response(JSON.stringify({ script: fb, fallback: true }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }

  const anthropic = new Anthropic({ apiKey })

  let prompt: string

  // ---- STACK ANALYSIS mode ----
  if (mode === 'stack_analysis') {
    const costDisplay = monthly_labor_cost ? `$${Number(monthly_labor_cost).toLocaleString()}/month` : null
    const tiers = [
      { name: 'Starter', price: 497, features: 'AI Receptionist/Dispatcher + Missed Call Text Back' },
      { name: 'Growth', price: 797, features: 'Starter + Review Generation + Lead Follow-Up Automation' },
      { name: 'Full Stack', price: 1297, features: 'Everything + Website' },
    ]

    prompt = `You are a sales strategist preparing a closer for a discovery/sales call.

Lead info:
- Business: ${business_name || 'Unknown'}
- Contact: ${contact_name || 'Unknown'}
- Niche: ${niche || 'Unknown'}
- City: ${city || 'Unknown'}
- Job title being replaced/augmented: ${job_title || 'Unknown'}
- Monthly labor cost: ${costDisplay || 'Unknown'}
- Rep notes: ${notes || 'None'}
- Pain points: ${pain_points || 'None noted'}

Available tiers:
- Starter: $497/month — AI Receptionist/Dispatcher + Missed Call Text Back
- Growth: $797/month — Starter + Review Generation + Lead Follow-Up Automation
- Full Stack: $1,297/month — Everything + Website

Your task: Recommend exactly ONE tier and explain why, then prepare the closer for the call.

Respond with ONLY valid JSON — no markdown, no code blocks, no extra text:
{
  "tier": "Growth",
  "price": 797,
  "why": [
    "Specific reason 1 using the actual numbers from the lead data",
    "Specific reason 2 about their niche or situation",
    "Specific reason 3 about a pain point or opportunity"
  ],
  "pitch_first": "One confident sentence about what to lead with on the call, using financial framing",
  "objection": "The single most likely objection this specific prospect will raise",
  "objection_response": "A tactical 1-2 sentence response to that objection"
}

Use the actual numbers. Be specific to THIS lead — not generic. The 'why' array should have 2-4 items.`

    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 600,
      messages: [{ role: 'user', content: prompt }],
    })

    const rawText = message.content[0].type === 'text' ? message.content[0].text.trim() : '{}'
    let analysis
    try {
      analysis = JSON.parse(rawText)
    } catch {
      const match = rawText.match(/```(?:json)?\s*([\s\S]*?)```/)
      try {
        analysis = match ? JSON.parse(match[1]) : null
      } catch {
        analysis = null
      }
    }

    if (!analysis) {
      analysis = {
        tier: 'Growth',
        price: 797,
        why: ['High-inbound niche — call volume is the core problem', 'Growth tier ROI within the first month'],
        pitch_first: `At ${costDisplay || 'their current cost'}, the Growth tier at $797/month pays for itself immediately.`,
        objection: "We already have someone handling calls",
        objection_response: "That's actually perfect — this works alongside them and handles overflow so nothing falls through the cracks.",
      }
    }

    return new Response(
      JSON.stringify({ analysis }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

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
      model: 'claude-haiku-4-5',
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
      model: 'claude-haiku-4-5',
      max_tokens: 400,
      messages: [{ role: 'user', content: prompt }],
    })

    return new Response(
      JSON.stringify({ briefing: message.content[0].type === 'text' ? message.content[0].text : '' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // ---- SCRIPT mode (default) ----
  // Bullet cheat-sheet, not prose: the rep glances at this mid-call. The
  // "solution" key renders under a "Pain Amplification" heading in the
  // modal — it amplifies the cost of the problem, it does NOT pitch.
  prompt = `You are writing a cold-call CHEAT SHEET for an appointment setter at Ohvara, which sells AI receptionists/dispatchers to local service businesses that are trying to hire for the phones.

The rep's ONLY goal: surface the prospect's missed-call pain with QUESTIONS, then book a 15-minute discovery call. The rep never pitches product details or pricing — questions, not pitch.

Lead info:
- Business: ${business_name}
- Contact: ${contact_name || 'the owner'}
- Niche: ${niche || 'service business'}
- City: ${city || 'their area'}
- Known pain points: ${pain_points || 'none noted'}
- Rep notes: ${notes || 'none'}

Return ONLY valid JSON with these keys:
{
  "opener": "...",
  "problem": "...",
  "solution": "...",
  "objections": "...",
  "close": "..."
}

FORMAT — this is the important part:
- Each value is 2-4 SHORT bullet lines. Every line starts with "- ".
- Each bullet is a glanceable prompt, question, or reminder — 15 words max. NOT sentences to read verbatim.
- Tailor bullets to THIS lead: use the business name, niche, city, and pain points where they make a bullet sharper.

Section meanings:
- opener: how to open casual and peer-to-peer (reference their niche/city/hiring situation)
- problem: discovery questions that surface missed-call pain
- solution: pain amplification — make the cost of missed calls concrete with THEIR numbers (renders under a "Pain Amplification" heading; do not pitch)
- objections: 2-3 likely objections, each with a one-line comeback ('"Not interested" → ...')
- close: how to book the 15-minute call (offer two specific times, confirm, hang up)`

  let script
  try {
    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 1000,
      messages: [{ role: 'user', content: prompt }],
    })
    const rawText = message.content[0].type === 'text' ? message.content[0].text : '{}'
    try {
      script = JSON.parse(rawText)
    } catch {
      const match = rawText.match(/```(?:json)?\s*([\s\S]*?)```/)
      script = match ? JSON.parse(match[1]) : null
    }
  } catch {
    // API credits exhausted or network error — use fallback
  }

  if (!script) {
    script = buildFallbackScript(business_name || 'this business', niche || 'service business', job_title || 'receptionist')
  }

  return new Response(
    JSON.stringify({ script }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('generate-ai-script error:', message)
    // Never return a 500 to the rep — always give them a usable script
    const fallback = buildFallbackScript('this business', 'service business', 'receptionist')
    return new Response(
      JSON.stringify({ script: fallback, fallback: true }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
