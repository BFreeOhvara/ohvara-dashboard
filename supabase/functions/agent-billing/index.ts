// agent-billing — Prompt 673 (weekly agent retainer), 692 (tiers), 734
// (billing managed inside the portal). All the logic and the action list live
// in core.ts; this file wires Deno: secrets, the service-role client and the
// server.
//
// Deploy (verify_jwt off; users are authenticated in core.ts):
//   npx.cmd supabase functions deploy agent-billing --no-verify-jwt --project-ref jjextitmbptoaolacocs
//
// Secrets: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PUBLISHABLE_KEY.
import { createClient } from 'npm:@supabase/supabase-js'
import { configure, handle } from './core.ts'

configure({
  stripeKey: Deno.env.get('STRIPE_SECRET_KEY'),
  webhookSecret: Deno.env.get('STRIPE_WEBHOOK_SECRET'),
  publishableKey: Deno.env.get('STRIPE_PUBLISHABLE_KEY'),
})

Deno.serve(req => handle(req, createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)))
