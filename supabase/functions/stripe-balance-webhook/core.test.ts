/**
 * Node unit tests for stripe-balance-webhook: signed fake events against an
 * in-memory ledger that keeps credit_topup's rule (one credit per session id
 * and per event id). No real Stripe calls.
 * Run: node --test supabase/functions/stripe-balance-webhook/core.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { handle, hmacHex, TOPUP_KIND, type CreditResult, type Store } from './core.ts'

const AGENT = '22222222-2222-4222-8222-222222222222'
const SECRET = 'whsec_test_balance'
const NOW = Date.parse('2026-10-28T20:50:00Z')

function ledger() {
  const rows: { agent_id: string; amount_cents: number; session_id: string; event_id: string }[] = []
  const store: Store = {
    async creditTopup(a): Promise<CreditResult> {
      if (rows.some(r => r.session_id === a.session_id || r.event_id === a.event_id)) {
        return { result: 'duplicate', ledger_id: null, balance_cents: null }
      }
      rows.push(a)
      return { result: 'credited', ledger_id: `l${rows.length}`, balance_cents: rows.reduce((s, r) => s + r.amount_cents, 0) }
    },
  }
  return { rows, store }
}

const paidEvent = (over: { id?: string; session?: string; livemode?: boolean; object?: any; type?: string } = {}) => ({
  id: over.id ?? 'evt_1',
  type: over.type ?? 'checkout.session.completed',
  livemode: over.livemode ?? false,
  data: {
    object: {
      id: over.session ?? 'cs_test_1',
      mode: 'payment',
      payment_status: 'paid',
      currency: 'usd',
      amount_total: 25000,
      client_reference_id: AGENT,
      metadata: { kind: TOPUP_KIND, agent_id: AGENT, amount_cents: '25000' },
      ...(over.object || {}),
    },
  },
})

async function signed(event: unknown, secret = SECRET, t = Math.floor(NOW / 1000)) {
  const raw = JSON.stringify(event)
  return { raw, sig: `t=${t},v1=${await hmacHex(secret, `${t}.${raw}`)}` }
}

async function post(store: Store, raw: string, sig: string | null, env: { webhookSecret?: string } = { webhookSecret: SECRET }) {
  const res = await handle(new Request('http://x/stripe-balance-webhook', {
    method: 'POST', headers: sig ? { 'stripe-signature': sig } : {}, body: raw,
  }), store, { ...env, now: () => NOW })
  return { status: res.status, body: await res.json() }
}

const quiet = async <T>(fn: () => Promise<T>) => {
  const o = { log: console.log, warn: console.warn, error: console.error }
  console.log = console.warn = console.error = () => {}
  try { return await fn() } finally { Object.assign(console, o) }
}

test('a paid top-up is credited with amount_total, session id and event id', async () => {
  const l = ledger()
  const { raw, sig } = await signed(paidEvent())
  const r = await quiet(() => post(l.store, raw, sig))
  assert.equal(r.status, 200)
  assert.equal(r.body.result, 'credited')
  assert.deepEqual(l.rows, [{ agent_id: AGENT, amount_cents: 25000, session_id: 'cs_test_1', event_id: 'evt_1' }])
})

test('a replayed event or a second event for the same session credits nothing more', async () => {
  const l = ledger()
  const first = await signed(paidEvent())
  assert.equal((await quiet(() => post(l.store, first.raw, first.sig))).body.result, 'credited')
  const replay = await quiet(() => post(l.store, first.raw, first.sig))
  assert.equal(replay.status, 200)
  assert.equal(replay.body.result, 'duplicate')
  const sameSession = await signed(paidEvent({ id: 'evt_2' }))
  const r2 = await quiet(() => post(l.store, sameSession.raw, sameSession.sig))
  assert.equal(r2.status, 200)
  assert.equal(r2.body.result, 'duplicate')
  const sameEvent = await signed(paidEvent({ session: 'cs_test_2' }))
  assert.equal((await quiet(() => post(l.store, sameEvent.raw, sameEvent.sig))).body.result, 'duplicate')
  assert.equal(l.rows.length, 1)
})

test('a bad, missing, stale or wrong-secret signature is 400 and credits nothing', async () => {
  const l = ledger()
  const { raw, sig } = await signed(paidEvent())
  const wrong = await signed(paidEvent(), 'whsec_agent_billing')
  const stale = await signed(paidEvent(), SECRET, Math.floor(NOW / 1000) - 600)
  for (const [body, s] of [[raw, null], [raw, 't=1,v1=abc'], [raw, wrong.sig], [stale.raw, stale.sig], [raw.replace('25000', '50000'), sig]] as const) {
    const r = await quiet(() => post(l.store, body, s))
    assert.equal(r.status, 400)
  }
  assert.equal(l.rows.length, 0)
})

test('no signing secret set is 503 and credits nothing', async () => {
  const l = ledger()
  const { raw, sig } = await signed(paidEvent())
  assert.equal((await quiet(() => post(l.store, raw, sig, {}))).status, 503)
  assert.equal(l.rows.length, 0)
})

test('a livemode event is ignored with 200', async () => {
  const l = ledger()
  for (const ev of [paidEvent({ livemode: true }), { ...paidEvent(), livemode: undefined }]) {
    const { raw, sig } = await signed(ev)
    const r = await quiet(() => post(l.store, raw, sig))
    assert.equal(r.status, 200)
    assert.equal(r.body.ignored, 'livemode')
  }
  assert.equal(l.rows.length, 0)
})

test('other events and unpaid or untagged sessions are ignored with 200', async () => {
  const l = ledger()
  for (const ev of [
    paidEvent({ type: 'payment_intent.succeeded' }),
    paidEvent({ object: { payment_status: 'unpaid' } }),
    paidEvent({ object: { mode: 'subscription' } }),
    paidEvent({ object: { metadata: { ohvara: 'agent_billing' } } }),
    paidEvent({ object: { metadata: { kind: TOPUP_KIND, agent_id: 'not-a-uuid' } } }),
    paidEvent({ object: { client_reference_id: '33333333-3333-4333-8333-333333333333' } }),
    paidEvent({ object: { currency: 'eur' } }),
    paidEvent({ object: { amount_total: 0 } }),
  ]) {
    const { raw, sig } = await signed(ev)
    const r = await quiet(() => post(l.store, raw, sig))
    assert.equal(r.status, 200)
    assert.ok(r.body.ignored, JSON.stringify(r.body))
  }
  assert.equal(l.rows.length, 0)
})

test('a database error is 500 so Stripe retries, with a generic body', async () => {
  const store: Store = { async creditTopup() { throw new Error('credit_topup: profile x not found') } }
  const { raw, sig } = await signed(paidEvent())
  const r = await quiet(() => post(store, raw, sig))
  assert.equal(r.status, 500)
  assert.deepEqual(r.body, { error: 'Credit failed' })
})
