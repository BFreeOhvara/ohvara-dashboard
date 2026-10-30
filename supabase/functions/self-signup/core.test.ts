/**
 * Node unit tests for public sign-up. Database, auth and mail are all faked.
 * Run: node --test supabase/functions/self-signup/core.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { handle, EMAIL_LIMIT, IP_LIMIT, MIN_OK_MS, MSG, TERMS_VERSION, type Account, type Deps, type NewUser, type PendingSignup } from './core.ts'

const NOW = new Date('2026-10-30T18:00:00Z')
const IP = '203.0.113.9'

const good = {
  action: 'signup', full_name: ' Pat Rivers ', email: ' Pat@Example.com ', password: 'hunter2hunter', agree_terms: true,
}

function fake(over: Partial<Deps> = {}, state: { accounts?: Record<string, Account> } = {}) {
  const attempts: { ip_hash: string; email_hash: string }[] = []
  const pending = new Map<string, PendingSignup>()
  const created: NewUser[] = []
  const sent: string[] = []
  const marked: string[] = []
  const slept: number[] = []
  const locked = new Set<string>()
  const d: Deps = {
    testEmails: '',
    async signupOpen() { return true },
    async hash(v) { return `h(${v})` },
    async countAttempts(col, hash) { return attempts.filter(a => a[col] === hash).length },
    async recordAttempt(ip_hash, email_hash) { attempts.push({ ip_hash, email_hash }) },
    async findAccount(email) { return state.accounts?.[email] ?? null },
    async isLocked(id) { return locked.has(id) },
    async savePending(row) { pending.set(row.email, row) },
    async clearPending(email) { pending.delete(email) },
    async createUser(user) { created.push(user); return { id: 'new-user', error: null } },
    async markConfirmPending(id) { marked.push(id) },
    async sendConfirm(id, email) { sent.push(`${id}:${email}`); return true },
    now: () => NOW,
    async sleep(ms) { slept.push(ms) },
    log: () => {},
    ...over,
  }
  return { d, attempts, pending, created, sent, marked, slept, locked }
}

test('status answers { open } and nothing else', async () => {
  const open = await handle(fake().d, IP, { action: 'status' })
  assert.deepEqual(open, { status: 200, body: { open: true } })
  const shut = await handle(fake({ async signupOpen() { return false } }).d, IP, { action: 'status' })
  assert.deepEqual(shut.body, { open: false })
  const broken = await handle(fake({ async signupOpen() { throw new Error('x') } }).d, IP, { action: 'status' })
  assert.deepEqual(broken.body, { open: false })
})

test('closed means refused, with nothing written', async () => {
  for (const signupOpen of [async () => false, async () => { throw new Error('settings down') }]) {
    const f = fake({ signupOpen })
    const r = await handle(f.d, IP, good)
    assert.equal(r.status, 403)
    assert.equal(r.body.error, MSG.closed)
    assert.equal(f.attempts.length, 0)
    assert.equal(f.created.length, 0)
    assert.equal(f.pending.size, 0)
  }
})

test('the test list opens sign-up for its own emails only', async () => {
  const shut = { async signupOpen() { return false }, testEmails: ' brayden@example.com , PAT@example.com,,' }
  const f = fake(shut)
  assert.equal((await handle(f.d, IP, good)).status, 200)
  assert.equal(f.created.length, 1)
  assert.equal((await handle(fake(shut).d, IP, { ...good, email: 'other@example.com' })).status, 403)
  assert.equal((await handle(fake({ ...shut, testEmails: '' }).d, IP, { ...good, email: '' })).status, 403)
})

test('every field is checked, and agree_terms must be exactly true', async () => {
  const cases: [Record<string, unknown>, string][] = [
    [{ full_name: '   ' }, MSG.name],
    [{ full_name: 7 }, MSG.name],
    [{ email: 'nope' }, MSG.email],
    [{ email: 'old@ohvara.internal' }, MSG.email],
    [{ password: 'short1' }, MSG.password],
    [{ password: 'nonumbershere' }, MSG.password],
    [{ password: `1${'a'.repeat(72)}` }, MSG.password],
    [{ password: 12345678 }, MSG.password],
    [{ agree_terms: false }, MSG.terms],
    [{ agree_terms: 'true' }, MSG.terms],
    [{ agree_terms: 1 }, MSG.terms],
    [{ agree_terms: undefined }, MSG.terms],
  ]
  for (const [change, msg] of cases) {
    const f = fake()
    const r = await handle(f.d, IP, { ...good, ...change })
    assert.equal(r.status, 400, JSON.stringify(change))
    assert.equal(r.body.error, msg, JSON.stringify(change))
    assert.equal(f.attempts.length, 0)
    assert.equal(f.created.length, 0)
  }
})

test('a new sign-up: role is always agent whatever the request says, no upline, pending row first', async () => {
  const order: string[] = []
  const f = fake()
  const { savePending, createUser, markConfirmPending, sendConfirm } = f.d
  f.d.savePending = async r => { order.push('pending'); await savePending(r) }
  f.d.createUser = async u => { order.push('create'); return await createUser(u) }
  f.d.markConfirmPending = async i => { order.push('mark'); await markConfirmPending(i) }
  f.d.sendConfirm = async (i, e) => { order.push('send'); return await sendConfirm(i, e) }

  const r = await handle(f.d, IP, {
    ...good, role: 'admin', app_metadata: { role: 'admin' }, user_metadata: { role: 'admin' }, source: 'invite', upline_id: 'x',
  })
  assert.deepEqual(r, { status: 200, body: { ok: true } })
  assert.deepEqual(order, ['pending', 'create', 'mark', 'send'])
  assert.deepEqual(f.pending.get('pat@example.com'), {
    email: 'pat@example.com', role: 'agent', source: 'self', terms_version: TERMS_VERSION,
    terms_accepted_at: NOW.toISOString(), created_at: NOW.toISOString(),
  })
  assert.deepEqual(f.created, [{
    email: 'pat@example.com', password: good.password, email_confirm: true,
    app_metadata: { role: 'agent' }, user_metadata: { full_name: 'Pat Rivers' },
  }])
  assert.deepEqual(f.marked, ['new-user'])
  assert.deepEqual(f.sent, ['new-user:pat@example.com'])
})

test('rate limits: 5 per IP and 3 per email in the hour, 429 with nothing created', async () => {
  const byIp = fake()
  for (let i = 0; i < IP_LIMIT; i++) {
    assert.equal((await handle(byIp.d, IP, { ...good, email: `a${i}@example.com` })).status, 200)
  }
  const r = await handle(byIp.d, IP, { ...good, email: 'six@example.com' })
  assert.equal(r.status, 429)
  assert.equal(r.body.error, MSG.tooMany)
  assert.equal(byIp.created.length, IP_LIMIT)
  assert.equal(byIp.attempts.length, IP_LIMIT)

  const byEmail = fake()
  for (let i = 0; i < EMAIL_LIMIT; i++) {
    assert.equal((await handle(byEmail.d, `10.0.0.${i}`, good)).status, 200)
  }
  assert.equal((await handle(byEmail.d, '10.0.0.99', good)).status, 429)
  assert.equal(byEmail.attempts.length, EMAIL_LIMIT)
})

test('rate limit holds against a burst: the count after writing refuses the extras', async () => {
  const f = fake()
  // Every request saw an empty count first, and the rows have since piled up.
  let reads = 0
  f.d.countAttempts = async col => { reads++; return reads <= 2 ? 0 : (col === 'ip_hash' ? IP_LIMIT + 1 : 1) }
  assert.equal((await handle(f.d, IP, good)).status, 429)
  assert.equal(f.created.length, 0)
})

test('only hashes reach the attempts table, and no address means refused', async () => {
  const f = fake()
  await handle(f.d, IP, good)
  assert.deepEqual(f.attempts, [{ ip_hash: `h(${IP})`, email_hash: 'h(pat@example.com)' }])
  const none = fake()
  assert.equal((await handle(none.d, null, good)).status, 429)
  assert.equal(none.created.length, 0)
})

test('a limiter or salt failure refuses instead of creating anything', async () => {
  const f = fake({ async hash() { throw new Error('ip_salt_missing') } })
  await assert.rejects(handle(f.d, IP, good))
  assert.equal(f.created.length, 0)
  const g = fake({ async countAttempts() { throw new Error('down') } })
  await assert.rejects(handle(g.d, IP, good))
  assert.equal(g.created.length, 0)
})

test('a duplicate email answers exactly like a new one, and the word exists never appears', async () => {
  const fresh = await handle(fake().d, IP, good)
  const invited: Account = { id: 'a', signup_source: 'invite', email_confirm_pending: false, is_active: true }
  const f = fake({}, { accounts: { 'pat@example.com': invited } })
  const dup = await handle(f.d, IP, good)
  assert.deepEqual(dup, fresh)
  assert.ok(!/exist/i.test(JSON.stringify(dup)))
  assert.equal(f.created.length, 0)
  assert.equal(f.pending.size, 0)
  assert.deepEqual(f.sent, [])
})

test('a race past the lookup: createUser says duplicate, same answer, pending row cleaned up', async () => {
  for (const error of [
    { code: 'email_exists', message: 'x' },
    { message: 'A user with this email address has already been registered' },
  ]) {
    const f = fake({ async createUser() { return { id: null, error } } })
    const r = await handle(f.d, IP, good)
    assert.deepEqual(r, { status: 200, body: { ok: true } })
    assert.equal(f.pending.size, 0)
    assert.deepEqual(f.sent, [])
  }
})

test('every ok takes the same minimum time, so timing gives nothing away', async () => {
  const fresh = fake()
  await handle(fresh.d, IP, good)
  assert.deepEqual(fresh.slept, [MIN_OK_MS])
  const dup = fake({}, { accounts: { 'pat@example.com': { id: 'a', signup_source: null, email_confirm_pending: null, is_active: true } } })
  await handle(dup.d, IP, good)
  assert.deepEqual(dup.slept, [MIN_OK_MS])
})

test('the confirm link is resent only to a pending, unpaid self-signup', async () => {
  const pending: Account = { id: 'a', signup_source: 'self', email_confirm_pending: true, is_active: true }
  const cases: [Partial<Account>, boolean, boolean][] = [
    [{}, true, true],
    [{}, false, false], // paid
    [{ email_confirm_pending: false }, true, false], // already confirmed
    [{ signup_source: 'invite' }, true, false], // text invite
    [{ signup_source: null }, true, false],
    [{ is_active: false }, true, false], // deactivated
  ]
  for (const [change, locked, sends] of cases) {
    const f = fake({}, { accounts: { 'pat@example.com': { ...pending, ...change } } })
    if (locked) f.locked.add('a')
    const r = await handle(f.d, IP, good)
    assert.deepEqual(r, { status: 200, body: { ok: true } })
    assert.deepEqual(f.sent, sends ? ['a:pat@example.com'] : [], JSON.stringify(change))
    assert.equal(f.created.length, 0)
  }
})

test('createUser failing cleans up the pending row and says nothing about why', async () => {
  const refused = fake({ async createUser() { return { id: null, error: { status: 500, code: 'unexpected_failure', message: 'Database error saving new user' } } } })
  const r = await handle(refused.d, IP, good)
  assert.deepEqual(r, { status: 500, body: { error: MSG.failed } })
  assert.equal(refused.pending.size, 0)
  assert.deepEqual(refused.sent, [])

  const threw = fake({ async createUser() { throw new Error('network') } })
  await assert.rejects(handle(threw.d, IP, good))
  assert.equal(threw.pending.size, 0)
})

test('the confirm step is non-fatal: the account stands and the answer is still ok', async () => {
  const noSend = fake({ async sendConfirm() { return false } })
  assert.equal((await handle(noSend.d, IP, good)).status, 200)
  const sendThrows = fake({ async sendConfirm() { throw new Error('resend') } })
  assert.equal((await handle(sendThrows.d, IP, good)).status, 200)
  const markFails = fake({ async markConfirmPending() { throw new Error('db') } })
  assert.equal((await handle(markFails.d, IP, good)).status, 200)
  assert.deepEqual(markFails.sent, [])
  assert.equal(markFails.pending.size, 1) // the trigger consumes it on the real database
})

test('anything else is an unknown action', async () => {
  assert.equal((await handle(fake().d, IP, { action: 'nope' })).status, 400)
  assert.equal((await handle(fake().d, IP, {})).status, 400)
})
