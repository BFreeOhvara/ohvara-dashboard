/**
 * Node unit tests for prepaid lead top-ups: the Checkout request
 * (lead-balance-topup), the webhook credit (../_shared/leadTopup.ts) and its
 * routing inside agent-billing's /webhook. Mocked Stripe, an in-memory ledger
 * that keeps migration 162's one-topup-per-stripe_ref rule. No real Stripe
 * calls, no money moves.
 * Run: node --test supabase/functions/lead-balance-topup/core.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { handle, type Deps } from './core.ts'
import { handleTopupEvent, isTopupEvent, type TopupStore } from '../_shared/leadTopup.ts'
import { StripeError, type Stripe } from '../_shared/fulfillmentPayouts.ts'
import { configure, handle as billingHandle } from '../agent-billing/core.ts'

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const NOW = Date.parse('2026-10-26T02:21:00Z')

// ── fakes ───────────────────────────────────────────────────────────────────

type Call = { method: string; path: string; params?: any; key?: string }

function fakeStripe(sessions: Record<string, any> = {}) {
  const calls: Call[] = []
  const stripe: Stripe = async (method, path, params, opts) => {
    calls.push({ method, path, params, key: opts?.idempotencyKey })
    if (method === 'POST' && path === 'checkout/sessions') {
      return { id: 'cs_test_new', url: 'https://checkout.stripe.com/c/pay/cs_test_new' }
    }
    const m = path.match(/^checkout\/sessions\/(.+)$/)
    if (method === 'GET' && m) {
      if (!sessions[m[1]]) throw new StripeError({ code: 'resource_missing' }, 404, 'missing')
      return sessions[m[1]]
    }
    throw new Error(`unexpected stripe ${method} ${path}`)
  }
  return { stripe, calls }
}

function deps(over: Partial<Deps> = {}, role = 'agent') {
  const { stripe, calls } = fakeStripe()
  const logs: string[] = []
  const d: Deps = {
    stripeKey: 'sk_test_x',
    stripe,
    async userOf(jwt) { return jwt === 'good' ? { id: A } : null },
    async profile(id) { return { id, role, email: 'ana@x.co', stripe_customer_id: null } },
    now: () => NOW,
    log: m => logs.push(m),
    ...over,
  }
  return { d, calls, logs }
}

function ledger(agents: Record<string, string> = { [A]: 'agent' }) {
  const rows: { id: string; agent_id: string; amount_cents: number; stripe_ref: string; balance_after_cents: number }[] = []
  const store: TopupStore = {
    async agent(id) { return agents[id] ? { id, role: agents[id] } : null },
    async insertTopup(row) {
      if (rows.some(r => r.stripe_ref === row.stripe_ref)) return null // unique (stripe_ref) where kind='topup'
      const bal = rows.filter(r => r.agent_id === row.agent_id).reduce((s, r) => s + r.amount_cents, 0) + row.amount_cents
      const r = { id: `l${rows.length + 1}`, ...row, balance_after_cents: bal }
      rows.push(r)
      return { id: r.id, balance_after_cents: bal }
    },
  }
  return { store, rows }
}

const paid = (over: Record<string, any> = {}) => ({
  id: 'cs_test_1', object: 'checkout.session', mode: 'payment', payment_status: 'paid', currency: 'usd',
  amount_total: 25000, client_reference_id: A,
  metadata: { ohvara: 'lead_balance', kind: 'lead_topup', profile_id: A, amount_cents: '25000' },
  ...over,
})
const completed = (session: any) => ({ id: 'evt_1', type: 'checkout.session.completed', data: { object: session } })

// ── the Checkout request ────────────────────────────────────────────────────

test('an agent gets a Checkout URL; the amount comes from the server map', async () => {
  const { d, calls } = deps()
  const r = await handle(d, 'Bearer good', { amount_dollars: 250, amount_cents: 1, return_url: 'https://portal.ohvara.com/agent/billing?x=1' })
  assert.equal(r.status, 200)
  assert.deepEqual(r.body, { url: 'https://checkout.stripe.com/c/pay/cs_test_new', session_id: 'cs_test_new', amount_cents: 25000 })
  const p = calls[0].params
  assert.equal(p.mode, 'payment')
  assert.equal(p.line_items[0].price_data.unit_amount, 25000)
  assert.equal(p.line_items[0].price_data.currency, 'usd')
  assert.deepEqual(p.payment_method_types, ['card'])
  assert.equal(p.client_reference_id, A)
  assert.deepEqual(p.metadata, { ohvara: 'lead_balance', kind: 'lead_topup', profile_id: A, amount_cents: 25000 })
  assert.equal(p.customer_email, 'ana@x.co')
  assert.equal(p.success_url, 'https://portal.ohvara.com/agent/billing?topup=success&session_id={CHECKOUT_SESSION_ID}')
  assert.equal(p.cancel_url, 'https://portal.ohvara.com/agent/billing?topup=canceled')
  assert.equal(calls[0].key, `lead-topup-${A}-25000-${Math.floor(NOW / 60e3)}`)
})

test('the existing Stripe customer is reused; a foreign return_url falls back to the portal', async () => {
  const { d, calls } = deps({ async profile(id) { return { id, role: 'agent', email: 'a@x.co', stripe_customer_id: 'cus_1' } } })
  await handle(d, 'Bearer good', { amount_dollars: '100', return_url: 'https://evil.example/steal' })
  assert.equal(calls[0].params.customer, 'cus_1')
  assert.equal(calls[0].params.customer_email, undefined)
  assert.ok(calls[0].params.success_url.startsWith('https://portal.ohvara.com/agent/billing?'))
  assert.equal(calls[0].params.line_items[0].price_data.unit_amount, 10000)
})

test('any other amount is refused before Stripe is called', async () => {
  for (const amount_dollars of [0, 99, 101, -100, '1e2', 1000, null, undefined, 'abc']) {
    const { d, calls } = deps()
    const r = await handle(d, 'Bearer good', { amount_dollars })
    assert.equal(r.status, 400, String(amount_dollars))
    assert.equal(calls.length, 0)
  }
})

test('signed out → 401, not an agent → 403, no key → 503, live key → 503', async () => {
  assert.equal((await handle(deps().d, null, { amount_dollars: 100 })).status, 401)
  assert.equal((await handle(deps().d, 'Bearer bad', { amount_dollars: 100 })).status, 401)
  assert.equal((await handle(deps({}, 'fulfillment').d, 'Bearer good', { amount_dollars: 100 })).status, 403)
  assert.equal((await handle(deps({ stripeKey: undefined }).d, 'Bearer good', { amount_dollars: 100 })).status, 503)
  for (const key of ['sk_live_x', 'rk_live_x']) {
    const { d, calls } = deps({ stripeKey: key })
    assert.equal((await handle(d, 'Bearer good', { amount_dollars: 100 })).status, 503)
    assert.equal(calls.length, 0)
  }
})

test('a Stripe failure is logged by code and shown as a plain message', async () => {
  const { d, logs } = deps({ stripe: async () => { throw new StripeError({ code: 'api_key_expired', message: 'Expired key sk_test_x' }, 401, 'x') } })
  const r = await handle(d, 'Bearer good', { amount_dollars: 500 })
  assert.equal(r.status, 502)
  assert.doesNotMatch(String(r.body.error), /sk_test|Expired/)
  assert.deepEqual(logs, ['stripe 401 api_key_expired'])
})

// ── the webhook credit ──────────────────────────────────────────────────────

test('a paid top-up credits the ledger once, however often the event comes', async () => {
  const { stripe } = fakeStripe({ cs_test_1: paid() })
  const { store, rows } = ledger()
  const first = await handleTopupEvent(store, stripe, completed({ id: 'cs_test_1' }))
  assert.deepEqual(first, { credited_cents: 25000, ledger_id: 'l1', balance_after_cents: 25000, session: 'cs_test_1' })
  const again = await handleTopupEvent(store, stripe, { ...completed({ id: 'cs_test_1' }), id: 'evt_2' })
  assert.deepEqual(again, { already_credited: 'cs_test_1' })
  assert.equal(rows.length, 1)
  assert.deepEqual({ ...rows[0], id: undefined }, { id: undefined, agent_id: A, amount_cents: 25000, stripe_ref: 'cs_test_1', note: 'Stripe top-up', balance_after_cents: 25000 })
})

test('the session is re-fetched: what Stripe says now wins over the payload', async () => {
  const { stripe, calls } = fakeStripe({ cs_test_1: paid({ payment_status: 'unpaid' }) })
  const { store, rows } = ledger()
  const r = await handleTopupEvent(store, stripe, completed(paid()))
  assert.deepEqual(r, { ignored: 'payment unpaid' })
  assert.equal(calls[0].path, 'checkout/sessions/cs_test_1')
  assert.equal(rows.length, 0)
})

test('nothing is credited unless it is a paid usd top-up for that agent at an allowed amount', async () => {
  const cases: [string, Record<string, any>][] = [
    ['subscription mode', { mode: 'subscription' }],
    ['not tagged', { metadata: { ohvara: 'agent_billing', profile_id: A } }],
    ['no payment yet', { payment_status: 'no_payment_required' }],
    ['other currency', { currency: 'eur' }],
    ['amount not allowed', { amount_total: 1234, metadata: { kind: 'lead_topup', profile_id: A, amount_cents: '1234' } }],
    ['amount differs from tag', { amount_total: 50000 }],
    ['client ref differs', { client_reference_id: B }],
    ['bad profile id', { client_reference_id: 'x', metadata: { kind: 'lead_topup', profile_id: 'x', amount_cents: '25000' } }],
  ]
  for (const [name, over] of cases) {
    const { stripe } = fakeStripe({ cs_test_1: paid(over) })
    const { store, rows } = ledger()
    const r = await handleTopupEvent(store, stripe, completed({ id: 'cs_test_1' }))
    assert.ok('ignored' in r, name)
    assert.equal(rows.length, 0, name)
  }
  // Agent gone, or no longer an agent.
  for (const agents of [{}, { [A]: 'fulfillment' }]) {
    const { stripe } = fakeStripe({ cs_test_1: paid() })
    const { store, rows } = ledger(agents)
    assert.deepEqual(await handleTopupEvent(store, stripe, completed({ id: 'cs_test_1' })), { ignored: 'not an agent', session: 'cs_test_1' })
    assert.equal(rows.length, 0)
  }
})

test('a ledger failure throws, so the webhook answers 500 and Stripe retries', async () => {
  const { stripe } = fakeStripe({ cs_test_1: paid() })
  const store: TopupStore = { async agent(id) { return { id, role: 'agent' } }, async insertTopup() { throw new Error('db down') } }
  await assert.rejects(handleTopupEvent(store, stripe, completed({ id: 'cs_test_1' })), /db down/)
})

test('isTopupEvent picks only completed sessions tagged lead_topup', () => {
  assert.equal(isTopupEvent(completed(paid())), true)
  assert.equal(isTopupEvent(completed({ mode: 'subscription', metadata: { ohvara: 'agent_billing' } })), false)
  assert.equal(isTopupEvent({ type: 'invoice.paid', data: { object: { metadata: { kind: 'lead_topup' } } } }), false)
})

// ── routing inside agent-billing /webhook ───────────────────────────────────

const SECRET = 'whsec_test'
async function signed(event: unknown) {
  const raw = JSON.stringify(event)
  const t = Math.floor(NOW / 1000)
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${t}.${raw}`))
  const hex = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('')
  return new Request('https://x.supabase.co/functions/v1/agent-billing/webhook', {
    method: 'POST', body: raw, headers: { 'stripe-signature': `t=${t},v1=${hex}` },
  })
}
const noDb = new Proxy({}, { get() { throw new Error('subscription path touched the database') } }) as any

test('agent-billing sends a top-up session to the ledger, not the subscription sync', async () => {
  const seen: any[] = []
  configure({ stripeKey: 'sk_test_x', webhookSecret: SECRET, now: () => NOW, async onTopupEvent(e) { seen.push(e); return { credited_cents: 25000 } } })
  const res = await billingHandle(await signed(completed(paid())), noDb)
  assert.equal(res.status, 200)
  assert.deepEqual(await res.json(), { received: true, credited_cents: 25000 })
  assert.equal(seen.length, 1)
})

test('agent-billing answers 500 when the credit fails, so Stripe retries', async () => {
  configure({ stripeKey: 'sk_test_x', webhookSecret: SECRET, now: () => NOW, async onTopupEvent() { throw new Error('db down') } })
  const res = await billingHandle(await signed(completed(paid())), noDb)
  assert.equal(res.status, 500)
})

test('a bad signature never reaches the credit', async () => {
  let called = false
  configure({ stripeKey: 'sk_test_x', webhookSecret: 'whsec_other', now: () => NOW, async onTopupEvent() { called = true; return {} } })
  const res = await billingHandle(await signed(completed(paid())), noDb)
  assert.equal(res.status, 400)
  assert.equal(called, false)
})

test('a subscription checkout still goes to the subscription sync, not the ledger', async () => {
  let called = false
  const stripeCalls: string[] = []
  configure({
    stripeKey: 'sk_test_x', webhookSecret: SECRET, now: () => NOW,
    async onTopupEvent() { called = true; return {} },
    fetch: (async (url: string) => {
      stripeCalls.push(String(url))
      return new Response(JSON.stringify({ error: { message: 'stop here' } }), { status: 500 })
    }) as any,
  })
  const res = await billingHandle(await signed(completed({ id: 'cs_sub', mode: 'subscription', subscription: 'sub_1', metadata: { ohvara: 'agent_billing' } })), noDb)
  assert.equal(called, false)
  assert.deepEqual(stripeCalls, ['https://api.stripe.com/v1/subscriptions/sub_1'])
  assert.equal(res.status, 500)
})
