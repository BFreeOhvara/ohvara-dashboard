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

  // Prompt 720 — accounts are email-based now; no username is made or stored.
  // The three legacy username accounts predate this and are untouched.
  let body: Record<string, string>
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid request body' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
  const { password, full_name, role, timezone } = body
  const email = (body.email || '').trim().toLowerCase()

  if (!email || !password || !full_name || !role) {
    return new Response(JSON.stringify({ error: 'Missing required fields' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return new Response(JSON.stringify({ error: 'Enter a valid email address' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  const { data, error } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name, role },
  })

  if (error) {
    const msg = /already.*registered|already.*exists/i.test(error.message)
      ? 'An account with this email already exists.'
      : error.message
    return new Response(JSON.stringify({ error: msg }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  // Store the plaintext credentials for admin lookup (rep_credentials, migration 041;
  // email instead of username since migration 129). Service-role client bypasses RLS.
  // Non-fatal: the account itself is already created above, so a credentials-table
  // failure shouldn't fail the whole request.
  const { error: credError } = await adminClient
    .from('rep_credentials')
    .upsert(
      { profile_id: data.user.id, email, password },
      { onConflict: 'profile_id' }
    )
  if (credError) {
    console.error('rep_credentials upsert failed:', credError.message)
  }

  // profiles.timezone (migration 042) defaults to America/Chicago at the
  // table level — only worth an explicit write when the admin picked
  // something else. Non-fatal, same as the credentials upsert above.
  if (timezone && timezone !== 'America/Chicago') {
    const { error: tzError } = await adminClient
      .from('profiles')
      .update({ timezone })
      .eq('id', data.user.id)
    if (tzError) {
      console.error('profiles.timezone update failed:', tzError.message)
    }
  }

  return new Response(
    JSON.stringify({ user: data.user }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
})
