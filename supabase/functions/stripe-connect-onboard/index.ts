// ============================================================
// stripe-connect-onboard — rep Stripe Connect (Express) onboarding (Prompt 55)
//
// Two modes (auth-required; the caller is the rep, resolved from the JWT):
//   default            → ensure the rep has a Connect Express account, then
//                        return a hosted Account Link onboarding URL.
//   { checkStatus:true} → retrieve the account and, if charges/payouts are
//                        enabled, flip profiles.stripe_onboarding_complete=true.
//                        Called after Stripe redirects back with
//                        ?onboarding=complete.
//
// Deploy WITH jwt verification (default):
//   supabase functions deploy stripe-connect-onboard --project-ref jjextitmbptoaolacocs
//
// Required secret: STRIPE_SECRET_KEY (already set from Prompt 9).
// Optional secret: DASHBOARD_URL (defaults to https://ohvara-dashboard.vercel.app)
// ============================================================

import { createClient } from 'npm:@supabase/supabase-js'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

// Thin Stripe REST helper — form-encoded POST / GET with the secret key
// (same pattern as generate-stripe-links). Returns parsed JSON or throws.
async function stripe(path: string, key: string, body?: Record<string, string>) {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: body ? 'POST' : 'GET',
    headers: {
      Authorization: `Bearer ${key}`,
      ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
    },
    ...(body ? { body: new URLSearchParams(body) } : {}),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data?.error?.message || `Stripe ${res.status}`)
  return data
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const stripeKey = Deno.env.get('STRIPE_SECRET_KEY')
  if (!stripeKey) return json({ error: 'Stripe not configured' }, 503)

  // Resolve the caller from the request JWT.
  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) return json({ error: 'Missing Authorization header' }, 401)

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const { data: { user }, error: authError } = await admin.auth.getUser(authHeader.replace('Bearer ', ''))
  if (authError || !user) return json({ error: 'Invalid or expired token' }, 401)

  const body = await req.json().catch(() => ({}))
  const checkStatus = !!body?.checkStatus

  const { data: profile } = await admin
    .from('profiles')
    .select('id, email, username, full_name, stripe_account_id, stripe_onboarding_complete')
    .eq('id', user.id)
    .single()
  if (!profile) return json({ error: 'Profile not found' }, 404)

  try {
    // ── Status check mode ────────────────────────────────────────────────
    if (checkStatus) {
      if (!profile.stripe_account_id) return json({ complete: false })
      const acct = await stripe(`accounts/${profile.stripe_account_id}`, stripeKey)
      const complete = !!(acct.charges_enabled && acct.payouts_enabled && acct.details_submitted)
      if (complete && !profile.stripe_onboarding_complete) {
        await admin.from('profiles').update({ stripe_onboarding_complete: true }).eq('id', user.id)
      }
      return json({ complete })
    }

    // ── Onboarding link mode ─────────────────────────────────────────────
    let accountId = profile.stripe_account_id
    if (!accountId) {
      const acct = await stripe('accounts', stripeKey, {
        type: 'express',
        country: 'US',
        'capabilities[card_payments][requested]': 'true',
        'capabilities[transfers][requested]': 'true',
        ...(profile.email ? { email: profile.email } : {}),
        'business_type': 'individual',
        'metadata[profile_id]': user.id,
      })
      accountId = acct.id
      await admin.from('profiles').update({ stripe_account_id: accountId }).eq('id', user.id)
    }

    const base = Deno.env.get('DASHBOARD_URL') || 'https://ohvara-dashboard.vercel.app'
    const link = await stripe('account_links', stripeKey, {
      account: accountId,
      refresh_url: `${base}/rep/commissions?onboarding=refresh`,
      return_url: `${base}/rep/commissions?onboarding=complete`,
      type: 'account_onboarding',
    })

    return json({ url: link.url })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[stripe-connect-onboard]', msg)
    return json({ error: msg }, 500)
  }
})
