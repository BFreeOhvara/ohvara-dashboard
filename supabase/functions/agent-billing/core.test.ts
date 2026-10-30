/**
 * Node unit tests for agent-billing's Policy Servicing + inbound spend. Stripe and
 * Supabase are mocked: every Stripe call is recorded, none leaves the machine.
 * Run: node --test supabase/functions/agent-billing/core.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { configure, handle } from './core.ts'

const AGENT = '33333333-3333-4333-8333-333333333333'
const NOW = Date.parse('2026-10-30T15:00:00Z')
const SETTINGS = {
  id: 1,
  agent_billing_weekly_cents: 29900,
  inbound_est_cents_live_call: 5500,
  inbound_est_cents_booked_appt: 9000,
  inbound_min_weekly_cents: 5000,
  inbound_spend_presets: [10000, 25000, 50000],
}

// A small stand-in for the Supabase client: enough for the chains core.ts uses.
function fakeAdmin(profile: any, spend: any[] = []) {
  const db: Record<string, any[]> = {
    app_settings: [{ ...SETTINGS }],
    profiles: [profile],
    agent_inbound_spend: spend,
    agent_inbound_spend_log: [],
  }
  const writes: { table: string; op: string; row: any }[] = []
  const from = (table: string) => {
    const filters: [string, unknown][] = []
    const rows = () => db[table].filter(r => filters.every(([k, v]) => r[k] === v))
    const q: any = {
      select() { return q },
      eq(k: string, v: unknown) { filters.push([k, v]); return q },
      single: async () => ({ data: rows()[0] ?? null, error: rows()[0] ? null : { message: 'no row' } }),
      maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
      then(ok: any) { return Promise.resolve({ data: rows(), error: null }).then(ok) },
      insert: async (row: any) => { writes.push({ table, op: 'insert', row }); db[table].push(row); return { error: null } },
      upsert: async (row: any) => {
        writes.push({ table, op: 'upsert', row })
        const i = db[table].findIndex(r => r.agent_id === row.agent_id && r.inbound_type === row.inbound_type)
        if (i >= 0) db[table][i] = row
        else db[table].push(row)
        return { error: null }
      },
      update(patch: any) {
        writes.push({ table, op: 'update', row: patch })
        return { eq: async () => { Object.assign(db[table][0], patch); return { error: null } } }
      },
    }
    return q
  }
  return {
    db, writes,
    client: { from, auth: { getUser: async () => ({ data: { user: { id: AGENT, email: 'a@example.com' } } }) } } as any,
  }
}

type Call = { method: string; path: string; form: URLSearchParams; headers: Record<string, string> }

// Answers from `routes` (first matching "METHOD path" wins); anything else is a
// test failure, so an unexpected Stripe call can't pass quietly.
function fakeStripe(routes: Record<string, (call: Call) => any> = {}) {
  const calls: Call[] = []
  const fetchFn = (async (url: string, init: any) => {
    const u = new URL(url)
    const path = u.pathname.replace('/v1/', '')
    const call: Call = { method: init.method, path, form: new URLSearchParams(init.body?.toString() ?? u.search), headers: init.headers }
    calls.push(call)
    const route = routes[`${init.method} ${path}`]
    if (!route) throw new Error(`unexpected Stripe call: ${init.method} ${path}`)
    const out = route(call)
    if (out?.__error) return new Response(JSON.stringify({ error: out.__error }), { status: out.__status ?? 400 })
    return new Response(JSON.stringify(out), { status: 200 })
  }) as unknown as typeof fetch
  return { calls, fetchFn }
}

const req = (body: unknown) => new Request('https://x.test/agent-billing', {
  method: 'POST', headers: { Authorization: 'Bearer jwt' }, body: JSON.stringify(body),
})

async function call(admin: any, stripe: ReturnType<typeof fakeStripe>, body: unknown, key: string | undefined = 'sk_test_x') {
  configure({ stripeKey: key, publishableKey: 'pk_test_x', fetch: stripe.fetchFn, now: () => NOW })
  const res = await handle(req(body), admin.client)
  return { status: res.status, body: await res.json() }
}

const agent = (over: Record<string, unknown> = {}) => ({
  id: AGENT, role: 'agent', email: 'a@example.com', full_name: 'A', billing_exempt: false, billing_status: 'active',
  stripe_customer_id: 'cus_1', stripe_subscription_id: 'sub_1', billing_grace_until: null, ...over,
})
const comped = () => agent({ billing_exempt: true, billing_status: 'exempt', stripe_customer_id: null, stripe_subscription_id: null })

const SERVICING = { id: 'si_serv', quantity: 1, metadata: {}, price: { id: 'price_s', unit_amount: 29900, metadata: { line: 'servicing' }, product: 'ohvara_line_servicing' } }
const OLD_TIER = { id: 'si_old', quantity: 1, metadata: {}, price: { id: 'price_old', unit_amount: 35000, metadata: { tier: 'standard' }, product: 'prod_old', nickname: 'Standard' } }
const LIVE_CALL = { id: 'si_lc', quantity: 1, metadata: { line: 'live_call' }, price: { id: 'price_lc', unit_amount: 10000, metadata: {}, product: 'ohvara_line_live_call' } }

const sub = (items: any[], over: Record<string, unknown> = {}) => ({
  id: 'sub_1', customer: 'cus_1', status: 'active', cancel_at_period_end: false, current_period_end: 1793000000,
  metadata: { profile_id: AGENT }, schedule: null, items: { data: items }, ...over,
})

const spendRow = (type: string, cents: number, paused = false) => ({ agent_id: AGENT, inbound_type: type, weekly_cents: cents, paused, updated_at: '2026-10-29T00:00:00Z' })
const logs = (a: any) => a.writes.filter((w: any) => w.table === 'agent_inbound_spend_log')
const posts = (s: ReturnType<typeof fakeStripe>) => s.calls.filter(c => c.method !== 'GET')

// The Stripe routes every happy-path inbound_set needs.
function stripeFor(current: any, extra: Record<string, (c: Call) => any> = {}) {
  return fakeStripe({
    'GET subscriptions/sub_1': () => current,
    'GET products/ohvara_line_live_call': () => ({ id: 'ohvara_line_live_call', active: true }),
    'GET products/ohvara_line_booked_appointment': () => ({ id: 'ohvara_line_booked_appointment', active: true }),
    'POST subscriptions/sub_1': () => current,
    ...extra,
  })
}

// ── inbound_get ─────────────────────────────────────────────────────────────

test('inbound_get: comped gets a normal 200 with no Stripe call', async () => {
  const a = fakeAdmin(comped())
  const s = fakeStripe()
  const r = await call(a, s, { action: 'inbound_get' })
  assert.equal(r.status, 200)
  assert.equal(s.calls.length, 0)
  assert.deepEqual(r.body, {
    configured: true, comped: true, billed: false, subscribed: true, mode: 'test',
    min_weekly_cents: 5000, presets: [10000, 25000, 50000],
    estimate_cents: { live_call: 5500, booked_appointment: 9000 },
    types: [
      { type: 'live_call', label: 'Live Calls', weekly_cents: 0, paused: false, estimate_count: 0 },
      { type: 'booked_appointment', label: 'Booked Appointments', weekly_cents: 0, paused: false, estimate_count: 0 },
    ],
  })
})

test('inbound_get: billed agent reads the live subscription and floors the estimate', async () => {
  const a = fakeAdmin(agent(), [spendRow('live_call', 25000), spendRow('booked_appointment', 8999, true)])
  const s = stripeFor(sub([SERVICING]))
  const r = await call(a, s, { action: 'inbound_get' })
  assert.equal(r.status, 200)
  assert.equal(r.body.subscribed, true)
  assert.equal(r.body.billed, true)
  assert.deepEqual(r.body.types.map((t: any) => [t.weekly_cents, t.paused, t.estimate_count]), [[25000, false, 4], [8999, true, 0]])
  assert.equal(posts(s).length, 0)
})

test('inbound_get: a live key reports live and a dead subscription is not subscribed', async () => {
  const a = fakeAdmin(agent())
  const s = fakeStripe({
    'GET subscriptions/sub_1': () => sub([SERVICING], { status: 'canceled' }),
    'GET subscriptions': () => ({ data: [] }),
  })
  const r = await call(a, s, { action: 'inbound_get' }, 'sk_live_x')
  assert.equal(r.status, 200)
  assert.equal(r.body.mode, 'live')
  assert.equal(r.body.subscribed, false)
})

test('inbound_get: Stripe not configured answers configured:false', async () => {
  const a = fakeAdmin(agent())
  const s = fakeStripe()
  const r = await call(a, s, { action: 'inbound_get' }, '')
  assert.equal(r.status, 200)
  assert.equal(r.body.configured, false)
  assert.equal(r.body.mode, 'test')
  assert.equal(r.body.subscribed, false)
  assert.equal(s.calls.length, 0)
})

// ── inbound_set refusals ────────────────────────────────────────────────────

test('inbound_set: a live key refuses with 403 before any Stripe call or write', async () => {
  const a = fakeAdmin(agent())
  const s = fakeStripe()
  const r = await call(a, s, { action: 'inbound_set', type: 'live_call', weekly_cents: 10000, paused: false }, 'sk_live_x')
  assert.equal(r.status, 403)
  assert.equal(r.body.error, 'Inbound spend is test mode only for now.')
  assert.equal(s.calls.length, 0)
  assert.equal(a.writes.length, 0)
})

test('inbound_set: a restricted live key is refused too', async () => {
  const a = fakeAdmin(agent())
  const s = fakeStripe()
  const r = await call(a, s, { action: 'inbound_set', type: 'live_call', weekly_cents: 10000, paused: false }, 'rk_live_x')
  assert.equal(r.status, 403)
  assert.equal(s.calls.length, 0)
})

test('inbound_set: comped answers 409 with no Stripe call, on a test or live key', async () => {
  for (const key of ['sk_test_x', 'sk_live_x']) {
    const a = fakeAdmin(comped())
    const s = fakeStripe()
    const r = await call(a, s, { action: 'inbound_set', type: 'live_call', weekly_cents: 10000, paused: false }, key)
    assert.equal(r.status, 409)
    assert.equal(r.body.error, "Your account isn't billed.")
    assert.equal(s.calls.length, 0)
    assert.equal(a.writes.length, 0)
  }
})

test('inbound_set: bad input is 400 with no Stripe call or write', async () => {
  const bad = [
    { type: 'lead', weekly_cents: 10000, paused: false },
    { type: 'toString', weekly_cents: 10000, paused: false },
    { weekly_cents: 10000, paused: false },
    { type: 'live_call', weekly_cents: '10000', paused: false },
    { type: 'live_call', weekly_cents: 10000.5, paused: false },
    { type: 'live_call', weekly_cents: -1, paused: false },
    { type: 'live_call', weekly_cents: 1, paused: false },
    { type: 'live_call', weekly_cents: 4999, paused: false },
    { type: 'live_call', weekly_cents: 100000000, paused: false },
    { type: 'live_call', paused: false },
    { type: 'live_call', weekly_cents: 10000, paused: 'yes' },
  ]
  for (const b of bad) {
    const a = fakeAdmin(agent())
    const s = fakeStripe()
    const r = await call(a, s, { action: 'inbound_set', ...b })
    assert.equal(r.status, 400, JSON.stringify(b))
    assert.equal(typeof r.body.error, 'string')
    assert.equal(s.calls.length, 0)
    assert.equal(a.writes.length, 0)
  }
})

test('inbound_set: billed agent with no live subscription is told to start servicing', async () => {
  const a = fakeAdmin(agent({ stripe_customer_id: null, stripe_subscription_id: null }))
  const s = fakeStripe()
  const r = await call(a, s, { action: 'inbound_set', type: 'live_call', weekly_cents: 10000, paused: false })
  assert.equal(r.status, 409)
  assert.equal(r.body.error, 'Start Policy Servicing first.')
  assert.equal(s.calls.length, 0)
  assert.equal(a.writes.length, 0)
})

test('inbound_set: Stripe not configured is the same 409, no Stripe call', async () => {
  const a = fakeAdmin(agent())
  const s = fakeStripe()
  const r = await call(a, s, { action: 'inbound_set', type: 'live_call', weekly_cents: 10000, paused: false }, '')
  assert.equal(r.status, 409)
  assert.equal(r.body.error, 'Start Policy Servicing first.')
  assert.equal(s.calls.length, 0)
})

// ── inbound_set writes ──────────────────────────────────────────────────────

test('inbound_set: first spend adds one item with inline price_data, no proration, and logs', async () => {
  const a = fakeAdmin(agent())
  const s = stripeFor(sub([SERVICING]))
  const r = await call(a, s, { action: 'inbound_set', type: 'live_call', weekly_cents: 11000, paused: false })
  assert.equal(r.status, 200)

  const [post] = posts(s)
  assert.equal(posts(s).length, 1)
  assert.equal(post.path, 'subscriptions/sub_1')
  assert.deepEqual(Object.fromEntries(post.form), {
    'items[0][price_data][currency]': 'usd',
    'items[0][price_data][product]': 'ohvara_line_live_call',
    'items[0][price_data][unit_amount]': '11000',
    'items[0][price_data][recurring][interval]': 'week',
    'items[0][quantity]': '1',
    'items[0][metadata][line]': 'live_call',
    proration_behavior: 'none',
  })
  assert.ok(post.headers['Idempotency-Key'])

  assert.deepEqual(logs(a).map((w: any) => w.row), [{
    agent_id: AGENT, inbound_type: 'live_call', old_cents: 0, new_cents: 11000, old_paused: false, new_paused: false,
  }])
  assert.equal(a.db.agent_inbound_spend[0].weekly_cents, 11000)
  assert.deepEqual(r.body.types[0], { type: 'live_call', label: 'Live Calls', weekly_cents: 11000, paused: false, estimate_count: 2 })
  assert.equal(r.body.subscribed, true)
})

test('inbound_set: a changed amount updates the same item, never the servicing item', async () => {
  const a = fakeAdmin(agent(), [spendRow('live_call', 10000)])
  const s = stripeFor(sub([LIVE_CALL, SERVICING]))
  const r = await call(a, s, { action: 'inbound_set', type: 'live_call', weekly_cents: 25000, paused: false })
  assert.equal(r.status, 200)
  const form = posts(s)[0].form
  assert.equal(form.get('items[0][id]'), 'si_lc')
  assert.equal(form.get('items[0][price_data][unit_amount]'), '25000')
  assert.equal(form.get('proration_behavior'), 'none')
  assert.ok(![...form.values()].includes('si_serv'))
})

test('inbound_set: spend 0 removes the item and logs it', async () => {
  const a = fakeAdmin(agent(), [spendRow('live_call', 10000)])
  const s = stripeFor(sub([LIVE_CALL, SERVICING]))
  const r = await call(a, s, { action: 'inbound_set', type: 'live_call', weekly_cents: 0, paused: false })
  assert.equal(r.status, 200)
  assert.deepEqual(Object.fromEntries(posts(s)[0].form), {
    'items[0][id]': 'si_lc', 'items[0][deleted]': 'true', proration_behavior: 'none',
  })
  assert.deepEqual(logs(a).map((w: any) => [w.row.old_cents, w.row.new_cents]), [[10000, 0]])
  assert.equal(a.db.agent_inbound_spend[0].weekly_cents, 0)
})

test('inbound_set: paused removes the item but keeps the amount', async () => {
  const a = fakeAdmin(agent(), [spendRow('live_call', 10000)])
  const s = stripeFor(sub([LIVE_CALL, SERVICING]))
  const r = await call(a, s, { action: 'inbound_set', type: 'live_call', weekly_cents: 10000, paused: true })
  assert.equal(r.status, 200)
  assert.equal(posts(s)[0].form.get('items[0][deleted]'), 'true')
  assert.deepEqual(r.body.types[0], { type: 'live_call', label: 'Live Calls', weekly_cents: 10000, paused: true, estimate_count: 1 })
  assert.deepEqual(logs(a).map((w: any) => [w.row.old_paused, w.row.new_paused]), [[false, true]])
})

test('inbound_set: a repeat changes nothing, in Stripe or the log', async () => {
  const a = fakeAdmin(agent(), [spendRow('live_call', 10000)])
  const s = stripeFor(sub([SERVICING, LIVE_CALL]))
  const r = await call(a, s, { action: 'inbound_set', type: 'live_call', weekly_cents: 10000, paused: false })
  assert.equal(r.status, 200)
  assert.equal(posts(s).length, 0)
  assert.equal(a.writes.length, 0)
})

test('inbound_set: zero with nothing there is a no-op', async () => {
  const a = fakeAdmin(agent())
  const s = stripeFor(sub([SERVICING]))
  const r = await call(a, s, { action: 'inbound_set', type: 'booked_appointment', weekly_cents: 0, paused: false })
  assert.equal(r.status, 200)
  assert.equal(posts(s).length, 0)
  assert.equal(a.writes.length, 0)
})

test('inbound_set: a duplicate item is removed while setting the amount', async () => {
  const dup = { ...LIVE_CALL, id: 'si_lc2' }
  const a = fakeAdmin(agent(), [spendRow('live_call', 10000)])
  const s = stripeFor(sub([SERVICING, LIVE_CALL, dup]))
  await call(a, s, { action: 'inbound_set', type: 'live_call', weekly_cents: 10000, paused: false })
  const form = posts(s)[0].form
  assert.equal(form.get('items[0][id]'), 'si_lc2')
  assert.equal(form.get('items[0][deleted]'), 'true')
  assert.equal(form.get('items[1][id]'), 'si_lc')
})

test('inbound_set: a pending schedule is released before items change', async () => {
  const a = fakeAdmin(agent())
  const s = stripeFor(sub([SERVICING], { schedule: 'sub_sched_1' }), {
    'GET subscription_schedules/sub_sched_1': () => ({ id: 'sub_sched_1', status: 'active' }),
    'POST subscription_schedules/sub_sched_1/release': () => ({ id: 'sub_sched_1' }),
  })
  const r = await call(a, s, { action: 'inbound_set', type: 'live_call', weekly_cents: 10000, paused: false })
  assert.equal(r.status, 200)
  assert.deepEqual(posts(s).map(c => c.path), ['subscription_schedules/sub_sched_1/release', 'subscriptions/sub_1'])
})

test('inbound_set: no change means the schedule is left alone', async () => {
  const a = fakeAdmin(agent(), [spendRow('live_call', 10000)])
  const s = stripeFor(sub([SERVICING, LIVE_CALL], { schedule: 'sub_sched_1' }))
  await call(a, s, { action: 'inbound_set', type: 'live_call', weekly_cents: 10000, paused: false })
  assert.equal(s.calls.filter(c => c.path.startsWith('subscription_schedules')).length, 0)
})

test('inbound_set: if Stripe fails nothing is written', async () => {
  const a = fakeAdmin(agent())
  const s = stripeFor(sub([SERVICING]), { 'POST subscriptions/sub_1': () => ({ __error: { type: 'api_error', message: 'nope' }, __status: 500 }) })
  const r = await call(a, s, { action: 'inbound_set', type: 'live_call', weekly_cents: 10000, paused: false })
  assert.equal(r.status, 502)
  assert.equal(a.writes.length, 0)
})

test('inbound_set: an agent on an old tier price keeps it', async () => {
  const a = fakeAdmin(agent())
  const s = stripeFor(sub([OLD_TIER]))
  await call(a, s, { action: 'inbound_set', type: 'live_call', weekly_cents: 10000, paused: false })
  const form = posts(s)[0].form
  assert.equal(posts(s).length, 1)
  assert.ok(![...form.values()].includes('si_old'))
  assert.ok(![...form.values()].includes('price_old'))
})

// ── overview ────────────────────────────────────────────────────────────────

const invoice = (over: Record<string, unknown> = {}) => ({
  id: 'in_1', status: 'paid', created: 1792000000, amount_paid: 51900, amount_due: 51900,
  hosted_invoice_url: 'https://h', invoice_pdf: 'https://p',
  lines: { data: [
    { amount: 22000, price: { metadata: {}, product: 'ohvara_line_live_call' }, metadata: { profile_id: AGENT } },
    { amount: 29900, price: { metadata: { line: 'servicing' }, product: 'ohvara_line_servicing' }, metadata: {} },
  ] },
  ...over,
})

function overviewStripe(current: any, invoices: any[] = [invoice()]) {
  return fakeStripe({
    'GET subscriptions/sub_1': () => current,
    'GET customers/cus_1': () => ({ id: 'cus_1', invoice_settings: { default_payment_method: 'pm_1' } }),
    'GET payment_methods/pm_1': () => ({ id: 'pm_1', customer: 'cus_1', type: 'card', card: { brand: 'visa', last4: '4242', exp_month: 1, exp_year: 2030 } }),
    'GET invoices': () => ({ data: invoices }),
  })
}

test('overview: comped gets a read-only 200 with no Stripe call', async () => {
  const a = fakeAdmin(comped(), [spendRow('live_call', 11000)])
  const s = fakeStripe()
  const r = await call(a, s, { action: 'overview' })
  assert.equal(r.status, 200)
  assert.equal(s.calls.length, 0)
  assert.equal(a.writes.length, 0)
  assert.deepEqual(r.body.servicing, { price_cents: 29900, status: 'active', next_charge_at: null, comped: true })
  assert.equal(r.body.next_charge_cents, 0)
  assert.deepEqual(r.body.invoices, [])
  assert.equal(r.body.inbound[0].estimate_count, 2)
})

test('overview: Stripe not configured answers configured:false', async () => {
  const a = fakeAdmin(agent())
  const s = fakeStripe()
  const r = await call(a, s, { action: 'overview' }, '')
  assert.equal(r.status, 200)
  assert.equal(r.body.configured, false)
  assert.equal(r.body.subscription, null)
  assert.equal(s.calls.length, 0)
})

test('overview: next charge is servicing plus unpaused inbound, whatever the item order', async () => {
  const a = fakeAdmin(agent(), [spendRow('live_call', 10000), spendRow('booked_appointment', 25000, true)])
  const s = overviewStripe(sub([LIVE_CALL, SERVICING]))
  const r = await call(a, s, { action: 'overview' })
  assert.equal(r.status, 200)
  assert.equal(r.body.configured, true)
  assert.equal(r.body.servicing.price_cents, 29900)
  assert.equal(r.body.servicing.status, 'active')
  assert.equal(r.body.servicing.comped, false)
  assert.equal(r.body.servicing.next_charge_at, new Date(1793000000 * 1000).toISOString())
  assert.equal(r.body.next_charge_cents, 39900)
  assert.equal(r.body.subscription.plan.name, 'Policy Servicing')
  assert.equal(r.body.subscription.plan.weekly_cents, 29900)
  assert.equal(r.body.subscription.scheduled, null)
  assert.equal(r.body.card.last4, '4242')
  assert.equal(r.body.publishable_key, 'pk_test_x')
})

test('overview: a set-to-cancel subscription has no next charge', async () => {
  const a = fakeAdmin(agent(), [spendRow('live_call', 10000)])
  const s = overviewStripe(sub([SERVICING, LIVE_CALL], { cancel_at_period_end: true }))
  const r = await call(a, s, { action: 'overview' })
  assert.equal(r.body.next_charge_cents, 0)
  assert.equal(r.body.servicing.next_charge_at, null)
  assert.equal(r.body.servicing.status, 'canceled')
  assert.equal(r.body.subscription.cancel_at_period_end, true)
})

test('overview: an old tier price shows as the servicing line at its own amount', async () => {
  const a = fakeAdmin(agent())
  const s = overviewStripe(sub([LIVE_CALL, OLD_TIER]))
  const r = await call(a, s, { action: 'overview' })
  assert.equal(r.body.servicing.price_cents, 35000)
  assert.equal(r.body.subscription.plan.name, 'Policy Servicing')
  assert.equal(r.body.next_charge_cents, 35000)
  assert.equal(posts(s).length, 0)
})

test('overview: invoice lines are labelled by tag or product, not position', async () => {
  const a = fakeAdmin(agent())
  const oldTier = invoice({
    id: 'in_old', amount_paid: 35000,
    lines: { data: [
      { amount: 35000, price: { metadata: { tier: 'standard' }, product: 'prod_old', nickname: 'Standard' }, metadata: {} },
      { amount: 5000, price: { metadata: {}, product: 'ohvara_line_booked_appointment' }, metadata: {} },
    ] },
  })
  const s = overviewStripe(sub([SERVICING]), [invoice(), oldTier, invoice({ id: 'in_draft', status: 'draft' })])
  const r = await call(a, s, { action: 'overview' })
  assert.deepEqual(r.body.invoices.map((i: any) => i.id), ['in_1', 'in_old'])
  const [first, second] = r.body.invoices
  assert.deepEqual(first.lines, [{ label: 'Policy Servicing', amount_cents: 29900 }, { label: 'Live Calls', amount_cents: 22000 }])
  assert.deepEqual(second.lines, [{ label: 'Policy Servicing', amount_cents: 35000 }, { label: 'Booked Appointments', amount_cents: 5000 }])
  assert.equal(first.date, new Date(1792000000 * 1000).toISOString())
  assert.equal(first.created, first.date)
  assert.equal(first.status, 'paid')
  assert.equal(first.amount_cents, 51900)
  assert.equal(first.description, 'Policy Servicing + Live Calls')
})

// ── status + webhook sync ───────────────────────────────────────────────────

test('sync: profile writes never touch billing_tier, and the period comes from the servicing item', async () => {
  const a = fakeAdmin(agent())
  const noTop = { ...sub([LIVE_CALL, { ...OLD_TIER, current_period_end: 1794000000 }]), current_period_end: undefined }
  const s = fakeStripe({ 'GET subscriptions': () => ({ data: [noTop] }) })
  const r = await call(a, s, { action: 'status' })
  assert.equal(r.status, 200)
  const [patch] = a.writes.filter(w => w.table === 'profiles')
  assert.ok(patch)
  assert.ok(!('billing_tier' in patch.row))
  assert.equal(patch.row.billing_current_period_end, new Date(1794000000 * 1000).toISOString())
})

// ── checkout + portal ───────────────────────────────────────────────────────

function checkoutStripe(found: any[]) {
  return fakeStripe({
    'GET subscriptions': () => ({ data: [] }),
    'GET prices': () => ({ data: found }),
    'GET products/ohvara_line_servicing': () => ({ __error: { code: 'resource_missing', message: 'gone' }, __status: 404 }),
    'POST products': () => ({ id: 'ohvara_line_servicing' }),
    'POST prices': () => ({ id: 'price_new' }),
    'POST prices/price_old': () => ({ id: 'price_old' }),
    'POST checkout/sessions': () => ({ client_secret: 'cs_secret' }),
  })
}

test('checkout: a first subscription makes the price from settings, servicing item only', async () => {
  const a = fakeAdmin(agent())
  const s = checkoutStripe([])
  const r = await call(a, s, { action: 'checkout', tier: 'premium' })
  assert.equal(r.status, 200)
  assert.equal(r.body.client_secret, 'cs_secret')

  const product = s.calls.find(c => c.path === 'products' && c.method === 'POST')!
  assert.equal(product.form.get('id'), 'ohvara_line_servicing')
  assert.equal(product.form.get('metadata[ohvara]'), 'agent_billing')
  assert.equal(product.form.get('metadata[line]'), 'servicing')

  const price = s.calls.find(c => c.path === 'prices' && c.method === 'POST')!
  assert.equal(price.form.get('unit_amount'), '29900')
  assert.equal(price.form.get('recurring[interval]'), 'week')
  assert.equal(price.form.get('metadata[line]'), 'servicing')

  const session = s.calls.find(c => c.path === 'checkout/sessions')!
  assert.equal(session.form.get('line_items[0][price]'), 'price_new')
  assert.equal(session.form.get('line_items[1][price]'), null)
  assert.ok(![...session.form.keys()].some(k => k.includes('tier')))
})

test('checkout: the existing price is reused while the amount matches', async () => {
  const a = fakeAdmin(agent())
  const s = checkoutStripe([{ id: 'price_same', unit_amount: 29900, recurring: { interval: 'week' } }])
  await call(a, s, { action: 'checkout' })
  assert.equal(s.calls.filter(c => c.path === 'prices' && c.method === 'POST').length, 0)
  assert.equal(s.calls.find(c => c.path === 'checkout/sessions')!.form.get('line_items[0][price]'), 'price_same')
})

test('checkout: a changed amount in settings makes a new price and retires the old', async () => {
  const a = fakeAdmin(agent())
  const s = checkoutStripe([{ id: 'price_old', unit_amount: 35000, recurring: { interval: 'week' } }])
  await call(a, s, { action: 'checkout' })
  const created = s.calls.find(c => c.path === 'prices' && c.method === 'POST')!
  assert.equal(created.form.get('unit_amount'), '29900')
  assert.equal(created.form.get('transfer_lookup_key'), 'true')
  assert.equal(s.calls.find(c => c.path === 'prices/price_old')!.form.get('active'), 'false')
})

test('checkout: spend left from an ended subscription is reset and logged', async () => {
  const a = fakeAdmin(agent(), [spendRow('live_call', 10000), spendRow('booked_appointment', 0)])
  const s = checkoutStripe([{ id: 'price_same', unit_amount: 29900, recurring: { interval: 'week' } }])
  await call(a, s, { action: 'checkout' })
  assert.deepEqual(logs(a).map((w: any) => [w.row.inbound_type, w.row.old_cents, w.row.new_cents]), [['live_call', 10000, 0]])
  assert.equal(a.db.agent_inbound_spend.find(r => r.inbound_type === 'live_call').weekly_cents, 0)
})

test('portal: the configuration offers no plan switching', async () => {
  const a = fakeAdmin(agent())
  const s = fakeStripe({
    'GET billing_portal/configurations': () => ({ data: [] }),
    'POST billing_portal/configurations': () => ({ id: 'bpc_1' }),
    'POST billing_portal/sessions': () => ({ url: 'https://portal' }),
  })
  const r = await call(a, s, { action: 'portal', flow: 'change_plan' })
  assert.equal(r.status, 200)
  const cfg = s.calls.find(c => c.path === 'billing_portal/configurations' && c.method === 'POST')!
  assert.equal(cfg.form.get('features[subscription_update][enabled]'), 'false')
  assert.ok(![...cfg.form.keys()].some(k => k.includes('[products]')))
  const session = s.calls.find(c => c.path === 'billing_portal/sessions')!
  assert.ok(![...session.form.keys()].some(k => k.startsWith('flow_data')))
})

test('the removed plan actions are unknown, and comped is still refused on the rest', async () => {
  for (const action of ['preview_change', 'change_plan', 'cancel_change']) {
    const r = await call(fakeAdmin(agent()), fakeStripe(), { action })
    assert.equal(r.status, 400)
  }
  const r = await call(fakeAdmin(comped()), fakeStripe(), { action: 'cancel' })
  assert.equal(r.status, 409)
  assert.equal(r.body.error, "Your account isn't billed.")
})
