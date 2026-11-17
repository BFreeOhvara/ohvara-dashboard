// P1027 — payment-intake ?setup: one-shot Resend set-up, never returns the secret. Run: node --test supabase/functions/payment-intake/setup.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { setup, type ResendApi } from './setup.ts'

const EP = 'https://x.supabase.co/functions/v1/payment-intake'
function fake(existing: { domain?: boolean; hook?: boolean } = {}) {
  const calls: string[] = []
  const api: ResendApi = async (m, p, b) => {
    calls.push(`${m} ${p}`)
    if (m === 'GET' && p === '/domains') return { ok: true, status: 200, json: { data: existing.domain ? [{ id: 'd1', name: 'notices.ohvara.com' }] : [] } }
    if (m === 'POST' && p === '/domains') { assert.deepEqual((b as { capabilities: unknown }).capabilities, { sending: 'disabled', receiving: 'enabled' }); return { ok: true, status: 201, json: { id: 'd1', name: 'notices.ohvara.com' } } }
    if (m === 'GET' && p === '/domains/d1') return { ok: true, status: 200, json: { id: 'd1', status: 'pending', records: [{ record: 'Receiving', type: 'MX', name: 'notices', value: 'inbound.example', priority: 10, status: 'pending' }] } }
    if (m === 'GET' && p === '/webhooks') return { ok: true, status: 200, json: { data: existing.hook ? [{ id: 'w0', endpoint: EP }] : [] } }
    if (m === 'POST' && p === '/webhooks') return { ok: true, status: 201, json: { id: 'w1', signing_secret: 'whsec_abcdefghijklmnopqrstuvwx' } }
    return { ok: true, status: 200, json: {} }
  }
  let saved: string | null = null
  const secrets = { get: async () => saved, set: async (s: string) => { saved = s; return true } }
  return { api, secrets, calls, saved: () => saved }
}
const req = (m: string, q: string) => new Request(`${EP}?setup=${q}`, { method: m })

test('first run: adds the receiving domain, creates the webhook, saves the secret, never returns it', async () => {
  const f = fake()
  const r = await setup(req('POST', 'resend'), f.api, f.secrets, EP)
  const body = await r.json()
  assert.equal(r.status, 200)
  assert.equal(f.saved(), 'whsec_abcdefghijklmnopqrstuvwx')
  assert.ok(!JSON.stringify(body).includes('whsec_'))
  assert.deepEqual(body.records[0], { record: 'Receiving', type: 'MX', name: 'notices', value: 'inbound.example', priority: 10, status: 'pending' })
  assert.ok(f.calls.includes('POST /domains'))
})

test('second run is refused; an old unusable webhook is replaced; status is read-only', async () => {
  const f = fake({ domain: true, hook: true })
  assert.equal((await setup(req('POST', 'resend'), f.api, f.secrets, EP)).status, 200)
  assert.ok(f.calls.includes('DELETE /webhooks/w0'))
  assert.ok(!f.calls.includes('POST /domains'))
  assert.equal((await setup(req('POST', 'resend'), f.api, f.secrets, EP)).status, 409)
  const n = f.calls.length
  const s = await (await setup(req('GET', 'status'), f.api, f.secrets, EP)).json()
  assert.deepEqual([s.found, s.webhook_secret_saved], [true, true])
  assert.ok(f.calls.slice(n).every(c => c.startsWith('GET')))
  assert.equal((await setup(req('GET', 'resend'), f.api, f.secrets, EP)).status, 400)
})
