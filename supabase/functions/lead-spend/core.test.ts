/**
 * Node unit tests for lead-spend with a mocked Stripe and an in-memory store. No real Stripe calls.
 * Run: node --test supabase/functions/lead-spend/core.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { handle, outcomeOf, runCharges, words, cardOf, type Charge, type Store } from './core.ts'
import { StripeError, type Stripe } from '../_shared/fulfillmentPayouts.ts'

const AGENT = 'a8840000-0000-4000-8000-00000000000a'

const charge = (over: Partial<Charge> = {}): Charge => ({
  id: 'ch1', agent_id: AGENT, key: 'weekly:a:2026-11-16', kind: 'weekly', amount_cents: 47500, attempts: 1,
  stripe_pi: null, week_start: '2026-11-16', note: null, customer: 'cus_a', recheck: false, ...over,
})

function world(claims: Charge[] = [charge()], over: { rpcError?: any; setResult?: any; changeResult?: any; changeError?: any } = {}) {
  const rpcs: { name: string; args: any }[] = []
  const store: Store = {
    userFromJwt: async jwt => (jwt === 'good' ? AGENT : null),
    cronOk: async s => s === 'cron-secret',
    rpc: async (name, args) => {
      rpcs.push({ name, args })
      if (over.rpcError && name === 'lead_spend_set') throw over.rpcError
      if (name === 'lead_spend_claim_charges') return claims.splice(0)
      if (name === 'lead_spend_set') return over.setResult ?? { from: '2026-11-12', charge_id: 'ch1', extra_cents: 30000 }
      if (name === 'lead_spend_retry') return 1
      if (name === 'billing_plan_change') { if (over.changeError) throw over.changeError; return over.changeResult ?? { direction: 'down', next_bill: '2026-12-01' } }
      if (name === 'billing_customer_of') return 'cus_a'
      if (name === 'billing_card_saved') return null
      return { status: args.p_status }
    },
  }
  return { store, rpcs, results: () => rpcs.filter(r => r.name === 'lead_spend_charge_result').map(r => r.args) }
}

function fakeStripe(routes: Record<string, (params: any, opts: any) => any>) {
  const calls: { method: string; path: string; params?: any; opts?: any }[] = []
  const stripe: Stripe = async (method, path, params, opts) => {
    calls.push({ method, path, params, opts })
    const r = routes[`${method} ${path}`]
    if (!r) throw new Error(`unexpected Stripe call ${method} ${path}`)
    return r(params, opts)
  }
  return { stripe, calls }
}
const withCard = (pi: any) => fakeStripe({
  'GET customers/cus_a': () => ({ id: 'cus_a', invoice_settings: { default_payment_method: 'pm_1' } }),
  'POST payment_intents': () => pi,
})

const cronReq = (body: any, secret = 'cron-secret') => new Request('https://x.test/lead-spend', {
  method: 'POST', headers: { 'x-ohvara-cron': secret }, body: JSON.stringify(body),
})
const userReq = (body: any, jwt = 'good') => new Request('https://x.test/lead-spend', {
  method: 'POST', headers: { Authorization: `Bearer ${jwt}` }, body: JSON.stringify(body),
})

test('a live or missing key charges nothing and touches no Stripe', async () => {
  for (const key of [undefined, 'sk_live_x', 'rk_live_x']) {
    const w = world(); const s = withCard({ id: 'pi_1', status: 'succeeded' })
    const r = await runCharges(w.store, s.stripe, key)
    assert.equal(r.skipped, 'test mode only')
    assert.equal(s.calls.length, 0)
    assert.equal(w.rpcs.length, 0, 'charges are not even claimed')
  }
})

test('a paid charge: off-session PaymentIntent on the default method, idempotent key, reported paid', async () => {
  const w = world(); const s = withCard({ id: 'pi_1', status: 'succeeded', livemode: false })
  const r = await runCharges(w.store, s.stripe, 'sk_test_x')
  assert.equal(r.charged, 1)
  const post = s.calls.find(c => c.method === 'POST')!
  assert.equal(post.params.amount, 47500)
  assert.equal(post.params.payment_method, 'pm_1')
  assert.equal(post.params.off_session, true)
  assert.equal(post.params.confirm, true)
  assert.equal(post.params.statement_descriptor_suffix, 'LEADS')
  assert.deepEqual(post.params.payment_method_types, ['card'])
  assert.equal(post.params.metadata.ohvara, 'lead_spend')
  assert.equal(post.opts.idempotencyKey, 'lead_spend:weekly:a:2026-11-16:1')
  assert.deepEqual(w.results(), [{ p_id: 'ch1', p_status: 'paid', p_pi: 'pi_1', p_failure: null }])
})

test('no saved method: failed with a plain reason, no PaymentIntent', async () => {
  const w = world()
  const s = fakeStripe({ 'GET customers/cus_a': () => ({ id: 'cus_a', invoice_settings: { default_payment_method: null } }) })
  await runCharges(w.store, s.stripe, 'sk_test_x')
  assert.equal(w.results()[0].p_status, 'failed')
  assert.match(w.results()[0].p_failure, /No card on file/)
  assert.ok(!s.calls.some(c => c.method === 'POST'))
})

test('no Stripe customer at all: failed without a Stripe call', async () => {
  const w = world([charge({ customer: null })]); const s = fakeStripe({})
  await runCharges(w.store, s.stripe, 'sk_test_x')
  assert.equal(w.results()[0].p_status, 'failed')
  assert.equal(s.calls.length, 0)
})

test('a decline is failed with Stripe\'s message and the PaymentIntent id', async () => {
  const w = world()
  const s = fakeStripe({
    'GET customers/cus_a': () => ({ invoice_settings: { default_payment_method: 'pm_1' } }),
    'POST payment_intents': () => { throw new StripeError({ message: 'Your card was declined.', code: 'card_declined', payment_intent: { id: 'pi_dec' } }, 402, 'x') },
  })
  await runCharges(w.store, s.stripe, 'sk_test_x')
  assert.deepEqual(w.results(), [{ p_id: 'ch1', p_status: 'failed', p_pi: 'pi_dec', p_failure: 'Your card was declined.' }])
})

test('a network error leaves the charge processing (retried later with the same key)', async () => {
  const w = world()
  const s = fakeStripe({
    'GET customers/cus_a': () => ({ invoice_settings: { default_payment_method: 'pm_1' } }),
    'POST payment_intents': () => { throw new TypeError('fetch failed') },
  })
  const r: any = await runCharges(w.store, s.stripe, 'sk_test_x')
  assert.equal(w.results().length, 0)
  assert.equal(r.results[0].result.left, 'ch1')
})

test('a slow payment: processing now, re-checked by id later and then paid', async () => {
  const w = world(); const s = withCard({ id: 'pi_ach', status: 'processing' })
  await runCharges(w.store, s.stripe, 'sk_test_x')
  assert.equal(w.results()[0].p_status, 'processing')
  const w2 = world([charge({ stripe_pi: 'pi_ach', recheck: true })])
  const s2 = fakeStripe({ 'GET payment_intents/pi_ach': () => ({ id: 'pi_ach', status: 'succeeded' }) })
  await runCharges(w2.store, s2.stripe, 'sk_test_x')
  assert.equal(w2.results()[0].p_status, 'paid')
  assert.ok(!s2.calls.some(c => c.method === 'POST'), 'a re-check never creates a second payment')
})

test('outcomes: livemode and 3-D Secure are failures; succeeded is paid', () => {
  assert.equal(outcomeOf({ status: 'succeeded', livemode: true }).status, 'failed')
  assert.equal(outcomeOf({ status: 'requires_action' }).status, 'failed')
  assert.equal(outcomeOf({ status: 'requires_payment_method', last_payment_error: { message: 'Insufficient funds' } }).failure, 'Insufficient funds')
  assert.equal(outcomeOf({ status: 'succeeded' }).status, 'paid')
})

test('cron: wrong secret is 401; run charges everything due', async () => {
  const w = world(); const s = withCard({ id: 'pi_1', status: 'succeeded' })
  assert.equal((await handle(cronReq({ action: 'run' }, 'nope'), w.store, s.stripe, 'sk_test_x')).status, 401)
  const res = await handle(cronReq({ action: 'run' }), w.store, s.stripe, 'sk_test_x')
  assert.equal(res.status, 200)
  assert.equal((await res.json()).charged, 1)
  assert.equal(w.rpcs.find(r => r.name === 'lead_spend_claim_charges')!.args.p_agent, null)
})

test('set_spend: signed out is 401; bad amounts are 400 before any write', async () => {
  const w = world(); const s = withCard({})
  assert.equal((await handle(userReq({ action: 'set_spend', appts_cents: 5000, live_cents: 0 }, 'bad'), w.store, s.stripe, 'sk_test_x')).status, 401)
  for (const bad of [{ appts_cents: -1, live_cents: 0 }, { appts_cents: 10.5, live_cents: 0 }, { appts_cents: 100001, live_cents: 0 }, { appts_cents: '50', live_cents: 0 }]) {
    assert.equal((await handle(userReq({ action: 'set_spend', ...bad }), w.store, s.stripe, 'sk_test_x')).status, 400)
  }
  assert.equal(w.rpcs.length, 0)
})

test('set_spend: sets for the caller only and charges the raise straight away, for that agent', async () => {
  const w = world(); const s = withCard({ id: 'pi_1', status: 'succeeded' })
  const res = await handle(userReq({ action: 'set_spend', appts_cents: 5000, live_cents: 2500, agent_id: 'someone-else' }), w.store, s.stripe, 'sk_test_x')
  const body = await res.json()
  assert.equal(res.status, 200)
  assert.deepEqual(w.rpcs[0], { name: 'lead_spend_set', args: { p_appts_cents: 5000, p_live_cents: 2500, p_agent: AGENT } })
  assert.equal(w.rpcs[1].args.p_agent, AGENT)
  assert.equal(body.charged.charged, 1)
})

test('set_spend: a cut makes no charge and no Stripe call', async () => {
  const w = world([], { setResult: { from: '2026-11-12', charge_id: null, extra_cents: 0 } }); const s = fakeStripe({})
  const res = await handle(userReq({ action: 'set_spend', appts_cents: 5000, live_cents: 0 }), w.store, s.stripe, 'sk_test_x')
  assert.equal((await res.json()).charged, null)
  assert.equal(s.calls.length, 0)
})

test('set_spend: under the paid minimum says Pause instead (code min_daily)', async () => {
  const w = world([], { rpcError: { message: 'Paid plans need at least $50 a day. Pause instead?', hint: 'min_daily' } })
  const res = await handle(userReq({ action: 'set_spend', appts_cents: 3000, live_cents: 0 }), w.store, null, 'sk_test_x')
  assert.equal(res.status, 400)
  assert.equal((await res.json()).code, 'min_daily')
})

test('pay_now: failed charges go back to due and are charged now', async () => {
  const w = world(); const s = withCard({ id: 'pi_2', status: 'succeeded' })
  const body = await (await handle(userReq({ action: 'pay_now' }), w.store, s.stripe, 'sk_test_x')).json()
  assert.equal(w.rpcs[0].name, 'lead_spend_retry')
  assert.equal(body.charged.charged, 1)
})

test('pause: needs a boolean', async () => {
  const w = world()
  assert.equal((await handle(userReq({ action: 'pause', paused: 'yes' }), w.store, null, 'sk_test_x')).status, 400)
  assert.equal((await handle(userReq({ action: 'pause', paused: true }), w.store, null, 'sk_test_x')).status, 200)
  assert.deepEqual(w.rpcs.at(-1), { name: 'lead_spend_pause', args: { p_paused: true, p_agent: AGENT } })
})

// P909: nightly charges, the card check, the max.
test('a nightly charge: says the day and the 12%, card only, OHVARA LEADS', async () => {
  const w = world([charge({ kind: 'nightly', key: 'nightly:a:2026-11-10', amount_cents: 11200, for_day: '2026-11-10', spend_cents: 10000, fee_cents: 1200 })])
  const s = withCard({ id: 'pi_n', status: 'succeeded', livemode: false })
  await runCharges(w.store, s.stripe, 'sk_test_x')
  const post = s.calls.find(c => c.method === 'POST')!
  assert.equal(post.params.amount, 11200)
  assert.equal(post.params.description, 'Lead spend for 2026-11-10 + 12%')
  assert.equal(post.params.statement_descriptor_suffix, 'LEADS')
  assert.equal(post.params.metadata.fee_cents, '1200')
  assert.equal(post.opts.idempotencyKey, 'lead_spend:nightly:a:2026-11-10:1')
  assert.deepEqual(w.results()[0], { p_id: 'ch1', p_status: 'paid', p_pi: 'pi_n', p_failure: null })
  assert.equal(words(charge({ kind: 'nightly', for_day: '2026-11-10', fee_cents: 0 })), 'Lead spend for 2026-11-10')
})

test('card_check: records the default card as words, never the number', async () => {
  const w = world([])
  const s = fakeStripe({
    'GET customers/cus_a': () => ({ invoice_settings: { default_payment_method: 'pm_1' } }),
    'GET payment_methods/pm_1': () => ({ type: 'card', card: { brand: 'visa', last4: '4242' } }),
  })
  const res = await handle(userReq({ action: 'card_check' }), w.store, s.stripe, 'sk_test_x')
  assert.equal((await res.json()).card, 'Visa ending 4242')
  assert.deepEqual(w.rpcs.find(r => r.name === 'billing_card_saved')!.args, { p_agent: AGENT, p_label: 'Visa ending 4242' })
  const none = fakeStripe({ 'GET customers/cus_a': () => ({ invoice_settings: { default_payment_method: null } }) })
  assert.equal(await cardOf(none.stripe, 'cus_a'), null)
  assert.equal(await cardOf(none.stripe, null), null)
})

test('set_spend: over the max says so (code max_daily)', async () => {
  const w = world([], { rpcError: { message: 'Daily lead spend can be up to $500 a day', hint: 'max_daily' } })
  const res = await handle(userReq({ action: 'set_spend', appts_cents: 60000, live_cents: 0 }), w.store, null, 'sk_test_x')
  assert.equal(res.status, 400)
  assert.equal((await res.json()).code, 'max_daily')
})

// P921: plan changes. Up: the prorated difference is charged straight away, for that agent, as OHVARA PLAN.
const UP = { direction: 'up', amount_cents: 75000, days_left: 15, days_in_month: 30, next_bill: '2026-12-01', charge_id: 'up1' }
const upCharge = () => charge({ id: 'up1', kind: 'plan_upgrade', key: 'plan_upgrade:a:pro:x', amount_cents: 75000, note: 'Upgrade to Pro, 15 days', tier_to: 'pro' })

test('plan_change up: billing_plan_change for the caller, then the upgrade is charged now as OHVARA PLAN', async () => {
  const w = world([upCharge()], { changeResult: UP })
  const s = withCard({ id: 'pi_up', status: 'succeeded', livemode: false })
  const res = await handle(userReq({ action: 'plan_change', tier: 'pro', daily_cents: 25000 }), w.store, s.stripe, 'sk_test_x')
  const body = await res.json()
  assert.equal(res.status, 200)
  assert.deepEqual(w.rpcs.find(r => r.name === 'billing_plan_change')!.args, { p_tier: 'pro', p_daily_cents: 25000, p_agent: AGENT })
  assert.equal(w.rpcs.find(r => r.name === 'lead_spend_claim_charges')!.args.p_agent, AGENT)
  const post = s.calls.find(c => c.method === 'POST')!
  assert.equal(post.params.amount, 75000)
  assert.equal(post.params.description, 'Upgrade to Pro, 15 days')
  assert.equal(post.params.statement_descriptor_suffix, 'PLAN')
  assert.equal(body.result, 'paid')
})

test('plan_change up, declined: reported failed (the database keeps the old plan)', async () => {
  const w = world([upCharge()], { changeResult: UP })
  const s = fakeStripe({
    'GET customers/cus_a': () => ({ invoice_settings: { default_payment_method: 'pm_1' } }),
    'POST payment_intents': () => { throw new StripeError({ message: 'Your card was declined.', code: 'card_declined', payment_intent: { id: 'pi_d' } }, 402, 'x') },
  })
  const res = await handle(userReq({ action: 'plan_change', tier: 'pro' }), w.store, s.stripe, 'sk_test_x')
  assert.equal((await res.json()).result, 'failed')
  assert.equal(w.results()[0].p_status, 'failed')
})

test('plan_change down or undo: nothing charged, no Stripe call', async () => {
  const w = world([upCharge()])
  const s = withCard({ id: 'pi_x', status: 'succeeded' })
  const res = await handle(userReq({ action: 'plan_change', tier: 'starter' }), w.store, s.stripe, 'sk_test_x')
  assert.equal((await res.json()).direction, 'down')
  assert.equal(s.calls.length, 0)
  assert.ok(!w.rpcs.some(r => r.name === 'lead_spend_claim_charges'))
})

test('plan_change: a bad plan is 400; busy is 409; over the band says over_plan', async () => {
  const w = world([])
  assert.equal((await handle(userReq({ action: 'plan_change', tier: 'scale' }), w.store, null, 'sk_test_x')).status, 400)
  assert.equal((await handle(userReq({ action: 'plan_change', tier: 'pro', daily_cents: -5 }), w.store, null, 'sk_test_x')).status, 400)
  const busy = world([], { changeError: { message: 'Your last plan change is still going through.', hint: 'busy' } })
  const r = await handle(userReq({ action: 'plan_change', tier: 'pro' }), busy.store, null, 'sk_test_x')
  assert.equal(r.status, 409)
  assert.equal((await r.json()).code, 'busy')
  const over = world([], { rpcError: { message: 'Your Growth plan goes up to $200 a day. Switch plan to spend more.', hint: 'over_plan' } })
  const o = await handle(userReq({ action: 'set_spend', appts_cents: 30000, live_cents: 0 }), over.store, null, 'sk_test_x')
  assert.equal(o.status, 400)
  assert.equal((await o.json()).code, 'over_plan')
})
