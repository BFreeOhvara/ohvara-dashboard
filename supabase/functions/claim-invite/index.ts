// claim-invite — public endpoint for invite-token self-registration (Prompt 282).
//
// Deployed with verify_jwt DISABLED (same as twilio-*-webhook / grade-call):
//   supabase functions deploy claim-invite --no-verify-jwt --project-ref jjextitmbptoaolacocs
// The signup page runs pre-auth, and this project's new-format publishable key
// (sb_publishable_*) is not a JWT, so JWT verification can't gate this. The
// invite token itself is the secret: a 12-char URL-safe CSPRNG ID (Prompt 294
// shortened it from the original 32-byte hex — still ~72 bits, effectively
// unguessable), single-use, 7-day expiry. Creation (migration 135, Prompt
// 731): admins from the Users page, and agents only through the
// send-agent-invite edge function, which texts/emails the link so the agent
// never sees it (channel / invited_email / invited_phone set on those rows).
//
// Two actions:
//   { action: 'check', token }  → { valid, role, email, by_text, pay_per_cancel_cents }
//     or { valid: false, reason: 'expired' | 'used' | 'invalid' } — the signup page's load gate
//     (email = the address an agent-sent email invite is locked to, else null)
//   { action: 'claim', token, full_name, email, password[, username] }
//     → validates the token again, creates the auth user with the REAL email
//       (not the legacy @ohvara.internal synthetic), marks the invite used.
//       Prompt 720: the Join form no longer asks for a username, so it's
//       optional here — when absent nothing about usernames is checked or
//       stored (profiles.username stays null). NEVER writes rep_credentials
//       — that table is legacy/client-flow only (Brayden's decision,
//       2026-07-15).

import { createClient } from 'npm:@supabase/supabase-js'
import { sendConfirmEmail } from '../_shared/confirmEmail.ts'

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
// Prompt 781: says which of those failed, so /join can show the right state.
async function fetchInvite(adminClient: ReturnType<typeof createClient>, token: string) {
  const { data, error } = await adminClient
    .from('rep_invites')
    .select('id, role, expires_at, used_at, created_by, channel, invited_email')
    .eq('token', token)
    .maybeSingle()
  if (error || !data) return { invite: null, reason: 'invalid' }
  if (data.used_at) return { invite: null, reason: 'used' }
  if (new Date(data.expires_at) <= new Date()) return { invite: null, reason: 'expired' }
  return { invite: data, reason: null }
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

  const { invite, reason } = await fetchInvite(adminClient, token)

  if (action === 'check') {
    // Deliberately minimal — reveals only whether the link works and what
    // role it grants, nothing about who created it or when it expires.
    // Prompt 731: plus the address an agent-sent email invite is locked to, so
    // the Join page can prefill it. Still nothing about who sent it.
    // Prompt 781: whether it came by text (no email known: /join asks for one
    // and it gets confirmed after), and Fulfillment's live pay per cancel for
    // the perks copy. A dead link says only expired / used / invalid.
    if (!invite) return json({ valid: false, reason })
    let pay: number | null = null
    if (invite.role === 'fulfillment') {
      const { data: cfg } = await adminClient.from('recovery_config').select('pay_per_cancel_cents').limit(1).maybeSingle()
      pay = cfg?.pay_per_cancel_cents ?? null
    }
    return json({
      valid: true, role: invite.role, email: invite.invited_email ?? null,
      by_text: invite.channel === 'sms', pay_per_cancel_cents: pay,
    })
  }

  if (action === 'claim') {
    if (!invite) {
      return json({ error: 'This invite link is invalid, expired, or already used.' }, 400)
    }

    const { full_name, email, password } = body
    const username = body.username?.trim() || null
    if (!full_name?.trim() || !email?.trim() || !password) {
      return json({ error: 'Missing required fields' }, 400)
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      return json({ error: 'Enter a valid email address' }, 400)
    }
    if (password.length < 8) {
      return json({ error: 'Password must be at least 8 characters' }, 400)
    }
    // Prompt 731: an invite an agent sent by email only works for that address.
    if (invite.invited_email && email.trim().toLowerCase() !== invite.invited_email.toLowerCase()) {
      return json({ error: 'This invite was sent to a different email address.' }, 400)
    }

    if (username) {
      // Same rule admin-create-user used to enforce for legacy usernames (Prompt 284).
      if (!/^[a-z0-9_-]+$/.test(username)) {
        return json({ error: 'Username may only contain lowercase letters, numbers, underscores, and hyphens' }, 400)
      }
      // Explicit pre-check: profiles.username is unique, and a duplicate would
      // otherwise only surface inside handle_new_user as an opaque "Database
      // error saving new user".
      const { data: existingUsername } = await adminClient
        .from('profiles')
        .select('id')
        .eq('username', username)
        .maybeSingle()
      if (existingUsername) {
        return json({ error: 'That username is already taken.' }, 400)
      }
    }

    // Prompt 770: take the invite first, in one conditional update, so two
    // claims of the same link at once can't both make an account. Released
    // again below if the account can't be made.
    const { data: taken } = await adminClient
      .from('rep_invites')
      .update({ used_at: new Date().toISOString() })
      .eq('id', invite.id)
      .is('used_at', null)
      .gt('expires_at', new Date().toISOString())
      .select('id')
      .maybeSingle()
    if (!taken) {
      return json({ error: 'This invite link is invalid, expired, or already used.' }, 400)
    }

    // The handle_new_user trigger creates the profiles row. Its role comes
    // from pending_signups, which only the service role can write (Prompt
    // 787, migration 160: app_metadata isn't on the row yet when the trigger
    // runs). The trigger ignores a role in user_metadata (Prompt 770), so a
    // plain public sign-up can't pick one.
    const cleanEmail = email.trim().toLowerCase()
    const { error: pendErr } = await adminClient.from('pending_signups')
      .upsert({ email: cleanEmail, role: invite.role, created_at: new Date().toISOString() })
    if (pendErr) {
      await adminClient.from('rep_invites').update({ used_at: null }).eq('id', invite.id).is('used_by', null)
      console.error('pending_signups upsert failed:', pendErr.message)
      return json({ error: 'Couldn’t create your account. Try again.' }, 500)
    }

    // email_confirm: true — no email provider is configured yet (Resend setup
    // pending), so accounts are auto-confirmed and can log in immediately.
    const { data, error } = await adminClient.auth.admin.createUser({
      email: cleanEmail,
      password,
      email_confirm: true,
      app_metadata: { role: invite.role },
      user_metadata: { full_name: full_name.trim(), role: invite.role, ...(username ? { username } : {}) },
    })
    if (error) {
      await adminClient.from('pending_signups').delete().eq('email', cleanEmail)
      await adminClient.from('rep_invites').update({ used_at: null }).eq('id', invite.id).is('used_by', null)
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
    // Prompt 731: admin-made links only. An invite an agent sent from the
    // account menu (channel set) carries no tie at all — no team, no upline —
    // so the inviter can never see the new agent's bookings (can_view_agent /
    // upline_of never reach them).
    if (!invite.channel) {
      const { error: uplineError } = await adminClient
        .from('profiles')
        .update({ upline_id: invite.created_by })
        .eq('id', data.user.id)
      if (uplineError) console.error('profiles upline_id update failed:', uplineError.message)
    }

    // Prompt 781: a text invite never knew this email, so it starts
    // unconfirmed: a confirm link goes out now, the portal shows a banner, and
    // Forgot password won't mail it until the link is clicked (account-email).
    // They're still signed straight in. Non-fatal: the banner can resend.
    if (invite.channel === 'sms') {
      const { error: pendErr } = await adminClient.from('profiles')
        .update({ email_confirm_pending: true }).eq('id', data.user.id)
      if (pendErr) console.error('email_confirm_pending update failed:', pendErr.message)
      else await sendConfirmEmail(adminClient, data.user.id, email.trim().toLowerCase())
    }

    // Single-use: already taken above; record who used it.
    const { error: usedError } = await adminClient
      .from('rep_invites')
      .update({ used_by: data.user.id })
      .eq('id', invite.id)
    if (usedError) console.error('rep_invites used_at update failed:', usedError.message)

    return json({ success: true })
  }

  return json({ error: 'Unknown action' }, 400)
})
