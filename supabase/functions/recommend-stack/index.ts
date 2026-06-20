import Anthropic from 'npm:@anthropic-ai/sdk'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const SETUP_FEE = 297

// Packages kept ONLY for closest-tier display color/name in the closer UI and
// Stripe link generation — NOT a sellable menu anymore (Prompt 5: problem-first
// pricing). Pricing always comes from the formula; automations are AI-generated
// free-form per lead, no catalog constraint.
const PACKAGES = {
  basic:   { name: 'Basic',   setup: SETUP_FEE, monthly: 497 },
  pro:     { name: 'Pro',     setup: SETUP_FEE, monthly: 797 },
  premium: { name: 'Premium', setup: SETUP_FEE, monthly: 1297 },
  elite:   { name: 'Elite',   setup: SETUP_FEE, monthly: 1797 },
} as const

type PackageKey = keyof typeof PACKAGES

function clamp(n: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, n)) }

// Formula: 15% of estimated monthly lost revenue.
// Tunable constants flagged here: 4.33 (weeks/month), 0.15 (take rate), 297/1797 (floor/ceiling).
function formulaPrice(callsMissedPerWeek: number | null, avgTicket: number | null): number | null {
  if (!callsMissedPerWeek || !avgTicket || callsMissedPerWeek <= 0 || avgTicket <= 0) return null
  const monthlyLost = callsMissedPerWeek * 4.33 * avgTicket
  if (monthlyLost < 500) return null  // not enough signal to formula-price
  return Math.round(clamp(monthlyLost * 0.15, 297, 1797) / 10) * 10  // round to nearest $10
}

// Map price → closest display tier for Stripe link generation + UI color.
function priceToTier(monthly: number): PackageKey {
  if (monthly >= 1500) return 'elite'
  if (monthly >= 1000) return 'premium'
  if (monthly >= 650)  return 'pro'
  return 'basic'
}

// Labor-cost fallback when no formula data is available (original logic preserved).
function laborTier(monthlyLaborCost: number | null): PackageKey {
  if (!monthlyLaborCost || monthlyLaborCost < 3000) return 'basic'
  if (monthlyLaborCost < 4000) return 'pro'
  if (monthlyLaborCost < 5000) return 'premium'
  return 'elite'
}

const PAIN_LABELS: Record<string, string> = {
  missed_calls:  'missed calls',
  slow_response: 'slow response times',
  no_shows:      'no-shows',
  never_booked:  'leads who called but never booked',
}

type Automation = { name: string; description: string }

// Heuristic, catalog-free automation generation for the no-API-key / API-error
// fallback path. Builds 2-5 named automations straight from whatever discovery
// signal is available — same spirit as the AI prompt, just deterministic.
function fallbackAutomations(inputs: {
  primaryPain: string | null
  currentSetup: string | null
  secondaryPain: string | null
  callsMissedPerWeek: number | null
  repNotes: string | null
}): Automation[] {
  const { primaryPain, currentSetup, secondaryPain, callsMissedPerWeek, repNotes } = inputs
  const automations: Automation[] = [
    { name: 'AI Receptionist', description: '24/7 call answering — captures every lead, even after hours' },
  ]

  const painLabel = primaryPain ? PAIN_LABELS[primaryPain] : null
  if (painLabel === 'missed calls' || (callsMissedPerWeek && callsMissedPerWeek > 0)) {
    automations.push({ name: 'Missed Call Text Back', description: 'Auto-SMS to any caller who doesn\'t get answered' })
  }
  if (painLabel === 'slow response times') {
    automations.push({ name: 'Instant Lead Response', description: 'AI replies to every new inquiry within seconds, day or night' })
  }
  if (painLabel === 'no-shows') {
    automations.push({ name: 'Appointment Reminders', description: 'SMS reminders that cut no-shows by 60%+' })
  }
  if (painLabel === 'leads who called but never booked') {
    automations.push({ name: 'Lead Follow-Up Automation', description: 'Multi-touch follow-up for quotes that go quiet' })
  }

  const notes = `${repNotes || ''} ${currentSetup || ''} ${secondaryPain || ''}`.toLowerCase()
  if (notes.includes('review') || notes.includes('reputation') || notes.includes('rating')) {
    automations.push({ name: 'Review Generation', description: 'Auto-requests 5-star reviews from completed jobs' })
  }
  if (notes.includes('dispatch') || notes.includes('route') || notes.includes('crew')) {
    automations.push({ name: 'AI Dispatcher', description: 'Intelligent call routing to the right crew member' })
  }
  if (notes.includes('marketing') || notes.includes('repeat') || notes.includes('seasonal')) {
    automations.push({ name: 'SMS Marketing', description: 'Monthly campaigns to past customers for repeat jobs' })
  }
  if (notes.includes('website') || notes.includes('web') || notes.includes('online')) {
    automations.push({ name: 'Professional Website', description: 'Mobile-first site that converts visitors to booked calls' })
  }

  if (automations.length < 2) {
    automations.push({ name: 'Missed Call Text Back', description: 'Auto-SMS to any caller who doesn\'t get answered' })
  }
  return automations.slice(0, 5)
}

function deterministicFallback(inputs: {
  callsMissedPerWeek: number | null
  avgTicket: number | null
  monthlyLaborCost: number | null
  repNotes: string | null
  niche: string | null
  customMonthly: number | null
  primaryPain: string | null
  currentSetup: string | null
  secondaryPain: string | null
}): Record<string, unknown> {
  const { callsMissedPerWeek, avgTicket, monthlyLaborCost, repNotes, niche, customMonthly, primaryPain, currentSetup, secondaryPain } = inputs

  const automations = fallbackAutomations({ primaryPain, currentSetup, secondaryPain, callsMissedPerWeek, repNotes })
  const tier = customMonthly ? priceToTier(customMonthly) : laborTier(monthlyLaborCost)
  const monthly = customMonthly || PACKAGES[tier].monthly
  const painLabel = primaryPain ? PAIN_LABELS[primaryPain] : null

  const missedRevStr = (callsMissedPerWeek && avgTicket)
    ? `You're missing ~${Math.round(callsMissedPerWeek * 4.33)} calls/month at $${avgTicket}/ticket — that's $${Math.round(callsMissedPerWeek * 4.33 * avgTicket).toLocaleString()}/month walking out the door.`
    : `At your current call volume, 2-3 missed calls a week adds up to thousands in lost revenue every month.`

  return {
    recommended_tier: tier,
    recommended_automations: automations,
    custom_monthly_price: monthly,
    confidence: 'medium',
    headline: `${niche || 'Your business'} is leaking revenue every time a call goes unanswered`,
    roi_argument: missedRevStr,
    pain_points: [
      painLabel ? `${painLabel[0].toUpperCase()}${painLabel.slice(1)} is the #1 thing costing them money` : 'Calls going unanswered while crew is on jobs',
      currentSetup ? `Current setup ("${currentSetup}") isn't covering the gap` : 'Quotes that go cold because nobody follows up',
      secondaryPain || 'No way to capture after-hours leads',
    ],
    why_pitch_this: `The selected automations directly address the gaps identified during your conversation — specifically ${painLabel || 'the missed calls and follow-up'} problem.`,
    talking_points: [
      `At ${callsMissedPerWeek || 'a few'} missed calls per week, you're leaving real money on the table every month`,
      `This stack pays for itself with just 1-2 recovered jobs per month`,
      `Live in 48 hours — no downtime, no hiring, no training`,
    ],
    pushback_response: `Think of it this way — if we recover even one job per week that you would have missed, the stack has already paid for itself. We're just making sure you capture what's already coming your way.`,
    alternative_automations: automations.slice(0, Math.max(1, automations.length - 1)),
    alternative_reason: 'A lighter version if price is the objection — still covers the highest-impact automation',
    upsell_path: 'Once they see ROI in month 1, they typically want to add more automations to compound the gains',
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const {
      businessName,
      niche,
      location,
      monthlyLaborCost,
      callsMissedPerWeek,
      avgTicket,
      repNotes,
      jobTitle,
      closerName,
      primaryPain,
      currentSetup,
      secondaryPain,
    } = await req.json()

    const customMonthly = formulaPrice(callsMissedPerWeek, avgTicket)
    const fallbackTier  = laborTier(monthlyLaborCost)
    const effectiveMonthly = customMonthly || PACKAGES[fallbackTier].monthly

    const formulaExplanation = customMonthly
      ? `Formula price: ${callsMissedPerWeek} missed calls/week × 4.33 weeks × $${avgTicket}/ticket = $${Math.round(callsMissedPerWeek * 4.33 * avgTicket).toLocaleString()}/month lost × 15% = $${customMonthly}/month for the stack`
      : `No formula data — price based on labor cost tier: $${effectiveMonthly}/month`

    const painLabel = primaryPain ? (PAIN_LABELS[primaryPain] || primaryPain) : null

    const prompt = `You are a sales strategy AI for Ohvara, an SMB automation company. Analyze this lead's specific problems and design a custom automation stack — there is NO fixed catalog. Name whatever automations actually solve their stated problems; invent a new automation type if their situation calls for it.

BUSINESS CONTEXT:
- Business: ${businessName || 'Unknown'} (${niche || 'general SMB'}) in ${location || 'unknown location'}
- Job Title: ${jobTitle || 'Owner'}
- Monthly Labor Cost: ${monthlyLaborCost ? `$${monthlyLaborCost}` : 'unknown'}
- Calls Missed Per Week: ${callsMissedPerWeek ?? 'not captured'}
- Avg Ticket Value: ${avgTicket ? `$${avgTicket}` : 'not captured'}
- Biggest pain right now: ${painLabel || 'not captured'}
- What they have in place today: ${currentSetup || 'not captured'}
- Anything else slipping through the cracks: ${secondaryPain || 'not captured'}
- Rep Notes: ${repNotes || 'No notes captured'}

CUSTOM PRICE TO CHARGE:
$${effectiveMonthly}/month + $${SETUP_FEE} one-time setup
${formulaExplanation}

RULES:
- Design 2-5 automations that directly solve THIS business's stated problems — problem-first, not feature-first
- Almost every lead needs some form of always-on call/lead capture — include it if missed calls or slow response is a factor
- Give each automation a short, plain-English name (2-4 words) and a one-line description of what it does
- Anchor ALL talking points and ROI arguments to exactly $${effectiveMonthly}/month and $${SETUP_FEE} setup
- Lead with missed revenue recovery, not features
- Reference specific numbers and their stated pain from the context when available

CLOSER: ${closerName || 'Nate'}

Respond with ONLY valid JSON, no markdown:
{
  "recommended_automations": [{"name": "Short Name", "description": "One-line description"}],
  "confidence": "high|medium|low",
  "headline": "One punchy sentence — max 12 words",
  "roi_argument": "Specific dollar-anchored ROI argument using the numbers above",
  "pain_points": ["3-4 pain points from rep notes/discovery answers or inferred from niche"],
  "why_pitch_this": "2-3 sentences on why this specific stack for this specific business",
  "talking_points": ["3-4 concrete talking points for ${closerName || 'Nate'} to use on the call"],
  "pushback_response": "What to say if they push back on the $${effectiveMonthly}/month price",
  "alternative_automations": [{"name": "Short Name", "description": "One-line description"}],
  "alternative_reason": "One line — when to offer the alternative stack instead",
  "upsell_path": "One sentence — how to expand the stack if they're open to it"
}`

    const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
    let rec: Record<string, unknown> | null = null

    if (apiKey) {
      try {
        const anthropic = new Anthropic({ apiKey })
        const message = await anthropic.messages.create({
          model: 'claude-haiku-4-5',
          max_tokens: 1200,
          messages: [{ role: 'user', content: prompt }],
        })

        const rawText = message.content[0].type === 'text' ? message.content[0].text.trim() : '{}'

        let parsed: Record<string, unknown>
        try {
          parsed = JSON.parse(rawText)
        } catch {
          const match = rawText.match(/```(?:json)?\s*([\s\S]*?)```/)
          parsed = match ? JSON.parse(match[1].trim()) : {}
        }

        // Coerce + validate: each automation needs a non-empty name; description optional.
        function normalizeAutomations(raw: unknown): Automation[] {
          if (!Array.isArray(raw)) return []
          return raw
            .map(a => {
              if (a && typeof a === 'object' && typeof (a as Automation).name === 'string') {
                return { name: (a as Automation).name.trim(), description: String((a as Automation).description || '').trim() }
              }
              if (typeof a === 'string') return { name: a, description: '' }
              return null
            })
            .filter((a): a is Automation => !!a && a.name.length > 0)
            .slice(0, 5)
        }

        const validatedAutomations = normalizeAutomations(parsed.recommended_automations)
        const resolvedTier = priceToTier(effectiveMonthly)

        if (validatedAutomations.length >= 1) {
          rec = {
            recommended_tier: resolvedTier,
            recommended_automations: validatedAutomations,
            custom_monthly_price: effectiveMonthly,
            confidence: parsed.confidence || 'medium',
            headline: parsed.headline || '',
            roi_argument: parsed.roi_argument || '',
            pain_points: parsed.pain_points || [],
            why_pitch_this: parsed.why_pitch_this || '',
            talking_points: parsed.talking_points || [],
            pushback_response: parsed.pushback_response || '',
            alternative_automations: normalizeAutomations(parsed.alternative_automations),
            alternative_reason: parsed.alternative_reason || '',
            upsell_path: parsed.upsell_path || '',
          }
        }
      } catch (apiErr) {
        console.warn('[recommend-stack] API error, using fallback:', String(apiErr))
      }
    }

    if (!rec) {
      rec = deterministicFallback({
        callsMissedPerWeek, avgTicket, monthlyLaborCost, repNotes, niche, customMonthly,
        primaryPain: painLabel, currentSetup, secondaryPain,
      }) as Record<string, unknown>
    }

    return new Response(
      JSON.stringify({ rec, packages: PACKAGES, setupFee: SETUP_FEE }),
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
