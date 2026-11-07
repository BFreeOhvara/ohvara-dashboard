/**
 * P886 — doc-send: sandbox delivers (test numbers fail), live senders, provider errors become a failure reason,
 * Telnyx webhook results, the cron + webhook secrets.
 * No network, no database. Run: node --test supabase/functions/doc-send/core.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { run, handle, readFaxHook, sandboxResult, isTestFailure, e164, type Claimed, type Store } from './core.ts'

const c = (o: Partial<Claimed> = {}): Claimed => ({
  send_id: '12345678-aaaa', channel: 'fax', destination: '5125550199', sandbox: true, provider: 'sandbox', attempt: 1,
  document_id: 'd1', title: 'Cancel request', path: 'p/d/signed.pdf', carrier: 'Old Life', client: 'Ann Lee', policy_number: 'NL-1', ...o,
})
function fakeStore(claimed: Claimed[]) {
  const results: unknown[][] = []; const refs: string[][] = []
  const store: Store = {
    async claim() { return claimed },
    async result(...a) { results.push(a) },
    async byProviderRef(ref) { return ref === 'fx-1' ? 'send-1' : null },
    async setProviderRef(id, ref) { refs.push([id, ref]) },
  }
  return { store, results, refs }
}

test('sandbox: delivered with a sandbox receipt; test numbers fail', () => {
  assert.equal(sandboxResult(c()).status, 'delivered')
  assert.equal(sandboxResult(c()).receipt?.sandbox, true)
  assert.ok(isTestFailure(c({ destination: '5125550000' })))
  assert.ok(isTestFailure(c({ channel: 'email', destination: 'fail@x.example' })))
  assert.ok(!isTestFailure(c({ channel: 'email', destination: 'forms@x.example' })))
  assert.match(sandboxResult(c({ destination: '5125550000' })).failure!, /Busy/)
})

test('run: sandbox sends never call a live sender', async () => {
  const { store, results } = fakeStore([c(), c({ send_id: 'b', destination: '5125550000' })])
  let live = 0
  const out = await run(store, { fax: async () => { live++; return { status: 'delivered' } } })
  assert.equal(live, 0)
  assert.deepEqual(out.map(o => o.status), ['delivered', 'failed'])
  assert.equal(results[0][1], 'delivered')
  assert.equal(results[1][1], 'failed')
})

test('run: live fax waits for the webhook (provider id kept), live email is delivered at once', async () => {
  const { store, results, refs } = fakeStore([c({ sandbox: false }), c({ send_id: 'e', channel: 'email', destination: 'f@x.example', sandbox: false })])
  await run(store, {
    fax: async () => ({ status: 'sending', providerRef: 'fx-1' }),
    email: async () => ({ status: 'delivered', providerRef: 'em-1', receipt: { id: 'em-1' } }),
  })
  assert.deepEqual(refs, [['12345678-aaaa', 'fx-1']])
  assert.equal(results.length, 1)
  assert.deepEqual(results[0].slice(0, 2), ['e', 'delivered'])
})

test('run: no sender, no file, or a thrown error become a failure reason', async () => {
  const { store, results } = fakeStore([c({ sandbox: false }), c({ send_id: 'n', sandbox: false, path: null }), c({ send_id: 't', channel: 'email', sandbox: false })])
  await run(store, { email: async () => { throw new Error('timeout') } })
  assert.match(results[0][2] as string, /No fax service/)
  assert.match(results[1][2] as string, /missing/)
  assert.match(results[2][2] as string, /timeout/)
})

test('Telnyx webhook: delivered and failed, other events ignored', () => {
  const ok = readFaxHook({ data: { event_type: 'fax.delivered', occurred_at: 't', payload: { fax_id: 'fx-1', page_count: 3, to: '+15125550199' } } })
  assert.deepEqual([ok?.status, ok?.pages, ok?.failure], ['delivered', 3, null])
  const bad = readFaxHook({ data: { event_type: 'fax.failed', payload: { fax_id: 'fx-1', failure_reason: 'user_busy' } } })
  assert.equal(bad?.failure, 'Busy signal')
  assert.equal(readFaxHook({ data: { event_type: 'fax.queued', payload: { fax_id: 'x' } } }), null)
  assert.equal(readFaxHook({}), null)
})

test('handle: webhook needs its key; run needs the cron secret', async () => {
  const { store, results } = fakeStore([])
  const hook = (key: string) => new Request(`https://x/doc-send?hook=fax&key=${key}`, { method: 'POST', body: JSON.stringify({ data: { event_type: 'fax.failed', payload: { fax_id: 'fx-1', failure_reason: 'no_answer' } } }) })
  assert.equal((await handle(hook('nope'), store, {}, { isCron: async () => true, hookSecret: 'k' })).status, 401)
  assert.equal((await handle(hook('k'), store, {}, { isCron: async () => false })).status, 401, 'no secret set = closed')
  const r = await handle(hook('k'), store, {}, { isCron: async () => false, hookSecret: 'k' })
  assert.equal((await r.json()).status, 'failed')
  assert.deepEqual(results[0].slice(0, 3), ['send-1', 'failed', 'No answer'])
  const run1 = new Request('https://x/doc-send', { method: 'POST', body: '{"action":"run"}' })
  assert.equal((await handle(run1, store, {}, { isCron: async () => false })).status, 401)
})

test('fax numbers go out as E.164', () => {
  assert.equal(e164('5125550199'), '+15125550199')
  assert.equal(e164('15125550199'), '+15125550199')
})
