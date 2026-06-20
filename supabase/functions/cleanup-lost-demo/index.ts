import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Prompt 8 — lost lifecycle. Deleting the auth user + clients row needs the
// admin API (service role), so this can't happen from the closer's own
// client-side update like the rest of "Save Outcome" does.
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
      .select('demo_client_id')
      .eq('id', appointmentId)
      .single()
    if (apptError) throw new Error(`Failed to load appointment: ${apptError.message}`)

    if (!appt?.demo_client_id) {
      // Nothing to clean up — not every lost appointment has a demo account
      // (e.g. lost before Prompt 7 shipped, or recommend-stack never fired).
      return new Response(
        JSON.stringify({ success: true, cleaned: false }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const { data: client } = await supabase
      .from('clients')
      .select('id, profile_id, status')
      .eq('id', appt.demo_client_id)
      .single()

    // Only ever delete an account still in 'demo' — if it somehow already
    // converted to a real one (status no longer 'demo'), leave it alone.
    if (client && client.status === 'demo') {
      if (client.profile_id) {
        // Cascades to delete the profiles row (profiles.id references
        // auth.users.id on delete cascade) — clients.profile_id does NOT
        // cascade, so the clients row needs its own delete below.
        await supabase.auth.admin.deleteUser(client.profile_id)
      }
      await supabase.from('clients').delete().eq('id', client.id)
    }

    await supabase.from('appointments').update({
      demo_client_id: null,
      demo_credentials: null,
    }).eq('id', appointmentId)

    return new Response(
      JSON.stringify({ success: true, cleaned: true }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[cleanup-lost-demo]', msg)
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
