import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Same deterministic hash + seeded PRNG as src/lib/syntheticStats.js (dashboard)
// — kept in sync by hand since this runs in Deno, not the Vite bundle. Same
// automation name always produces the same sample numbers.
function hashStr(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) { h = (h << 5) - h + s.charCodeAt(i); h |= 0 }
  return Math.abs(h) || 1
}

function seededRandom(seed: number) {
  let s = seed % 2147483647
  if (s <= 0) s += 2147483646
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646 }
}

function syntheticStatsFor(name: string, description: string | null, index: number) {
  const rand = seededRandom(hashStr(name + index))
  const actions = Math.round(20 + rand() * 70)
  const successRate = Math.round(60 + rand() * 35)
  const value = Math.round((400 + rand() * 3800) / 50) * 50
  return {
    actions,
    successRate,
    value,
    feed: [
      `${name} triggered — ${Math.round(rand() * 50) + 1} min ago`,
      description ? `${description} — Yesterday` : 'New activity logged — Yesterday',
      `${Math.max(1, Math.round(actions / 10))} actions completed this week`,
    ],
  }
}

function fakePhoneNumber(seed: string): string {
  const rand = seededRandom(hashStr(seed))
  const area = [469, 214, 972, 713, 281, 832][Math.floor(rand() * 6)]
  const mid = 200 + Math.floor(rand() * 800)
  const last = 1000 + Math.floor(rand() * 9000)
  return `+1 (${area}) ${mid}-${last}`
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { appointmentId } = await req.json()
    if (!appointmentId) {
      return new Response(
        JSON.stringify({ error: 'appointmentId is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const { data: appt, error: apptError } = await supabase
      .from('appointments')
      .select('id, lead_id, leads!inner(business_name, niche, recommended_stack, custom_monthly_price)')
      .eq('id', appointmentId)
      .single()

    if (apptError || !appt) {
      return new Response(
        JSON.stringify({ error: 'Appointment not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const lead = Array.isArray(appt.leads) ? appt.leads[0] : appt.leads
    const rec = lead?.recommended_stack || {}
    const monthlyPrice = rec.custom_monthly_price ?? lead?.custom_monthly_price ?? 497

    let frontRunners = rec.front_runners || []
    let subAgents = rec.sub_agents || []
    if (frontRunners.length === 0 && subAgents.length === 0 && rec.recommended_automations?.length > 0) {
      frontRunners = rec.recommended_automations.slice(0, 2)
      subAgents = rec.recommended_automations.slice(2)
    }

    const automations = [
      ...frontRunners.map((a: any) => ({ ...a, tier: 'front' })),
      ...subAgents.map((a: any) => ({ ...a, tier: 'sub' })),
    ].map((a, i) => {
      const stats = syntheticStatsFor(a.name, a.description || null, i)
      return {
        name: a.name,
        description: a.customer_benefit || a.description || null,
        tier: a.tier,
        ...stats,
      }
    })

    return new Response(
      JSON.stringify({
        businessName: lead?.business_name || 'Your Business',
        niche: lead?.niche || null,
        monthlyPrice,
        phoneNumber: fakePhoneNumber(appointmentId),
        automations,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[get-demo-preview]', msg)
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
