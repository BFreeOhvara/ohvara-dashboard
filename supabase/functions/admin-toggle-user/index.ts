import { createClient } from 'npm:@supabase/supabase-js'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Helper: verify caller is authenticated and has admin role
async function requireAdmin(req: Request, adminClient: ReturnType<typeof createClient>): Promise<{ error?: Response }> {
  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return {
      error: new Response(JSON.stringify({ error: 'Missing or invalid Authorization header' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
  }

  const jwt = authHeader.replace('Bearer ', '')
  const { data: { user }, error: authError } = await adminClient.auth.getUser(jwt)
  if (authError || !user) {
    return {
      error: new Response(JSON.stringify({ error: 'Invalid or expired token' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
  }

  const { data: profile } = await adminClient.from('profiles').select('role').eq('id', user.id).single()
  if (profile?.role !== 'admin') {
    return {
      error: new Response(JSON.stringify({ error: 'Forbidden — admin role required' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
  }

  return {}
}

// Toggles is_active on a profile. Uses service role so RLS doesn't block it.
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const adminClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  // Validate caller is an admin
  const { error: authError } = await requireAdmin(req, adminClient)
  if (authError) return authError

  const { user_id, is_active } = await req.json()

  if (!user_id || typeof is_active !== 'boolean') {
    return new Response(JSON.stringify({ error: 'user_id and is_active (boolean) required' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  const { error } = await adminClient
    .from('profiles')
    .update({ is_active })
    .eq('id', user_id)

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  return new Response(JSON.stringify({ success: true, is_active }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  })
})
