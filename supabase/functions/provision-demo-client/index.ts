import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Closest-tier label only — for clients.tier's NOT NULL CHECK + UI color,
// never for billing (custom_monthly_price/monthly_value is the real number).
function priceToTier(monthly: number): string {
  if (monthly >= 1500) return 'elite'
  if (monthly >= 1000) return 'premium'
  if (monthly >= 650)  return 'pro'
  return 'basic'
}

function randomSuffix(length = 4): string {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789' // no ambiguous chars
  return Array.from({ length }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
}

function generatePassword(): string {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%'
  return Array.from({ length: 14 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const {
      appointmentId,
      leadId,
      businessName,
      niche,
      location,
      customMonthlyPrice,
      recommendedAutomations,
    } = await req.json()

    if (!appointmentId || !leadId || !businessName) {
      return new Response(
        JSON.stringify({ error: 'appointmentId, leadId, and businessName are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // Reuse an existing demo client for this lead if one already exists —
    // either this exact appointment already has one (re-fired call), or the
    // lead had a prior appointment (No Answer/Follow-Up cycle → rebooked)
    // that already spawned a demo. Either way, link the current appointment
    // to it instead of creating a duplicate account.
    const { data: existingAppt } = await supabase
      .from('appointments')
      .select('demo_client_id')
      .eq('id', appointmentId)
      .single()

    let existingClientId: string | null = existingAppt?.demo_client_id || null
    if (!existingClientId) {
      const { data: byLead } = await supabase
        .from('clients')
        .select('id')
        .eq('lead_id', leadId)
        .in('status', ['demo', 'onboarding', 'active'])
        .limit(1)
        .maybeSingle()
      existingClientId = byLead?.id || null
    }

    if (existingClientId) {
      await supabase.from('appointments').update({ demo_client_id: existingClientId }).eq('id', appointmentId)
      return new Response(
        JSON.stringify({ success: true, clientId: existingClientId, reused: true }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const monthly = typeof customMonthlyPrice === 'number' && customMonthlyPrice > 0 ? customMonthlyPrice : 497
    const tier = priceToTier(monthly)
    const automations = Array.isArray(recommendedAutomations) ? recommendedAutomations : []

    // 1. Demo client row — status='demo' so the portal shows the sample-data banner
    const { data: client, error: clientError } = await supabase
      .from('clients')
      .insert({
        business_name: businessName,
        niche: niche || null,
        location: location || null,
        tier,
        status: 'demo',
        monthly_value: monthly,
        setup_fee: 297,
        lead_id: leadId,
        recommended_tier: tier,
        recommended_price: monthly,
        recommended_automations: automations,
      })
      .select()
      .single()

    if (clientError) throw new Error(`Failed to create demo client: ${clientError.message}`)

    // 2. Demo login — email keyed to the lead so it's obviously a demo and
    // never collides with a real close on the same business.
    const username = `demo-${leadId}`
    const email = `${username}@ohvara.internal`
    const password = generatePassword()

    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: businessName, role: 'client', username },
    })

    if (authError || !authData.user) {
      // Non-fatal: the demo client row exists, just no login yet. Common cause
      // is the same lead booking twice — username collision.
      console.error('[provision-demo-client] login creation failed:', authError?.message)
    } else {
      await supabase.from('clients').update({ profile_id: authData.user.id }).eq('id', client.id)
    }

    const credentials = authData?.user ? { username, email, password } : null

    // 3. Link the appointment to the demo client + stash creds for Nate's UI
    await supabase.from('appointments').update({
      demo_client_id: client.id,
      demo_credentials: credentials,
    }).eq('id', appointmentId)

    const portalUrl = `${Deno.env.get('DASHBOARD_URL') || 'https://ohvara-dashboard.vercel.app'}/login`

    return new Response(
      JSON.stringify({
        success: true,
        clientId: client.id,
        portalUrl,
        credentials,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[provision-demo-client]', msg)
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
