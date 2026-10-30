import test from 'node:test'
import assert from 'node:assert/strict'
import { needsCancellation } from './fulfillmentFlags.js'

test('only replaced_old_policy false is hidden from Fulfillment', () => {
  const rows = [{ id: 'y', replaced_old_policy: true }, { id: 'n', replaced_old_policy: false }, { id: 'old', replaced_old_policy: null }, { id: 'undef' }]
  assert.deepEqual(rows.filter(needsCancellation).map(r => r.id), ['y', 'old', 'undef'])
})
