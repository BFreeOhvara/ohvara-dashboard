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
// P933 LIVE CHARGING: an sk_test_ key charges as before (test mode). A live key (sk_live_ / rk_live_) charges only
// while Admin > Settings > Billing > Live charging is on (billing_settings.live_charging, default off; turning it on is
// Brayden's yes). Off: nothing is charged or sent to Stripe; charges stay due. A livemode PaymentIntent is accepted
// only while live charging is on. Test accounts (profiles.is_demo) are never claimed (lead_spend_claim_charges).
//
// P933 actions (signed-in agent):
//     { action: 'signup_quote', tier, daily_cents }     billing_signup_quote: setup + first month + first 2 days + booking desk.
//     { action: 'signup', tier, daily_cents }           billing_signup_start, then the charge runs straight away:
//                                                       { status: paid | failed | processing | due, skipped? }.
//   P955 (signed-in agent): signup_quote / signup take products: ['leads'|'servicing'|'reactivation', ...] (any mix;
//                                                       reactivation only = no charge, status paid at once).
//                           { action: 'product_add', product, tier?, daily_cents? }  billing_product_add, then the charge
//                                                       runs straight away (reactivation: added, no charge).
//   P952 (signed-in agent): { action: 'reactivation_pay', list_id }  reactivation_charge_start (the agent's own unpaid
//                                                       list: $2 x callable leads, one charge, OHVARA LEADS), then the
//                                                       charge runs straight away: { status: paid | failed | processing | due }.
//                                                       On a live key it needs recovery_config.reactivation_live too.
//   Cron 'run' also pays back what the reactivation scrub took off a paid list (reactivation_refunds_due), on the
//   same PaymentIntent, idempotent per list and amount.
//   P957 (final model): uploading a list is free; each DELIVERED appointment or live call is one $20
//   'reactivation_delivery' charge made by the database (reactivation_bill), which pg_net hands straight to
//     cron { action: 'reactivation_charge', agent_id }  runs that agent's due charges now (the 15-minute 'run' is the
//                                                       fallback). The lead shows only once it's paid (269).
//   'reactivation_pay' is retired (410 retired). Instead, signed-in agent:
//     { action: 'reactivation_start', list_id, pi? }    the card check, then reactivation_start_list (free):
//        default card -> not prepaid -> its fingerprint not on another account -> a $1 hold (manual capture, 3-D Secure
//        when the bank asks, Stripe Radar on) released at once. 3-D Secure: { code: 'needs_action', client_secret, pi }
//        -> the portal runs stripe.handleNextAction and calls again with pi. Every check is kept (reactivation_cards).
//   A transfer reported under 30 s after it was charged is paid back like the scrub refunds (delivery_id rows).
//   Admin: { action: 'live_check' }                     $1 on the admin's own saved card, refunded straight away. Runs on a
//                                                       test or a live key (Brayden's yes in chat); shows in Revenue.

import { type Stripe, StripeError } from '../_shared/fulfillmentPayouts.ts'

export type Charge = {
  id: string; agent_id: string; key: string
  kind: 'weekly' | 'change' | 'va_cost' | 'nightly' | 'plan_upgrade' | 'signup' | 'plan_month' | 'live_check' | 'reactivation' | 'product_add' | 'reactivation_delivery'; amount_cents: number
  attempts: number; stripe_pi: string | null; week_start: string; note: string | null; customer: string | null; recheck: boolean
  for_day?: string | null; spend_cents?: number | null; fee_cents?: number | null
  note?: string | null; tier_to?: string | null
  setup_cents?: number | null; plan_cents?: number | null; extra_cents?: number | null
}

export type Store = {
  userFromJwt(jwt: string): Promise<string | null>
  cronOk(secret: string): Promise<boolean>
  isAdmin(id: string): Promise<boolean>
  // A service-role RPC. Throws { message, hint?, code? } like PostgREST.
  rpc(name: string, args: Record<string, unknown>): Promise<any>
}

export const isTestKey = (key: string | undefined) => !!key && (key.startsWith('sk_test_') || key.startsWith('rk_test_'))
export const isLiveKey = (key: string | undefined) => !!key && (key.startsWith('sk_live_') || key.startsWith('rk_live_'))
// May this key charge right now? Test: yes. Live: only with the Admin switch on (P933).
export async function chargingAllowed(store: Store, key: string | undefined): Promise<{ ok: boolean; live: boolean }> {
  if (isTestKey(key)) return { ok: true, live: false }
  if (!isLiveKey(key)) return { ok: false, live: false }
  return { ok: (await store.rpc('billing_live_charging', {})) === true, live: true }
}

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

const cents = (v: unknown) => (Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 100000 ? (v as number) : null)

// What one Stripe answer means for the charge.
export function outcomeOf(pi: any, liveOk = false): { status: 'paid' | 'processing' | 'failed'; failure?: string } {
  if (pi?.livemode && !liveOk) return { status: 'failed', failure: 'Live payments are off (test mode only)' }
  switch (pi?.status) {
    case 'succeeded': return { status: 'paid' }
    case 'processing': return { status: 'processing' }
    case 'requires_action': return { status: 'failed', failure: 'Your bank wants you to confirm this payment. Update your card to try again.' }
    default: return { status: 'failed', failure: pi?.last_payment_error?.message || 'The payment was declined' }
  }
}

export const DESCRIPTOR_SUFFIX = 'LEADS'
// P921: a plan upgrade shows as OHVARA PLAN, its line "Upgrade to Pro, 15 days".
// P933: the monthly plan shows as OHVARA PLAN too; the sign-up as OHVARA LEADS, the live check as OHVARA CHECK.
export const suffixOf = (c: Charge) => (c.kind === 'plan_upgrade' || c.kind === 'plan_month' ? 'PLAN' : c.kind === 'live_check' ? 'CHECK' : DESCRIPTOR_SUFFIX)
const usd = (cents: number | null | undefined) => `$${((cents ?? 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
// The receipt line. P933: the 12% is the "booking desk", never a bare "+ 12%".
export const words = (c: Charge) =>
  c.kind === 'plan_upgrade' ? (c.note || `Upgrade to ${c.tier_to}`)
  : c.kind === 'va_cost' ? 'Team time (pilot)'
    : c.kind === 'nightly' ? `Lead spend for ${c.for_day}: ${usd(c.spend_cents)} to your ads${c.fee_cents ? ` + ${usd(c.fee_cents)} booking desk` : ''}`
      : c.kind === 'signup' || c.kind === 'plan_month' || c.kind === 'product_add' ? (c.note || 'Ohvara plan')
        : c.kind === 'live_check' ? 'Ohvara live check ($1, refunded)'
          : c.kind === 'reactivation' || c.kind === 'reactivation_delivery' ? (c.note || 'Reactivation')
          : c.kind === 'change' ? 'Lead spend (raised this week)' : 'Lead spend, week of ' + c.week_start
// Which catalog product a charge belongs to (P933 stripe_catalog), for Stripe's own reports.
export const productOf = (c: Charge) =>
  c.kind === 'signup' || c.kind === 'product_add' ? 'ohvara_signup' : c.kind === 'plan_month' || c.kind === 'plan_upgrade' ? `ohvara_plan_${c.tier_to || 'servicing'}`
    : c.kind === 'live_check' ? 'ohvara_live_check' : c.kind === 'reactivation' || c.kind === 'reactivation_delivery' ? 'ohvara_reactivation' : 'ohvara_lead_spend'

async function chargeOne(store: Store, stripe: Stripe, c: Charge, liveOk = false) {
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
          for_day: c.for_day ?? '', spend_cents: String(c.spend_cents ?? ''), fee_cents: String(c.fee_cents ?? ''), tier_to: c.tier_to ?? '',
          setup_cents: String(c.setup_cents ?? ''), plan_cents: String(c.plan_cents ?? ''), extra_cents: String(c.extra_cents ?? ''),
          product: productOf(c) },
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
  const o = outcomeOf(pi, liveOk)
  const r = await store.rpc('lead_spend_charge_result', { p_id: c.id, p_status: o.status, p_pi: pi?.id ?? null, p_failure: o.failure ?? null })
  return { ...(r || {}), status: r?.status ?? o.status, pi: pi?.id ?? null, failure: o.failure ?? null }
}

export async function runCharges(store: Store, stripe: Stripe | null, key: string | undefined, agent: string | null = null) {
  if (!stripe) return { skipped: 'Stripe not set up', charged: 0 }
  const gate = await chargingAllowed(store, key)
  if (!gate.ok) return { skipped: gate.live ? 'live charging is off' : 'no Stripe key', charged: 0 }
  const claimed: Charge[] = (await store.rpc('lead_spend_claim_charges', { p_limit: 25, p_agent: agent })) || []
  const results = []
  for (const c of claimed) results.push({ id: c.id, result: await chargeOne(store, stripe, c, gate.live) })
  return { charged: claimed.length, results }
}

// P952: what the reactivation scrub took off a paid list goes back on the same PaymentIntent (removed numbers are free).
export async function reactivationRefunds(store: Store, stripe: Stripe | null, key: string | undefined) {
  if (!stripe) return { skipped: 'Stripe not set up', refunded: 0 }
  const gate = await chargingAllowed(store, key)
  if (!gate.ok) return { skipped: gate.live ? 'live charging is off' : 'no Stripe key', refunded: 0 }
  const got = await store.rpc('reactivation_refunds_due', {})
  const due: { list_id?: string; delivery_id?: string; charge_id: string; pi: string; cents: number; key: string }[] = Array.isArray(got) ? got : []
  let refunded = 0
  for (const r of due) {
    if (!(r.cents > 0) || !r.pi) continue
    try {
      // P957: a delivered live call that turned out under 30 s is paid back the same way.
      const meta = r.delivery_id ? { ohvara: 'reactivation_short_transfer', delivery_id: r.delivery_id, charge_id: r.charge_id }
        : { ohvara: 'reactivation_scrub', list_id: r.list_id, charge_id: r.charge_id }
      await stripe('POST', 'refunds', { payment_intent: r.pi, amount: r.cents, metadata: meta }, { idempotencyKey: r.key })
      if (r.delivery_id) await store.rpc('reactivation_delivery_refunded', { p_delivery: r.delivery_id, p_cents: r.cents })
      else await store.rpc('reactivation_refunded', { p_list: r.list_id, p_cents: r.cents })
      refunded++
    } catch { /* left due; the next run tries again with the same key */ }
  }
  return { refunded }
}

// The $1 live check: charged on the admin's own saved card (any key; Brayden's yes in chat), then refunded in full.
export async function liveCheck(store: Store, stripe: Stripe, key: string | undefined, me: string) {
  const { charge_id } = await store.rpc('billing_live_check_start', { p_admin: me })
  const claimed: Charge[] = (await store.rpc('lead_spend_claim_charges', { p_limit: 5, p_agent: me })) || []
  const c = claimed.find(x => x.id === charge_id)
  if (!c) return { status: 'due', refunded: false }
  const r: any = await chargeOne(store, stripe, c, isLiveKey(key))
  const status = r?.status ?? 'processing'
  let refunded = false
  if (status === 'paid' && r?.pi) {
    await stripe('POST', 'refunds', { payment_intent: r.pi, metadata: { ohvara: 'live_check', charge_id: c.id } }, { idempotencyKey: `live_check_refund:${c.id}` })
    await store.rpc('billing_charge_refunded', { p_id: c.id, p_cents: c.amount_cents })
    refunded = true
  }
  return { status, refunded, mode: isLiveKey(key) ? 'live' : 'test', failure: r?.failure ?? null }
}

// -- P957: the card check before a reactivation list starts --------------------------------------------------------
// Nobody gets leads without a real, chargeable card: not prepaid/gift, not already backing another account, and a $1
// hold that clears (the bank's 3-D Secure when it asks; Radar decides like any payment). The hold is released at once.
// Returns { ok: true, card } or { ok: false, code, error, client_secret?, pi? }.
export const CHECK_CENTS = 100
const ucBrand = (b: unknown) => { const x = String(b || 'Card'); return x.charAt(0).toUpperCase() + x.slice(1) }
export async function reactivationCardCheck(store: Store, stripe: Stripe, key: string | undefined, me: string, piId: string | null = null) {
  const off = { ok: false, code: 'reactivation_off', error: 'Reactivation opens soon. Nothing was charged.' }
  const gate = await chargingAllowed(store, key)
  if (!gate.ok) return off
  if (gate.live && (await store.rpc('reactivation_is_live', {})) !== true) return off
  const record = (pm: any, status: string, failure: string | null = null) => store.rpc('reactivation_card_record', {
    p_agent: me, p_pm: pm?.id ?? null, p_fingerprint: pm?.card?.fingerprint ?? null, p_funding: pm?.card?.funding ?? null,
    p_brand: pm?.card?.brand ?? null, p_last4: pm?.card?.last4 ?? null, p_status: status, p_failure: failure })
  const customer = await store.rpc('billing_customer_of', { p_agent: me })
  if (!customer) { await record(null, 'no_card'); return { ok: false, code: 'no_card', error: 'Add a card first.' } }
  const cu = await stripe('GET', `customers/${customer}`)
  const method = cu?.invoice_settings?.default_payment_method
  const pmId = typeof method === 'string' ? method : method?.id
  if (!pmId) { await record(null, 'no_card'); return { ok: false, code: 'no_card', error: 'Add a card first.' } }
  const pm = typeof method === 'object' && method?.card ? method : await stripe('GET', `payment_methods/${pmId}`)
  if (pm?.type && pm.type !== 'card') { await record(pm, 'no_card'); return { ok: false, code: 'no_card', error: 'Add a credit or debit card.' } }
  const label = `${ucBrand(pm?.card?.brand)} ending ${pm?.card?.last4 || '••••'}`
  if (pm?.card?.funding === 'prepaid') {
    await record(pm, 'prepaid', 'Prepaid card')
    return { ok: false, code: 'prepaid', error: `Prepaid and gift cards can't be used for reactivation. Add a credit or debit card. (${label})` }
  }
  if (await store.rpc('reactivation_card_shared', { p_agent: me, p_fingerprint: pm?.card?.fingerprint ?? null })) {
    await record(pm, 'shared', 'On another account')
    return { ok: false, code: 'shared_card', error: 'This card is already on another Ohvara account. Use a different card, or contact us.' }
  }
  let pi: any
  try {
    if (piId) {
      // After 3-D Secure in the portal: the same hold, read back (it must be ours, for this agent).
      pi = await stripe('GET', `payment_intents/${piId}`)
      if (pi?.metadata?.ohvara !== 'reactivation_card_check' || pi?.metadata?.agent_id !== me) return { ok: false, code: 'bad_check', error: 'Start the card check again.' }
    } else {
      pi = await stripe('POST', 'payment_intents', {
        amount: CHECK_CENTS, currency: 'usd', customer, payment_method: pm.id, capture_method: 'manual', confirm: true,
        payment_method_types: ['card'], payment_method_options: { card: { request_three_d_secure: 'automatic' } },
        description: 'Ohvara card check ($1 hold, released)', statement_descriptor_suffix: 'CHECK',
        metadata: { ohvara: 'reactivation_card_check', agent_id: me, product: 'ohvara_reactivation' },
      }, { idempotencyKey: `react_card:${me}:${pm.id}:${Math.floor(Date.now() / 600000)}` })
    }
  } catch (e) {
    if (e instanceof StripeError) {
      const msg = (e as StripeError).message || 'The card was declined.'
      await record(pm, 'declined', msg)
      return { ok: false, code: 'declined', error: `${msg} Try another card.` }
    }
    throw e
  }
  if (pi?.livemode && !gate.live) { await record(pm, 'declined', 'Live card on test mode'); return { ok: false, code: 'declined', error: 'Live payments are off (test mode only).' } }
  if (pi?.status === 'requires_action') {
    await record(pm, 'needs_action', 'Bank asked to confirm')
    return { ok: false, code: 'needs_action', error: 'Your bank wants you to confirm the card.', client_secret: pi.client_secret, pi: pi.id }
  }
  if (pi?.status !== 'requires_capture' && pi?.status !== 'succeeded') {
    const msg = pi?.last_payment_error?.message || 'The card was declined.'
    await record(pm, 'declined', msg)
    return { ok: false, code: 'declined', error: `${msg} Try another card.` }
  }
  // Passed: release the hold (the $1 never stays on the card).
  try { if (pi.status === 'requires_capture') await stripe('POST', `payment_intents/${pi.id}/cancel`, {}, { idempotencyKey: `react_card_release:${pi.id}` }) }
  catch { /* an uncaptured hold falls off by itself within 7 days */ }
  await record(pm, 'ok')
  return { ok: true, card: label }
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

// P955: the products picked (leads, servicing, reactivation). null = not sent (the P933 way); false = not valid.
export function productsOf(v: unknown): string[] | null | false {
  if (v == null) return null
  if (!Array.isArray(v) || !v.length || v.length > 3) return false
  return v.every(x => ['leads', 'servicing', 'reactivation'].includes(x as string)) ? [...new Set(v as string[])] : false
}

export async function handle(req: Request, store: Store, stripe: Stripe | null, key: string | undefined): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  let body: any = {}
  try { body = await req.json() } catch { return json({ error: 'Bad JSON' }, 400) }

  const cron = req.headers.get('x-ohvara-cron')
  if (cron) {
    if (!(await store.cronOk(cron))) return json({ error: 'Not allowed' }, 401)
    // P957: a delivered appointment or live call charges straight away (269 reactivation_bill -> pg_net).
    if (body.action === 'reactivation_charge') {
      if (typeof body.agent_id !== 'string' || !/^[0-9a-f-]{36}$/.test(body.agent_id)) return json({ error: 'agent_id' }, 400)
      return json(await runCharges(store, stripe, key, body.agent_id))
    }
    if (body.action !== 'run') return json({ error: 'Unknown action' }, 400)
    const ran = await runCharges(store, stripe, key)
    return json({ ...ran, refunds: await reactivationRefunds(store, stripe, key) })
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
        // Reading the card charges nothing, so it works on either key (P933).
        if (!stripe) return json({ card: null, skipped: 'Stripe not set up' })
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
      case 'signup_quote': {
        const d = body.daily_cents == null ? null : cents(body.daily_cents)
        const products = productsOf(body.products)
        if (products === false) return json({ error: 'Pick Leads, Servicing or Reactivation' }, 400)
        return json(await store.rpc('billing_signup_quote', { p_tier: String(body.tier || ''), p_daily_cents: d, p_agent: me, p_products: products }))
      }
      case 'signup': {
        // P955: products = any mix of leads, servicing, reactivation (not sent = the P933 way: tier 'servicing' or a lead plan).
        const products = productsOf(body.products)
        if (products === false) return json({ error: 'Pick Leads, Servicing or Reactivation' }, 400)
        const leads = products ? products.includes('leads') : body.tier !== 'servicing'
        if (leads && !['starter', 'growth', 'pro'].includes(body.tier)) return json({ error: 'Pick a plan' }, 400)
        if (!products && !['starter', 'growth', 'pro', 'servicing'].includes(body.tier)) return json({ error: 'Pick a plan' }, 400)
        const d = leads ? cents(body.daily_cents) : null
        if (leads && d == null) return json({ error: 'Spend must be whole cents, $0 to $1,000 a day' }, 400)
        // P941: a lead plan is charged only once the sign-up has everything the campaign needs (states + licence tick,
        // time zone, hours; save_signup_details). Nothing is charged while anything is missing.
        if (leads) {
          const missing = await store.rpc('signup_details_missing', { p_agent: me })
          if (Array.isArray(missing) && missing.length) {
            return json({ error: `Finish your details first: ${missing.join(', ')}. Nothing was charged.`, code: 'details_missing', missing }, 400)
          }
        }
        const q = await store.rpc('billing_signup_start', { p_tier: leads ? body.tier : 'servicing', p_daily_cents: d, p_agent: me, p_products: products })
        // Reactivation only: nothing to charge; the portal is open.
        if (q?.free) return json({ ...q, status: 'paid', failure: null, skipped: null })
        const charged: any = await runCharges(store, stripe, key, me)
        const mine = charged?.results?.find((r: any) => r.id === q.charge_id)?.result
        return json({ ...q, status: mine?.status ?? q.status ?? 'due', failure: mine?.failure ?? null, skipped: charged?.skipped ?? null })
      }
      case 'product_add': {
        // P955: add Leads or Servicing in Billing (charged now: setup when due, the days left, the first days of leads);
        // Reactivation is added with no charge. Leads needs the sign-up details saved first (states, hours).
        if (!['leads', 'servicing', 'reactivation'].includes(body.product)) return json({ error: 'Pick a product' }, 400)
        const leads = body.product === 'leads'
        if (leads && !['starter', 'growth', 'pro'].includes(body.tier)) return json({ error: 'Pick a plan' }, 400)
        const d = leads ? cents(body.daily_cents) : null
        if (leads && d == null) return json({ error: 'Spend must be whole cents, $0 to $1,000 a day' }, 400)
        if (leads) {
          const missing = await store.rpc('signup_details_missing', { p_agent: me })
          if (Array.isArray(missing) && missing.length) {
            return json({ error: `Finish your details first: ${missing.join(', ')}. Nothing was charged.`, code: 'details_missing', missing }, 400)
          }
        }
        const q = await store.rpc('billing_product_add', { p_product: body.product, p_tier: leads ? body.tier : null, p_daily_cents: d, p_agent: me })
        if (q?.status === 'added') return json({ ...q, status: 'paid', failure: null, skipped: null })
        const charged: any = await runCharges(store, stripe, key, me)
        const mine = charged?.results?.find((r: any) => r.id === q.charge_id)?.result
        return json({ ...q, status: mine?.status ?? q.status ?? 'due', failure: mine?.failure ?? null, skipped: charged?.skipped ?? null })
      }
      case 'reactivation_pay':
        // P952's pay-per-list is retired (P957): lists are free; each delivered appointment or live call is charged.
        return json({ error: 'Lists are free to start now. You pay for each appointment or live call we deliver.', code: 'retired' }, 410)
      case 'reactivation_start': {
        if (typeof body.list_id !== 'string' || !/^[0-9a-f-]{36}$/.test(body.list_id)) return json({ error: 'Pick a list' }, 400)
        const pi = typeof body.pi === 'string' && /^pi_[A-Za-z0-9_]+$/.test(body.pi) ? body.pi : null
        if (!stripe) return json({ error: "Billing isn't set up yet.", code: 'reactivation_off' }, 503)
        const chk: any = await reactivationCardCheck(store, stripe, key, me, pi)
        if (!chk.ok) return json(chk, chk.code === 'needs_action' ? 202 : chk.code === 'reactivation_off' ? 409 : 402)
        const started = await store.rpc('reactivation_start_list', { p_list: body.list_id, p_agent: me })
        return json({ ok: true, card: chk.card, ...started })
      }
      case 'live_check': {
        if (!(await store.isAdmin(me))) return json({ error: 'Admins only' }, 403)
        if (!stripe) return json({ error: 'Stripe not set up' }, 503)
        return json(await liveCheck(store, stripe, key, me))
      }
      case 'pause':
        if (typeof body.paused !== 'boolean') return json({ error: 'paused must be true or false' }, 400)
        await store.rpc('lead_spend_pause', { p_paused: body.paused, p_agent: me })
        return json({ paused: body.paused })
      default:
        return json({ error: 'Unknown action' }, 400)
    }
  } catch (e: any) {
    if (['min_daily', 'max_daily', 'over_plan', 'servicing_only', 'bad_tier', 'no_products', 'bad_product', 'details_missing'].includes(e?.hint)) return json({ error: e.message, code: e.hint }, 400)
    if (['busy', 'test_account', 'comped', 'already_paid', 'no_card', 'empty', 'already_have', 'pending_removal', 'not_signed_up', 'card_owed', 'over_limit', 'retired'].includes(e?.hint)) return json({ error: e.message, code: e.hint }, 409)
    if (e?.code === '42501') return json({ error: e.message || 'Not allowed' }, 403)
    return json({ error: e?.message || 'Something went wrong' }, 500)
  }
}
