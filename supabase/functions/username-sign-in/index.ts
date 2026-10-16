// username-sign-in — sign in with a username, without ever showing its email
// (Prompt 768, QA Finding 8).
//
// Deployed with verify_jwt DISABLED — the caller is signed out:
//   supabase functions deploy username-sign-in --no-verify-jwt --project-ref jjextitmbptoaolacocs
//
// Before this, Login called resolve_login_email (migration 069) as anon and got
// the email back for any username (brayden11 → Brayden's email). That RPC is
// now closed to everyone but the service role (migration 147). Here the
// username is resolved and the password checked on the server, through Supabase
// Auth's normal password sign-in (its own rate limits apply), and only a
// session comes back, only for the right password. A wrong password and an
// unknown username give the same answer, so neither leaks anything.
//
//   { username, password } → 200 { access_token, refresh_token }
//                          | 400 { error: 'Invalid login credentials' }
//
// The browser then calls auth.setSession(tokens); two-step (MFA) and the
// deactivated-account check run exactly as after an email sign-in.

import { createClient } from 'npm:@supabase/supabase-js'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

const refuse = () => json({ error: 'Invalid login credentials' }, 400)

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Not found' }, 404)

  let username = '', password = ''
  try {
    const body = await req.json()
    username = String(body?.username ?? '').trim()
    password = String(body?.password ?? '')
  } catch {
    return refuse()
  }
  if (!username || !password || username.includes('@') || username.length > 64) return refuse()

  const url = Deno.env.get('SUPABASE_URL')!
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: profile } = await admin
    .from('profiles')
    .select('email')
    .eq('username', username)
    .limit(1)
    .maybeSingle()
  // Same fallback the browser used: the old synthetic address.
  const email = profile?.email || `${username}@ohvara.internal`

  const auth = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data, error } = await auth.auth.signInWithPassword({ email, password })
  if (error || !data.session) return refuse()

  return json({
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
  })
})
