import { createClient } from 'npm:@supabase/supabase-js'
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { isCron } from '../_shared/cronAuth.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  // Only pg_cron (Vault secret, P767) or the service key may run this job.
  const bearer = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
  if (bearer !== Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') && !(await isCron(req, supabase))) {
    return new Response(JSON.stringify({ error: 'Not allowed' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }

  try {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

    const { data: leads, error: fetchError } = await supabase
      .from('leads')
      .select('id')
      .eq('status', 'No Answer')
      .not('no_answer_at', 'is', null)
      .lte('no_answer_at', cutoff)

    if (fetchError) throw fetchError

    const count = leads?.length ?? 0
    if (count === 0) {
      return new Response(JSON.stringify({ redistributed: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const leadIds = leads!.map((l: { id: string }) => l.id)

    // Return to unassigned pool — no specific rep assigned.
    const { error: updateError } = await supabase
      .from('leads')
      .update({ assigned_rep_id: null, status: 'New', no_answer_at: null })
      .in('id', leadIds)
      .eq('status', 'No Answer')

    if (updateError) throw updateError

    // Close out queue rows without a named recipient (pool return).
    const { error: queueError } = await supabase
      .from('no_answer_queue')
      .update({ distributed_at: new Date().toISOString() })
      .in('lead_id', leadIds)
      .is('distributed_at', null)

    if (queueError) throw queueError

    console.log(`[redistribute-no-answers] returned ${count} leads to pool`)
    return new Response(JSON.stringify({ redistributed: count }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('[redistribute-no-answers]', err)
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
