/**
 * P886 — doc-sign: token checks, what the page sees (no internals), consent + typed name, the last signer stamps and
 * stores the PDF, decline, uploads (type, size, path on the policy, hash), errors in plain words.
 * No network, no database. Run: node --test supabase/functions/doc-sign/core.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { handle, publicView, validToken, sha256Hex, bytesToB64, b64ToBytes, type Store, type View, type Signer } from './core.ts'

const T = 'a'.repeat(48)
const base: View = {
  state: 'sign', mode: 'sign', signer_id: 's1', document_id: 'doc1', policy_id: 'pol1', name: 'Tom Fry', role: 'owner',
  title: 'Change of beneficiary', doc_type: 'beneficiary_change', carrier: 'New Life', storage_path: 'templates/x/ben.pdf',
  template_id: 't1', prefill: { policy_number: 'NL-1' }, fields: [{ key: 'policy_number', x: 1, y: 2 }],
  others: [{ role: 'irrevocable_beneficiary', name: 'Jo Fry', signed: false }],
}

function fake(view: View = base, allSigned = false) {
  const calls: Record<string, unknown[]> = {}
  const log = (k: string, ...a: unknown[]) => { (calls[k] ??= []).push(a) }
  const store: Store = {
    async view(t) { log('view', t); return view },
    async sign(t, name, consent, ip, ua) {
      log('sign', t, name, consent, ip, ua)
      const signers: Signer[] = [{ role: 'owner', name: 'Tom Fry', signed_name: name, signed_at: 'now', ip, ua, consent_version: 'esign-v1' }]
      return { all_signed: allSigned, document_id: 'doc1', policy_id: 'pol1', signers }
    },
    async decline(t, r) { log('decline', t, r) },
    async render(v, s) { log('render', v.document_id, s?.length ?? 0); return new Uint8Array([37, 80, 68, 70, s ? 1 : 0]) },
    async put(p, b, ct) { log('put', p, b.length, ct) },
    async signedFile(id, p, sha) { log('signedFile', id, p, sha) },
    async uploaded(t, p, sha) { log('uploaded', t, p, sha); return 'doc1' },
  }
  return { store, calls }
}
const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request('https://x/doc-sign', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', ...headers } })

test('tokens are 48 hex characters', () => {
  assert.ok(validToken(T))
  assert.ok(!validToken('a'.repeat(47)))
  assert.ok(!validToken("'; drop table--"))
  assert.ok(!validToken(undefined))
})

test('the page sees the form, not paths or field positions', () => {
  const v = publicView(base) as Record<string, unknown>
  assert.equal(v.role, 'Policy owner')
  assert.equal((v.consent as { version: string }).version, 'esign-v1')
  for (const k of ['storage_path', 'policy_id', 'document_id', 'signer_id', 'fields', 'prefill']) assert.ok(!(k in v), k)
  assert.deepEqual(publicView({ state: 'expired', title: 'X' }), { state: 'expired', title: 'X' })
})

test('GET a bad token is not found without asking the database', async () => {
  const { store, calls } = fake()
  const r = await handle(new Request('https://x/doc-sign?t=zz'), store)
  assert.equal(r.status, 404)
  assert.equal(calls.view, undefined)
})

test('GET a signing link returns the prefilled PDF', async () => {
  const { store } = fake()
  const r = await handle(new Request(`https://x/doc-sign?t=${T}`), store)
  const b = await r.json()
  assert.equal(b.state, 'sign')
  assert.equal(b.pdf, bytesToB64(new Uint8Array([37, 80, 68, 70, 0])))
  assert.equal(r.headers.get('cache-control'), 'no-store')
})

test('sign needs consent and a typed name', async () => {
  const { store, calls } = fake()
  assert.equal((await handle(post({ action: 'sign', t: T, name: 'Tom Fry', consent: false }), store)).status, 400)
  assert.equal((await handle(post({ action: 'sign', t: T, name: ' ', consent: true }), store)).status, 400)
  assert.equal(calls.sign, undefined)
})

test('one of two signs: recorded with IP and device, nothing stamped', async () => {
  const { store, calls } = fake(base, false)
  const r = await handle(post({ action: 'sign', t: T, name: 'Tom Fry', consent: true }, { 'x-forwarded-for': '1.2.3.4, 10.0.0.1', 'user-agent': 'Phone' }), store)
  assert.deepEqual(await r.json(), { state: 'signed', all_signed: false })
  assert.deepEqual(calls.sign[0], [T, 'Tom Fry', true, '1.2.3.4', 'Phone'])
  assert.equal(calls.put, undefined)
})

test('the last signer stamps the PDF with signatures, stores it under the policy, marks it signed', async () => {
  const { store, calls } = fake(base, true)
  const r = await handle(post({ action: 'sign', t: T, name: 'Tom Fry', consent: true }), store)
  assert.equal((await r.json()).all_signed, true)
  assert.deepEqual(calls.render[0], ['doc1', 1])
  const sha = await sha256Hex(new Uint8Array([37, 80, 68, 70, 1]))
  assert.equal((calls.put[0] as string[])[0], `pol1/doc1/signed-${sha.slice(0, 12)}.pdf`)
  assert.deepEqual(calls.signedFile[0], ['doc1', `pol1/doc1/signed-${sha.slice(0, 12)}.pdf`, sha])
})

test('database refusals come back in their own words; others are hidden', async () => {
  const { store } = fake()
  store.sign = async () => { throw Object.assign(new Error('This link ran out. Ask us for a new one.'), { code: '22023' }) }
  let b = await (await handle(post({ action: 'sign', t: T, name: 'Tom Fry', consent: true }), store)).json()
  assert.equal(b.error, 'This link ran out. Ask us for a new one.')
  store.sign = async () => { throw Object.assign(new Error('relation x does not exist'), { code: '42P01' }) }
  b = await (await handle(post({ action: 'sign', t: T, name: 'Tom Fry', consent: true }), store)).json()
  assert.match(b.error, /Something went wrong/)
})

test('decline passes the reason', async () => {
  const { store, calls } = fake()
  const r = await handle(post({ action: 'decline', t: T, reason: 'Wrong address' }), store)
  assert.equal((await r.json()).state, 'declined')
  assert.deepEqual(calls.decline[0], [T, 'Wrong address'])
})

test('upload: photo or PDF only, 10 MB, stored under its policy with a hash', async () => {
  const up: View = { ...base, state: 'upload', mode: 'upload', role: 'uploader' }
  const { store, calls } = fake(up)
  const file = bytesToB64(new Uint8Array([1, 2, 3]))
  assert.equal((await handle(post({ action: 'upload', t: T, type: 'text/html', file }), store)).status, 400)
  assert.equal((await handle(post({ action: 'upload', t: T, type: 'image/jpeg', file: '' }), store)).status, 400)
  const big = bytesToB64(new Uint8Array(10 * 1024 * 1024 + 1))
  assert.equal((await handle(post({ action: 'upload', t: T, type: 'image/jpeg', file: big }), store)).status, 400)
  const r = await handle(post({ action: 'upload', t: T, type: 'image/jpeg', file: `data:image/jpeg;base64,${file}` }), store)
  assert.equal((await r.json()).state, 'done')
  const sha = await sha256Hex(new Uint8Array([1, 2, 3]))
  assert.deepEqual(calls.put[0], [`pol1/doc1/upload-${sha.slice(0, 12)}.jpg`, 3, 'image/jpeg'])
  assert.equal((calls.uploaded[0] as string[])[2], sha)
})

test('an upload link that ran out stores nothing', async () => {
  const { store, calls } = fake({ state: 'expired' })
  const r = await handle(post({ action: 'upload', t: T, type: 'application/pdf', file: bytesToB64(new Uint8Array([1])) }), store)
  assert.equal(r.status, 400)
  assert.equal(calls.put, undefined)
})

test('base64 round trip', () => {
  const b = new Uint8Array([0, 255, 128, 7])
  assert.deepEqual(b64ToBytes(bytesToB64(b)), b)
})
