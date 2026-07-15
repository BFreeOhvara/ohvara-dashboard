// claim-invite — public endpoint for invite-token self-registration (Prompt 282).
//
// Deployed with verify_jwt DISABLED (same as twilio-*-webhook / grade-call):
//   supabase functions deploy claim-invite --no-verify-jwt --project-ref jjextitmbptoaolacocs
// The signup page runs pre-auth, and this project's new-format publishable key
// (sb_publishable_*) is not a JWT, so JWT verification can't gate this. The
// invite token itself is the secret: 32 bytes of CSPRNG hex, single-use,
// 7-day expiry, admin-only to create.
//
// Two actions:
//   { action: 'check', token }  → { valid, role } — the signup page's load gate
//   { action: 'claim', token, full_name, email, phone, password }
//     → validates the token again, creates the auth user with the REAL email
//       (not the legacy @ohvara.internal synthetic), marks the invite used.
//       NEVER writes rep_credentials — that table is legacy/client-flow only
//       (Brayden's decision, 2026-07-15).

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

// A token is claimable if it exists, is unused, and hasn't expired.
async function fetchValidInvite(adminClient: ReturnType<typeof createClient>, token: string) {
  const { data, error } = await adminClient
    .from('rep_invites')
    .select('id, role, expires_at, used_at')
    .eq('token', token)
    .maybeSingle()
  if (error || !data) return null
  if (data.used_at) return null
  if (new Date(data.expires_at) <= new Date()) return null
  return data
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const adminClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  let body: Record<string, string>
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid request body' }, 400)
  }

  const { action, token } = body
  if (!token || typeof token !== 'string') {
    return json({ error: 'Missing invite token' }, 400)
  }

  const invite = await fetchValidInvite(adminClient, token)

  if (action === 'check') {
    // Deliberately minimal — reveals only whether the link works and what
    // role it grants, nothing about who created it or when it expires.
    return invite ? json({ valid: true, role: invite.role }) : json({ valid: false })
  }

  if (action === 'claim') {
    if (!invite) {
      return json({ error: 'This invite link is invalid, expired, or already used.' }, 400)
    }

    const { full_name, email, phone, password } = body
    if (!full_name?.trim() || !email?.trim() || !password) {
      return json({ error: 'Missing required fields' }, 400)
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      return json({ error: 'Enter a valid email address' }, 400)
    }
    if (password.length < 8) {
      return json({ error: 'Password must be at least 8 characters' }, 400)
    }

    // email_confirm: true — no email provider is configured yet (Resend setup
    // pending), so accounts are auto-confirmed and can log in immediately.
    // The handle_new_user trigger creates the profiles row from this metadata
    // (username stays null for real-email accounts — login is by email).
    const { data, error } = await adminClient.auth.admin.createUser({
      email: email.trim().toLowerCase(),
      password,
      email_confirm: true,
      user_metadata: { full_name: full_name.trim(), role: invite.role },
    })
    if (error) {
      const msg = /already.*registered|already.*exists/i.test(error.message)
        ? 'An account with this email already exists.'
        : error.message
      return json({ error: msg }, 400)
    }

    // Phone lives on profiles, not auth — set it after the trigger has run.
    // Non-fatal: the account exists either way.
    if (phone?.trim()) {
      const { error: phoneError } = await adminClient
        .from('profiles')
        .update({ phone: phone.trim() })
        .eq('id', data.user.id)
      if (phoneError) console.error('profiles.phone update failed:', phoneError.message)
    }

    // Single-use: mark consumed. If this somehow fails the token would stay
    // claimable, so treat it as fatal enough to log loudly — but the account
    // is already created, so still return success to the new user.
    const { error: usedError } = await adminClient
      .from('rep_invites')
      .update({ used_at: new Date().toISOString(), used_by: data.user.id })
      .eq('id', invite.id)
    if (usedError) console.error('rep_invites used_at update failed:', usedError.message)

    return json({ success: true })
  }

  return json({ error: 'Unknown action' }, 400)
})
