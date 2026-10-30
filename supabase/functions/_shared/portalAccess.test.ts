/**
 * Node unit tests for the paid-function guard. The database is faked.
 * Run: node --test supabase/functions/_shared/portalAccess.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isLockedSelfSignup } from './portalAccess.ts'

type Err = { code?: string } | null

function db(profile: unknown, access: unknown = null, errs: { profile?: Err; rpc?: Err } = {}) {
  const calls: string[] = []
  const chain = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: async () => ({ data: errs.profile ? null : profile, error: errs.profile ?? null }),
  }
  return {
    calls,
    from(table: string) { calls.push(`from:${table}`); return chain },
    async rpc(fn: string) { calls.push(`rpc:${fn}`); return { data: errs.rpc ? null : access, error: errs.rpc ?? null } },
  }
}

const self = { role: 'agent', signup_source: 'self' }

test('a self-signup agent who is not unlocked is locked', async () => {
  assert.equal(await isLockedSelfSignup(db(self, { unlocked: false }), 'u'), true)
})

test('a self-signup agent who is unlocked is not locked', async () => {
  assert.equal(await isLockedSelfSignup(db(self, { unlocked: true }), 'u'), false)
})

test('invited agents, fulfillment and admin are never locked, and skip the access lookup', async () => {
  for (const p of [
    { role: 'agent', signup_source: 'invite' },
    { role: 'agent', signup_source: null },
    { role: 'agent' },
    { role: 'fulfillment', signup_source: 'invite' },
    { role: 'fulfillment', signup_source: 'self' },
    { role: 'admin', signup_source: null },
    { role: 'admin', signup_source: 'self' },
    null,
  ]) {
    const d = db(p, { unlocked: false }, { rpc: { code: 'XX000' } })
    assert.equal(await isLockedSelfSignup(d, 'u'), false, JSON.stringify(p))
    assert.ok(!d.calls.includes('rpc:agent_portal_access'), JSON.stringify(p))
  }
})

test('fails closed for a self-signup agent when the access lookup errors or answers oddly', async () => {
  assert.equal(await isLockedSelfSignup(db(self, null, { rpc: { code: 'PGRST202' } }), 'u'), true)
  assert.equal(await isLockedSelfSignup(db(self, null), 'u'), true)
  assert.equal(await isLockedSelfSignup(db(self, { unlocked: 'true' }), 'u'), true)
  assert.equal(await isLockedSelfSignup(db(self, {}), 'u'), true)
})

test('a failed profile read fails closed, except when the migration is not applied yet', async () => {
  assert.equal(await isLockedSelfSignup(db(null, null, { profile: { code: 'PGRST301' } }), 'u'), true)
  assert.equal(await isLockedSelfSignup(db(null, null, { profile: { code: '42703' } }), 'u'), false)
})
