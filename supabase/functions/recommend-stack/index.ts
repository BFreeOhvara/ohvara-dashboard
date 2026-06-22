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
// Tunable constants flagged here: 4.33 (weeks/month), 0.15 (take rate), 397/1997 (floor/ceiling).
function formulaPrice(callsMissedPerWeek: number | null, avgTicket: number | null): number | null {
  if (!callsMissedPerWeek || !avgTicket || callsMissedPerWeek <= 0 || avgTicket <= 0) return null
  const monthlyLost = callsMissedPerWeek * 4.33 * avgTicket
  if (monthlyLost < 500) return null  // not enough signal to formula-price
  return Math.round(clamp(monthlyLost * 0.15, 397, 1997) / 10) * 10  // round to nearest $10
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

type Automation = { name: string; description: string; customer_benefit?: string }

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
    { name: 'AI Receptionist', description: '24/7 call answering — captures every lead, even after hours', customer_benefit: 'You get every inbound call answered, even when your crew is on a job — no leads slip through' },
  ]

  const painLabel = primaryPain ? PAIN_LABELS[primaryPain] : null
  if (painLabel === 'missed calls' || (callsMissedPerWeek && callsMissedPerWeek > 0)) {
    automations.push({ name: 'Missed Call Text Back', description: 'Auto-SMS to any caller who doesn\'t get answered', customer_benefit: 'Every missed call gets an instant text back — prospects stay warm instead of calling someone else' })
  }
  if (painLabel === 'slow response times') {
    automations.push({ name: 'Instant Lead Response', description: 'AI replies to every new inquiry within seconds, day or night', customer_benefit: 'Every new inquiry gets a reply in seconds — before they move on to the next business' })
  }
  if (painLabel === 'no-shows') {
    automations.push({ name: 'Appointment Reminders', description: 'SMS reminders that cut no-shows by 60%+', customer_benefit: 'No-shows drop dramatically because customers get reminders that actually get seen' })
  }
  if (painLabel === 'leads who called but never booked') {
    automations.push({ name: 'Lead Follow-Up Automation', description: 'Multi-touch follow-up for quotes that go quiet', customer_benefit: 'Quotes that went quiet come back to life — the system follows up so you don\'t have to' })
  }

  const notes = `${repNotes || ''} ${currentSetup || ''} ${secondaryPain || ''}`.toLowerCase()
  if (notes.includes('review') || notes.includes('reputation') || notes.includes('rating')) {
    automations.push({ name: 'Review Generation', description: 'Auto-requests 5-star reviews from completed jobs', customer_benefit: 'You build a 5-star reputation automatically, without ever having to ask' })
  }
  if (notes.includes('dispatch') || notes.includes('route') || notes.includes('crew')) {
    automations.push({ name: 'AI Dispatcher', description: 'Intelligent call routing to the right crew member', customer_benefit: 'Every call goes to the right person instantly — no hold times, no chaos' })
  }
  if (notes.includes('marketing') || notes.includes('repeat') || notes.includes('seasonal')) {
    automations.push({ name: 'SMS Marketing', description: 'Monthly campaigns to past customers for repeat jobs', customer_benefit: 'Past customers come back on their own — repeat jobs without any extra sales effort' })
  }
  if (notes.includes('website') || notes.includes('web') || notes.includes('online')) {
    automations.push({ name: 'Professional Website', description: 'Mobile-first site that converts visitors to booked calls', customer_benefit: 'You get a site that turns visitors into booked calls, not just a brochure' })
  }

  // Ensure a minimum of 4 automations so the split+floor always has material to work with.
  const fallbackPad = [
    { name: 'Missed Call Text Back', description: 'Auto-SMS to any caller who doesn\'t get answered', customer_benefit: 'Every missed call gets an instant text back — prospects stay warm instead of calling someone else' },
    { name: 'Appointment Reminders', description: 'SMS reminders that cut no-shows by 60%+', customer_benefit: 'No-shows drop dramatically because customers get reminders that actually get seen' },
    { name: 'Review Generation', description: 'Auto-requests 5-star reviews from completed jobs', customer_benefit: 'You build a 5-star reputation automatically, without ever having to ask' },
    { name: 'Lead Follow-Up Automation', description: 'Multi-touch follow-up for quotes that go quiet', customer_benefit: 'Quotes that went quiet come back to life — the system follows up so you don\'t have to' },
  ]
  for (const a of fallbackPad) {
    if (automations.length >= 4) break
    if (!automations.some(x => x.name === a.name)) automations.push(a)
  }
  return automations.slice(0, 7)
}

// Splits a flat, ordered automation list into 1-2 front-runners (the
// headline agents, always first) + up to 5 sub-agents (the rest).
function splitFrontRunners(automations: Automation[]): { frontRunners: Automation[]; subAgents: Automation[] } {
  const frontRunners = automations.slice(0, Math.min(2, automations.length || 1))
  const subAgents = automations.slice(frontRunners.length, frontRunners.length + 5)
  return { frontRunners, subAgents }
}

// Safety net (Prompt 12 fix 2): the AI doesn't always honor "both tiers
// required," and the deterministic fallback's short automation pools can
// split too unevenly on their own. Promotes/demotes one agent across the
// boundary so neither tier ever comes back empty, without ever dropping
// below 1 front-runner.
function enforceBothTiers(frontRunners: Automation[], subAgents: Automation[]): { frontRunners: Automation[]; subAgents: Automation[] } {
  let fr = [...frontRunners]
  let sub = [...subAgents]
  if (fr.length === 0 && sub.length > 0) {
    fr = [sub[0]]
    sub = sub.slice(1)
  }
  if (sub.length === 0 && fr.length > 1) {
    sub = [fr[fr.length - 1]]
    fr = fr.slice(0, -1)
  }
  return { frontRunners: fr, subAgents: sub }
}

// Curated pool for padding sub-agents when the AI or fallback returns too few.
// Ordered by how broadly applicable they are to SMB phone-booking businesses.
const AUTOMATION_POOL: Automation[] = [
  { name: 'Appointment Reminders', description: 'SMS reminders that cut no-shows by 60%+', customer_benefit: 'No-shows drop dramatically because customers get reminders that actually get seen' },
  { name: 'Review Generation', description: 'Auto-requests 5-star reviews from completed jobs', customer_benefit: 'You build a 5-star reputation automatically, without ever having to ask' },
  { name: 'Lead Follow-Up Automation', description: 'Multi-touch follow-up for quotes that go quiet', customer_benefit: 'Quotes that went quiet come back to life — the system follows up so you don\'t have to' },
  { name: 'After-Hours Call Handler', description: 'Captures leads when the office is closed', customer_benefit: 'Leads coming in after hours still get answered — you never lose a job to off-hours timing' },
  { name: 'Booking Confirmation SMS', description: 'Instant confirmation text when appointments are scheduled', customer_benefit: 'Every new booking gets instant confirmation — customers feel taken care of from the start' },
  { name: 'Customer Reactivation', description: 'Re-engages past customers for repeat and referral business', customer_benefit: 'Past customers come back on their own — repeat jobs without any extra sales effort' },
  { name: 'Missed Call Text Back', description: 'Auto-SMS to any caller who doesn\'t get answered', customer_benefit: 'Every missed call gets an instant text back — prospects stay warm instead of calling someone else' },
  { name: 'Job Status Updates', description: 'Automated SMS keeping customers informed on job progress', customer_benefit: 'Customers stay informed without calling in — fewer interruptions, happier jobs' },
]

// Enforces the stack composition floor: sub_agents ≥ 2 × front_runners.length.
// Pads from AUTOMATION_POOL (de-duped against what's already in the stack) when
// the AI or deterministic fallback returns fewer sub-agents than required.
function enforceStackFloor(frontRunners: Automation[], subAgents: Automation[]): { frontRunners: Automation[]; subAgents: Automation[] } {
  const minSubs = frontRunners.length * 2
  if (subAgents.length >= minSubs) return { frontRunners, subAgents }
  const existing = new Set([...frontRunners, ...subAgents].map(a => a.name.toLowerCase()))
  const padded = [...subAgents]
  for (const candidate of AUTOMATION_POOL) {
    if (padded.length >= minSubs) break
    if (!existing.has(candidate.name.toLowerCase())) {
      padded.push(candidate)
      existing.add(candidate.name.toLowerCase())
    }
  }
  return { frontRunners, subAgents: padded }
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
  const split = splitFrontRunners(automations)
  const { frontRunners: bothTiersFR, subAgents: bothTiersSub } = enforceBothTiers(split.frontRunners, split.subAgents)
  const { frontRunners, subAgents } = enforceStackFloor(bothTiersFR, bothTiersSub)
  const tier = customMonthly ? priceToTier(customMonthly) : laborTier(monthlyLaborCost)
  const monthly = customMonthly || PACKAGES[tier].monthly
  const painLabel = primaryPain ? PAIN_LABELS[primaryPain] : null

  const missedRevStr = (callsMissedPerWeek && avgTicket)
    ? `You're missing ~${Math.round(callsMissedPerWeek * 4.33)} calls/month at $${avgTicket}/ticket — that's $${Math.round(callsMissedPerWeek * 4.33 * avgTicket).toLocaleString()}/month walking out the door.`
    : `At your current call volume, 2-3 missed calls a week adds up to thousands in lost revenue every month.`

  return {
    recommended_tier: tier,
    front_runners: frontRunners,
    sub_agents: subAgents,
    recommended_automations: [...frontRunners, ...subAgents],
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
- Identify the 1-2 MOST CRITICAL problems this business described, then assign 1-2 front-runner agents that directly solve them — these are the headline of the sale
- Assign 1-5 sub-agents that complement and amplify the front-runners (make one smarter, handle its edge cases, extend its reach). No standalone sub-agent that could exist without a front-runner — every sub-agent must have a clear relationship to one
- You MUST return 1-2 front-runner agents AND at least 2 sub-agents per front-runner: with 1 front-runner return ≥2 sub-agents (≥3 total); with 2 front-runners return ≥4 sub-agents (≥6 total). Never return only one tier, and never return fewer sub-agents than 2× the front-runner count
- Almost every lead needs some form of always-on call/lead capture as a front-runner — include it if missed calls or slow response is a factor
- Give each agent a short, SPECIFIC, plain-English name (2-4 words) that names the job it does — "After-Hours Call Handler," not "AI Receptionist." Avoid generic names
- No agent should sound generic or overlap another. If there's overlap, combine into one
- Anchor ALL talking points and ROI arguments to exactly $${effectiveMonthly}/month and $${SETUP_FEE} setup
- Lead with missed revenue recovery, not features
- Reference specific numbers and their stated pain from the context when available

CLOSER: ${closerName || 'Nate'}

Respond with ONLY valid JSON, no markdown:
{
  "front_runners": [{"name": "Short Specific Name", "description": "One-line description of what the automation does", "customer_benefit": "You get [specific benefit tied to their diagnosed pain] — written as what the customer experiences, not a feature description"}],
  "sub_agents": [{"name": "Short Specific Name", "description": "One-line description of what the automation does", "customer_benefit": "You get [specific benefit tied to their diagnosed pain] — written as what the customer experiences, not a feature description"}],
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

    const demoMode = Deno.env.get('DEMO_MODE') === 'true'
    const apiKey = demoMode ? null : Deno.env.get('ANTHROPIC_API_KEY')
    let rec: Record<string, unknown> | null = null

    if (apiKey) {
      try {
        const anthropic = new Anthropic({ apiKey })
        const message = await anthropic.messages.create({
          model: 'claude-haiku-4-5',
          max_tokens: 1500,
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
        function normalizeAutomations(raw: unknown, max = 5): Automation[] {
          if (!Array.isArray(raw)) return []
          return raw
            .map(a => {
              if (a && typeof a === 'object' && typeof (a as Automation).name === 'string') {
                const benefit = String((a as Automation).customer_benefit || '').trim()
                return {
                  name: (a as Automation).name.trim(),
                  description: String((a as Automation).description || '').trim(),
                  ...(benefit ? { customer_benefit: benefit } : {}),
                }
              }
              if (typeof a === 'string') return { name: a, description: '' }
              return null
            })
            .filter((a): a is Automation => !!a && a.name.length > 0)
            .slice(0, max)
        }

        const validatedFrontRunners = normalizeAutomations(parsed.front_runners, 2)
        const validatedSubAgents = normalizeAutomations(parsed.sub_agents, 5)
        const { frontRunners: enforcedFrontRunners, subAgents: enforcedSubAgents } = enforceBothTiers(validatedFrontRunners, validatedSubAgents)
        const { frontRunners: finalFrontRunners, subAgents: finalSubAgents } = enforceStackFloor(enforcedFrontRunners, enforcedSubAgents)
        const resolvedTier = priceToTier(effectiveMonthly)

        if (finalFrontRunners.length >= 1) {
          rec = {
            recommended_tier: resolvedTier,
            front_runners: finalFrontRunners,
            sub_agents: finalSubAgents,
            // Combined list — backward compat for any code/data still reading the flat array.
            recommended_automations: [...finalFrontRunners, ...finalSubAgents],
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
