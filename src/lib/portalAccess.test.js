// Who gets into the agent portal. These fail if someone loosens the unlock rule.
// Run: npm run test:unit   (or: node --test src/lib/portalAccess.test.js)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { billingAccess, portalState, gateView } from './portalAccess.js'

const NOW = Date.parse('2026-10-30T18:00:00Z')
const HOUR = 3600e3
const past = new Date(NOW - HOUR).toISOString()
const soon = new Date(NOW + 48 * HOUR).toISOString()

const agent = (over = {}) => ({ role: 'agent', billing_exempt: false, billing_status: 'none', signup_source: 'invite', ...over })
const selfAgent = (over = {}) => agent({ signup_source: 'self', ...over })
const on = { agent_billing_enforced: true }
const off = { agent_billing_enforced: false }

// What agent_portal_access returns for a self-signup (migration 190), by plan.
const nothing = { self: true, servicing: false, leads: false, unlocked: false }
const servicing = { self: true, servicing: true, leads: false, unlocked: true }
const leadsOnly = { self: true, servicing: false, leads: true, unlocked: true }
const both = { self: true, servicing: true, leads: true, unlocked: true }

// ── Invited agent: unchanged from before self-signup existed ────────────────
test('invited agent: flag off is never locked, whatever the billing status', () => {
  for (const billing_status of ['none', 'lapsed', 'past_due', 'canceled', undefined]) {
    const s = portalState(agent({ billing_status, billing_grace_until: past, billing_current_period_end: past }), null, off, NOW)
    assert.equal(s.locked, false, String(billing_status))
    assert.equal(s.servicing, true)
    assert.equal(s.self, false)
  }
  assert.equal(portalState(agent(), null, undefined, NOW).locked, false, 'no settings row = flag off')
})

test('invited agent: flag on, active is open', () => {
  assert.deepEqual(billingAccess(agent({ billing_status: 'active' }), true, NOW), { locked: false, grace: false })
})

test('invited agent: flag on, status none is locked', () => {
  const s = portalState(agent({ billing_status: 'none' }), null, on, NOW)
  assert.equal(s.locked, true)
  assert.equal(s.servicing, false)
  assert.equal(s.self, false)
})

test('invited agent: flag on, a missing or unknown status is locked', () => {
  for (const billing_status of [undefined, null, '', 'lapsed', 'unpaid']) {
    assert.equal(billingAccess(agent({ billing_status }), true, NOW).locked, true, String(billing_status))
  }
})

test('invited agent: flag on, past_due inside the grace period is open with the grace banner', () => {
  assert.deepEqual(billingAccess(agent({ billing_status: 'past_due', billing_grace_until: soon }), true, NOW), { locked: false, grace: true })
})

test('invited agent: flag on, past_due after the grace period (or with none) is locked', () => {
  assert.deepEqual(billingAccess(agent({ billing_status: 'past_due', billing_grace_until: past }), true, NOW), { locked: true, grace: false })
  assert.equal(billingAccess(agent({ billing_status: 'past_due', billing_grace_until: null }), true, NOW).locked, true)
})

test('invited agent: flag on, canceled inside the paid period is open', () => {
  assert.deepEqual(billingAccess(agent({ billing_status: 'canceled', billing_current_period_end: soon }), true, NOW), { locked: false, grace: false })
})

test('invited agent: flag on, canceled after the paid period (or with none) is locked', () => {
  assert.equal(billingAccess(agent({ billing_status: 'canceled', billing_current_period_end: past }), true, NOW).locked, true)
  assert.equal(billingAccess(agent({ billing_status: 'canceled', billing_current_period_end: null }), true, NOW).locked, true)
})

test('invited agent: the access answer is ignored, only the billing flag counts', () => {
  assert.equal(portalState(agent({ billing_status: 'active' }), nothing, on, NOW).locked, false)
  assert.equal(portalState(agent({ billing_status: 'none' }), servicing, on, NOW).locked, true)
})

test('a missing signup_source is treated as invited, not as self-signup', () => {
  const s = portalState(agent({ signup_source: undefined, billing_status: 'none' }), null, off, NOW)
  assert.equal(s.locked, false)
  assert.equal(s.self, false)
})

// ── Self-signup: locked until the database says unlocked ────────────────────
test('self-signup: no plan (status none) is locked', () => {
  const s = portalState(selfAgent({ billing_status: 'none' }), nothing, on, NOW)
  assert.equal(s.locked, true)
  assert.equal(s.self, true)
  assert.equal(s.servicing, false)
  assert.equal(s.unknown, false)
})

test('self-signup: the billing flag being off does not open it', () => {
  assert.equal(portalState(selfAgent({ billing_status: 'none' }), nothing, off, NOW).locked, true)
  assert.equal(portalState(selfAgent(), nothing, undefined, NOW).locked, true)
})

test('self-signup: a lapsed payer (past_due after grace) is locked', () => {
  const s = portalState(selfAgent({ billing_status: 'past_due', billing_grace_until: past }), nothing, on, NOW)
  assert.equal(s.locked, true)
  assert.equal(s.grace, false)
})

test('self-signup: canceled after the paid period is locked', () => {
  const s = portalState(selfAgent({ billing_status: 'canceled', billing_current_period_end: past }), nothing, on, NOW)
  assert.equal(s.locked, true)
})

test('self-signup: access unknown (missing, errored, or odd answer) is locked', () => {
  for (const access of [null, undefined, 'unknown', {}, { unlocked: 'true' }, { unlocked: 1 }]) {
    const s = portalState(selfAgent({ billing_status: 'active' }), access, off, NOW)
    assert.equal(s.locked, true, JSON.stringify(access))
    assert.equal(s.unknown, true, JSON.stringify(access))
    assert.equal(s.servicing, false)
    assert.equal(s.self, true)
  }
})

test('self-signup: a profile that looks paid cannot open it when the database says no', () => {
  assert.equal(portalState(selfAgent({ billing_status: 'active' }), nothing, off, NOW).locked, true)
})

test('self-signup: active is open with Servicing', () => {
  const s = portalState(selfAgent({ billing_status: 'active' }), servicing, on, NOW)
  assert.deepEqual(s, { locked: false, grace: false, servicing: true, leads: false, needsServicing: false, self: true, unknown: false })
})

test('self-signup: past_due inside the grace period is open with the grace banner', () => {
  const s = portalState(selfAgent({ billing_status: 'past_due', billing_grace_until: soon }), servicing, on, NOW)
  assert.equal(s.locked, false)
  assert.equal(s.grace, true)
})

test('self-signup: canceled inside the paid period is open, with no grace banner', () => {
  const s = portalState(selfAgent({ billing_status: 'canceled', billing_current_period_end: soon }), servicing, on, NOW)
  assert.equal(s.locked, false)
  assert.equal(s.grace, false)
})

test('self-signup: billing_exempt is open, even if the access answer is missing', () => {
  for (const access of [nothing, null, 'unknown']) {
    const s = portalState(selfAgent({ billing_exempt: true }), access, on, NOW)
    assert.equal(s.locked, false)
    assert.equal(s.servicing, true)
  }
})

test('self-signup: leads active (with Servicing too) is open', () => {
  const s = portalState(selfAgent({ billing_status: 'active' }), both, on, NOW)
  assert.equal(s.locked, false)
  assert.equal(s.leads, true)
  assert.equal(s.needsServicing, false)
})

test('self-signup: a Leads-only payer is open but needsServicing', () => {
  const s = portalState(selfAgent({ billing_status: 'none' }), leadsOnly, on, NOW)
  assert.equal(s.locked, false)
  assert.equal(s.leads, true)
  assert.equal(s.servicing, false)
  assert.equal(s.needsServicing, true)
})

test('a locked self-signup is never reported as needing Servicing (it needs a plan)', () => {
  assert.equal(portalState(selfAgent(), nothing, on, NOW).needsServicing, false)
})

// ── Everyone else is never locked ───────────────────────────────────────────
test('fulfillment is never locked', () => {
  for (const signup_source of ['invite', 'self', undefined]) {
    const s = portalState({ role: 'fulfillment', billing_status: 'none', signup_source }, nothing, on, NOW)
    assert.equal(s.locked, false, String(signup_source))
    assert.equal(s.servicing, true)
  }
  assert.equal(billingAccess({ role: 'fulfillment', billing_status: 'none' }, true, NOW).locked, false)
})

test('admin is never locked', () => {
  for (const signup_source of ['invite', 'self', undefined]) {
    const s = portalState({ role: 'admin', billing_status: 'none', signup_source }, null, on, NOW)
    assert.equal(s.locked, false, String(signup_source))
  }
  assert.equal(billingAccess({ role: 'admin', billing_status: 'none' }, true, NOW).locked, false)
})

test('no profile (not loaded yet) is not locked', () => {
  assert.equal(portalState(null, null, on, NOW).locked, false)
  assert.equal(portalState(undefined, 'unknown', on, NOW).locked, false)
})

test('a comped agent (billing_exempt) is never locked', () => {
  assert.equal(portalState(agent({ billing_exempt: true }), null, on, NOW).locked, false)
})

// ── What each page shows ────────────────────────────────────────────────────
test('gateView: a locked self-signup sees the welcome page everywhere but Billing, Settings, Leads and More', () => {
  const s = portalState(selfAgent(), nothing, on, NOW)
  for (const p of ['/agent', '/agent/book', '/agent/submit', '/agent/clients', '/agent/activity', '/messages']) {
    assert.equal(gateView(s, p), 'welcome', p)
  }
  for (const p of ['/settings', '/agent/billing', '/agent/leads', '/agent/more']) {
    assert.equal(gateView(s, p), 'open', p)
  }
})

test('gateView: a locked invited agent sees the paused page, with Billing, Settings and Leads reachable', () => {
  const s = portalState(agent(), null, on, NOW)
  assert.equal(gateView(s, '/agent'), 'paused')
  assert.equal(gateView(s, '/agent/book'), 'paused')
  assert.equal(gateView(s, '/settings'), 'open')
  assert.equal(gateView(s, '/agent/billing'), 'open')
  assert.equal(gateView(s, '/agent/leads'), 'open')
  assert.equal(gateView(s, '/agent/more'), 'paused', 'More is only open for a self-signup')
})

test('gateView: a Leads-only payer is told to add Servicing on Book and Clients only', () => {
  const s = portalState(selfAgent(), leadsOnly, on, NOW)
  assert.equal(gateView(s, '/agent/book'), 'servicing'); assert.equal(gateView(s, '/agent/submit'), 'servicing')
  assert.equal(gateView(s, '/agent/clients'), 'servicing')
  assert.equal(gateView(s, '/agent'), 'open')
  assert.equal(gateView(s, '/agent/leads'), 'open')
})

test('gateView: an unlocked agent sees every page', () => {
  const s = portalState(selfAgent({ billing_status: 'active' }), servicing, on, NOW)
  for (const p of ['/agent', '/agent/book', '/agent/submit', '/agent/clients', '/agent/billing']) assert.equal(gateView(s, p), 'open', p)
})
