// run-migration-034 — retired (Prompt 768, QA Finding 9).
//
// This was a one-off that ran an ALTER TABLE on the pre-pivot `leads` table
// with the database superuser URL, deployed with JWT verification off, so
// anyone could call it. It now refuses everything. Brayden: delete it from
// Supabase → Edge Functions; nothing calls it.

Deno.serve(() => new Response(JSON.stringify({ error: 'Not found' }), {
  status: 404, headers: { 'Content-Type': 'application/json' },
}))
