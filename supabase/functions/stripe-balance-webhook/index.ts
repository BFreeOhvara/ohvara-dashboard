// stripe-balance-webhook — credits a paid prepaid-balance Checkout to the
// agent's lead ledger. Logic in core.ts; this file wires Deno: the signing
// secret, the service-role client and the server.
//
// Deploy (verify_jwt off; Stripe signs, core.ts checks the signature):
//   npx.cmd supabase functions deploy stripe-balance-webhook --no-verify-jwt --project-ref jjextitmbptoaolacocs
//
// Secrets: STRIPE_BALANCE_WEBHOOK_SECRET (this endpoint's own whsec_…, test
// mode). Needs migration 176 applied (credit_topup).
import { createClient } from 'npm:@supabase/supabase-js'
import { handle, type CreditResult, type Store } from './core.ts'

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

const store: Store = {
  async creditTopup({ agent_id, amount_cents, session_id, event_id }) {
    const { data, error } = await db.rpc('credit_topup', {
      p_agent_id: agent_id,
      p_amount_cents: amount_cents,
      p_stripe_session_id: session_id,
      p_stripe_event_id: event_id,
      p_note: 'Stripe top-up',
    })
    if (error) throw new Error(`credit_topup: ${error.message}`)
    const row = (Array.isArray(data) ? data[0] : data) as CreditResult | undefined
    if (!row || (row.result !== 'credited' && row.result !== 'duplicate')) throw new Error('credit_topup: no result')
    return row
  },
}

Deno.serve(req => handle(req, store, { webhookSecret: Deno.env.get('STRIPE_BALANCE_WEBHOOK_SECRET') }))
