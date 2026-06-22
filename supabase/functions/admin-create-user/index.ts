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

  const { username, password, full_name, role } = await req.json()

  if (!username || !password || !full_name || !role) {
    return new Response(JSON.stringify({ error: 'Missing required fields' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  // Usernames must be lowercase alphanumeric + underscores/hyphens only
  if (!/^[a-z0-9_-]+$/.test(username)) {
    return new Response(JSON.stringify({ error: 'Username may only contain lowercase letters, numbers, underscores, and hyphens' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  // Internal email — never exposed to the user
  const internalEmail = `${username}@ohvara.internal`

  const { data, error } = await adminClient.auth.admin.createUser({
    email: internalEmail,
    password,
    email_confirm: true,
    user_metadata: { full_name, role, username },
  })

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  // Store the plaintext credentials for admin lookup (rep_credentials, migration 041).
  // Service-role client bypasses RLS. Non-fatal: the account itself is already
  // created above, so a credentials-table failure shouldn't fail the whole request.
  const { error: credError } = await adminClient
    .from('rep_credentials')
    .upsert(
      { profile_id: data.user.id, username, password },
      { onConflict: 'profile_id' }
    )
  if (credError) {
    console.error('rep_credentials upsert failed:', credError.message)
  }

  return new Response(
    JSON.stringify({ user: data.user }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
})
