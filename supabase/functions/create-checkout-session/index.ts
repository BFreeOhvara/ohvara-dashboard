// create-checkout-session — retired (Prompt 770, Admin hardening).
//
// A pre-pivot function. Nothing in the app or the cron calls it, and it
// didn't check who was calling: the public key that every browser has was
// enough to run it (the gateway's JWT check doesn't stop that). It now
// refuses everything. The old code is in git history. Brayden: delete it
// from Supabase → Edge Functions.

Deno.serve(() => new Response(JSON.stringify({ error: 'Not found' }), {
  status: 404, headers: { 'Content-Type': 'application/json' },
}))
