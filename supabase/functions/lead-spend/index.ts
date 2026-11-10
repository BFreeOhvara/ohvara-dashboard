// lead-spend — P884, lead spend charges (P909: nightly, to the card on file; P933: sign-up and monthly plan too, live
// key only with Admin Live charging on). Logic: core.ts.
//
// Deploy with --no-verify-jwt: pg_cron calls it every 15 minutes with the x-ohvara-cron secret, not a JWT; core.ts
// checks the user's JWT or the cron secret on every request.
//   npx.cmd supabase functions deploy lead-spend --no-verify-jwt --project-ref jjextitmbptoaolacocs
//
// Secrets: STRIPE_SECRET_KEY (shared with agent-billing). A live key charges only while billing_settings.live_charging is on.
// Needs the P884 migration (lead_spend_* functions) and 145's fulfillment_cron_ok.
import { createClient } from 'npm:@supabase/supabase-js'
import { handle, type Store } from './core.ts'
import { stripeClient } from '../_shared/fulfillmentPayouts.ts'

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
const KEY = Deno.env.get('STRIPE_SECRET_KEY')

const store: Store = {
  async userFromJwt(jwt) {
    const { data } = await admin.auth.getUser(jwt)
    return data.user?.id ?? null
  },
  async cronOk(secret) {
    const { data } = await admin.rpc('fulfillment_cron_ok', { p_secret: secret })
    return data === true
  },
  async isAdmin(id) {
    const { data } = await admin.from('profiles').select('role, is_active').eq('id', id).maybeSingle()
    return data?.role === 'admin' && data?.is_active !== false
  },
  async rpc(name, args) {
    const { data, error } = await admin.rpc(name, args)
    if (error) throw error
    return data
  },
}

Deno.serve(req => handle(req, store, KEY ? stripeClient(KEY) : null, KEY))
