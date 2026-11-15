// P1013 — test/demo accounts and agents who signed up but never paid stay out of everyone's Messages, lists and
// numbers (the database decides: migration 276); the admin finds a non-paying sign-up only under Agents.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildAdmState } from './lib/admReal.js'
import { isTestProfile } from './lib/testAccounts.js'

const src = f => readFileSync(new URL(f, import.meta.url), 'utf8')
const p = (id, o = {}) => ({ id, role: 'agent', full_name: id, email: `${id}@x.invalid`, created_at: '2026-11-12T15:00:00Z', ...o })

test('the server marks who is listed; a non-paying sign-up only shows under "Signed up, not paying", with its date', () => {
  const raw = {
    profiles: [p('a-paid'), p('a-new', { signup_source: 'invite' }), p('a-busy', { signup_source: 'self' }), p('v-1', { role: 'fulfillment' })],
    activity: [{ agent_id: 'a-paid', paying: true, active: true, listed: true },
      { agent_id: 'a-new', paying: false, active: false, listed: false },
      { agent_id: 'a-busy', paying: false, active: true, listed: false }],
    leads: [{ id: 'l1', assigned_rep_id: 'a-paid', created_at: '2026-11-14T15:00:00Z', lead_type: 'mortgage_protection' },
      { id: 'l2', assigned_rep_id: 'a-new', created_at: '2026-11-14T15:00:00Z', lead_type: 'mortgage_protection' },
      { id: 'l3', assigned_rep_id: 'gone-test-agent', created_at: '2026-11-14T15:00:00Z', lead_type: 'mortgage_protection' }],
  }
  const s = buildAdmState(raw)
  assert.deepEqual(s.agents.map(a => a.id), ['a-paid'])
  assert.deepEqual(s.idleSignups.map(a => a.id).sort(), ['a-busy', 'a-new'])
  assert.ok(s.idleSignups.every(a => a.idle && a.joined))
  assert.deepEqual(s.vas.map(v => v.id), ['v-1'])
  // a test account's row (its person isn't on the server's people list) and a non-paying agent's row stay out
  assert.deepEqual(s.leads.map(l => l.id), ['l1'])
})

test('test accounts: the flag only, no client-side id list', () => {
  assert.equal(isTestProfile({ id: 'x', is_test: true }), true)
  assert.equal(isTestProfile({ id: '3f2b2df7-40b1-4921-80e2-09981c819642' }), false)
  assert.equal(/excludeTestAccounts|TEST_ACCOUNT_IDS/.test(src('./lib/testAccounts.js')), false)
})

test('the filter is named "Signed up, not paying" on desktop and phone and shows the sign-up date', () => {
  for (const f of ['./adminshell/screens/Agents.jsx', './adminshell/m/AAgents.jsx']) {
    assert.match(src(f), /Signed up, not paying/, f)
    assert.match(src(f), /Signed up \$\{a\.joined/, f)
  }
})

test('migration 276: the directory, Messages lines and people lists are filtered in the database', () => {
  const m = src('../supabase/migrations/276_hidden_accounts.sql')
  assert.match(m, /create policy profiles_select/)
  for (const f of ['my_standing_threads', 'va_agent_roster', 'on_duty_agents', 'team_activity', 'agent_activity_feed', 'va_shift_week',
    'va_shifts_today', 'admin_list_profiles', 'admin_agent_activity', 'admin_ad_costs', 'admin_lead_pauses', 'admin_unreachable_agents']) {
    assert.match(m, new RegExp(`rename to ${f}_p1013`), f)
  }
})
