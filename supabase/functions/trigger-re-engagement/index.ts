import { createClient } from 'npm:@supabase/supabase-js'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Runs nightly via pg_cron or Supabase scheduled function.
// Finds leads that were Voicemail/No Answer with a batch_date of yesterday,
// and schedules the 3-step re-engagement sequence.
//
// WIRE-THIS: Add actual Twilio send calls once Twilio account is provisioned.
// Currently writes sequence rows to re_engagement_log but does NOT send messages.

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  const yesterdayStr = yesterday.toISOString().split('T')[0]

  // Find eligible leads: Voicemail or No Answer from yesterday's batch, not already in re-engagement
  const { data: leads, error } = await supabase
    .from('leads')
    .select('id')
    .in('status', ['Voicemail', 'No Answer'])
    .eq('batch_date', yesterdayStr)
    .eq('re_engagement_active', false)

  if (error) {
    return new Response(JSON.stringify({ error }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  if (!leads?.length) {
    return new Response(JSON.stringify({ message: 'No leads to re-engage' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  const now = new Date()

  // Schedule 3-step sequence for each lead
  const rows = leads.flatMap(lead => [
    {
      lead_id: lead.id,
      sequence_step: 1,
      channel: 'sms',
      scheduled_at: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(), // +24h
      status: 'pending',
    },
    {
      lead_id: lead.id,
      sequence_step: 2,
      channel: 'email',
      scheduled_at: new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000).toISOString(), // +72h
      status: 'pending',
    },
    {
      lead_id: lead.id,
      sequence_step: 3,
      channel: 'sms',
      scheduled_at: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(), // +7d
      status: 'pending',
    },
  ])

  const [insertResult, flagResult] = await Promise.all([
    supabase.from('re_engagement_log').insert(rows),
    supabase
      .from('leads')
      .update({ re_engagement_active: true })
      .in('id', leads.map(l => l.id)),
  ])

  return new Response(JSON.stringify({
    success: true,
    leads_queued: leads.length,
    rows_created: rows.length,
    insert_error: insertResult.error,
    flag_error: flagResult.error,
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  })
})
