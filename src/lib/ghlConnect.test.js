import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  readGhlSettings, readGhlKeySaved, bridgeDeployed, formFromSettings, checkForm, patchFromForm, sameForm,
  saveGhlSettings, sendGhlKey, testConnection, ago, connectStatus, ghlPlugged, GHL_KEY_NAME,
} from './ghlConnect.js'

const ROW = { enabled: true, location_id: 'l1C08ntBrFjLS0elLIYU', workflow_new_inbound: '9f1c2b3a-4d5e-4f60', workflow_appointment_reminder: null, workflow_no_show: null, workflow_opt_out: null, last_sync_at: '2026-11-05T18:00:00Z', last_sync_status: 'ok', last_sync_error: null }

// A fake supabase client that records what it was asked to do.
function fake({ row = ROW, selectErr = null, updated = [{ id: true }], updateErr = null, fn = { data: { success: true, secrets: [] }, error: null } } = {}) {
  const calls = { updates: [], invokes: [] }
  const sb = {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row, error: selectErr }) }) }),
      update: patch => { calls.updates.push(patch); return { eq: () => ({ select: async () => ({ data: updated, error: updateErr }) }) } },
    }),
    functions: { invoke: async (name, opts) => { calls.invokes.push({ name, opts }); if (fn instanceof Error) throw fn; return fn } },
  }
  return { sb, calls }
}

test('reads: row or null', async () => {
  assert.deepEqual(await readGhlSettings(fake().sb), ROW)
  assert.equal(await readGhlSettings(fake({ row: null }).sb), null)
  assert.equal(await readGhlSettings(fake({ selectErr: { code: '42P01' } }).sb), null)
})

test('key saved: from the secret list, null when unreadable', async () => {
  assert.equal(await readGhlKeySaved(fake({ fn: { data: { secrets: [{ key_name: GHL_KEY_NAME }] }, error: null } }).sb), true)
  assert.equal(await readGhlKeySaved(fake({ fn: { data: { secrets: [{ key_name: 'X' }] }, error: null } }).sb), false)
  assert.equal(await readGhlKeySaved(fake({ fn: { data: { capabilities: {} }, error: null } }).sb), null)
  assert.equal(await readGhlKeySaved(fake({ fn: new Error('offline') }).sb), null)
})

test('deployed = the bridge has run once', () => {
  assert.equal(bridgeDeployed(ROW), true)
  assert.equal(bridgeDeployed({ ...ROW, last_sync_at: null }), false)
  assert.equal(bridgeDeployed(null), false)
})

test('form checks and patch', () => {
  const f = formFromSettings(ROW)
  assert.deepEqual(checkForm(f), {})
  assert.deepEqual(patchFromForm({ ...f, locationId: ' l1C08ntBrFjLS0elLIYU ', workflows: { ...f.workflows, workflow_no_show: '  ' } }),
    { location_id: 'l1C08ntBrFjLS0elLIYU', workflow_new_inbound: '9f1c2b3a-4d5e-4f60', workflow_appointment_reminder: null, workflow_no_show: null, workflow_opt_out: null })
  assert.ok(checkForm({ ...f, locationId: '' }).locationId)
  assert.ok(checkForm({ ...f, locationId: 'bad id!' }).locationId)
  assert.ok(checkForm({ ...f, workflows: { ...f.workflows, workflow_opt_out: 'x' } }).workflow_opt_out)
  assert.ok(sameForm(f, formFromSettings(ROW)) && !sameForm(f, { ...f, locationId: 'abcdef12' }))
})

test('save settings: writes only the admin-editable columns, never the switch', async () => {
  const { sb, calls } = fake()
  assert.deepEqual(await saveGhlSettings(sb, formFromSettings(ROW)), { ok: true })
  assert.deepEqual(Object.keys(calls.updates[0]).sort(), ['location_id', 'workflow_appointment_reminder', 'workflow_new_inbound', 'workflow_no_show', 'workflow_opt_out'])
  assert.equal((await saveGhlSettings(fake().sb, { ...formFromSettings(ROW), locationId: '' })).ok, false)
  assert.equal((await saveGhlSettings(fake({ updated: [] }).sb, formFromSettings(ROW))).ok, false)
  assert.equal((await saveGhlSettings(fake({ updateErr: { message: 'x' } }).sb, formFromSettings(ROW))).ok, false)
})

test('key goes to the secret flow only, and no error echoes it', async () => {
  const { sb, calls } = fake()
  assert.deepEqual(await sendGhlKey(sb, '  pit-SECRET-1234  '), { ok: true })
  assert.equal(calls.invokes[0].name, 'fetch-secrets')
  assert.equal(calls.invokes[0].opts.method, 'POST')
  assert.equal(calls.invokes[0].opts.body.key_name, GHL_KEY_NAME)
  assert.equal(calls.invokes[0].opts.body.value, 'pit-SECRET-1234')
  assert.equal(calls.updates.length, 0)
  for (const bad of [fake({ fn: { data: null, error: { message: 'pit-SECRET-1234 boom' } } }), fake({ fn: new Error('pit-SECRET-1234') })]) {
    const r = await sendGhlKey(bad.sb, 'pit-SECRET-1234')
    assert.equal(r.ok, false)
    assert.ok(!JSON.stringify(r).includes('SECRET'))
  }
  assert.equal((await sendGhlKey(fake().sb, '  ')).ok, false)
})

test('Test connection stays disabled until the bridge is deployed', () => {
  assert.equal(testConnection({ ...ROW, last_sync_at: null }, true).enabled, false)
  assert.match(testConnection({ ...ROW, last_sync_at: null }, true).note, /deployed/)
  assert.equal(testConnection(null, null).enabled, false)
  assert.equal(testConnection({ ...ROW, location_id: null }, true).enabled, false)
  assert.equal(testConnection(ROW, false).enabled, false)
  assert.equal(testConnection(ROW, true).enabled, true)
  assert.equal(testConnection(ROW, null).enabled, true)
})

test('ago', () => {
  const now = Date.parse('2026-11-05T18:10:00Z')
  assert.equal(ago('2026-11-05T18:09:40Z', now), 'just now')
  assert.equal(ago('2026-11-05T18:05:00Z', now), '5 min ago')
  assert.equal(ago('2026-11-05T15:10:00Z', now), '3 h ago')
  assert.match(ago('2026-11-01T18:00:00Z', now), /Nov 1/)
  assert.equal(ago(null, now), '')
})

test('connect status words', () => {
  const now = Date.parse('2026-11-05T18:10:00Z')
  assert.equal(connectStatus(null, now).label, 'Not connected')
  assert.equal(connectStatus({ ...ROW, last_sync_at: null, last_sync_status: null }, now).label, 'Waiting for deploy')
  const c = connectStatus(ROW, now)
  assert.deepEqual([c.label, c.tone, c.line], ['Connected', 'green', 'Last sync 10 min ago'])
  assert.equal(connectStatus({ ...ROW, last_sync_status: 'error', last_sync_error: 'bad token' }, now).line, 'bad token')
})

test('plugged checks', () => {
  assert.deepEqual(ghlPlugged(ROW, true), [true, true])
  assert.deepEqual(ghlPlugged({ ...ROW, workflow_new_inbound: null }, null), [false, false])
  assert.deepEqual(ghlPlugged(null, false), [false, false])
})
