/**
 * Node unit tests for Fulfillment payouts (Prompt 753): fulfillment-pay-week,
 * fulfillment-connect-session and the Connect webhook handler, with a mocked
 * Stripe client and in-memory stores. No real Stripe calls, no transfers.
 * Run: node --test supabase/functions/fulfillment-pay-week/core.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { payWeek, handle, type Store, type Payout, type Figures } from './core.ts'
import { act as connectAct, handle as connectHandle, details, maskStreet, type Store as ConnectSessionStore } from '../fulfillment-connect-session/core.ts'
import {
  StripeError, summarize, statusOf, handleConnectEvent, formEncode, type Stripe, type PayoutAccount, type Email,
} from '../_shared/fulfillmentPayouts.ts'

const REP = '11111111-1111-4111-8111-111111111111'
const AGENT = '22222222-2222-4222-8222-222222222222'
const ADMIN = '33333333-3333-4333-8333-333333333333'
const WEEK = '2026-10-05' // a Monday
const ENV = { configured: true, appUrl: 'https://portal.ohvara.com' }

const readyAccount = (over: Partial<PayoutAccount> = {}): PayoutAccount => ({
  rep_id: REP, stripe_account_id: 'acct_rep', details_submitted: true, payouts_enabled: true, transfers_active: true,
  requirements_due: [], disabled_reason: null, external_kind: 'bank', bank_name: 'Chase', last4: '4821', ...over,
})

// 30h at $15/hr, the mockup's numbers.
const FIG: Figures = { period_start: WEEK, period_end: '2026-10-11', hours: 30, rate_cents: 1500, amount_cents: 45000, ended: true }

function world(over: { live?: boolean; figures?: Partial<Figures>; account?: PayoutAccount | null; stripeFail?: any; repEmails?: boolean } = {}) {
  const rows = new Map<string, Payout & { approved_by?: string; paid_to?: string; failure_reason?: string | null }>()
  const emails: Email[] = []
  const calls: { method: string; path: string; params?: any; key?: string }[] = []
  const transfersByKey = new Map<string, any>()
  const roles: Record<string, string> = { [REP]: 'fulfillment', [AGENT]: 'agent', [ADMIN]: 'admin' }
  const account = over.account === undefined ? readyAccount() : over.account
  const store: Store = {
    async userFromJwt(jwt) { return ({ admin: ADMIN, rep: REP } as any)[jwt] ?? null },
    async role(id) { return roles[id] ?? null },
    async payoutsLive() { return over.live ?? true },
    async rep(id) {
      if (!roles[id]) return null
      return { id, role: roles[id], full_name: 'Test Fulfill', email: 'tf@example.com', stripe_account_id: account?.stripe_account_id ?? null, payout_email_sent: over.repEmails ?? true, payout_email_problem: over.repEmails ?? true }
    },
    async figures(_rep, start) { return { ...FIG, ...over.figures, period_start: start } },
    async claim(repId, f, adminId) {
      const k = `${repId}|${f.period_start}`
      let r = rows.get(k)
      if (!r) { r = { id: `po_${rows.size + 1}`, rep_id: repId, period_start: f.period_start, period_end: f.period_end, hours: f.hours, rate_cents: f.rate_cents, amount_cents: f.amount_cents, status: 'upcoming', stripe_transfer_id: null }; rows.set(k, r) }
      if (!['upcoming', 'failed', 'held'].includes(r.status)) return null
      Object.assign(r, { status: 'approved', approved_by: adminId, hours: f.hours, rate_cents: f.rate_cents, amount_cents: f.amount_cents })
      return { ...r }
    },
    async payout(repId, start) { return rows.get(`${repId}|${start}`) ?? null },
    async account() { return account },
    async markPayout(id, patch) { for (const r of rows.values()) if (r.id === id) Object.assign(r, patch) },
    async sendEmail(e) { emails.push(e) },
  }
  const stripe: Stripe = async (method, path, params, opts) => {
    calls.push({ method, path, params, key: opts?.idempotencyKey })
    if (path === 'transfers') {
      if (over.stripeFail) throw over.stripeFail
      // Stripe's idempotency: the same key returns the same transfer.
      if (opts?.idempotencyKey && transfersByKey.has(opts.idempotencyKey)) return transfersByKey.get(opts.idempotencyKey)
      const t = { id: `tr_${transfersByKey.size + 1}`, amount: params!.amount }
      if (opts?.idempotencyKey) transfersByKey.set(opts.idempotencyKey, t)
      return t
    }
    return {}
  }
  return { store, stripe, rows, emails, calls }
}

const transfers = (calls: any[]) => calls.filter(c => c.path === 'transfers')

test('admin-only: a rep, an agent or a stranger cannot pay a week', async () => {
  const w = world()
  await assert.rejects(payWeek(w.store, w.stripe, ENV, REP, { rep_id: REP, period_start: WEEK }), { status: 403 })
  await assert.rejects(payWeek(w.store, w.stripe, ENV, AGENT, { rep_id: REP, period_start: WEEK }), { status: 403 })
  await assert.rejects(payWeek(w.store, w.stripe, ENV, 'nobody', { rep_id: REP, period_start: WEEK }), { status: 403 })
  assert.equal(transfers(w.calls).length, 0)
})

test('payouts_live off: Approve & pay refuses, nothing is sent', async () => {
  const w = world({ live: false })
  await assert.rejects(payWeek(w.store, w.stripe, ENV, ADMIN, { rep_id: REP, period_start: WEEK }), { code: 'payouts_off', message: /Turn on payouts/ })
  assert.equal(w.calls.length, 0)
  assert.equal(w.rows.size, 0)
})

test('input checks: bad rep id, a non-Monday, a non-Fulfillment rep, a week not over, $0', async () => {
  const w = world()
  await assert.rejects(payWeek(w.store, w.stripe, ENV, ADMIN, { rep_id: 'x', period_start: WEEK }), { status: 400 })
  await assert.rejects(payWeek(w.store, w.stripe, ENV, ADMIN, { rep_id: REP, period_start: '2026-10-06' }), { status: 400 })
  await assert.rejects(payWeek(w.store, w.stripe, ENV, ADMIN, { rep_id: AGENT, period_start: WEEK }), { status: 404 })
  const open = world({ figures: { ended: false } })
  await assert.rejects(payWeek(open.store, open.stripe, ENV, ADMIN, { rep_id: REP, period_start: WEEK }), { code: 'week_not_over' })
  const zero = world({ figures: { amount_cents: 0, hours: 0 } })
  await assert.rejects(payWeek(zero.store, zero.stripe, ENV, ADMIN, { rep_id: REP, period_start: WEEK }), { code: 'nothing_to_pay' })
  assert.equal(transfers([...open.calls, ...zero.calls, ...w.calls]).length, 0)
  const unconfigured = world()
  await assert.rejects(payWeek(unconfigured.store, unconfigured.stripe, { ...ENV, configured: false }, ADMIN, { rep_id: REP, period_start: WEEK }), { code: 'not_configured' })
})

test('amount is recomputed on the server: a client amount in the body is ignored', async () => {
  const w = world()
  const r = await payWeek(w.store, w.stripe, ENV, ADMIN, { rep_id: REP, period_start: WEEK, amount_cents: 999999, hours: 80 })
  assert.equal(r.amount_cents, 45000)
  const [t] = transfers(w.calls)
  assert.equal(t.params.amount, 45000)
  assert.equal(t.params.destination, 'acct_rep')
  assert.equal(t.params.currency, 'usd')
  assert.equal(t.params.metadata.period_start, WEEK)
  const row = w.rows.get(`${REP}|${WEEK}`)!
  assert.equal(row.status, 'paid')
  assert.equal(row.stripe_transfer_id, 'tr_1')
  assert.equal(row.paid_to, 'Chase •••• 4821')
  assert.equal(row.approved_by, ADMIN)
  assert.equal(w.emails.length, 1)
  assert.match(w.emails[0].subject, /\$450\.00/)
  assert.match(w.emails[0].text, /Chase •••• 4821/)
})

test('idempotency: one paid row per rep-week; a second click is refused; the key is per row + amount', async () => {
  const w = world()
  await payWeek(w.store, w.stripe, ENV, ADMIN, { rep_id: REP, period_start: WEEK })
  await assert.rejects(payWeek(w.store, w.stripe, ENV, ADMIN, { rep_id: REP, period_start: WEEK }), { code: 'already_paid' })
  const ts = transfers(w.calls)
  assert.equal(ts.length, 1)
  assert.equal(ts[0].key, 'fulfillment-payout-po_1-45000')
  assert.equal(w.rows.size, 1)
  // A row stuck in approved (the attempt in flight) is not paid twice either.
  const x = world()
  await x.store.claim(REP, FIG, ADMIN)
  await assert.rejects(payWeek(x.store, x.stripe, ENV, ADMIN, { rep_id: REP, period_start: WEEK }), { code: 'in_progress' })
  assert.equal(transfers(x.calls).length, 0)
})

test('a retry after a crash reuses the same idempotency key, so Stripe returns the same transfer', async () => {
  const w = world()
  await payWeek(w.store, w.stripe, ENV, ADMIN, { rep_id: REP, period_start: WEEK })
  // Simulate the row reverting (e.g. the DB write after the transfer was lost).
  w.rows.get(`${REP}|${WEEK}`)!.status = 'failed'
  const again = await payWeek(w.store, w.stripe, ENV, ADMIN, { rep_id: REP, period_start: WEEK })
  assert.equal(again.transfer_id, 'tr_1')
})

test('failure path: a refused transfer marks the week failed and sends the problem email', async () => {
  const w = world({ stripeFail: new StripeError({ code: 'balance_insufficient', message: 'Insufficient funds in Stripe account acct_123' }, 400, 'x') })
  await assert.rejects(payWeek(w.store, w.stripe, ENV, ADMIN, { rep_id: REP, period_start: WEEK }), { code: 'transfer_failed', message: /balance was too low/ })
  const row = w.rows.get(`${REP}|${WEEK}`)!
  assert.equal(row.status, 'failed')
  assert.match(row.failure_reason!, /balance was too low/)
  assert.doesNotMatch(row.failure_reason!, /acct_/)
  assert.equal(w.emails.length, 1)
  assert.match(w.emails[0].subject, /problem/)
  // Failed can be paid again once fixed.
  const ok = world()
  const r2 = ok.rows
  r2.set(`${REP}|${WEEK}`, { ...row, status: 'failed' })
  assert.equal((await payWeek(ok.store, ok.stripe, ENV, ADMIN, { rep_id: REP, period_start: WEEK })).ok, true)
})

test('held: a rep without a ready payout account is put on hold, no transfer', async () => {
  for (const account of [null, readyAccount({ payouts_enabled: false, requirements_due: ['individual.verification.document'] })]) {
    const w = world({ account })
    await assert.rejects(payWeek(w.store, w.stripe, ENV, ADMIN, { rep_id: REP, period_start: WEEK }), { code: 'held' })
    assert.equal(w.rows.get(`${REP}|${WEEK}`)!.status, 'held')
    assert.equal(transfers(w.calls).length, 0)
    assert.equal(w.emails.length, 1)
  }
})

test('emails respect the rep switches', async () => {
  const w = world({ repEmails: false })
  await payWeek(w.store, w.stripe, ENV, ADMIN, { rep_id: REP, period_start: WEEK })
  assert.equal(w.emails.length, 0)
})

test('handle: no JWT is 401, a refusal is its status + code', async () => {
  const w = world({ live: false })
  const req = (auth: string | null, body: any) => new Request('http://x', { method: 'POST', headers: auth ? { Authorization: `Bearer ${auth}` } : {}, body: JSON.stringify(body) })
  assert.equal((await handle(req(null, {}), w.store, w.stripe, ENV)).status, 401)
  const r = await handle(req('admin', { rep_id: REP, period_start: WEEK }), w.store, w.stripe, ENV)
  assert.equal(r.status, 409)
  assert.equal((await r.json()).code, 'payouts_off')
  assert.equal((await handle(req('rep', { rep_id: REP, period_start: WEEK }), w.store, w.stripe, ENV)).status, 403)
})

// ── fulfillment-connect-session ─────────────────────────────────────────────

const stripeAccount = (over: any = {}) => ({
  id: 'acct_rep', details_submitted: true, payouts_enabled: true, capabilities: { transfers: 'active' },
  requirements: { currently_due: [], past_due: [], disabled_reason: null },
  external_accounts: { data: [{ object: 'bank_account', bank_name: 'JPMORGAN CHASE BANK', last4: '4821', default_for_currency: true }] },
  individual: {
    first_name: 'Test', last_name: 'Fulfill', address: { line1: '1418 Elm St', city: 'Amarillo', state: 'TX' },
    dob: { day: 3, month: 4, year: 1994 }, verification: { status: 'verified' }, ssn_last_4_provided: true,
  },
  ...over,
})

function connectWorld(over: { acct?: string | null; role?: string; docsRefused?: boolean } = {}) {
  const saved: PayoutAccount[] = []
  const calls: { method: string; path: string; params?: any; key?: string }[] = []
  const profiles: Record<string, any> = {
    [REP]: { id: REP, role: over.role ?? 'fulfillment', email: 'tf@example.com', full_name: 'Test Fulfill', stripe_account_id: over.acct === undefined ? 'acct_rep' : over.acct },
    [AGENT]: { id: AGENT, role: 'agent', email: 'a@example.com', full_name: 'Agent', stripe_account_id: 'acct_agent' },
  }
  const store: ConnectSessionStore = {
    async userFromJwt(jwt) { return ({ rep: REP, agent: AGENT } as any)[jwt] ?? null },
    async profile(id) { return profiles[id] ?? null },
    async setStripeAccount(id, a) { profiles[id].stripe_account_id = a },
    async saveAccount(row) { saved.push(row) },
  }
  const stripe: Stripe = async (method, path, params, opts) => {
    calls.push({ method, path, params, key: opts?.idempotencyKey })
    if (method === 'GET' && path.startsWith('accounts/')) return stripeAccount({ id: path.split('/')[1] })
    if (method === 'POST' && path === 'accounts') return { id: 'acct_new', details_submitted: false, payouts_enabled: false, capabilities: { transfers: 'inactive' }, requirements: { currently_due: ['external_account'] } }
    if (path === 'account_sessions') {
      if (over.docsRefused && params?.components?.documents) throw new StripeError({ message: 'Received unknown parameter: components[documents]', param: 'components[documents]' }, 400, 'x')
      return { client_secret: `cs_${params!.account}` }
    }
    return {}
  }
  return { store, stripe, saved, calls, profiles }
}
const CENV = { configured: true, publishableKey: 'pk_test_1' }

test('connect session: only a signed-in Fulfillment rep, and only for their own account', async () => {
  const w = connectWorld()
  await assert.rejects(connectAct(w.store, w.stripe, CENV, '', { action: 'session' }), { status: 401 })
  await assert.rejects(connectAct(w.store, w.stripe, CENV, 'agent', { action: 'session' }), { status: 403 })
  const s = await connectAct(w.store, w.stripe, CENV, 'rep', { action: 'session', account: 'acct_agent' }) as any
  assert.equal(s.client_secret, 'cs_acct_rep')
  assert.equal(s.publishable_key, 'pk_test_1')
  assert.equal(s.documents, true)
  const sess = w.calls.find(c => c.path === 'account_sessions')!
  assert.equal(sess.params.account, 'acct_rep')
  assert.deepEqual(Object.keys(sess.params.components).sort(), ['account_management', 'account_onboarding', 'documents', 'notification_banner'])
  assert.equal(sess.params.components.account_management.features.external_account_collection, true)
  assert.ok(!w.calls.some(c => c.path.includes('acct_agent')))
})

test('connect session: creates an Express account (transfers only) the first time, idempotently', async () => {
  const w = connectWorld({ acct: null })
  const s = await connectAct(w.store, w.stripe, CENV, 'rep', { action: 'session' }) as any
  const create = w.calls.find(c => c.method === 'POST' && c.path === 'accounts')!
  assert.equal(create.params.type, 'express')
  assert.deepEqual(create.params.capabilities, { transfers: { requested: true } })
  assert.equal(create.params.metadata.profile_id, REP)
  assert.equal(create.key, `fulfillment-account-${REP}`)
  assert.equal(w.profiles[REP].stripe_account_id, 'acct_new')
  assert.equal(s.client_secret, 'cs_acct_new')
  assert.equal(statusOf(w.saved[0]), 'incomplete')
})

test('connect session: falls back without the documents component and says so', async () => {
  const w = connectWorld({ docsRefused: true })
  const s = await connectAct(w.store, w.stripe, CENV, 'rep', { action: 'session' }) as any
  assert.equal(s.documents, false)
  assert.equal(s.client_secret, 'cs_acct_rep')
})

test('connect overview: status, last 4 only, masked details; nothing unmasked stored', async () => {
  const w = connectWorld()
  const o = await connectAct(w.store, w.stripe, CENV, 'rep', { action: 'overview' }) as any
  assert.equal(o.status, 'ready')
  assert.equal(o.account.label, 'JPMORGAN CHASE BANK •••• 4821')
  assert.deepEqual(o.details, { legal_name: 'Test Fulfill', address: '•••• Elm St, Amarillo, TX', dob: '••/••/1994', verified: true, tin_on_file: true })
  const stored = JSON.stringify(w.saved)
  assert.doesNotMatch(stored, /1418|Amarillo|1994|Test/)
  const none = connectWorld({ acct: null })
  assert.equal((await connectAct(none.store, none.stripe, CENV, 'rep', { action: 'overview' }) as any).status, 'none')
  assert.equal(none.calls.length, 0)
  const off = connectWorld()
  await assert.rejects(connectAct(off.store, off.stripe, { configured: false, publishableKey: null }, 'rep', {}), { code: 'not_configured' })
  assert.equal(maskStreet('12B Main St'), '•••• Main St')
  assert.equal(details({}), null)
})

test('connect handle: Stripe text is not leaked', async () => {
  const w = connectWorld()
  const boom: Stripe = async () => { throw new StripeError({ message: 'No such account: acct_secret' }, 404, 'x') }
  const r = await connectHandle(new Request('http://x', { method: 'POST', headers: { Authorization: 'Bearer rep' }, body: '{"action":"overview"}' }), w.store, boom, CENV)
  assert.equal(r.status, 502)
  assert.doesNotMatch(await r.text(), /acct_secret/)
})

test('status summary: action needed vs ready vs incomplete; debit card destination', () => {
  assert.equal(statusOf(null), 'none')
  assert.equal(statusOf(summarize(REP, stripeAccount())), 'ready')
  assert.equal(statusOf(summarize(REP, stripeAccount({ requirements: { currently_due: ['individual.verification.document'] } }))), 'action_needed')
  assert.equal(statusOf(summarize(REP, stripeAccount({ details_submitted: false }))), 'incomplete')
  const card = summarize(REP, stripeAccount({ external_accounts: { data: [{ object: 'card', brand: 'Visa', last4: '1111' }] } }))
  assert.deepEqual([card.external_kind, card.bank_name, card.last4], ['card', 'Visa debit', '1111'])
  assert.equal(formEncode({ a: { b: [1, { c: 2 }] } }).toString(), 'a%5Bb%5D%5B0%5D=1&a%5Bb%5D%5B1%5D%5Bc%5D=2')
})

// ── Connect webhook events ──────────────────────────────────────────────────

test('webhook: account.updated re-fetches and stores the summary; unknown accounts ignored', async () => {
  const saved: PayoutAccount[] = []
  const rows: any[] = [{ id: 'po_1', rep_id: REP, period_start: WEEK, period_end: '2026-10-11', amount_cents: 45000, status: 'paid', stripe_transfer_id: 'tr_9' }]
  const emails: Email[] = []
  const store = {
    async repByAccount(a: string) { return a === 'acct_rep' ? REP : null },
    async saveAccount(r: PayoutAccount) { saved.push(r) },
    async payoutByTransfer(t: string) { return rows.find(r => r.stripe_transfer_id === t) ?? null },
    async markPayout(id: string, patch: any) { Object.assign(rows.find(r => r.id === id), patch) },
    async rep() { return { email: 'tf@example.com', payout_email_problem: true } },
    async sendEmail(e: Email) { emails.push(e) },
  }
  let fetched = 0
  const stripe: Stripe = async (_m, path) => { fetched++; return stripeAccount({ id: path.split('/')[1], payouts_enabled: false }) }
  // The event payload says enabled, the fresh account says not: the fresh one wins.
  const r = await handleConnectEvent(store, stripe, { type: 'account.updated', data: { object: { id: 'acct_rep', payouts_enabled: true } } }, 'https://p')
  assert.equal(fetched, 1)
  assert.equal(saved[0].payouts_enabled, false)
  assert.equal(r.status, 'action_needed')
  assert.deepEqual(await handleConnectEvent(store, stripe, { type: 'account.updated', data: { object: { id: 'acct_other' } } }, 'https://p'), { ignored: 'not a fulfillment payout account' })
  await handleConnectEvent(store, stripe, { type: 'account.external_account.created', account: 'acct_rep', data: { object: { object: 'bank_account' } } }, 'https://p')
  assert.equal(saved.length, 2)

  const rev = await handleConnectEvent(store, stripe, { type: 'transfer.reversed', data: { object: { id: 'tr_9' } } }, 'https://p')
  assert.equal(rev.reversed, 'po_1')
  assert.equal(rows[0].status, 'failed')
  assert.equal(emails.length, 1)
  // A redelivered event doesn't email twice.
  await handleConnectEvent(store, stripe, { type: 'transfer.reversed', data: { object: { id: 'tr_9' } } }, 'https://p')
  assert.equal(emails.length, 1)
})

// ── agent-billing's webhook routes Connect events here, billing unchanged ───

test('agent-billing webhook: either signing secret; Connect events go to the payout handler', async () => {
  const { configure, handle: billing } = await import('../agent-billing/core.ts')
  const { createHmac } = await import('node:crypto')
  const seen: any[] = []
  const fetched: string[] = []
  configure({
    stripeKey: 'sk_test_x', webhookSecret: 'whsec_billing', connectWebhookSecret: 'whsec_connect',
    onConnectEvent: async e => { seen.push(e.type); return { ok: 1 } },
    fetch: (async (url: string) => { fetched.push(url); return new Response('{}', { status: 404 }) }) as any,
    now: () => 1_800_000_000_000,
  })
  const post = (secret: string, event: any) => {
    const body = JSON.stringify(event)
    const t = 1_800_000_000
    const sig = createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')
    return billing(new Request('http://x/agent-billing/webhook', { method: 'POST', headers: { 'stripe-signature': `t=${t},v1=${sig}` }, body }), {} as any)
  }
  assert.equal((await post('whsec_connect', { type: 'account.updated', data: { object: { id: 'acct_1' } } })).status, 200)
  assert.equal((await post('whsec_billing', { type: 'transfer.reversed', data: { object: { id: 'tr_1' } } })).status, 200)
  assert.deepEqual(seen, ['account.updated', 'transfer.reversed'])
  assert.equal((await post('whsec_wrong', { type: 'account.updated', data: { object: {} } })).status, 400)
  // A billing event still takes the subscription path (re-fetches the subscription), not the payout handler.
  await post('whsec_billing', { type: 'customer.subscription.updated', data: { object: { id: 'sub_1' } } })
  assert.equal(seen.length, 2)
  assert.ok(fetched.some(u => u.includes('subscriptions/sub_1')))
  // Unrelated events are ignored as before.
  const r = await post('whsec_billing', { type: 'charge.succeeded', data: { object: {} } })
  assert.equal((await r.json()).ignored, 'charge.succeeded')
})
