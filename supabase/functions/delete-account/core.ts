// Prompt 775 — Delete my account (Apple guideline 5.1.1(v)), for agents and
// Fulfillment, from the app or the website. Admins can't delete themselves
// here. Order matters:
//   1. an agent's Stripe plan is cancelled now (if Stripe can't be reached,
//      nothing is deleted: never leave someone billed with no account);
//   2. account_delete() (migration 156) removes their personal data and
//      messages, anonymises the profile, keeps pay / call records, and tells
//      the admins (bell + email);
//   3. their profile photo is removed from storage;
//   4. the login is deleted (soft: the auth row stays, scrambled, so records
//      that point at the id keep working; nobody can sign in with it).
// What's deleted vs kept: brain/Account Deletion.md (vault).

export type Me = {
  id: string
  role: string
  is_demo: boolean | null
  billing_exempt: boolean | null
  billing_status: string | null
  stripe_subscription_id: string | null
  deleted_at: string | null
}

export interface Deps {
  userFromJwt(jwt: string): Promise<string | null>
  profile(id: string): Promise<Me | null>
  // 'cancelled' | 'gone' (already ended / not found); throws when Stripe fails.
  cancelSubscription(subId: string): Promise<'cancelled' | 'gone'>
  stripeReady: boolean
  deleteData(id: string): Promise<Record<string, unknown>>
  removePhoto(id: string): Promise<void>
  deleteLogin(id: string): Promise<void>
}

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

// A plan that is still charging (or set to end later) is cancelled now.
const LIVE = ['active', 'past_due', 'trialing', 'canceled', 'incomplete', 'unpaid']

export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
  const uid = jwt ? await deps.userFromJwt(jwt) : null
  if (!uid) return json({ error: 'Not signed in' }, 401)

  let body: any = {}
  try { body = await req.json() } catch { /* empty */ }
  if (body?.confirm !== 'DELETE') return json({ error: 'Type DELETE to confirm.' }, 400)

  const me = await deps.profile(uid)
  if (!me) return json({ error: 'No account found.' }, 404)
  if (me.deleted_at) return json({ ok: true, already: true })
  if (me.role === 'admin') return json({ error: 'Admin accounts can’t be deleted from here. Ask another admin.' }, 403)
  if (me.role !== 'agent' && me.role !== 'fulfillment') return json({ error: 'This account can’t be deleted from here.' }, 403)

  // 1. Stripe first (agents only; sample and comped accounts were never billed).
  let plan: 'none' | 'cancelled' | 'gone' = 'none'
  const billed = me.role === 'agent' && !me.is_demo && !me.billing_exempt && me.billing_status !== 'exempt'
  if (billed && me.stripe_subscription_id && LIVE.includes(me.billing_status || '')) {
    if (!deps.stripeReady) return json({ error: 'Billing can’t be reached right now, so nothing was deleted. Try again later.' }, 503)
    try {
      plan = await deps.cancelSubscription(me.stripe_subscription_id)
    } catch (e) {
      console.error('[delete-account] stripe cancel failed:', (e as Error).message)
      return json({ error: 'Couldn’t cancel your plan, so nothing was deleted. Try again in a minute.' }, 502)
    }
  }

  // 2. The data.
  let removed: Record<string, unknown>
  try {
    removed = await deps.deleteData(uid)
  } catch (e) {
    console.error('[delete-account] account_delete failed:', (e as Error).message)
    return json({ error: 'Couldn’t delete your account. Try again in a minute.', plan }, 500)
  }

  // 3–4. Photo and login. The profile is already anonymous and switched off,
  // so a failure here is logged, not shown: the person is signed out anyway.
  try { await deps.removePhoto(uid) } catch (e) { console.error('[delete-account] photo:', (e as Error).message) }
  try { await deps.deleteLogin(uid) } catch (e) { console.error('[delete-account] login:', (e as Error).message) }

  return json({ ok: true, plan, removed })
}

// Stripe: cancel now (not at period end). Already-ended or missing = gone.
export async function stripeCancel(key: string, subId: string, f: typeof fetch = fetch): Promise<'cancelled' | 'gone'> {
  const res = await f(`https://api.stripe.com/v1/subscriptions/${encodeURIComponent(subId)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${key}` },
  })
  if (res.ok) return 'cancelled'
  const data = await res.json().catch(() => ({}))
  const err = data?.error || {}
  if (res.status === 404 || err.code === 'resource_missing' || /cancel/i.test(err.message || '')) return 'gone'
  throw new Error(`stripe ${res.status} ${err.code || err.type || ''}`)
}
