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
      clientEmail,
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

    // 2. Create (or reuse) the client record. Billed monthly_value priority:
    // override_price (Nate's negotiated price) > recommendedPrice (the actual
    // custom formula price from recommend-stack) > getTierPrice(tier) (last-
    // resort fallback for old/incomplete data only — tier is a closest-color
    // label now, not a sellable price point, so this should rarely fire).
    const finalMonthlyValue = typeof overridePrice === 'number' && overridePrice > 0
      ? overridePrice
      : typeof recommendedPrice === 'number' && recommendedPrice > 0
        ? recommendedPrice
        : getTierPrice(tier)

    const clientFields = {
      business_name: businessName,
      niche: niche || null,
      location: location || null,
      tier,
      status: 'onboarding',
      monthly_value: finalMonthlyValue,
      setup_fee: 297,
      recommended_tier: recommendedTier || null,
      recommended_price: typeof recommendedPrice === 'number' ? recommendedPrice : null,
      override_price: typeof overridePrice === 'number' && overridePrice > 0 ? overridePrice : null,
    }

    // Prompt 7/8: if this appointment already has a demo account (provisioned
    // automatically at booking), convert it in place — update the same
    // clients row + reuse the same login, rather than spawning a duplicate.
    const { data: existingAppt } = await supabase
      .from('appointments')
      .select('demo_client_id')
      .eq('id', appointmentId)
      .single()

    let client: { id: string; profile_id: string | null } | null = null
    let login: { userId: string; username: string; password: string } | null = null
    let reusedDemo = false

    if (existingAppt?.demo_client_id) {
      const { data: updated, error: updateError } = await supabase
        .from('clients')
        .update(clientFields)
        .eq('id', existingAppt.demo_client_id)
        .select('id, profile_id')
        .single()
      if (updateError) throw new Error(`Failed to convert demo client: ${updateError.message}`)
      client = updated
      reusedDemo = true

      // Swap the demo-{leadId}@ohvara.internal identity for a real email if
      // Nate provided one (or the lead has one on file) — same password, so
      // there's nothing new to hand the client who already saw the demo.
      const realEmail = (clientEmail || '').trim()
      if (client.profile_id && realEmail) {
        const { error: emailError } = await supabase.auth.admin.updateUserById(client.profile_id, {
          email: realEmail,
          email_confirm: true,
        })
        if (emailError) console.error('[provision-client] email update failed:', emailError.message)
      }
    } else {
      const { data: created, error: clientError } = await supabase
        .from('clients')
        .insert(clientFields)
        .select('id, profile_id')
        .single()
      if (clientError) throw new Error(`Failed to create client: ${clientError.message}`)
      client = created

      // 3. Create the client's login (auth.users + profiles role='client') and link it
      login = await createClientLogin(supabase, businessName)
      if (login) {
        await supabase.from('clients').update({ profile_id: login.userId }).eq('id', client.id)
      }
    }

    // Demo account is now a real one — clear the appointment's demo pointer
    // so the closer UI stops showing "Open Client Preview" for it.
    if (reusedDemo) {
      await supabase.from('appointments').update({ demo_client_id: null, demo_credentials: null }).eq('id', appointmentId)
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
    const dealLabel = `${businessName} closed on ${tier[0].toUpperCase() + tier.slice(1)} ($${finalMonthlyValue}/mo)`
    const notifMessage = reusedDemo
      ? `${dealLabel} — converted from demo account, same login as shown on the call`
      : login
        ? `${dealLabel} — login: ${login.username} / ${login.password}`
        : `${dealLabel} — login creation FAILED, create manually`

    await supabase.from('notifications').insert({
      type: 'new_client',
      message: notifMessage,
      data: {
        clientId: client.id,
        tier,
        closerId,
        appointmentId,
        reusedDemo,
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
        reusedDemo,
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
