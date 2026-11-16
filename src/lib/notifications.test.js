import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ROLE_TYPES, TYPE_INFO, TYPE_KIND, sampleRows, sampleSettings, appLink, toItem, whereWords } from './notifications.js'

// P1023 — exactly Brayden's lists, one sample of each, links that open today's pages.
test('each role has exactly its list, every type has a label and a look', () => {
  assert.equal(ROLE_TYPES.agent.length, 8)
  assert.equal(ROLE_TYPES.fulfillment.length, 13) // 12 items; "booked call starting" is two types (5 min, handed to you)
  assert.equal(ROLE_TYPES.admin.length, 8)
  for (const t of Object.values(ROLE_TYPES).flat()) { assert.ok(TYPE_INFO[t], t); assert.ok(TYPE_KIND[t], t) }
})

test('urgent ones cannot be muted; email only for your payment failed and something broke', () => {
  const all = ['agent', 'fulfillment', 'admin'].flatMap(sampleSettings)
  assert.deepEqual(all.filter(r => !r.can_mute).map(r => r.type).sort(),
    ['billing_charge_failed', 'billing_payment_problem', 'call_not_started', 'client_payment_failed', 'live_transfer', 'va_ring', 'va_save_call'])
  assert.deepEqual([...new Set(all.filter(r => r.email).map(r => r.type))].sort(), ['billing_charge_failed', 'job_failed'])
  assert.equal(whereWords(all.find(r => r.type === 'live_transfer')), 'Rings your phone, Yes / No')
  assert.equal(whereWords(all.find(r => r.type === 'billing_charge_failed')), 'Phone + Bell + Email')
})

test('sample bell: the bell types for the role, each opening a page', () => {
  for (const role of ['agent', 'fulfillment', 'admin']) {
    const rows = sampleRows(role)
    const inBell = ROLE_TYPES[role].filter(t => !['live_transfer', 'va_ring'].includes(t))
    assert.deepEqual([...new Set(rows.map(r => r.type))].sort(), [...inBell].sort(), role)
    for (const r of rows) assert.ok(toItem(r, role).to, r.type)
  }
})

test('old links open today’s pages', () => {
  assert.equal(appLink('/billing?fix=1', 'agent'), '/agent/billing')
  assert.equal(appLink('/fulfillment/desk?open=0e4a7d2c-1111-4222-8333-444455556666', 'fulfillment'), '/fulfillment/calendar/0e4a7d2c-1111-4222-8333-444455556666')
  assert.equal(appLink('/admin/users?user=x', 'admin'), '/admin/agents')
  assert.equal(appLink('https://evil.example', 'agent'), null)
  assert.equal(appLink('//evil.example', 'agent'), null)
})
