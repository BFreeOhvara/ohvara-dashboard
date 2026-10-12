// fulfillment-pay-week — Prompt 753, admin Approve & pay for one rep-week.
// Logic in core.ts; this file wires Deno: secrets, the service-role store,
// Stripe and Resend.
//
// Deploy WITH jwt verification (called by a signed-in admin):
//   npx.cmd supabase functions deploy fulfillment-pay-week --project-ref jjextitmbptoaolacocs
//
// Secrets: STRIPE_SECRET_KEY; RESEND_API_KEY + INVITE_FROM_EMAIL (the invites@
// sender, already set for send-agent-invite); PUBLIC_APP_URL (optional).
// Nothing pays until recovery_config.payouts_live is on.
import { createClient } from 'npm:@supabase/supabase-js'
import { handle, type Store } from './core.ts'
import { stripeClient } from '../_shared/fulfillmentPayouts.ts'

const KEY = Deno.env.get('STRIPE_SECRET_KEY') || ''
const RESEND = Deno.env.get('RESEND_API_KEY')
const FROM = Deno.env.get('INVITE_FROM_EMAIL')
const APP_URL = (Deno.env.get('PUBLIC_APP_URL') || 'https://portal.ohvara.com').replace(/\/$/, '')
const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

const PAYOUT_COLS = 'id, rep_id, period_start, period_end, hours, rate_cents, amount_cents, status, stripe_transfer_id'

const store: Store = {
  async userFromJwt(jwt) {
    const { data } = await db.auth.getUser(jwt)
    return data.user?.id ?? null
  },
  async role(id) {
    const { data } = await db.from('profiles').select('role').eq('id', id).maybeSingle()
    return data?.role ?? null
  },
  async payoutsLive() {
    const { data } = await db.from('recovery_config').select('payouts_live').limit(1).maybeSingle()
    return !!data?.payouts_live
  },
  async rep(id) {
    const { data } = await db.from('profiles')
      .select('id, role, full_name, email, stripe_account_id, payout_email_sent, payout_email_problem').eq('id', id).maybeSingle()
    return data
  },
  async figures(repId, start) {
    const { data, error } = await db.rpc('fulfillment_week_figures', { p_rep: repId, p_start: start })
    if (error) throw error
    const f = Array.isArray(data) ? data[0] : data
    return f ? { ...f, hours: Number(f.hours) } : null
  },
  async claim(repId, f, adminId) {
    // Make sure the row exists, then take it with one conditional update.
    await db.from('fulfillment_payouts').upsert(
      { rep_id: repId, period_start: f.period_start, period_end: f.period_end, hours: f.hours, rate_cents: f.rate_cents, amount_cents: f.amount_cents },
      { onConflict: 'rep_id,period_start', ignoreDuplicates: true },
    )
    const stale = new Date(Date.now() - 2 * 60e3).toISOString()
    const { data, error } = await db.from('fulfillment_payouts')
      .update({ status: 'approved', approved_by: adminId, hours: f.hours, rate_cents: f.rate_cents, amount_cents: f.amount_cents, failure_reason: null })
      .eq('rep_id', repId).eq('period_start', f.period_start)
      .or(`status.in.(upcoming,failed,held),and(status.eq.approved,updated_at.lt.${stale})`)
      .select(PAYOUT_COLS).maybeSingle()
    if (error) throw error
    return data ? { ...data, hours: Number(data.hours) } : null
  },
  async payout(repId, start) {
    const { data } = await db.from('fulfillment_payouts').select(PAYOUT_COLS).eq('rep_id', repId).eq('period_start', start).maybeSingle()
    return data
  },
  async account(repId) {
    const { data } = await db.from('fulfillment_payout_accounts').select('*').eq('rep_id', repId).maybeSingle()
    return data
  },
  async markPayout(id, patch) {
    const { error } = await db.from('fulfillment_payouts').update(patch).eq('id', id)
    if (error) throw error
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

Deno.serve(req => handle(req, store, stripeClient(KEY), { configured: !!KEY, appUrl: APP_URL }))
