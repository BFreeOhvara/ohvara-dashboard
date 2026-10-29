// create-balance-topup — one-time Stripe Checkout for an agent's prepaid lead
// balance. Logic in core.ts; this file wires Deno: secrets, the service-role
// store and Stripe's REST API. Crediting happens in stripe-balance-webhook.
//
// Deploy (the caller is checked in core.ts; verify_jwt alone isn't enough):
//   npx.cmd supabase functions deploy create-balance-topup --project-ref jjextitmbptoaolacocs
//
// Secrets: STRIPE_SECRET_KEY (must be sk_test_…; anything else is refused),
// PUBLIC_APP_URL (optional extra return origin). Needs migration 176 applied.
import { createClient } from 'npm:@supabase/supabase-js'
import { handle, type Store } from './core.ts'
import { stripeClient } from '../_shared/fulfillmentPayouts.ts'

const KEY = Deno.env.get('STRIPE_SECRET_KEY') || ''
const APP_URL = Deno.env.get('PUBLIC_APP_URL')
const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

let appOrigins: string[] = []
try { if (APP_URL) appOrigins = [new URL(APP_URL).origin] } catch { /* ignore a bad value */ }

const store: Store = {
  async userFromJwt(jwt) {
    const { data } = await db.auth.getUser(jwt)
    return data.user?.id ?? null
  },
  async profile(id) {
    const { data } = await db.from('profiles').select('id, role, email, stripe_customer_id').eq('id', id).maybeSingle()
    return data
  },
  async topupOptions() {
    const { data, error } = await db.from('prepaid_topup_options').select('amount_cents').eq('active', true)
    if (error) throw new Error(`prepaid_topup_options: ${error.message}`)
    return (data || []).map(r => r.amount_cents as number)
  },
}

Deno.serve(req => handle(req, store, stripeClient(KEY), { stripeKey: KEY, appOrigins }))
