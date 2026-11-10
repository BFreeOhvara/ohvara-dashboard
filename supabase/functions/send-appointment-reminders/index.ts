// send-appointment-reminders — retired (P922, security check).
//
// A pre-pivot function that checked nobody: anyone holding the public key
// could have run it. It isn't deployed on live and nothing calls it; this stub
// makes sure an accidental deploy can't open that door. The old code is in git
// history.

Deno.serve(() => new Response(JSON.stringify({ error: 'Not found' }), {
  status: 404, headers: { 'Content-Type': 'application/json' },
}))
