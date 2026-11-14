// P999 — Sign in with Apple / Google helpers and the admin "Signed up, not active" split.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { versionAtLeast, parseAuthReturn, oauthErrorText, needsTerms } from './lib/oauthCore.js'
import { buildAdmState } from './lib/admReal.js'

test('the app shows Apple / Google only from 1.2', () => {
  assert.equal(versionAtLeast('1.1', '1.2'), false)
  assert.equal(versionAtLeast('1.2', '1.2'), true)
  assert.equal(versionAtLeast('1.10', '1.2'), true)
  assert.equal(versionAtLeast('2', '1.2'), true)
  assert.equal(versionAtLeast(undefined, '1.2'), false)
})

test('the return link gives a session or a plain-words error', () => {
  assert.deepEqual(parseAuthReturn('ohvara://auth#access_token=a&refresh_token=r&expires_in=3600'), { access_token: 'a', refresh_token: 'r' })
  assert.deepEqual(parseAuthReturn('https://portal.ohvara.com/login?error=server_error&error_description=Database+error+saving+new+user'),
    { error: 'Database error saving new user' })
  assert.equal(parseAuthReturn('https://portal.ohvara.com/login'), null)
  assert.match(oauthErrorText('Database error saving new user'), /no Ohvara account for that email/)
  assert.equal(oauthErrorText('access_denied'), 'Sign-in was cancelled.')
})

test('only a self-signup agent without terms gets the terms step', () => {
  assert.equal(needsTerms({ role: 'agent', signup_source: 'self', terms_accepted_at: null }), true)
  assert.equal(needsTerms({ role: 'agent', signup_source: 'self', terms_accepted_at: '2026-11-14' }), false)
  assert.equal(needsTerms({ role: 'agent', signup_source: 'invite', terms_accepted_at: null }), false)
  assert.equal(needsTerms({ role: 'admin', signup_source: 'self' }), false)
  assert.equal(needsTerms(null), false)
})

test('admin: sign-ups that did nothing leave the agent list; invited agents and unknown activity always show', () => {
  const p = (id, o = {}) => ({ id, role: 'agent', full_name: id, email: `${id}@x.invalid`, created_at: '2026-11-01T00:00:00Z', ...o })
  const raw = {
    profiles: [p('a-paid', { signup_source: 'self' }), p('a-idle', { signup_source: 'self' }), p('a-busy', { signup_source: 'self' }),
      p('a-invited', { signup_source: 'invite' }), p('a-unknown', { signup_source: 'self' })],
    activity: [{ agent_id: 'a-paid', paying: true, active: false }, { agent_id: 'a-idle', paying: false, active: false },
      { agent_id: 'a-busy', paying: false, active: true }, { agent_id: 'a-invited', paying: false, active: false }],
  }
  const s = buildAdmState(raw)
  assert.deepEqual(s.agents.map(a => a.id).sort(), ['a-busy', 'a-invited', 'a-paid', 'a-unknown'])
  assert.deepEqual(s.idleSignups.map(a => a.id), ['a-idle'])
  assert.equal(s.idleSignups[0].idle, true)
  assert.deepEqual(buildAdmState({ profiles: raw.profiles }).idleSignups, [])
})
