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

  const demoMode = Deno.env.get('DEMO_MODE') === 'true'
  const apiKey = demoMode ? null : Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) {
    // No API key, or DEMO_MODE on — return fallback content immediately, no Anthropic call.
    if (mode === 'pitch_anchor') {
      return new Response(JSON.stringify({ pitch_anchor: `${business_name || 'This business'} is bleeding revenue on every missed call — we fix that for less than a part-time hire.`, fallback: true }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }
    if (mode === 'briefing') {
      return new Response(JSON.stringify({ briefing: `Lead with missed-call revenue loss — ${niche || 'this business'} is almost certainly losing jobs to unanswered calls. Probe current setup and after-hours coverage. Expect a price objection; reframe around cost of one lost job vs. the monthly fee.`, fallback: true }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }
    const fb = buildFallbackScript(business_name || 'this business', niche || 'service business', job_title || 'receptionist')
    return new Response(JSON.stringify({ script: fb, fallback: true }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }

  const anthropic = new Anthropic({ apiKey })

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

  // Coerce sections to strings before they leave the function. The model
  // sometimes returns arrays of bullets (the bullet prompt invites it) —
  // the client renders strings, so normalize here too (belt and suspenders
  // with the client-side normalizeScript).
  if (script && typeof script === 'object') {
    let usable = 0
    for (const k of ['opener', 'problem', 'solution', 'objections', 'close']) {
      const v = (script as Record<string, unknown>)[k]
      if (typeof v === 'string' && v.trim()) {
        usable++
      } else if (Array.isArray(v) && v.length) {
        ;(script as Record<string, unknown>)[k] = v
          .map(x => String(x).trim())
          .filter(Boolean)
          .map(l => (l.startsWith('- ') || l.startsWith('• ') ? l : `- ${l}`))
          .join('\n')
        usable++
      } else {
        delete (script as Record<string, unknown>)[k]
      }
    }
    if (usable < 3) script = null
  } else {
    script = null
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
