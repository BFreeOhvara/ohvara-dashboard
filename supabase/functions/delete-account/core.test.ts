/**
 * Node unit tests for Delete my account (Prompt 775). Stripe and Supabase are
 * mocked: nothing is cancelled or deleted for real.
 * Run: node --test supabase/functions/delete-account/core.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { handle, stripeCancel, type Deps, type Me } from './core.ts'

const UID = '11111111-1111-4111-8111-111111111111'

function deps(me: Partial<Me> | null, over: Partial<Deps> = {}) {
  const log: string[] = []
  const d: Deps = {
    async userFromJwt(jwt) { return jwt === 'good' ? UID : null },
    async profile() {
      return me === null ? null : {
        id: UID, role: 'agent', is_demo: false, billing_exempt: false, billing_status: 'active',
        stripe_subscription_id: 'sub_1', deleted_at: null, ...me,
      }
    },
    stripeReady: true,
    async cancelSubscription(id) { log.push(`stripe:${id}`); return 'cancelled' },
    async deleteData(id) { log.push(`data:${id}`); return { deleted: true } },
    async removePhoto(id) { log.push(`photo:${id}`) },
    async deleteLogin(id) { log.push(`login:${id}`) },
    ...over,
  }
  return { d, log }
}

const req = (body: unknown, jwt = 'good', method = 'POST') =>
  new Request('https://x/functions/v1/delete-account', {
    method, headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
    body: method === 'POST' ? JSON.stringify(body) : undefined,
  })

test('signed out, wrong method and no DELETE are refused; nothing runs', async () => {
  const { d, log } = deps({})
  assert.equal((await handle(req({ confirm: 'DELETE' }, 'bad'), d)).status, 401)
  assert.equal((await handle(req({}, 'good', 'GET'), d)).status, 405)
  assert.equal((await handle(req({ confirm: 'delete' }), d)).status, 400)
  assert.equal((await handle(req({}), d)).status, 400)
  assert.deepEqual(log, [])
})

test('an admin can’t delete themselves here', async () => {
  const { d, log } = deps({ role: 'admin' })
  const res = await handle(req({ confirm: 'DELETE' }), d)
  assert.equal(res.status, 403)
  assert.deepEqual(log, [])
})

test('billed agent: plan cancelled first, then data, photo, login', async () => {
  const { d, log } = deps({})
  const res = await handle(req({ confirm: 'DELETE' }), d)
  assert.equal(res.status, 200)
  assert.equal((await res.json()).plan, 'cancelled')
  assert.deepEqual(log, [`stripe:sub_1`, `data:${UID}`, `photo:${UID}`, `login:${UID}`])
})

test('Stripe failing means nothing is deleted', async () => {
  const { d, log } = deps({}, { async cancelSubscription() { throw new Error('boom') } })
  const res = await handle(req({ confirm: 'DELETE' }), d)
  assert.equal(res.status, 502)
  assert.deepEqual(log, [])
  const off = deps({}, { stripeReady: false })
  assert.equal((await handle(req({ confirm: 'DELETE' }), off.d)).status, 503)
  assert.deepEqual(off.log, [])
})

test('Fulfillment, comped, sample and plan-less agents skip Stripe', async () => {
  for (const me of [
    { role: 'fulfillment' }, { billing_exempt: true }, { billing_status: 'exempt' },
    { is_demo: true }, { stripe_subscription_id: null }, { billing_status: 'none' },
  ]) {
    const { d, log } = deps(me)
    const res = await handle(req({ confirm: 'DELETE' }), d)
    assert.equal(res.status, 200, JSON.stringify(me))
    assert.ok(!log.some(l => l.startsWith('stripe:')), JSON.stringify(me))
    assert.ok(log.includes(`data:${UID}`) && log.includes(`login:${UID}`))
  }
})

test('already deleted is fine and does nothing again', async () => {
  const { d, log } = deps({ deleted_at: '2026-10-17T00:00:00Z' })
  const res = await handle(req({ confirm: 'DELETE' }), d)
  assert.equal(res.status, 200)
  assert.equal((await res.json()).already, true)
  assert.deepEqual(log, [])
})

test('a photo or login hiccup after the data is gone still answers ok', async () => {
  const { d, log } = deps({ role: 'fulfillment' }, {
    async removePhoto() { throw new Error('storage') },
    async deleteLogin() { throw new Error('auth') },
  })
  assert.equal((await handle(req({ confirm: 'DELETE' }), d)).status, 200)
  assert.deepEqual(log, [`data:${UID}`])
  const bad = deps({ role: 'fulfillment' }, { async deleteData() { throw new Error('db') } })
  assert.equal((await handle(req({ confirm: 'DELETE' }), bad.d)).status, 500)
  assert.ok(!bad.log.some(l => l.startsWith('login:')))
})

test('stripeCancel: DELETE now; missing or already-cancelled counts as gone', async () => {
  const seen: { url: string; method?: string; auth?: string }[] = []
  const mk = (status: number, body: unknown) => (async (url: any, init: any) => {
    seen.push({ url: String(url), method: init?.method, auth: init?.headers?.Authorization })
    return new Response(JSON.stringify(body), { status })
  }) as typeof fetch
  assert.equal(await stripeCancel('sk_test', 'sub_9', mk(200, { status: 'canceled' })), 'cancelled')
  assert.equal(seen[0].url, 'https://api.stripe.com/v1/subscriptions/sub_9')
  assert.equal(seen[0].method, 'DELETE')
  assert.equal(seen[0].auth, 'Bearer sk_test')
  assert.equal(await stripeCancel('k', 's', mk(404, { error: { code: 'resource_missing' } })), 'gone')
  assert.equal(await stripeCancel('k', 's', mk(400, { error: { message: 'This subscription is already canceled.' } })), 'gone')
  await assert.rejects(stripeCancel('k', 's', mk(500, { error: { type: 'api_error' } })))
})
