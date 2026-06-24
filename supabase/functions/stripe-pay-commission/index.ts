// ============================================================
// stripe-pay-commission — admin approves & pays a rep payout (Prompt 55)
//
// Takes { payout_id }. Reads the commission_payouts row, finds the rep's
// connected Stripe account, fires a Stripe Transfer to it, and marks the
// row paid. Admin-only (verified via profile role check on the JWT).
//
// Deploy WITH jwt verification (default):
//   supabase functions deploy stripe-pay-commission --project-ref jjextitmbptoaolacocs
//
// Required secret: STRIPE_SECRET_KEY.
// ============================================================

import { createClient } from 'npm:@supabase/supabase-js'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const stripeKey = Deno.env.get('STRIPE_SECRET_KEY')
  if (!stripeKey) return json({ error: 'Stripe not configured' }, 503)

  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) return json({ error: 'Missing Authorization header' }, 401)

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const { data: { user }, error: authError } = await admin.auth.getUser(authHeader.replace('Bearer ', ''))
  if (authError || !user) return json({ error: 'Invalid or expired token' }, 401)

  const { data: caller } = await admin.from('profiles').select('role').eq('id', user.id).single()
  if (caller?.role !== 'admin') return json({ error: 'Forbidden — admin only' }, 403)

  const { payout_id } = await req.json().catch(() => ({}))
  if (!payout_id) return json({ error: 'payout_id is required' }, 400)

  // Load the payout + the rep's connected account.
  const { data: payout } = await admin
    .from('commission_payouts')
    .select('id, rep_profile_id, amount_cents, status, stripe_transfer_id')
    .eq('id', payout_id)
    .single()
  if (!payout) return json({ error: 'Payout not found' }, 404)
  if (payout.status === 'paid') return json({ error: 'Payout already paid' }, 409)
  if (!payout.amount_cents || payout.amount_cents <= 0) return json({ error: 'Invalid payout amount' }, 400)

  const { data: rep } = await admin
    .from('profiles')
    .select('stripe_account_id, stripe_onboarding_complete')
    .eq('id', payout.rep_profile_id)
    .single()
  if (!rep?.stripe_account_id || !rep.stripe_onboarding_complete) {
    return json({ error: 'Rep has not finished connecting their bank' }, 422)
  }

  // Fire the transfer. On any failure, mark the row failed so the admin sees it.
  try {
    const res = await fetch('https://api.stripe.com/v1/transfers', {
      method: 'POST',
      headers: { Authorization: `Bearer ${stripeKey}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        amount: String(payout.amount_cents),
        currency: 'usd',
        destination: rep.stripe_account_id,
        'metadata[payout_id]': payout.id,
      }),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data?.error?.message || `Stripe ${res.status}`)

    await admin.from('commission_payouts').update({
      status: 'paid',
      stripe_transfer_id: data.id,
      paid_at: new Date().toISOString(),
    }).eq('id', payout.id)

    return json({ success: true, transfer_id: data.id })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[stripe-pay-commission]', msg)
    await admin.from('commission_payouts')
      .update({ status: 'failed', notes: msg.slice(0, 280) })
      .eq('id', payout.id)
    return json({ error: msg }, 500)
  }
})
