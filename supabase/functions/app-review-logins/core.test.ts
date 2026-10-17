/**
 * Node unit tests for the App Review logins (Prompt 775). Supabase is mocked.
 * Run: node --test supabase/functions/app-review-logins/core.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { handle, makePassword, DEMO, type Deps } from './core.ts'

function deps(callerRole: string | null, existing: Record<string, string> = {}, over: Partial<Deps> = {}) {
  const log: string[] = []
  let n = 0
  const d: Deps = {
    async caller(jwt) { return jwt === 'good' && callerRole ? { id: 'me', role: callerRole, is_active: true, is_demo: false } : null },
    async findByEmail(email) { return existing[email] ?? null },
    async createUser(email, _pw, role) { log.push(`create:${role}`); return `new-${role}` },
    async setPassword(id) { log.push(`reset:${id}`) },
    async seed(a, r) { log.push(`seed:${a}:${r}`) },
    password: () => `pw${++n}`,
    ...over,
  }
  return { d, log }
}
const req = (body: unknown, jwt = 'good') => new Request('https://x/functions/v1/app-review-logins', {
  method: 'POST', headers: { Authorization: `Bearer ${jwt}` }, body: JSON.stringify(body),
})

test('admins only', async () => {
  for (const role of ['agent', 'fulfillment']) {
    const { d, log } = deps(role)
    assert.equal((await handle(req({ action: 'reset' }), d)).status, 403)
    assert.deepEqual(log, [])
  }
  assert.equal((await handle(req({ action: 'reset' }, 'bad'), deps('admin').d)).status, 401)
  const demoAdmin = deps('admin', {}, { async caller() { return { id: 'x', role: 'admin', is_active: true, is_demo: true } } })
  assert.equal((await handle(req({ action: 'reset' }), demoAdmin.d)).status, 403)
})

test('status says whether they exist, never a password', async () => {
  const { d } = deps('admin', { [DEMO.agent.email]: 'a1' })
  const body = await (await handle(req({ action: 'status' }), d)).json()
  assert.deepEqual(body, { agent: { email: DEMO.agent.email, exists: true }, fulfillment: { email: DEMO.fulfillment.email, exists: false } })
  assert.ok(!JSON.stringify(body).includes('pw'))
})

test('reset: makes missing accounts, resets existing ones, seeds, returns new passwords once', async () => {
  const { d, log } = deps('admin', { [DEMO.agent.email]: 'a1' })
  const res = await handle(req({ action: 'reset' }), d)
  assert.equal(res.status, 200)
  assert.equal(res.headers.get('Cache-Control'), 'no-store')
  const body = await res.json()
  assert.deepEqual(body.agent, { email: DEMO.agent.email, password: 'pw1' })
  assert.deepEqual(body.fulfillment, { email: DEMO.fulfillment.email, password: 'pw2' })
  assert.deepEqual(log, ['reset:a1', 'create:fulfillment', 'seed:a1:new-fulfillment'])
})

test('a failure answers 500 without passwords', async () => {
  const { d } = deps('admin', {}, { async seed() { throw new Error('nope') } })
  const res = await handle(req({ action: 'reset' }), d)
  assert.equal(res.status, 500)
  assert.ok(!(await res.text()).includes('pw'))
})

test('passwords: 20 chars from the no-look-alike set, all different', () => {
  const seen = new Set<string>()
  for (let i = 0; i < 200; i++) {
    const p = makePassword()
    assert.match(p, /^[A-HJ-NP-Za-km-np-z2-9]{20}$/)
    seen.add(p)
  }
  assert.equal(seen.size, 200)
})
