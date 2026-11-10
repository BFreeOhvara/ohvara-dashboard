// lead-spend (Prompt 884; P909 nightly) — charges lead spend to the card on file. index.ts wires Deno; all the logic is here, free
// of Deno globals, so it runs against a mocked Stripe and an in-memory store in core.test.ts.
//
// The money rules live in the database (supabase/migrations/237_billing_engine.sql): what a week needs, rollover,
// delivered spend capped at the balance, what stops when. This function only moves money for charges the database
// has already made (lead_spend_charges), and reports each result back (lead_spend_charge_result).
//
// P909 (final pricing): the database makes one 'nightly' charge per agent each evening (8 PM Central): tomorrow's
// spend minus their credit, plus 12% on lead plans. No weekly or mid-week raise charges are made any more, and no bank
// transfer: cards only. The statement descriptor reads OHVARA LEADS (the account prefix OHVARA + suffix LEADS).
//
//   POST (signed-in agent, Bearer JWT)
//     { action: 'set_spend', appts_cents, live_cents }  lead_spend_set (from tomorrow; the next nightly charge picks it
//                                                       up). Under $50 → 400 { code: 'min_daily' }; over the agent's
//                                                       max ($500) → 400 { code: 'max_daily' }.
//     { action: 'card_check' }                          reads the customer's default card from Stripe and records it
//                                                       (billing_card_saved: brand + last 4 only). Leads need one.
//     { action: 'pay_now' }                             after a card update: failed charges back to due, charged now.
//     { action: 'pause', paused }                       lead_spend_pause.
//     { action: 'plan_change', tier, daily_cents? }     P921 billing_plan_change. Up: the prorated difference is
//                                                       charged now (a 'plan_upgrade' charge, run straight away) and
//                                                       the plan changes only when it's paid; declined → nothing
//                                                       changes. Down: from the next bill. Same plan: Undo.
//                                                       Busy → 409 { code: 'busy' }; over the band → 400 'over_plan'.
//   POST (pg_cron, header x-ohvara-cron)
//     { action: 'run' }                                 every 15 minutes: charges everything due, re-checks processing.
//
// Each charge is an off-session PaymentIntent on the customer's default card (saved through agent-billing; card numbers
// are only ever in Stripe). The idempotency key is the
// charge's key plus its attempt number, so a crash and a re-run never charge twice; a retry after a decline is a new
// attempt. Statement descriptor suffix "LEADS" (shows as OHVARA LEADS).
//
// TEST MODE ONLY: unless the key starts with sk_test_, nothing is charged and nothing is sent to Stripe; charges stay
// due. A livemode PaymentIntent is never accepted. Going live is Brayden's switch (the live key), a hard stop.

import { type Stripe, StripeError } from '../_shared/fulfillmentPayouts.ts'

export type Charge = {
  id: string; agent_id: string; key: string; kind: 'weekly' | 'change' | 'va_cost' | 'nightly' | 'plan_upgrade'; amount_cents: number
  attempts: number; stripe_pi: string | null; week_start: string; note: string | null; customer: string | null; recheck: boolean
  for_day?: string | null; spend_cents?: number | null; fee_cents?: number | null
  note?: string | null; tier_to?: string | null
}

export type Store = {
  userFromJwt(jwt: string): Promise<string | null>
  cronOk(secret: string): Promise<boolean>
  // A service-role RPC. Throws { message, hint?, code? } like PostgREST.
  rpc(name: string, args: Record<string, unknown>): Promise<any>
}

export const isTestKey = (key: string | undefined) => !!key && key.startsWith('sk_test_')

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

const cents = (v: unknown) => (Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 100000 ? (v as number) : null)

// What one Stripe answer means for the charge.
export function outcomeOf(pi: any): { status: 'paid' | 'processing' | 'failed'; failure?: string } {
  if (pi?.livemode) return { status: 'failed', failure: 'Live payments are off (test mode only)' }
  switch (pi?.status) {
    case 'succeeded': return { status: 'paid' }
    case 'processing': return { status: 'processing' }
    case 'requires_action': return { status: 'failed', failure: 'Your bank wants you to confirm this payment. Update your card to try again.' }
    default: return { status: 'failed', failure: pi?.last_payment_error?.message || 'The payment was declined' }
  }
}

export const DESCRIPTOR_SUFFIX = 'LEADS'
// P921: a plan upgrade shows as OHVARA PLAN, its line "Upgrade to Pro, 15 days".
export const suffixOf = (c: Charge) => (c.kind === 'plan_upgrade' ? 'PLAN' : DESCRIPTOR_SUFFIX)
export const words = (c: Charge) =>
  c.kind === 'plan_upgrade' ? (c.note || `Upgrade to ${c.tier_to}`)
  : c.kind === 'va_cost' ? 'Team time (pilot)'
    : c.kind === 'nightly' ? `Lead spend for ${c.for_day}${c.fee_cents ? ' + 12%' : ''}`
      : c.kind === 'change' ? 'Lead spend (raised this week)' : 'Lead spend, week of ' + c.week_start

async function chargeOne(store: Store, stripe: Stripe, c: Charge) {
  let pi: any = null
  try {
    if (c.recheck && c.stripe_pi) {
      pi = await stripe('GET', `payment_intents/${c.stripe_pi}`)
    } else {
      if (!c.customer) return store.rpc('lead_spend_charge_result', { p_id: c.id, p_status: 'failed', p_failure: 'No card on file' })
      const customer = await stripe('GET', `customers/${c.customer}`)
      const method = customer?.invoice_settings?.default_payment_method
      const pm = typeof method === 'string' ? method : method?.id
      if (!pm) return store.rpc('lead_spend_charge_result', { p_id: c.id, p_status: 'failed', p_failure: 'No card on file' })
      pi = await stripe('POST', 'payment_intents', {
        amount: c.amount_cents, currency: 'usd', customer: c.customer, payment_method: pm,
        off_session: true, confirm: true, description: words(c), statement_descriptor_suffix: suffixOf(c),
        payment_method_types: ['card'],
        metadata: { ohvara: 'lead_spend', charge_id: c.id, agent_id: c.agent_id, kind: c.kind, week_start: c.week_start,
          for_day: c.for_day ?? '', spend_cents: String(c.spend_cents ?? ''), fee_cents: String(c.fee_cents ?? ''), tier_to: c.tier_to ?? '' },
      }, { idempotencyKey: `lead_spend:${c.key}:${c.attempts}` })
    }
  } catch (e) {
    if (e instanceof StripeError) {
      // A decline comes back as an error that still names the PaymentIntent.
      const err = (e as StripeError).raw || {}
      return store.rpc('lead_spend_charge_result', {
        p_id: c.id, p_status: 'failed', p_pi: err.payment_intent?.id ?? null, p_failure: err.message || e.message || 'The payment was declined',
      })
    }
    // Network or Stripe outage: leave it processing; the next run retries with the same idempotency key.
    return { left: c.id, error: String((e as Error)?.message || e) }
  }
  const o = outcomeOf(pi)
  return store.rpc('lead_spend_charge_result', { p_id: c.id, p_status: o.status, p_pi: pi?.id ?? null, p_failure: o.failure ?? null })
}

export async function runCharges(store: Store, stripe: Stripe | null, key: string | undefined, agent: string | null = null) {
  if (!isTestKey(key) || !stripe) return { skipped: 'test mode only', charged: 0 }
  const claimed: Charge[] = (await store.rpc('lead_spend_claim_charges', { p_limit: 25, p_agent: agent })) || []
  const results = []
  for (const c of claimed) results.push({ id: c.id, result: await chargeOne(store, stripe, c) })
  return { charged: claimed.length, results }
}

// The customer's default card, as words ("Visa ending 4242"), or null. Never the number.
export async function cardOf(stripe: Stripe, customer: string | null): Promise<string | null> {
  if (!customer) return null
  const cu = await stripe('GET', `customers/${customer}`)
  const method = cu?.invoice_settings?.default_payment_method
  const id = typeof method === 'string' ? method : method?.id
  if (!id) return null
  const pm = typeof method === 'object' && method?.card ? method : await stripe('GET', `payment_methods/${id}`)
  if (pm?.type && pm.type !== 'card') return null
  const brand = String(pm?.card?.brand || 'Card')
  return `${brand.charAt(0).toUpperCase()}${brand.slice(1)} ending ${pm?.card?.last4 || '••••'}`
}

export async function handle(req: Request, store: Store, stripe: Stripe | null, key: string | undefined): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  let body: any = {}
  try { body = await req.json() } catch { return json({ error: 'Bad JSON' }, 400) }

  const cron = req.headers.get('x-ohvara-cron')
  if (cron) {
    if (!(await store.cronOk(cron))) return json({ error: 'Not allowed' }, 401)
    if (body.action !== 'run') return json({ error: 'Unknown action' }, 400)
    return json(await runCharges(store, stripe, key))
  }

  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
  const me = jwt ? await store.userFromJwt(jwt) : null
  if (!me) return json({ error: 'Not signed in' }, 401)

  try {
    switch (body.action) {
      case 'set_spend': {
        const a = cents(body.appts_cents), l = cents(body.live_cents)
        if (a == null || l == null) return json({ error: 'Spend must be whole cents, $0 to $1,000 a day' }, 400)
        const set = await store.rpc('lead_spend_set', { p_appts_cents: a, p_live_cents: l, p_agent: me })
        const charged = set?.charge_id ? await runCharges(store, stripe, key, me) : null
        return json({ ...set, charged })
      }
      case 'card_check': {
        if (!stripe || !isTestKey(key)) return json({ card: null, skipped: 'test mode only' })
        const customer = await store.rpc('billing_customer_of', { p_agent: me })
        const label = await cardOf(stripe, customer)
        await store.rpc('billing_card_saved', { p_agent: me, p_label: label })
        return json({ card: label })
      }
      case 'pay_now': {
        const retried = await store.rpc('lead_spend_retry', { p_agent: me })
        return json({ retried, charged: await runCharges(store, stripe, key, me) })
      }
      case 'plan_change': {
        if (!['starter', 'growth', 'pro'].includes(body.tier)) return json({ error: 'Pick a plan' }, 400)
        const d = body.daily_cents == null ? null : cents(body.daily_cents)
        if (body.daily_cents != null && d == null) return json({ error: 'Spend must be whole cents, $0 to $1,000 a day' }, 400)
        const q = await store.rpc('billing_plan_change', { p_tier: body.tier, p_daily_cents: d, p_agent: me })
        const charged = q?.charge_id ? await runCharges(store, stripe, key, me) : null
        const result = q?.charge_id ? (charged as any)?.results?.find((r: any) => r.id === q.charge_id)?.result?.status ?? 'due' : null
        return json({ ...q, charged, result })
      }
      case 'pause':
        if (typeof body.paused !== 'boolean') return json({ error: 'paused must be true or false' }, 400)
        await store.rpc('lead_spend_pause', { p_paused: body.paused, p_agent: me })
        return json({ paused: body.paused })
      default:
        return json({ error: 'Unknown action' }, 400)
    }
  } catch (e: any) {
    if (e?.hint === 'min_daily' || e?.hint === 'max_daily' || e?.hint === 'over_plan' || e?.hint === 'servicing_only') return json({ error: e.message, code: e.hint }, 400)
    if (e?.hint === 'busy') return json({ error: e.message, code: 'busy' }, 409)
    if (e?.code === '42501') return json({ error: e.message || 'Not allowed' }, 403)
    return json({ error: e?.message || 'Something went wrong' }, 500)
  }
}
