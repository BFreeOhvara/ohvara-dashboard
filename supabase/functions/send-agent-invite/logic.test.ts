/**
 * Node unit tests for the self-signup lock on invites. Database and senders are faked.
 * Run: node --test supabase/functions/send-agent-invite/logic.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { handle, type Caller, type Deps } from './logic.ts'
import { LOCKED_MESSAGE, isLockedSelfSignup } from '../_shared/portalAccess.ts'

function fake(caller: Caller, locked: boolean) {
  const touched: string[] = []
  const note = (name: string) => { touched.push(name) }
  const d: Deps = {
    env: { resendKey: 'k', fromEmail: 'from@example.com' },
    async caller() { return caller },
    async lockedSelfSignup() { return locked },
    async smsLive() { return false },
    async countSent() { note('countSent'); return 0 },
    async emailHasAccount() { note('emailHasAccount'); return false },
    async expireLive() { note('expireLive') },
    async insertInvite() { note('insertInvite'); return 'inv' },
    async deleteInvite() { note('deleteInvite') },
    fetch: (async () => { note('fetch'); return new Response('{}') }) as typeof fetch,
    randomBytes: n => new Uint8Array(n),
    now: () => new Date('2026-10-30T18:00:00Z'),
    log: () => {},
  }
  return { d, touched }
}

const agent: Caller = { id: 'a', role: 'agent', is_active: true, full_name: 'Pat Rivers' }
const send = { action: 'send', channel: 'email', to: 'friend@example.com' }

test('a locked self-signup agent is refused before anything is checked, created or sent', async () => {
  const { d, touched } = fake(agent, true)
  assert.deepEqual(await handle(d, 'jwt', send), { status: 403, body: { error: LOCKED_MESSAGE } })
  assert.deepEqual(touched, [])
  assert.equal(LOCKED_MESSAGE, 'Choose a plan to unlock your portal before inviting people.')
})

test('a locked agent can still read the channel status, so the form can show the message', async () => {
  const { d, touched } = fake(agent, true)
  const r = await handle(d, 'jwt', { action: 'status' })
  assert.equal(r.status, 200)
  assert.deepEqual(touched, [])
})

test('an agent who is not locked sends exactly as before', async () => {
  const { d, touched } = fake(agent, false)
  assert.deepEqual(await handle(d, 'jwt', send), { status: 200, body: { ok: true } })
  assert.ok(touched.includes('insertInvite'))
  assert.ok(touched.includes('fetch'))
})

test('admin sends exactly as before', async () => {
  const { d, touched } = fake({ ...agent, role: 'admin' }, false)
  assert.deepEqual(await handle(d, 'jwt', { ...send, role: 'fulfillment' }), { status: 200, body: { ok: true } })
  assert.ok(touched.includes('insertInvite'))
})

// ── The same checks with the real guard (_shared/portalAccess.ts) in front of a fake database ──

// A service-role client that answers for one profile and one agent_portal_access result.
function guardDb(profile: unknown, access: unknown, rpcError: { code: string } | null = null) {
  const chain = { select: () => chain, eq: () => chain, maybeSingle: async () => ({ data: profile, error: null }) }
  return {
    from: () => chain,
    rpc: async () => ({ data: rpcError ? null : access, error: rpcError }),
  }
}

function wired(caller: Caller, profile: unknown, access: unknown, rpcError: { code: string } | null = null) {
  const f = fake(caller, false)
  const db = guardDb(profile, access, rpcError)
  f.d.lockedSelfSignup = id => isLockedSelfSignup(db, id)
  return f
}

test('real guard: a locked self-signup caller is refused on email and on text, before any write or send', async () => {
  for (const body of [send, { action: 'send', channel: 'sms', to: '5125550123' }]) {
    const { d, touched } = wired(agent, { role: 'agent', signup_source: 'self' }, { unlocked: false })
    assert.deepEqual(await handle(d, 'jwt', body), { status: 403, body: { error: LOCKED_MESSAGE } })
    assert.deepEqual(touched, [], 'no count, lookup, insert, delete or fetch happened')
  }
})

test('real guard: a self-signup caller whose access cannot be read is refused before any write', async () => {
  const { d, touched } = wired(agent, { role: 'agent', signup_source: 'self' }, null, { code: 'PGRST202' })
  assert.deepEqual(await handle(d, 'jwt', send), { status: 403, body: { error: LOCKED_MESSAGE } })
  assert.deepEqual(touched, [])
})

test('real guard: an unlocked self-signup agent sends the invite', async () => {
  const { d, touched } = wired(agent, { role: 'agent', signup_source: 'self' }, { unlocked: true })
  assert.deepEqual(await handle(d, 'jwt', send), { status: 200, body: { ok: true } })
  assert.ok(touched.includes('insertInvite'))
  assert.ok(touched.includes('fetch'))
})

test('real guard: an invited agent sends the invite, even though their access would read as not unlocked', async () => {
  for (const signup_source of ['invite', null]) {
    const { d, touched } = wired(agent, { role: 'agent', signup_source }, { unlocked: false })
    assert.deepEqual(await handle(d, 'jwt', send), { status: 200, body: { ok: true } })
    assert.ok(touched.includes('insertInvite'))
  }
})

test('real guard: an admin sends the invite', async () => {
  const admin = { ...agent, role: 'admin' }
  const { d, touched } = wired(admin, { role: 'admin', signup_source: 'self' }, { unlocked: false })
  assert.deepEqual(await handle(d, 'jwt', { ...send, role: 'fulfillment' }), { status: 200, body: { ok: true } })
  assert.ok(touched.includes('insertInvite'))
})
