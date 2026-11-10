/**
 * P939: Test connection. One GET (list one contact), plain-words answers, key only in the Authorization header.
 * Run: node --test supabase/functions/_shared/ghlPing.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ghlPing, pingMessage, pingUrl, GHL_BASE } from './ghlPing.ts'

const KEY = 'pit-secret-0000-never-shown'
const LOC = 'l1C08ntBrFjLS0elLIYU'
const stub = (status: number) => {
  const sent: { url: string; init: any }[] = []
  return { sent, fn: async (url: string, init: any) => { sent.push({ url, init }); return { ok: status < 300, status, text: async () => 'body' } } }
}

test('one GET, read-only: list one contact in the location', async () => {
  const s = stub(200)
  const r = await ghlPing(s.fn, KEY, LOC)
  assert.equal(r.ok, true)
  assert.equal(s.sent.length, 1)
  assert.equal(s.sent[0].init.method, 'GET')
  assert.equal(s.sent[0].init.body, undefined)
  assert.equal(s.sent[0].url, `${GHL_BASE}/contacts/?locationId=${LOC}&limit=1`)
  assert.equal(s.sent[0].url, pingUrl(LOC))
  assert.equal(s.sent[0].init.headers.Authorization, `Bearer ${KEY}`)
  assert.ok(!s.sent[0].url.includes(KEY))
})

test('each failure is said in plain words and never carries the key', async () => {
  for (const status of [401, 403, 404, 422, 429, 500, 502, 418]) {
    const r = await ghlPing(stub(status).fn, KEY, LOC)
    assert.equal(r.ok, false, String(status))
    assert.ok(r.message.length > 10)
    assert.ok(!r.message.includes(KEY))
  }
  assert.match(pingMessage(401).message, /rejected the key/)
  assert.match(pingMessage(403).message, /location/)
  assert.match(pingMessage(404).message, /location ID/)
})

test('a network failure is a plain message, not a stack trace, and keeps the key out of it', async () => {
  const r = await ghlPing(async () => { throw new Error(`boom ${KEY}`) }, KEY, LOC)
  assert.equal(r.ok, false)
  assert.ok(!r.message.includes(KEY) && !r.message.includes('boom'))
})
