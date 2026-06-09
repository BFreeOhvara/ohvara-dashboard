import Anthropic from 'npm:@anthropic-ai/sdk'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const PACKAGES = {
  basic: {
    name: 'Basic',
    setup: 497,
    monthly: 497,
    services: ['AI Receptionist (24/7)', 'Missed Call Text Back'],
    roi: 'Replaces a $2,800+/mo receptionist',
  },
  pro: {
    name: 'Pro',
    setup: 497,
    monthly: 797,
    services: [
      'AI Receptionist (24/7)',
      'Missed Call Text Back',
      'Review Generation',
      'Lead Follow-Up Automation',
      'Appointment Reminders',
    ],
    roi: 'Replaces a $3,500+/mo receptionist + marketing assistant',
  },
  premium: {
    name: 'Premium',
    setup: 497,
    monthly: 1297,
    services: [
      'AI Receptionist (24/7)',
      'Missed Call Text Back',
      'Review Generation',
      'Lead Follow-Up Automation',
      'Appointment Reminders',
      'AI Dispatcher',
      'SMS Marketing',
    ],
    roi: 'Replaces a $4,500+/mo receptionist + dispatcher',
  },
  elite: {
    name: 'Elite',
    setup: 497,
    monthly: 1797,
    services: [
      'Everything in Premium',
      'Professional Website',
      'Multiple AI agents (up to 5 lines)',
      'Priority support',
      'Custom reporting dashboard',
    ],
    roi: 'Replaces $6,000+/mo full office staff',
  },
} as const

type PackageKey = keyof typeof PACKAGES

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const {
      businessName,
      niche,
      location,
      monthlyLaborCost,
      repNotes,
      jobTitle,
      closerName,
    } = await req.json()

    const anthropic = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY')! })

    const packagesText = Object.entries(PACKAGES)
      .map(
        ([id, p]) =>
          `${p.name} (${id}): $${p.setup} one-time setup + $${p.monthly}/mo\n` +
          `  Services: ${p.services.join(', ')}\n` +
          `  ROI: ${p.roi}`
      )
      .join('\n\n')

    const prompt = `You are an AI sales consultant for Ohvara, an AI automation company targeting trades businesses.

BUSINESS PROFILE:
- Business: ${businessName}
- Industry: ${niche}
- Location: ${location}
- Currently hiring for: ${jobTitle || 'not specified'}
- Estimated monthly labor cost: ${monthlyLaborCost ? `$${monthlyLaborCost}/mo` : 'not specified'}
- Pain points from appointment setter: ${repNotes || 'Not captured yet'}
- Closer handling this call: ${closerName || 'not specified'}

PACKAGES AVAILABLE:
${packagesText}

RECOMMENDATION RULES:
- Monthly labor cost under $3,000 → Basic
- Monthly labor cost $3,000–$4,000 → Pro
- Monthly labor cost $4,000–$5,000 → Premium
- Monthly labor cost over $5,000 OR dispatcher/multiple locations needed → Elite
- Always anchor ROI to their labor cost vs our monthly price
- Lead with ROI and pain, not features
- Pain points from the rep are GOLD — reference them specifically
- If no labor cost is known, infer from niche and job title

Respond ONLY in this exact JSON format, no markdown, no code blocks:
{
  "recommended_tier": "basic|pro|premium|elite",
  "confidence": "high|medium|low",
  "headline": "One punchy sentence why this fits — max 12 words",
  "roi_argument": "Specific dollar comparison — their hire cost vs our monthly price",
  "pain_points": ["Pain point 1 (from rep notes or inferred from niche)", "Pain point 2", "Pain point 3"],
  "why_pitch_this": "2-3 sentences on why this tier specifically solves their problem",
  "talking_points": ["Talking point 1", "Talking point 2", "Talking point 3"],
  "pushback_response": "One direct response if they hesitate on price",
  "alternative_tier": "basic|pro|premium|elite",
  "alternative_reason": "One sentence — when to offer this tier instead",
  "upsell_path": "One sentence — how to move them up a tier if they're open to it"
}`

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1000,
      messages: [{ role: 'user', content: prompt }],
    })

    const rawText = message.content[0].type === 'text' ? message.content[0].text.trim() : '{}'

    let rec: Record<string, unknown>
    try {
      rec = JSON.parse(rawText)
    } catch {
      const match = rawText.match(/```(?:json)?\s*([\s\S]*?)```/)
      try {
        rec = match ? JSON.parse(match[1].trim()) : null
      } catch {
        rec = null
      }
    }

    // Fallback if parse fails
    if (!rec) {
      const laborCost = parseFloat(String(monthlyLaborCost || '0'))
      let fallbackTier: PackageKey = 'pro'
      if (laborCost < 3000) fallbackTier = 'basic'
      else if (laborCost >= 5000) fallbackTier = 'premium'
      const fp = PACKAGES[fallbackTier]
      rec = {
        recommended_tier: fallbackTier,
        confidence: 'medium',
        headline: `${fp.name} at $${fp.monthly}/mo beats hiring at $${laborCost || fp.monthly * 4}/mo`,
        roi_argument: `At $${fp.monthly}/mo vs a $${laborCost || fp.monthly * 4}/mo hire, you keep ${fp.roi.toLowerCase()}.`,
        pain_points: [
          'Missing calls while team is on job sites',
          'Losing work to competitors who answer faster',
          repNotes || 'High inbound call volume overwhelming the business',
        ],
        why_pitch_this: `${fp.name} is the right fit based on their size and pain. ${fp.roi}.`,
        talking_points: [
          `You're spending or about to spend $${laborCost || fp.monthly * 4}/mo — we do more for $${fp.monthly}/mo`,
          `We're live in 24 hours — no hiring, no training, no sick days`,
          `${fp.services[0]} never misses a call, even at 2am`,
        ],
        pushback_response: "I get it — but you're already spending more than this every month just trying to cover calls. This just works better and costs less.",
        alternative_tier: fallbackTier === 'basic' ? 'pro' : 'basic',
        alternative_reason: 'If they need review generation and follow-up too',
        upsell_path: 'Once they see the call volume drop and reviews tick up, Premium pays for itself in saved dispatcher time',
      }
    }

    return new Response(
      JSON.stringify({ rec, packages: PACKAGES }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[recommend-stack]', msg)
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
