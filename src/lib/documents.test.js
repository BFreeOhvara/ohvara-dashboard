// P886 — documents helpers: the carrier's channel, fax/email checks, a document's next step, the gate's words, and the
// real calls' names and arguments. Run: node --test src/lib/documents.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pickChannel, addressFor, faxDigits, showFax, validEmail, nextStep, gateWords, sendTo, docsApi, signLink, MAX_ATTEMPTS } from './documents.js'

test('the carrier’s first channel with an address, like doc_pick_channel', () => {
  assert.equal(pickChannel({ docs_channels: ['fax', 'email'], docs_fax: '5125550199', docs_email: 'f@x.co' }), 'fax')
  assert.equal(pickChannel({ docs_channels: ['fax', 'email'], docs_email: 'f@x.co' }), 'email')
  assert.equal(pickChannel({ docs_channels: ['upload', 'agent_portal'] }), 'agent_portal')
  assert.equal(pickChannel({ docs_channels: [] }), null)
  assert.equal(addressFor({ docs_upload_url: 'https://u' }, 'upload'), 'https://u')
})

test('fax numbers and emails', () => {
  assert.equal(faxDigits('+1 (512) 555-0199'), '5125550199')
  assert.equal(faxDigits('555-01'), null)
  assert.equal(showFax('5125550199'), '(512) 555-0199')
  assert.ok(validEmail(' forms@newlife.example '))
  assert.ok(!validEmail('forms@newlife'))
  assert.equal(sendTo({ channel: 'fax', destination: '5125550199' }), '(512) 555-0199')
  assert.equal(sendTo({ channel: 'agent_portal' }), 'the agent uploads it')
})

test('a document’s next step', () => {
  assert.equal(nextStep({ status: 'out_for_signature' }), 'wait')
  assert.equal(nextStep({ status: 'expired' }), 'relink')
  assert.equal(nextStep({ status: 'signed', sends: [] }), 'send')
  assert.equal(nextStep({ status: 'signed', sends: [{ status: 'delivered' }] }), 'confirm')
  assert.equal(nextStep({ status: 'signed', sends: [{ status: 'failed' }] }), 'retry')
  assert.equal(nextStep({ status: 'signed', sends: Array(MAX_ATTEMPTS).fill({ status: 'not_received' }) }), 'call')
  assert.equal(nextStep({ status: 'on_file', sends: [{ status: 'received' }] }), 'none')
  assert.equal(nextStep({ status: 'void' }), 'none')
})

test('the replacement gate in words', () => {
  assert.equal(gateWords({ applies: false }), null)
  // P899: the gate waits only for "issued", then the cancel is timed before the old policy's next draft.
  assert.match(gateWords({ applies: true, open: false, waiting_for: ['issued'] }), /^Waiting until the new policy is issued\./)
  assert.match(gateWords({ applies: true, open: true }), /Cancel the old one before its next draft/)
  assert.match(gateWords({ applies: true, open: true, cancel_by: 'Nov 6', old_draft: 'Nov 9' }), /by Nov 6, before its Nov 9 draft/)
  assert.match(gateWords({ applies: true, open: true, override: 'Client insists' }), /admin: Client insists/)
})

test('real calls use the migration’s names and arguments', async () => {
  const seen = []
  const db = { rpc: async (fn, args) => { seen.push([fn, args]); return { data: { ok: 1 }, error: null } } }
  const api = docsApi(db)
  await api.send('d1')
  await api.markGate('p1', 'issued', '2026-11-01')
  await api.startSigning({ policy: 'p1', docType: 'poa', title: 'POA', signers: [{ role: 'owner', name: 'Ann' }] })
  assert.deepEqual(seen[0], ['doc_send_request', { p_doc: 'd1', p_channel: null, p_destination: null, p_retry_of: null }])
  assert.deepEqual(seen[1], ['replacement_mark', { p_policy: 'p1', p_what: 'issued', p_on: '2026-11-01', p_how: null }])
  assert.equal(seen[2][0], 'doc_start_signing')
  const bad = docsApi({ rpc: async () => ({ data: null, error: new Error('Not yet') }) })
  await assert.rejects(bad.send('d1'), /Not yet/)
  assert.equal(signLink('abc', 'https://app.example'), 'https://app.example/sign/abc')
})
