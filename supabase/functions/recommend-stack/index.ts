import Anthropic from 'npm:@anthropic-ai/sdk'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// À la carte automation catalog — the menu Nate sells from.
// price fields are reference only; the actual charged price is formula-derived.
const AUTOMATION_CATALOG = [
  { id: 'ai_receptionist',       name: 'AI Receptionist',           desc: '24/7 call answering — captures every lead, even after hours' },
  { id: 'missed_call_text_back', name: 'Missed Call Text Back',     desc: 'Auto-SMS to any caller who doesn\'t get answered' },
  { id: 'review_generation',     name: 'Review Generation',         desc: 'Auto-requests 5-star reviews from completed jobs' },
  { id: 'lead_followup',         name: 'Lead Follow-Up Automation', desc: 'Multi-touch follow-up for quotes that go quiet' },
  { id: 'appointment_reminders', name: 'Appointment Reminders',     desc: 'SMS reminders that cut no-shows by 60%+' },
  { id: 'ai_dispatcher',         name: 'AI Dispatcher',             desc: 'Intelligent call routing to the right crew member' },
  { id: 'sms_marketing',         name: 'SMS Marketing',             desc: 'Monthly campaigns to past customers for repeat jobs' },
  { id: 'website',               name: 'Professional Website',      desc: 'Mobile-first site that converts visitors to booked calls' },
] as const

type AutomationId = typeof AUTOMATION_CATALOG[number]['id']

// Packages kept for backward-compat: closest-tier display name + Stripe link generation.
// NOT used for pricing — that comes from the formula.
const PACKAGES = {
  basic:   { name: 'Basic',   setup: 497, monthly: 497,  services: ['AI Receptionist (24/7)', 'Missed Call Text Back'] },
  pro:     { name: 'Pro',     setup: 497, monthly: 797,  services: ['AI Receptionist (24/7)', 'Missed Call Text Back', 'Review Generation', 'Lead Follow-Up Automation', 'Appointment Reminders'] },
  premium: { name: 'Premium', setup: 497, monthly: 1297, services: ['AI Receptionist (24/7)', 'Missed Call Text Back', 'Review Generation', 'Lead Follow-Up Automation', 'Appointment Reminders', 'AI Dispatcher', 'SMS Marketing'] },
  elite:   { name: 'Elite',   setup: 497, monthly: 1797, services: ['AI Receptionist (24/7)', 'Missed Call Text Back', 'Review Generation', 'Lead Follow-Up Automation', 'Appointment Reminders', 'AI Dispatcher', 'SMS Marketing', 'Professional Website'] },
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

function deterministicFallback(inputs: {
  callsMissedPerWeek: number | null
  avgTicket: number | null
  monthlyLaborCost: number | null
  repNotes: string | null
  niche: string | null
  customMonthly: number | null
}): Record<string, unknown> {
  const { callsMissedPerWeek, avgTicket, monthlyLaborCost, repNotes, niche, customMonthly } = inputs

  // Heuristic automation selection from available signals
  const automations: AutomationId[] = ['ai_receptionist']
  if (callsMissedPerWeek && callsMissedPerWeek > 0) automations.push('missed_call_text_back')
  const notes = (repNotes || '').toLowerCase()
  if (notes.includes('review') || notes.includes('reputation') || notes.includes('rating')) automations.push('review_generation')
  if (notes.includes('follow') || notes.includes('ghost') || notes.includes('quote')) automations.push('lead_followup')
  if (notes.includes('no show') || notes.includes('cancel') || notes.includes('reminder')) automations.push('appointment_reminders')
  if (notes.includes('dispatch') || notes.includes('route') || notes.includes('crew')) automations.push('ai_dispatcher')
  if (notes.includes('marketing') || notes.includes('repeat') || notes.includes('seasonal')) automations.push('sms_marketing')
  if (notes.includes('website') || notes.includes('web') || notes.includes('online')) automations.push('website')
  if (automations.length < 2) automations.push('missed_call_text_back')

  const tier = customMonthly ? priceToTier(customMonthly) : laborTier(monthlyLaborCost)
  const monthly = customMonthly || PACKAGES[tier].monthly

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
    pain_points: ['Calls going unanswered while crew is on jobs', 'Quotes that go cold because nobody follows up', 'No way to capture after-hours leads'],
    why_pitch_this: `The selected automations directly address the gaps identified during your conversation — specifically the missed calls and follow-up problem.`,
    talking_points: [
      `At ${callsMissedPerWeek || 'a few'} missed calls per week, you're leaving real money on the table every month`,
      `This stack pays for itself with just 1-2 recovered jobs per month`,
      `Live in 48 hours — no downtime, no hiring, no training`,
    ],
    pushback_response: `Think of it this way — if we recover even one job per week that you would have missed, the stack has already paid for itself. We're just making sure you capture what's already coming your way.`,
    alternative_tier: tier === 'basic' ? 'pro' : 'basic',
    alternative_reason: tier === 'basic' ? 'If they want review generation and follow-up automation too, Pro covers those gaps' : 'If price is the objection, Basic still covers the highest-ROI automations',
    upsell_path: 'Once they see ROI in month 1, they typically want to add review generation and SMS marketing to compound the gains',
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
    } = await req.json()

    const customMonthly = formulaPrice(callsMissedPerWeek, avgTicket)
    const fallbackTier  = laborTier(monthlyLaborCost)
    const effectiveMonthly = customMonthly || PACKAGES[fallbackTier].monthly

    const catalogList = AUTOMATION_CATALOG.map(a => `- ${a.id}: ${a.name} — ${a.desc}`).join('\n')

    const formulaExplanation = customMonthly
      ? `Formula price: ${callsMissedPerWeek} missed calls/week × 4.33 weeks × $${avgTicket}/ticket = $${Math.round(callsMissedPerWeek * 4.33 * avgTicket).toLocaleString()}/month lost × 15% = $${customMonthly}/month for the stack`
      : `No formula data — price based on labor cost tier: $${effectiveMonthly}/month`

    const prompt = `You are a sales strategy AI for Ohvara, an SMB automation company. Analyze this lead and recommend an à la carte automation stack.

BUSINESS CONTEXT:
- Business: ${businessName || 'Unknown'} (${niche || 'general SMB'}) in ${location || 'unknown location'}
- Job Title: ${jobTitle || 'Owner'}
- Monthly Labor Cost: ${monthlyLaborCost ? `$${monthlyLaborCost}` : 'unknown'}
- Calls Missed Per Week: ${callsMissedPerWeek ?? 'not captured'}
- Avg Ticket Value: ${avgTicket ? `$${avgTicket}` : 'not captured'}
- Rep Notes: ${repNotes || 'No notes captured'}

CUSTOM PRICE TO CHARGE:
$${effectiveMonthly}/month + $497 one-time setup
${formulaExplanation}

AUTOMATION CATALOG (pick 2-5 that fit this lead):
${catalogList}

RULES:
- Always include ai_receptionist for any lead with missed call pain (almost every SMB)
- Select automations that directly address specific pain points in the rep notes
- Anchor ALL talking points and ROI arguments to exactly $${effectiveMonthly}/month and $497 setup
- Lead with missed revenue recovery, not features
- Reference specific numbers from the context when available

CLOSER: ${closerName || 'Nate'}

Respond with ONLY valid JSON, no markdown:
{
  "recommended_automations": ["id1", "id2"],
  "confidence": "high|medium|low",
  "headline": "One punchy sentence — max 12 words",
  "roi_argument": "Specific dollar-anchored ROI argument using the numbers above",
  "pain_points": ["3-4 pain points from rep notes or inferred from niche"],
  "why_pitch_this": "2-3 sentences on why this specific stack for this specific business",
  "talking_points": ["3-4 concrete talking points for ${closerName || 'Nate'} to use on the call"],
  "pushback_response": "What to say if they push back on the $${effectiveMonthly}/month price",
  "alternative_automations": ["id1", "id2"],
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
          max_tokens: 1000,
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

        const validIds = new Set(AUTOMATION_CATALOG.map(a => a.id))
        const validatedAutomations = ((parsed.recommended_automations || []) as string[]).filter(id => validIds.has(id as AutomationId))

        const resolvedTier = priceToTier(effectiveMonthly)

        if (parsed.recommended_automations) {
          rec = {
            recommended_tier: resolvedTier,
            recommended_automations: validatedAutomations.length >= 1 ? validatedAutomations : ['ai_receptionist', 'missed_call_text_back'],
            custom_monthly_price: effectiveMonthly,
            confidence: parsed.confidence || 'medium',
            headline: parsed.headline || '',
            roi_argument: parsed.roi_argument || '',
            pain_points: parsed.pain_points || [],
            why_pitch_this: parsed.why_pitch_this || '',
            talking_points: parsed.talking_points || [],
            pushback_response: parsed.pushback_response || '',
            alternative_tier: resolvedTier === 'basic' ? 'pro' : 'basic',
            alternative_reason: parsed.alternative_reason || '',
            upsell_path: parsed.upsell_path || '',
          }
        }
      } catch (apiErr) {
        console.warn('[recommend-stack] API error, using fallback:', String(apiErr))
      }
    }

    if (!rec) {
      rec = deterministicFallback({ callsMissedPerWeek, avgTicket, monthlyLaborCost, repNotes, niche, customMonthly }) as Record<string, unknown>
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
