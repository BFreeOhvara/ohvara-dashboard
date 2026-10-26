/**
 * Node unit tests for prepaid balance top-ups: the one-time Checkout
 * (create-balance-topup) and the session checks the webhook credits on
 * (_shared/balanceTopup.ts), with a mocked Stripe. No real Stripe calls.
 * The webhook itself is tested in agent-billing/core.test.ts.
 * Run: node --test supabase/functions/create-balance-topup/core.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { handle, type Store } from './core.ts'
import { topupFromSession, TOPUP_KIND } from '../_shared/balanceTopup.ts'
import type { Stripe } from '../_shared/fulfillmentPayouts.ts'

const AGENT = '22222222-2222-4222-8222-222222222222'
const REP = '11111111-1111-4111-8111-111111111111'

function world(over: { customer?: string | null; configured?: boolean } = {}) {
  const calls: { method: string; path: string; params?: any; key?: string }[] = []
  const profiles: Record<string, any> = {
    [AGENT]: { id: AGENT, role: 'agent', email: 'a@example.com', stripe_customer_id: over.customer === undefined ? 'cus_a' : over.customer },
    [REP]: { id: REP, role: 'fulfillment', email: 'r@example.com', stripe_customer_id: null },
  }
  const store: Store = {
    async userFromJwt(jwt) { return ({ agent: AGENT, rep: REP } as any)[jwt] ?? null },
    async profile(id) { return profiles[id] ?? null },
  }
  const stripe: Stripe = async (method, path, params, opts) => {
    calls.push({ method, path, params, key: opts?.idempotencyKey })
    return { id: 'cs_test_1', url: 'https://checkout.stripe.com/c/pay/cs_test_1' }
  }
  const env = { configured: over.configured ?? true, now: () => Date.parse('2026-10-25T01:14:00Z') }
  const call = async (jwt: string | null, body: any) => {
    const res = await handle(new Request('http://x/create-balance-topup', {
      method: 'POST',
      headers: jwt ? { Authorization: `Bearer ${jwt}` } : {},
      body: JSON.stringify(body),
    }), store, stripe, env)
    return { status: res.status, body: await res.json() }
  }
  return { calls, call }
}

test('an agent gets a one-time payment session for a set amount', async () => {
  const w = world()
  const r = await w.call('agent', { amount_cents: 25000, return_url: 'https://portal.ohvara.com/agent/billing?x=1' })
  assert.equal(r.status, 200)
  assert.deepEqual(r.body, { url: 'https://checkout.stripe.com/c/pay/cs_test_1', id: 'cs_test_1' })
  assert.equal(w.calls.length, 1)
  const { method, path, params, key } = w.calls[0]
  assert.equal(method, 'POST')
  assert.equal(path, 'checkout/sessions')
  assert.equal(params.mode, 'payment')
  assert.deepEqual(params.payment_method_types, ['card'])
  assert.equal(params.customer, 'cus_a')
  assert.equal(params.client_reference_id, AGENT)
  assert.equal(params.line_items[0].price_data.unit_amount, 25000)
  assert.equal(params.line_items[0].price_data.currency, 'usd')
  assert.equal(params.line_items[0].price_data.recurring, undefined)
  assert.deepEqual(params.metadata, { ohvara: 'agent_balance', kind: TOPUP_KIND, agent_id: AGENT, amount_cents: '25000' })
  assert.equal(params.success_url, 'https://portal.ohvara.com/agent/billing?topup=success&session_id={CHECKOUT_SESSION_ID}')
  assert.equal(params.cancel_url, 'https://portal.ohvara.com/agent/billing?topup=cancel')
  assert.match(key!, new RegExp(`^balance-topup-${AGENT}-25000-\\d+$`))
})

test('every set amount works; anything else is refused before Stripe', async () => {
  for (const cents of [10000, 25000, 50000]) {
    const w = world()
    assert.equal((await w.call('agent', { amount_cents: cents })).status, 200)
  }
  for (const bad of [1, 9999, 30000, '25000', -10000, null, undefined]) {
    const w = world()
    const r = await w.call('agent', { amount_cents: bad })
    assert.equal(r.status, 400, String(bad))
    assert.equal(r.body.code, 'bad_amount')
    assert.equal(w.calls.length, 0)
  }
})

test('no customer yet: the email is prefilled instead', async () => {
  const w = world({ customer: null })
  await w.call('agent', { amount_cents: 10000 })
  assert.equal(w.calls[0].params.customer, undefined)
  assert.equal(w.calls[0].params.customer_email, 'a@example.com')
})

test('a foreign return URL falls back to the portal', async () => {
  const w = world()
  await w.call('agent', { amount_cents: 10000, return_url: 'https://evil.example/steal' })
  assert.match(w.calls[0].params.success_url, /^https:\/\/portal\.ohvara\.com\/agent\/billing\?/)
})

test('signed out, non-agents and an unconfigured Stripe are refused', async () => {
  let w = world()
  assert.equal((await w.call(null, { amount_cents: 10000 })).status, 401)
  assert.equal((await w.call('nobody', { amount_cents: 10000 })).status, 401)
  assert.equal((await w.call('rep', { amount_cents: 10000 })).status, 403)
  assert.equal(w.calls.length, 0)
  w = world({ configured: false })
  assert.equal((await w.call('agent', { amount_cents: 10000 })).status, 503)
  assert.equal(w.calls.length, 0)
})

// ── what the webhook will credit ────────────────────────────────────────────

const paid = (over: any = {}) => ({
  id: 'cs_test_1', object: 'checkout.session', mode: 'payment', payment_status: 'paid',
  client_reference_id: AGENT, amount_total: 25000, currency: 'usd',
  metadata: { ohvara: 'agent_balance', kind: TOPUP_KIND, agent_id: AGENT, amount_cents: '25000' },
  ...over,
})

test('a paid top-up session is credited for the amount we set', () => {
  assert.deepEqual(topupFromSession(paid()), { credit: { agent_id: AGENT, amount_cents: 25000, session_id: 'cs_test_1' } })
})

test('sessions that must not credit', () => {
  const m = paid().metadata
  assert.deepEqual(topupFromSession(paid({ metadata: { ohvara: 'agent_billing', profile_id: AGENT } })), { skip: 'not_topup' })
  assert.deepEqual(topupFromSession(paid({ mode: 'subscription' })), { skip: 'not_payment_mode' })
  assert.deepEqual(topupFromSession(paid({ payment_status: 'unpaid' })), { skip: 'payment_status_unpaid' })
  assert.deepEqual(topupFromSession(paid({ client_reference_id: REP })), { skip: 'agent_mismatch' })
  assert.deepEqual(topupFromSession(paid({ metadata: { ...m, agent_id: undefined } })), { skip: 'agent_mismatch' })
  assert.deepEqual(topupFromSession(paid({ metadata: { ...m, amount_cents: '1' }, amount_total: 1 })), { skip: 'bad_amount' })
  assert.deepEqual(topupFromSession(paid({ amount_total: 100 })), { skip: 'amount_mismatch' })
  assert.deepEqual(topupFromSession(paid({ currency: 'eur' })), { skip: 'amount_mismatch' })
})
