// fulfillment-connect-session — Prompt 753. Payout settings for a Fulfillment
// rep, inside the portal, with Stripe Connect embedded components. index.ts
// wires Deno; everything here runs against a mocked Stripe in core.test.ts.
//
//   POST { action: 'overview' }  what My pay and Payout settings show: the
//        account's status, where pay goes (bank name + last 4), what Stripe
//        still needs, and a masked view of the rep's details and tax status.
//        Read live from Stripe for the caller's own account, and the summary
//        is saved to fulfillment_payout_accounts (heals a missed webhook).
//        Names, addresses and birth dates are masked here and never stored.
//   POST { action: 'session' }   an Account Session client_secret for the
//        embedded components (onboarding, account management, notification
//        banner, documents). Creates the rep's Express account first if they
//        don't have one (the P55 stripe-connect-onboard pattern, transfers
//        only). If Stripe refuses the documents component, the session is
//        made without it and { documents: false } tells the page to hide
//        Download 1099.
//
// Callers: a signed-in Fulfillment rep (or, Prompt 765, an admin connecting
// their own bank from Admin Payouts), for themselves only. The account id
// always comes from their own profile; nothing in the body names an account.

import {
  type PayoutAccount, type Stripe, StripeError, summarize, statusOf, destinationLabel,
} from '../_shared/fulfillmentPayouts.ts'

export type Profile = { id: string; role: string; email: string | null; full_name: string | null; stripe_account_id: string | null }

export type Store = {
  userFromJwt(jwt: string): Promise<string | null>
  profile(id: string): Promise<Profile | null>
  setStripeAccount(id: string, accountId: string): Promise<void>
  saveAccount(row: PayoutAccount): Promise<void>
}

export type Env = { configured: boolean; publishableKey: string | null }

export class AppError extends Error {
  status: number; code?: string
  constructor(status: number, message: string, code?: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

const TAG = { ohvara: 'fulfillment_payouts' }

// "1418 Elm St" → "•••• Elm St"
export function maskStreet(line1: string | null | undefined) {
  if (!line1) return null
  return line1.replace(/^\s*[\d-]+[A-Za-z]?\s*/, '•••• ')
}

export function details(account: any) {
  const ind = account?.individual
  if (!ind) return null
  const a = ind.address || {}
  const name = [ind.first_name, ind.last_name].filter(Boolean).join(' ') || null
  const place = [a.city, a.state].filter(Boolean).join(', ')
  const street = maskStreet(a.line1)
  return {
    legal_name: name,
    address: street || place ? [street, place].filter(Boolean).join(', ') : null,
    dob: ind.dob?.year ? `••/••/${ind.dob.year}` : null,
    verified: ind.verification?.status === 'verified',
    tin_on_file: !!(ind.ssn_last_4_provided || ind.id_number_provided),
  }
}

async function caller(store: Store, jwt: string) {
  const id = jwt ? await store.userFromJwt(jwt) : null
  if (!id) throw new AppError(401, 'Not signed in')
  const me = await store.profile(id)
  if (!me || (me.role !== 'fulfillment' && me.role !== 'admin')) throw new AppError(403, 'Payout settings are for Fulfillment reps.')
  return me
}

export async function overview(store: Store, stripe: Stripe, me: Profile) {
  if (!me.stripe_account_id) return { status: 'none', account: null, details: null }
  const account = await stripe('GET', `accounts/${me.stripe_account_id}`)
  const row = summarize(me.id, account)
  await store.saveAccount(row)
  return {
    status: statusOf(row),
    account: {
      payouts_enabled: row.payouts_enabled,
      requirements_due: row.requirements_due,
      disabled_reason: row.disabled_reason,
      external_kind: row.external_kind,
      bank_name: row.bank_name,
      last4: row.last4,
      label: destinationLabel(row),
    },
    details: details(account),
  }
}

async function ensureAccount(store: Store, stripe: Stripe, me: Profile) {
  if (me.stripe_account_id) return me.stripe_account_id
  const acct = await stripe('POST', 'accounts', {
    type: 'express',
    country: 'US',
    business_type: 'individual',
    capabilities: { transfers: { requested: true } },
    ...(me.email ? { email: me.email } : {}),
    metadata: { ...TAG, profile_id: me.id },
  }, { idempotencyKey: `fulfillment-account-${me.id}` })
  await store.setStripeAccount(me.id, acct.id)
  await store.saveAccount(summarize(me.id, acct))
  return acct.id as string
}

const COMPONENTS = {
  account_onboarding: { enabled: true, features: { external_account_collection: true } },
  account_management: { enabled: true, features: { external_account_collection: true } },
  notification_banner: { enabled: true, features: { external_account_collection: true } },
}

export async function session(store: Store, stripe: Stripe, env: Env, me: Profile) {
  if (!env.publishableKey) throw new AppError(503, 'Payouts aren\'t set up yet.', 'not_configured')
  const account = await ensureAccount(store, stripe, me)
  let documents = true
  let s
  try {
    s = await stripe('POST', 'account_sessions', { account, components: { ...COMPONENTS, documents: { enabled: true } } })
  } catch (e) {
    if (!(e instanceof StripeError) || !String(e.param || e.message).includes('documents')) throw e
    documents = false
    s = await stripe('POST', 'account_sessions', { account, components: COMPONENTS })
  }
  return { client_secret: s.client_secret, publishable_key: env.publishableKey, documents }
}

export async function act(store: Store, stripe: Stripe, env: Env, jwt: string, body: any) {
  const me = await caller(store, jwt)
  if (!env.configured) throw new AppError(503, 'Payouts aren\'t set up yet.', 'not_configured')
  switch (body?.action || 'overview') {
    case 'overview': return overview(store, stripe, me)
    case 'session': return session(store, stripe, env, me)
    default: throw new AppError(400, 'Unknown action')
  }
}

export async function handle(req: Request, store: Store, stripe: Stripe, env: Env): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer /, '')
  const body = await req.json().catch(() => ({}))
  try {
    return json(await act(store, stripe, env, jwt, body))
  } catch (e) {
    if (e instanceof AppError) return json({ error: e.message, ...(e.code ? { code: e.code } : {}) }, e.status)
    // Stripe's own text can name ids and internals; it's logged, not shown.
    console.error('fulfillment-connect-session failed:', e instanceof StripeError ? `${e.status} ${e.code || e.type}: ${e.message}` : (e as Error).message)
    return json({ error: 'Something went wrong with Stripe. Try again in a minute.' }, 502)
  }
}
