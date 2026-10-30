/**
 * Node unit tests for the self-signup lock on invites. Database and senders are faked.
 * Run: node --test supabase/functions/send-agent-invite/logic.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { handle, type Caller, type Deps } from './logic.ts'
import { LOCKED_MESSAGE } from '../_shared/portalAccess.ts'

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
