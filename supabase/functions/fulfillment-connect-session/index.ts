// fulfillment-connect-session — Prompt 753, Payout settings for a Fulfillment
// rep (Stripe Connect embedded components). Logic in core.ts; this file wires
// Deno: secrets, the service-role store and Stripe's REST API.
//
// Deploy WITH jwt verification (called by a signed-in rep):
//   npx.cmd supabase functions deploy fulfillment-connect-session --project-ref jjextitmbptoaolacocs
//
// Secrets: STRIPE_SECRET_KEY, STRIPE_PUBLISHABLE_KEY (both already set for
// agent-billing). Connect must be enabled on the Stripe account (Express).
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
    const { data } = await db.from('profiles').select('id, role, email, full_name, stripe_account_id').eq('id', id).maybeSingle()
    return data
  },
  async setStripeAccount(id, accountId) {
    const { error } = await db.from('profiles').update({ stripe_account_id: accountId }).eq('id', id)
    if (error) throw error
  },
  async saveAccount(row) {
    const { error } = await db.from('fulfillment_payout_accounts').upsert({ ...row, updated_at: new Date().toISOString() })
    if (error) throw error
  },
}

Deno.serve(req => handle(req, store, stripeClient(KEY), {
  configured: !!KEY,
  publishableKey: Deno.env.get('STRIPE_PUBLISHABLE_KEY') || null,
}))
