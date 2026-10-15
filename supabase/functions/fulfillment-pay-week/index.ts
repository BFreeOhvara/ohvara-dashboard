// fulfillment-pay-week — Prompt 764, the automatic Monday pay run (was P753's
// admin Approve & pay). Logic in core.ts; this file wires Deno: secrets, the
// service-role store, Stripe and Resend.
//
// pg_cron calls it (job fulfillment-pay-run, daily 13:05 and 14:05 UTC) with
// the x-ohvara-cron secret from Vault; it pays from Monday 8 AM Central.
// Deploy WITHOUT jwt verification (the cron secret is the check):
//   npx.cmd supabase functions deploy fulfillment-pay-week --no-verify-jwt --project-ref jjextitmbptoaolacocs
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

const PAYOUT_COLS = 'id, rep_id, period_start, period_end, amount_cents, cancels, topup_cents, status, stripe_transfer_id'
const one = (data: any) => (Array.isArray(data) ? data[0] : data) ?? null

const store: Store = {
  async cronOk(secret) {
    const { data } = await db.rpc('fulfillment_cron_ok', { p_secret: secret })
    return data === true
  },
  async settings() {
    const { data } = await db.from('recovery_config').select('payouts_live, payouts_paused').limit(1).maybeSingle()
    return { payouts_live: !!data?.payouts_live, payouts_paused: !!data?.payouts_paused }
  },
  async run(payDate) {
    const { data } = await db.from('fulfillment_pay_runs').select('id, pay_date, status, attempts').eq('pay_date', payDate).maybeSingle()
    return data
  },
  async startRun(payDate, periodStart) {
    const { data: had } = await db.from('fulfillment_pay_runs').select('id, attempts').eq('pay_date', payDate).maybeSingle()
    const now = new Date().toISOString()
    const q = had
      ? db.from('fulfillment_pay_runs').update({ status: 'running', attempts: had.attempts + 1, updated_at: now, finished_at: null }).eq('id', had.id)
      : db.from('fulfillment_pay_runs').insert({ pay_date: payDate, period_start: periodStart })
    const { data, error } = await q.select('id, pay_date, status, attempts').single()
    if (error) throw error
    return data
  },
  async finishRun(id, patch) {
    const { error } = await db.from('fulfillment_pay_runs').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id)
    if (error) throw error
  },
  async reps() {
    const { data, error } = await db.from('profiles')
      .select('id, full_name, email, stripe_account_id, payout_email_sent, payout_email_problem').eq('role', 'fulfillment')
    if (error) throw error
    return data ?? []
  },
  async payable(repId, periodStart) {
    const { data, error } = await db.rpc('fulfillment_payable', { p_rep: repId, p_period_start: periodStart })
    if (error) throw error
    const f = one(data)
    return { amount_cents: Number(f?.amount_cents) || 0, cancels: Number(f?.cancels) || 0 }
  },
  async sending(repId, periodStart) {
    const { data } = await db.from('fulfillment_payouts').select(PAYOUT_COLS)
      .eq('rep_id', repId).eq('period_start', periodStart).eq('status', 'approved').maybeSingle()
    return data
  },
  async account(repId) {
    const { data } = await db.from('fulfillment_payout_accounts').select('*').eq('rep_id', repId).maybeSingle()
    return data
  },
  async claim(repId, periodStart, runId, hold = false, reason) {
    const { data, error } = await db.rpc('fulfillment_claim_payout', {
      p_rep: repId, p_period_start: periodStart, p_run: runId, p_hold: hold, p_reason: reason ?? null,
    })
    if (error) throw error
    const row = one(data)
    return row?.id ? row : null
  },
  async finish(payoutId, ok, transferId, paidTo, reason) {
    const { error } = await db.rpc('fulfillment_finish_payout', {
      p_payout: payoutId, p_ok: ok, p_transfer: transferId, p_paid_to: paidTo, p_reason: reason,
    })
    if (error) throw error
  },
  async notifyAdmins(message, data) {
    const { data: admins } = await db.from('profiles').select('id').eq('role', 'admin')
    if (!admins?.length) return
    await db.from('notifications').insert(admins.map(a => ({ profile_id: a.id, type: 'payout_run', message, data })))
  },
  async notifyRep(repId, message, data) {
    await db.from('notifications').insert({ profile_id: repId, type: 'payout_problem', message, data })
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
