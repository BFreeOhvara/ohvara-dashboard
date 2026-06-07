import { createClient } from 'npm:@supabase/supabase-js'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Called by a Supabase DB trigger (pg_net) or directly when a lead is set to Booked
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const { lead_id, rep_id } = await req.json()

  if (!lead_id) {
    return new Response(JSON.stringify({ error: 'lead_id required' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  // Get the closer who was least recently assigned (round-robin)
  const { data: rotation, error: rotErr } = await supabase
    .from('closer_rotation')
    .select('closer_id, last_assigned_at')
    .order('last_assigned_at', { ascending: true, nullsFirst: true })
    .limit(1)
    .single()

  if (rotErr || !rotation) {
    return new Response(JSON.stringify({ error: 'No closers in rotation', detail: rotErr }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  const closerId = rotation.closer_id

  // Assign the lead to the closer and create an appointment record
  const [leadUpdate, appointmentInsert] = await Promise.all([
    supabase
      .from('leads')
      .update({ assigned_closer_id: closerId })
      .eq('id', lead_id),
    supabase
      .from('appointments')
      .insert({
        lead_id,
        closer_id: closerId,
        rep_id: rep_id || null,
        status: 'pending',
      }),
  ])

  if (leadUpdate.error || appointmentInsert.error) {
    return new Response(JSON.stringify({ error: leadUpdate.error || appointmentInsert.error }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  // Update rotation timestamp
  await supabase
    .from('closer_rotation')
    .update({ last_assigned_at: new Date().toISOString() })
    .eq('closer_id', closerId)

  return new Response(JSON.stringify({ success: true, closer_id: closerId }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  })
})
