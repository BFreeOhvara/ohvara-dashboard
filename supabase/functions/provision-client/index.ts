import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function getTierPrice(tier: string): number {
  const prices: Record<string, number> = { basic: 497, pro: 797, premium: 1297, elite: 1797 }
  return prices[tier] ?? 497
}

function generateOnboardingQuestions(
  tier: string,
  businessName: string,
  niche: string
): Array<{ id: string; question: string; type: string; required: boolean; options?: string[] }> {
  // Core — every tier
  const core = [
    { id: 'owner_name',     question: "What's your first name?",                                                               type: 'text',     required: true },
    { id: 'owner_email',    question: "What's your email address?",                                                             type: 'email',    required: true },
    { id: 'business_phone', question: `What's the main phone number for ${businessName}?`,                                     type: 'phone',    required: true },
    { id: 'city_state',     question: "What city and state are you in?",                                                        type: 'text',     required: true },
    { id: 'services',       question: `What ${niche} services do you offer? (list them out)`,                                  type: 'textarea', required: true },
    { id: 'hours',          question: "What are your business hours?",                                                          type: 'text',     required: true },
    { id: 'after_hours',    question: "After hours — should the AI take a message, or transfer to your cell?",                 type: 'select',   required: true, options: ['Take a message', 'Transfer to my cell'] },
  ]

  // Pro+ — review platform
  const proQuestions = tier !== 'basic'
    ? [{ id: 'review_platform', question: "Where do you want more reviews — Google, Facebook, or both?", type: 'select', required: true, options: ['Google', 'Facebook', 'Both'] }]
    : []

  // Premium+ — dispatcher info
  const premiumQuestions = ['premium', 'elite'].includes(tier)
    ? [
        { id: 'team_size',      question: "How many people are on your team right now?",               type: 'number',   required: true },
        { id: 'dispatch_method', question: "How do you currently assign jobs to your team?",           type: 'textarea', required: false },
      ]
    : []

  // Elite — website info
  const eliteQuestions = tier === 'elite'
    ? [
        { id: 'website_style',  question: "Describe your ideal website in a few words (e.g. dark and professional, bright and friendly)", type: 'text', required: false },
        { id: 'competitors',    question: "Name 1-2 competitors you admire or want to stand out from",                                    type: 'text', required: false },
      ]
    : []

  return [...core, ...proQuestions, ...premiumQuestions, ...eliteQuestions]
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const {
      appointmentId,
      tier,
      closerId,
      businessName,
      niche,
      location,
      monthlyLaborCost,
    } = await req.json()

    if (!appointmentId || !tier || !businessName) {
      return new Response(
        JSON.stringify({ error: 'appointmentId, tier, and businessName are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // 1. Mark appointment closed
    await supabase.from('appointments').update({
      status: 'completed',
      outcome: 'closed',
      closed_at: new Date().toISOString(),
      closed_tier: tier,
      closer_id: closerId,
    }).eq('id', appointmentId)

    // 2. Create client record
    const { data: client, error: clientError } = await supabase
      .from('clients')
      .insert({
        business_name: businessName,
        niche: niche || null,
        location: location || null,
        tier,
        status: 'onboarding',
        monthly_value: getTierPrice(tier),
        setup_fee: 497,
      })
      .select()
      .single()

    if (clientError) throw new Error(`Failed to create client: ${clientError.message}`)

    // 3. Generate onboarding questions per tier
    const questions = generateOnboardingQuestions(tier, businessName, niche || 'service')

    // 4. Create onboarding record
    await supabase.from('onboarding').insert({
      client_id: client.id,
      tier,
      status: 'pending_info',
      questions,
    })

    // 5. Create admin notification
    await supabase.from('notifications').insert({
      type: 'new_client',
      message: `${businessName} closed on ${tier[0].toUpperCase() + tier.slice(1)} ($${getTierPrice(tier)}/mo)`,
      data: { clientId: client.id, tier, closerId, appointmentId },
    })

    const portalUrl = `${Deno.env.get('CLIENT_PORTAL_URL') || 'https://client.ohvara.com'}/onboard/${client.id}`

    return new Response(
      JSON.stringify({
        success: true,
        clientId: client.id,
        tier,
        monthlyValue: getTierPrice(tier),
        onboardingUrl: portalUrl,
        questionCount: questions.length,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[provision-client]', msg)
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
