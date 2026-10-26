/**
 * Node unit tests for the agent-billing webhook's prepaid top-up branch:
 * signature check, crediting once per Checkout Session, and staying out of
 * the subscription path. The DB is an in-memory stand-in for credit_topup
 * (migration 161); Stripe is never called.
 * Run: node --test supabase/functions/agent-billing/core.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { configure, handle } from './core.ts'

const AGENT = '22222222-2222-4222-8222-222222222222'
const SECRET = 'whsec_test_fake'
const NOW = Date.parse('2026-10-25T01:14:00Z')

function world(over: { failDb?: boolean } = {}) {
  const ledger = new Map<string, { agent: string; cents: number }>()
  const rpcs: any[] = []
  const stripeCalls: string[] = []
  const admin: any = {
    async rpc(name: string, args: any) {
      rpcs.push({ name, args })
      if (over.failDb) return { data: null, error: { message: 'connection reset' } }
      if (name !== 'credit_topup') return { data: null, error: { message: `no rpc ${name}` } }
      if (ledger.has(args.p_session)) return { data: false, error: null }
      ledger.set(args.p_session, { agent: args.p_agent, cents: args.p_amount_cents })
      return { data: true, error: null }
    },
  }
  configure({
    stripeKey: 'sk_test_fake',
    webhookSecret: SECRET,
    now: () => NOW,
    fetch: (async (url: string) => {
      stripeCalls.push(url)
      return new Response(JSON.stringify({ error: { message: 'unexpected' } }), { status: 500 })
    }) as any,
  })
  const send = async (event: any, sign: (raw: string) => string | null = raw => signed(raw)) => {
    const raw = JSON.stringify(event)
    const sig = sign(raw)
    const res = await handle(new Request('http://x/agent-billing/webhook', {
      method: 'POST',
      headers: sig ? { 'stripe-signature': sig } : {},
      body: raw,
    }), admin)
    return { status: res.status, body: await res.json() }
  }
  return { ledger, rpcs, stripeCalls, send }
}

function signed(raw: string, secret = SECRET, t = Math.floor(NOW / 1000)) {
  return `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex')}`
}

const topupEvent = (over: any = {}, id = 'evt_1') => ({
  id, type: 'checkout.session.completed',
  data: {
    object: {
      id: 'cs_test_1', object: 'checkout.session', mode: 'payment', payment_status: 'paid',
      client_reference_id: AGENT, amount_total: 50000, currency: 'usd',
      metadata: { ohvara: 'agent_balance', kind: 'prepaid_topup', agent_id: AGENT, amount_cents: '50000' },
      ...over,
    },
  },
})

test('a paid top-up credits the ledger once, however often Stripe sends it', async () => {
  const w = world()
  const first = await w.send(topupEvent())
  assert.equal(first.status, 200)
  assert.equal(first.body.topup, 'credited')
  assert.deepEqual(w.rpcs[0], { name: 'credit_topup', args: { p_agent: AGENT, p_amount_cents: 50000, p_session: 'cs_test_1' } })

  const again = await w.send(topupEvent({}, 'evt_2'))
  assert.equal(again.status, 200)
  assert.equal(again.body.topup, 'already_credited')
  assert.equal(w.ledger.size, 1)
  assert.deepEqual(w.ledger.get('cs_test_1'), { agent: AGENT, cents: 50000 })
  assert.equal(w.stripeCalls.length, 0)
})

test('a bad or missing signature credits nothing', async () => {
  const w = world()
  assert.equal((await w.send(topupEvent(), () => null)).status, 400)
  assert.equal((await w.send(topupEvent(), raw => signed(raw, 'whsec_other'))).status, 400)
  assert.equal((await w.send(topupEvent(), raw => signed(raw, SECRET, Math.floor(NOW / 1000) - 600))).status, 400)
  // Signed over a different body.
  assert.equal((await w.send(topupEvent(), () => signed(JSON.stringify(topupEvent({ amount_total: 10000 }))))).status, 400)
  assert.equal(w.rpcs.length, 0)
})

test('unpaid or tampered sessions are acknowledged but not credited', async () => {
  const w = world()
  for (const over of [{ payment_status: 'unpaid' }, { amount_total: 100 }, { client_reference_id: 'someone-else' }]) {
    const r = await w.send(topupEvent(over))
    assert.equal(r.status, 200)
    assert.match(r.body.ignored, /^topup_/)
  }
  assert.equal(w.rpcs.length, 0)
})

test('a DB failure answers 500 so Stripe retries', async () => {
  const w = world({ failDb: true })
  const r = await w.send(topupEvent())
  assert.equal(r.status, 500)
})

test('payment-mode sessions without the marker still go nowhere', async () => {
  const w = world()
  const r = await w.send(topupEvent({ metadata: {} }))
  assert.equal(r.status, 200)
  assert.equal(r.body.ignored, 'checkout.session.completed')
  assert.equal(w.rpcs.length, 0)
  assert.equal(w.stripeCalls.length, 0)
})
