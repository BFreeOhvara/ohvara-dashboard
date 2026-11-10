/**
 * P939: the saved-secrets reader. Round trip with the same cipher fetch-secrets writes with; the saved value wins,
 * the env value is the fallback; a value that can't be decrypted is skipped; no value ever appears in a log line.
 * Run: node --test supabase/functions/_shared/secretStore.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { encryptValue, decryptValue, readSecrets, type SecretsDb } from './secretStore.ts'

const ENC = 'test-encryption-key-0123456789'
const fakeDb = (rows: { key_name: string; encrypted_value: string }[] | 'throws'): SecretsDb => ({
  from: () => ({ select: () => ({ in: async (_c, names) => {
    if (rows === 'throws') throw new Error('no table')
    return { data: rows.filter(r => names.includes(r.key_name)), error: null }
  } }) }),
})

test('encrypt then decrypt round-trips; the stored text hides the value', async () => {
  const enc = await encryptValue(ENC, 'pit-abc-123')
  assert.ok(!enc.includes('pit-abc-123'))
  assert.equal(await decryptValue(ENC, enc), 'pit-abc-123')
})

test('no encryption key (under 16 chars): nothing is sealed or opened', async () => {
  await assert.rejects(() => encryptValue('short', 'x'))
})

test('saved value wins over the env value', async () => {
  const row = { key_name: 'GHL_API_KEY', encrypted_value: await encryptValue(ENC, 'saved-one') }
  const r = await readSecrets(fakeDb([row]), ['GHL_API_KEY'], { encKey: ENC, env: () => 'env-one' })
  assert.equal(r.GHL_API_KEY, 'saved-one')
})

test('nothing saved: the env value is the fallback; neither: undefined', async () => {
  assert.equal((await readSecrets(fakeDb([]), ['GHL_API_KEY'], { encKey: ENC, env: () => 'env-one' })).GHL_API_KEY, 'env-one')
  assert.equal((await readSecrets(fakeDb([]), ['GHL_API_KEY'], { encKey: ENC, env: () => undefined })).GHL_API_KEY, undefined)
  assert.equal((await readSecrets(fakeDb([]), ['GHL_API_KEY'], { encKey: ENC, env: () => '  ' })).GHL_API_KEY, undefined)
})

test('unreadable table falls back to the env value', async () => {
  assert.equal((await readSecrets(fakeDb('throws'), ['GHL_API_KEY'], { encKey: ENC, env: () => 'env-one' })).GHL_API_KEY, 'env-one')
})

test('a saved value that will not decrypt is skipped and the log names the key, not the value', async () => {
  const row = { key_name: 'GHL_API_KEY', encrypted_value: await encryptValue('another-encryption-key-999', 'saved-one') }
  const logs: string[] = []
  const r = await readSecrets(fakeDb([row]), ['GHL_API_KEY'], { encKey: ENC, env: () => undefined, log: m => logs.push(m) })
  assert.equal(r.GHL_API_KEY, undefined)
  assert.equal(logs.length, 1)
  assert.match(logs[0], /GHL_API_KEY/)
  assert.ok(!logs[0].includes('saved-one') && !logs[0].includes(row.encrypted_value))
})

test('saved but SECRETS_ENCRYPTION_KEY missing: falls back, logs without the value', async () => {
  const row = { key_name: 'GHL_API_KEY', encrypted_value: await encryptValue(ENC, 'saved-one') }
  const logs: string[] = []
  const r = await readSecrets(fakeDb([row]), ['GHL_API_KEY'], { encKey: undefined, env: () => 'env-one', log: m => logs.push(m) })
  assert.equal(r.GHL_API_KEY, 'env-one')
  assert.ok(logs.every(l => !l.includes('saved-one')))
})
