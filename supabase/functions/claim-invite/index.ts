// claim-invite — public endpoint for invite-token self-registration (Prompt 282).
//
// Deployed with verify_jwt DISABLED (same as twilio-*-webhook / grade-call):
//   supabase functions deploy claim-invite --no-verify-jwt --project-ref jjextitmbptoaolacocs
// The signup page runs pre-auth, and this project's new-format publishable key
// (sb_publishable_*) is not a JWT, so JWT verification can't gate this. The
// invite token itself is the secret: a 12-char URL-safe CSPRNG ID (Prompt 294
// shortened it from the original 32-byte hex — still ~72 bits, effectively
// unguessable), single-use, 7-day expiry, admin-only to create.
//
// Two actions:
//   { action: 'check', token }  → { valid, role } — the signup page's load gate
//   { action: 'claim', token, full_name, username, email, password }
//     → validates the token again, creates the auth user with the REAL email
//       (not the legacy @ohvara.internal synthetic) plus a self-chosen
//       username (Prompt 284 — phone was dropped from this form), marks the
//       invite used. NEVER writes rep_credentials — that table is
//       legacy/client-flow only (Brayden's decision, 2026-07-15).

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
    .select('id, role, expires_at, used_at, created_by')
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

    const { full_name, username, email, password } = body
    if (!full_name?.trim() || !username?.trim() || !email?.trim() || !password) {
      return json({ error: 'Missing required fields' }, 400)
    }
    // Same rule admin-create-user already enforces for legacy usernames (Prompt 284).
    if (!/^[a-z0-9_-]+$/.test(username.trim())) {
      return json({ error: 'Username may only contain lowercase letters, numbers, underscores, and hyphens' }, 400)
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      return json({ error: 'Enter a valid email address' }, 400)
    }
    if (password.length < 8) {
      return json({ error: 'Password must be at least 8 characters' }, 400)
    }

    // Explicit pre-check: profiles.username is unique, but the auth email
    // here is the rep's real address, not a username-derived synthetic one
    // (unlike legacy accounts) — so a duplicate username wouldn't collide at
    // the auth layer, only later at the DB constraint inside handle_new_user,
    // which would surface as an opaque "Database error saving new user"
    // instead of a clear message.
    const { data: existingUsername } = await adminClient
      .from('profiles')
      .select('id')
      .eq('username', username.trim())
      .maybeSingle()
    if (existingUsername) {
      return json({ error: 'That username is already taken.' }, 400)
    }

    // email_confirm: true — no email provider is configured yet (Resend setup
    // pending), so accounts are auto-confirmed and can log in immediately.
    // The handle_new_user trigger creates the profiles row from this metadata.
    const { data, error } = await adminClient.auth.admin.createUser({
      email: email.trim().toLowerCase(),
      password,
      email_confirm: true,
      user_metadata: { full_name: full_name.trim(), role: invite.role, username: username.trim() },
    })
    if (error) {
      const msg = /already.*registered|already.*exists/i.test(error.message)
        ? 'An account with this email already exists.'
        : error.message
      return json({ error: msg }, 400)
    }

    // Hierarchy (Prompt 326): whoever's link this was becomes the new
    // account's direct upline. handle_new_user already created the profiles
    // row from the metadata above, so this is an update, not an insert.
    // Non-fatal — a missing upline shows up as an unparented node on the
    // Hierarchy page, which is fixable there; failing the whole signup over
    // it would be worse.
    const { error: uplineError } = await adminClient
      .from('profiles')
      .update({ upline_id: invite.created_by })
      .eq('id', data.user.id)
    if (uplineError) console.error('profiles upline_id update failed:', uplineError.message)

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
