/**
 * Node unit tests for create-balance-topup with a mocked Stripe and an
 * in-memory store. No real Stripe calls.
 * Run: node --test supabase/functions/create-balance-topup/core.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { handle, ownReturnUrl, requestedCents, TOPUP_KIND, type Store } from './core.ts'
import type { Stripe } from '../_shared/fulfillmentPayouts.ts'

const AGENT = '22222222-2222-4222-8222-222222222222'
const REP = '11111111-1111-4111-8111-111111111111'
const RETURN = 'https://portal.ohvara.com/agent/billing'

function world(over: { key?: string; options?: number[] } = {}) {
  const calls: { method: string; path: string; params?: any; key?: string }[] = []
  const profiles: Record<string, any> = {
    [AGENT]: { id: AGENT, role: 'agent', email: 'a@example.com', stripe_customer_id: 'cus_a' },
    [REP]: { id: REP, role: 'fulfillment', email: 'r@example.com', stripe_customer_id: null },
  }
  const store: Store = {
    async userFromJwt(jwt) { return ({ agent: AGENT, rep: REP } as any)[jwt] ?? null },
    async profile(id) { return profiles[id] ?? null },
    async topupOptions() { return over.options ?? [10000, 25000, 50000] },
  }
  const stripe: Stripe = async (method, path, params, opts) => {
    calls.push({ method, path, params, key: opts?.idempotencyKey })
    return { id: 'cs_test_1', url: 'https://checkout.stripe.com/c/pay/cs_test_1' }
  }
  const env = { stripeKey: 'key' in over ? over.key : 'sk_test_abc', now: () => Date.parse('2026-10-28T20:50:00Z') }
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

test('an agent gets a test-mode payment session for an allowed amount', async () => {
  const w = world()
  const r = await w.call('agent', { amount_cents: 25000, return_url: `${RETURN}?x=1` })
  assert.equal(r.status, 200)
  assert.deepEqual(r.body, { url: 'https://checkout.stripe.com/c/pay/cs_test_1' })
  assert.equal(w.calls.length, 1)
  const { method, path, params, key } = w.calls[0]
  assert.equal(method, 'POST')
  assert.equal(path, 'checkout/sessions')
  assert.equal(params.mode, 'payment')
  assert.equal(params.client_reference_id, AGENT)
  assert.equal(params.line_items[0].price_data.unit_amount, 25000)
  assert.equal(params.line_items[0].price_data.currency, 'usd')
  assert.equal(params.metadata.kind, TOPUP_KIND)
  assert.equal(params.metadata.agent_id, AGENT)
  assert.equal(params.metadata.amount_cents, '25000')
  assert.equal(params.success_url, `${RETURN}?topup=success&session_id={CHECKOUT_SESSION_ID}`)
  assert.equal(params.cancel_url, `${RETURN}?topup=cancel`)
  assert.match(key!, /^balance-topup-/)
})

test('amount_dollars from the Billing card maps to cents', async () => {
  const w = world()
  const r = await w.call('agent', { amount_dollars: 100, return_url: RETURN })
  assert.equal(r.status, 200)
  assert.equal(w.calls[0].params.line_items[0].price_data.unit_amount, 10000)
})

test('an amount not in the active options is refused, Stripe untouched', async () => {
  for (const body of [{ amount_cents: 12345 }, { amount_cents: 1 }, { amount_dollars: 99.999 }, { amount_cents: '25000.5' }, {}]) {
    const w = world()
    const r = await w.call('agent', { ...body, return_url: RETURN })
    assert.equal(r.status, 400, JSON.stringify(body))
    assert.equal(r.body.code, 'bad_amount')
    assert.equal(w.calls.length, 0)
  }
})

test('the allow-list comes from the settings rows, not a fixed list', async () => {
  const w = world({ options: [7500] })
  assert.equal((await w.call('agent', { amount_cents: 10000, return_url: RETURN })).status, 400)
  assert.equal((await w.call('agent', { amount_cents: 7500, return_url: RETURN })).status, 200)
  assert.equal(w.calls.length, 1)
  const none = world({ options: [] })
  const r = await none.call('agent', { amount_cents: 10000, return_url: RETURN })
  assert.equal(r.status, 503)
  assert.equal(none.calls.length, 0)
})

test('signed out or not an agent is refused', async () => {
  const w = world()
  assert.equal((await w.call(null, { amount_cents: 10000, return_url: RETURN })).status, 401)
  assert.equal((await w.call('nobody', { amount_cents: 10000, return_url: RETURN })).status, 401)
  assert.equal((await w.call('rep', { amount_cents: 10000, return_url: RETURN })).status, 403)
  assert.equal(w.calls.length, 0)
})

test('a missing or live key is refused before any Stripe call', async () => {
  for (const key of [undefined, '', 'sk_live_abc', 'rk_live_abc', 'rk_test_abc', 'pk_test_abc']) {
    const w = world({ key })
    const r = await w.call('agent', { amount_cents: 10000, return_url: RETURN })
    assert.equal(r.status, 503, String(key))
    assert.equal(r.body.code, 'not_configured')
    assert.equal(w.calls.length, 0)
  }
})

test('a foreign-host return_url is refused', async () => {
  for (const return_url of [
    'https://evil.example.com/agent/billing', 'https://portal.ohvara.com.evil.com/x', 'http://portal.ohvara.com/agent/billing',
    'https://user@portal.ohvara.com/x', 'javascript:alert(1)', '', undefined,
  ]) {
    const w = world()
    const r = await w.call('agent', { amount_cents: 10000, return_url })
    assert.equal(r.status, 400, String(return_url))
    assert.equal(r.body.code, 'bad_return_url')
    assert.equal(w.calls.length, 0)
  }
  assert.ok(ownReturnUrl('http://localhost:5173/agent/billing'))
  assert.ok(ownReturnUrl('https://ohvara-dashboard.vercel.app/agent/billing'))
  assert.ok(ownReturnUrl('https://app.example.org/x', ['https://app.example.org']))
})

test('a Stripe failure gives a generic error', async () => {
  const store: Store = {
    async userFromJwt() { return AGENT },
    async profile() { return { id: AGENT, role: 'agent', email: null, stripe_customer_id: null } },
    async topupOptions() { return [10000] },
  }
  const stripe: Stripe = async () => { throw new Error('No such customer: cus_secret') }
  const orig = console.error
  console.error = () => {}
  try {
    const res = await handle(new Request('http://x', {
      method: 'POST', headers: { Authorization: 'Bearer a' }, body: JSON.stringify({ amount_cents: 10000, return_url: RETURN }),
    }), store, stripe, { stripeKey: 'sk_test_x' })
    assert.equal(res.status, 502)
    assert.doesNotMatch(JSON.stringify(await res.json()), /cus_secret/)
  } finally { console.error = orig }
})

test('requestedCents', () => {
  assert.equal(requestedCents({ amount_cents: 10000 }), 10000)
  assert.equal(requestedCents({ amount_dollars: '250' }), 25000)
  assert.equal(requestedCents({ amount_dollars: 12.5 }), 1250)
  assert.ok(Number.isNaN(requestedCents({ amount_dollars: 'abc' })))
  assert.ok(Number.isNaN(requestedCents({})))
})
