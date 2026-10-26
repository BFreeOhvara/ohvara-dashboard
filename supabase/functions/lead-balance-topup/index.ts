// lead-balance-topup — Stripe Checkout for the prepaid lead balance. The
// rules are in core.ts and ../_shared/leadTopup.ts; this wires Deno.
//
// Deploying is a manual step (JWT is checked here too):
//   npx.cmd supabase functions deploy lead-balance-topup --project-ref jjextitmbptoaolacocs
//
// Secrets: STRIPE_SECRET_KEY (the same key agent-billing uses). A live key is
// refused: top-ups are test mode only for now. The credit is written by
// agent-billing's webhook (checkout.session.completed, already subscribed).
import { createClient } from 'npm:@supabase/supabase-js'
import { stripeClient } from '../_shared/fulfillmentPayouts.ts'
import { handle, type Deps } from './core.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

const KEY = Deno.env.get('STRIPE_SECRET_KEY')
const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

const deps: Deps = {
  stripeKey: KEY,
  stripe: stripeClient(KEY || ''),
  async userOf(jwt) {
    const { data } = await admin.auth.getUser(jwt)
    return data?.user ? { id: data.user.id } : null
  },
  async profile(id) {
    const { data } = await admin.from('profiles').select('id, role, email, stripe_customer_id').eq('id', id).maybeSingle()
    return data
  },
  now: () => Date.now(),
  log: m => console.error('[lead-balance-topup]', m),
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  let body: unknown = {}
  try { body = await req.json() } catch { /* empty body: amount check fails below */ }
  if (!body || typeof body !== 'object' || Array.isArray(body)) body = {}
  const r = await handle(deps, req.headers.get('Authorization'), body as Record<string, unknown>)
  return json(r.body, r.status)
})
