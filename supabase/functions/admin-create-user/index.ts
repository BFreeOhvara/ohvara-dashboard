import { createClient } from 'npm:@supabase/supabase-js'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

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

  const { data, error } = await supabase.auth.admin.createUser({
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

  return new Response(
    JSON.stringify({ user: data.user }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
})
