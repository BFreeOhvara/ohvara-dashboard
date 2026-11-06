import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ghlStatus, validLocationId, validWorkflowId, GHL_EVENTS } from './ghlStatus.js'

const S = { enabled: true, location_id: 'l1C08ntBrFjLS0elLIYU', last_sync_status: 'ok', last_sync_at: '2026-11-05T18:00:00Z', last_sync_error: null }

test('status ladder', () => {
  assert.equal(ghlStatus(null).key, 'not_connected')
  assert.equal(ghlStatus({ ...S, location_id: null }, { deployed: true }).key, 'not_connected')
  assert.equal(ghlStatus(S).key, 'waiting_for_deploy')
  assert.equal(ghlStatus({ ...S, enabled: false }, { deployed: true }).key, 'off')
  assert.equal(ghlStatus({ ...S, last_sync_status: 'not_configured' }, { deployed: true }).key, 'not_connected')
  const err = ghlStatus({ ...S, last_sync_status: 'error', last_sync_error: 'GHL POST contacts: Invalid JWT' }, { deployed: true })
  assert.equal(err.key, 'error')
  assert.equal(err.detail, 'GHL POST contacts: Invalid JWT')
  assert.deepEqual(ghlStatus(S, { deployed: true }), { key: 'connected', label: 'Connected', detail: 'Last sync', at: S.last_sync_at })
})

test('ID checks match migration 230', () => {
  assert.ok(validLocationId('l1C08ntBrFjLS0elLIYU'))
  assert.ok(!validLocationId('bad id!'))
  assert.ok(!validLocationId(''))
  assert.ok(validWorkflowId(null) && validWorkflowId('') && validWorkflowId('9f1c2b3a-4d5e-4f60'))
  assert.ok(!validWorkflowId('x'))
  assert.equal(GHL_EVENTS.length, 4)
})
