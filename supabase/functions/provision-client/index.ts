import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function getTierPrice(tier: string): number {
  const prices: Record<string, number> = { basic: 497, pro: 797, premium: 1297, elite: 1797 }
  return prices[tier] ?? 497
}

function slugifyUsername(businessName: string): string {
  const base = businessName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24)
  return base || 'client'
}

function randomSuffix(length = 4): string {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789' // no ambiguous chars
  return Array.from({ length }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
}

function generatePassword(): string {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%'
  return Array.from({ length: 14 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
}

// Creates the client's login (auth.users + profiles via the handle_new_user trigger,
// same username@ohvara.internal pattern as admin-create-user). Retries the username
// once on collision. Auth creation failures are non-fatal — the close flow still
// produces a clients/onboarding row; manual login creation is the fallback.
async function createClientLogin(
  supabase: ReturnType<typeof createClient>,
  businessName: string
): Promise<{ userId: string; username: string; password: string } | null> {
  const baseSlug = slugifyUsername(businessName)
  const password = generatePassword()

  for (let attempt = 0; attempt < 2; attempt++) {
    const username = attempt === 0 ? baseSlug : `${baseSlug}-${randomSuffix()}`
    const email = `${username}@ohvara.internal`

    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: businessName, role: 'client', username },
    })

    if (!error && data.user) {
      return { userId: data.user.id, username, password }
    }

    const collision = error?.status === 422 || error?.message?.includes('already been registered')
    if (!collision) {
      console.error('[provision-client] login creation failed:', error?.message)
      return null
    }
    // collision — loop retries with a randomized suffix
  }

  console.error('[provision-client] login creation failed: username collisions exhausted')
  return null
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
      recommendedTier,
      recommendedPrice,
      overridePrice,
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

    // 2. Create client record — override_price (Nate's negotiated price, if set)
    // wins as the billed monthly_value; recommended_tier/recommended_price persist
    // the AI's recommendation at close time for later analysis.
    const finalMonthlyValue = typeof overridePrice === 'number' && overridePrice > 0
      ? overridePrice
      : getTierPrice(tier)

    const { data: client, error: clientError } = await supabase
      .from('clients')
      .insert({
        business_name: businessName,
        niche: niche || null,
        location: location || null,
        tier,
        status: 'onboarding',
        monthly_value: finalMonthlyValue,
        setup_fee: 497,
        recommended_tier: recommendedTier || null,
        recommended_price: typeof recommendedPrice === 'number' ? recommendedPrice : null,
        override_price: typeof overridePrice === 'number' && overridePrice > 0 ? overridePrice : null,
      })
      .select()
      .single()

    if (clientError) throw new Error(`Failed to create client: ${clientError.message}`)

    // 3. Create the client's login (auth.users + profiles role='client') and link it
    const login = await createClientLogin(supabase, businessName)
    if (login) {
      await supabase.from('clients').update({ profile_id: login.userId }).eq('id', client.id)
    }

    // 4. Generate onboarding questions per tier
    const questions = generateOnboardingQuestions(tier, businessName, niche || 'service')

    // 5. Create onboarding record
    await supabase.from('onboarding').insert({
      client_id: client.id,
      tier,
      status: 'pending_info',
      questions,
    })

    // 6. Create admin notification (carries the login credentials for manual handoff —
    // no client email automation exists yet)
    await supabase.from('notifications').insert({
      type: 'new_client',
      message: login
        ? `${businessName} closed on ${tier[0].toUpperCase() + tier.slice(1)} ($${finalMonthlyValue}/mo) — login: ${login.username} / ${login.password}`
        : `${businessName} closed on ${tier[0].toUpperCase() + tier.slice(1)} ($${finalMonthlyValue}/mo) — login creation FAILED, create manually`,
      data: {
        clientId: client.id,
        tier,
        closerId,
        appointmentId,
        ...(login ? { clientLogin: { username: login.username, password: login.password } } : {}),
      },
    })

    // The client logs into the main dashboard now (no UUID-in-URL flow) — their
    // first login lands on /client, which prompts to finish onboarding if
    // incomplete. Standalone ohvara-client-portal retired (migration 032/033).
    const portalUrl = `${Deno.env.get('DASHBOARD_URL') || 'https://ohvara-dashboard.vercel.app'}/login`

    return new Response(
      JSON.stringify({
        success: true,
        clientId: client.id,
        tier,
        monthlyValue: finalMonthlyValue,
        onboardingUrl: portalUrl,
        questionCount: questions.length,
        clientLogin: login ? { username: login.username, password: login.password } : null,
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
