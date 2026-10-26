// agent-billing — Prompt 673 (weekly agent retainer), 692 (tiers), 734
// (billing managed inside the portal). All the logic and the action list live
// in core.ts; this file wires Deno: secrets, the service-role client and the
// server. Prompt 753: the same webhook also takes Fulfillment payout events
// (Connect), handled by ../_shared/fulfillmentPayouts.ts.
//
// Deploy (verify_jwt off; users are authenticated in core.ts):
//   npx.cmd supabase functions deploy agent-billing --no-verify-jwt --project-ref jjextitmbptoaolacocs
//
// Secrets: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PUBLISHABLE_KEY,
// STRIPE_CONNECT_WEBHOOK_SECRET (P753, the Connect endpoint's whsec_…),
// RESEND_API_KEY + INVITE_FROM_EMAIL (payout problem emails).
import { createClient } from 'npm:@supabase/supabase-js'
import { configure, handle } from './core.ts'
import { handleConnectEvent, stripeClient, type ConnectStore } from '../_shared/fulfillmentPayouts.ts'
import { handleTopupEvent, type TopupStore } from '../_shared/leadTopup.ts'

const KEY = Deno.env.get('STRIPE_SECRET_KEY')
const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
const APP_URL = (Deno.env.get('PUBLIC_APP_URL') || 'https://portal.ohvara.com').replace(/\/$/, '')
const RESEND = Deno.env.get('RESEND_API_KEY')
const FROM = Deno.env.get('INVITE_FROM_EMAIL')

const payouts: ConnectStore = {
  async repByAccount(accountId) {
    const { data } = await admin.from('profiles').select('id').eq('stripe_account_id', accountId).eq('role', 'fulfillment').maybeSingle()
    return data?.id ?? null
  },
  async saveAccount(row) {
    const { error } = await admin.from('fulfillment_payout_accounts').upsert({ ...row, updated_at: new Date().toISOString() })
    if (error) throw error
  },
  async payoutByTransfer(transferId) {
    const { data } = await admin.from('fulfillment_payouts')
      .select('id, rep_id, period_start, period_end, amount_cents, status').eq('stripe_transfer_id', transferId).maybeSingle()
    return data
  },
  async markPayout(id, patch) {
    const { error } = await admin.from('fulfillment_payouts').update(patch).eq('id', id)
    if (error) throw error
  },
  async rep(id) {
    const { data } = await admin.from('profiles').select('email, payout_email_problem').eq('id', id).maybeSingle()
    return data
  },
  async sendEmail(e) {
    if (!RESEND || !FROM) return
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM, to: [e.to], subject: e.subject, html: e.html, text: e.text }),
    })
    if (!res.ok) throw new Error(`resend ${res.status}`)
  },
}

// Prepaid lead top-ups (migration 162's agent_lead_ledger; service role may
// only insert). 23505 is the one-topup-per-stripe_ref index: already credited.
const topups: TopupStore = {
  async agent(id) {
    const { data, error } = await admin.from('profiles').select('id, role').eq('id', id).maybeSingle()
    if (error) throw error
    return data
  },
  async insertTopup(row) {
    const { data, error } = await admin.from('agent_lead_ledger')
      .insert({ ...row, kind: 'topup' }).select('id, balance_after_cents').single()
    if (error?.code === '23505') return null
    if (error) throw error
    return data
  },
}

configure({
  stripeKey: KEY,
  webhookSecret: Deno.env.get('STRIPE_WEBHOOK_SECRET'),
  publishableKey: Deno.env.get('STRIPE_PUBLISHABLE_KEY'),
  connectWebhookSecret: Deno.env.get('STRIPE_CONNECT_WEBHOOK_SECRET'),
  onConnectEvent: KEY ? event => handleConnectEvent(payouts, stripeClient(KEY), event, APP_URL) : undefined,
  onTopupEvent: KEY ? event => handleTopupEvent(topups, stripeClient(KEY), event) : undefined,
})

Deno.serve(req => handle(req, admin))
