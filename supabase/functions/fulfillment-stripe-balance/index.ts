// fulfillment-stripe-balance — Prompt 765. Read-only: Ohvara's available
// Stripe balance in US cents, for the admin Payouts page ("Covers Monday's
// run" / "Not enough for Monday"). Admin only. Moves nothing.
//
//   POST (any body)  Authorization: Bearer <admin's session JWT>
//   → { available_cents }
//
// Deploy WITH jwt verification:
//   npx.cmd supabase functions deploy fulfillment-stripe-balance --project-ref jjextitmbptoaolacocs
// Secret: STRIPE_SECRET_KEY (already set).
import { createClient } from 'npm:@supabase/supabase-js'
import { stripeClient } from '../_shared/fulfillmentPayouts.ts'

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
const KEY = Deno.env.get('STRIPE_SECRET_KEY') || ''

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer /, '')
  const { data: u } = jwt ? await db.auth.getUser(jwt) : { data: { user: null } }
  if (!u.user) return json({ error: 'Not signed in' }, 401)
  const { data: me } = await db.from('profiles').select('role').eq('id', u.user.id).maybeSingle()
  if (me?.role !== 'admin') return json({ error: 'Only an admin can see the Stripe balance' }, 403)
  if (!KEY) return json({ error: 'Stripe isn\'t set up' }, 503)
  try {
    const balance = await stripeClient(KEY)('GET', 'balance')
    const available = (balance?.available || []).filter((b: any) => b.currency === 'usd').reduce((s: number, b: any) => s + (Number(b.amount) || 0), 0)
    return json({ available_cents: available })
  } catch (e) {
    console.error('fulfillment-stripe-balance failed:', (e as Error).message)
    return json({ error: 'Stripe didn\'t answer. Try again in a minute.' }, 502)
  }
})
