// create-balance-topup — one-time Stripe Checkout for an agent's prepaid
// balance. Logic in core.ts; this file wires Deno: secrets, the service-role
// store and Stripe's REST API. Crediting happens in the agent-billing webhook.
//
// Deploy WITH jwt verification (called by a signed-in agent):
//   npx.cmd supabase functions deploy create-balance-topup --project-ref jjextitmbptoaolacocs
//
// Secrets: STRIPE_SECRET_KEY (already set for agent-billing; sk_test_… in
// test mode). Needs migration 161 applied first.
import { createClient } from 'npm:@supabase/supabase-js'
import { handle, type Store } from './core.ts'
import { stripeClient } from '../_shared/fulfillmentPayouts.ts'

const KEY = Deno.env.get('STRIPE_SECRET_KEY') || ''
const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

const store: Store = {
  async userFromJwt(jwt) {
    const { data } = await db.auth.getUser(jwt)
    return data.user?.id ?? null
  },
  async profile(id) {
    const { data } = await db.from('profiles').select('id, role, email, stripe_customer_id').eq('id', id).maybeSingle()
    return data
  },
}

Deno.serve(req => handle(req, store, stripeClient(KEY), { configured: !!KEY }))
