// admin-delete-user — retired (Prompt 770, Admin hardening).
//
// It deleted any account (yourself or the last admin included) with no record.
// Nothing in the app calls it any more (P762 moved the Users page to the
// admin_set_user_access / admin_set_user_role RPCs and invites), so it now
// refuses everything. Brayden: delete it from Supabase → Edge Functions.

Deno.serve(() => new Response(JSON.stringify({ error: 'Not found' }), {
  status: 404, headers: { 'Content-Type': 'application/json' },
}))
