// admin-toggle-user — retired (Prompt 770, Admin hardening).
//
// It turned access on or off with the service role, skipping the self and
// last-admin checks, the session sign-out and the call release.
// Nothing in the app calls it any more (P762 moved the Users page to the
// admin_set_user_access / admin_set_user_role RPCs and invites), so it now
// refuses everything. Brayden: delete it from Supabase → Edge Functions.

Deno.serve(() => new Response(JSON.stringify({ error: 'Not found' }), {
  status: 404, headers: { 'Content-Type': 'application/json' },
}))
