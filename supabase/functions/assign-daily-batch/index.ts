import { createClient } from 'npm:@supabase/supabase-js'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const LEADS_PER_REP = 150

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const today = new Date().toISOString().split('T')[0]

  // Get active reps
  const { data: reps, error: repsError } = await supabase
    .from('profiles')
    .select('id')
    .eq('role', 'rep')
    .eq('is_active', true)

  if (repsError || !reps?.length) {
    return new Response(JSON.stringify({ error: 'No active reps', detail: repsError }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  // Get unassigned New leads (Indeed first, then Google Maps)
  const { data: leads, error: leadsError } = await supabase
    .from('leads')
    .select('id, source')
    .eq('status', 'New')
    .is('assigned_rep_id', null)
    .order('source', { ascending: false }) // indeed > google_maps alphabetically descending
    .order('created_at', { ascending: true })
    .limit(reps.length * LEADS_PER_REP)

  if (leadsError) {
    return new Response(JSON.stringify({ error: leadsError }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  if (!leads?.length) {
    return new Response(JSON.stringify({ message: 'No unassigned leads available' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  // Distribute leads round-robin across reps
  const assignments: Record<string, string[]> = {}
  reps.forEach(r => { assignments[r.id] = [] })

  leads.forEach((lead, i) => {
    const repId = reps[i % reps.length].id
    assignments[repId].push(lead.id)
  })

  const results = []
  for (const [repId, leadIds] of Object.entries(assignments)) {
    if (!leadIds.length) continue

    const batch = leadIds.slice(0, LEADS_PER_REP)

    const { error } = await supabase
      .from('leads')
      .update({ assigned_rep_id: repId, batch_date: today })
      .in('id', batch)

    if (!error) {
      await supabase.from('batch_assignments').insert({
        rep_id: repId,
        batch_date: today,
        lead_count: batch.length,
      })
      results.push({ repId, assigned: batch.length })
    }
  }

  return new Response(JSON.stringify({ success: true, results }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  })
})
