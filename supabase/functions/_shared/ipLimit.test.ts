/**
 * Deno tests for the shared per-IP limiter, against an in-memory stand-in for
 * public.public_form_attempts. No network, no real database.
 * Run: deno test --allow-env supabase/functions/_shared/ipLimit.test.ts
 */
import assert from 'node:assert/strict'
import { checkAndRecord, clientIp, hashIp, serviceStore, type Store } from './ipLimit.ts'

type Row = { id: number; ip_hash: string; created_at: string }

// The "database": rows outlive any client made over them.
function table() {
  const rows: Row[] = []
  let next = 1
  // A fresh supabase-js-shaped client over the same rows (a restart or cold start).
  const client = () => ({
    from(name: string) {
      assert.equal(name, 'public_form_attempts')
      const filters: ((r: Row) => boolean)[] = []
      // deno-lint-ignore no-explicit-any
      const q: any = {
        select() { return q },
        eq(col: keyof Row, v: unknown) { filters.push(r => r[col] === v); return q },
        gt(col: keyof Row, v: string) { filters.push(r => String(r[col]) > v); return q },
        then(ok: (v: { count: number; error: null }) => unknown) {
          return Promise.resolve({ count: rows.filter(r => filters.every(f => f(r))).length, error: null }).then(ok)
        },
        insert(row: Omit<Row, 'id'>) { rows.push({ id: next++, ...row }); return Promise.resolve({ error: null }) },
      }
      return q
    },
  })
  // Cleanup job: delete rows older than the cutoff.
  const prune = (beforeIso: string) => {
    for (let i = rows.length - 1; i >= 0; i--) if (rows[i].created_at < beforeIso) rows.splice(i, 1)
  }
  return { rows, client, prune }
}

const HOUR = 3_600_000
const OPTS = { limit: 3, windowMs: HOUR }
const T0 = new Date('2026-10-25T12:00:00Z')
const at = (ms: number) => new Date(T0.getTime() + ms)

function withSalt<T>(salt: string | undefined, fn: () => Promise<T>): Promise<T> {
  const before = Deno.env.get('FORM_IP_SALT')
  if (salt === undefined) Deno.env.delete('FORM_IP_SALT')
  else Deno.env.set('FORM_IP_SALT', salt)
  return fn().finally(() => {
    if (before === undefined) Deno.env.delete('FORM_IP_SALT')
    else Deno.env.set('FORM_IP_SALT', before)
  })
}

Deno.test('limit still holds after a restart (fresh client and store on the same table)', () =>
  withSalt('test-salt', async () => {
    const db = table()
    const ipHash = await hashIp('203.0.113.7')
    const first: Store = serviceStore(db.client())
    for (let i = 0; i < 3; i++) assert.equal((await checkAndRecord(first, ipHash, { ...OPTS, now: at(i * 1000) })).blocked, false)
    assert.equal((await checkAndRecord(first, ipHash, { ...OPTS, now: at(4000) })).blocked, true)

    const afterRestart: Store = serviceStore(db.client())
    const r = await checkAndRecord(afterRestart, ipHash, { ...OPTS, now: at(5000) })
    assert.deepEqual(r, { blocked: true, count: 3 })
    assert.equal(db.rows.length, 3, 'blocked attempts are not written')
  }))

Deno.test('pruning rows older than the window does not unblock an IP inside it', () =>
  withSalt('test-salt', async () => {
    const db = table()
    const ipHash = await hashIp('203.0.113.7')
    const store = serviceStore(db.client())
    await checkAndRecord(store, ipHash, { ...OPTS, now: at(-2 * HOUR) }) // old, outside the window
    for (let i = 0; i < 3; i++) await checkAndRecord(store, ipHash, { ...OPTS, now: at(i * 60_000) })
    const now = at(10 * 60_000)
    assert.equal((await checkAndRecord(store, ipHash, { ...OPTS, now })).blocked, true)

    db.prune(new Date(now.getTime() - HOUR).toISOString())
    assert.equal(db.rows.length, 3, 'only the out-of-window row was pruned')
    assert.equal((await checkAndRecord(serviceStore(db.client()), ipHash, { ...OPTS, now })).blocked, true)
  }))

Deno.test('window is rolling: attempts age out once they are older than the window', () =>
  withSalt('test-salt', async () => {
    const db = table()
    const ipHash = await hashIp('203.0.113.7')
    const store = serviceStore(db.client())
    for (let i = 0; i < 3; i++) await checkAndRecord(store, ipHash, { ...OPTS, now: at(i * 1000) })
    assert.equal((await checkAndRecord(store, ipHash, { ...OPTS, now: at(HOUR - 1) })).blocked, true)
    // created_at > now - window: the first attempt is exactly an hour old now, so it no longer counts.
    assert.equal((await checkAndRecord(store, ipHash, { ...OPTS, now: at(HOUR) })).blocked, false)
  }))

Deno.test('other IPs are counted separately', () =>
  withSalt('test-salt', async () => {
    const db = table()
    const store = serviceStore(db.client())
    const a = await hashIp('203.0.113.7')
    for (let i = 0; i < 3; i++) await checkAndRecord(store, a, { ...OPTS, now: at(i) })
    assert.equal((await checkAndRecord(store, await hashIp('198.51.100.2'), { ...OPTS, now: at(10) })).blocked, false)
  }))

Deno.test('missing FORM_IP_SALT fails closed', () =>
  withSalt(undefined, async () => {
    await assert.rejects(() => hashIp('203.0.113.7'), /ip_salt_missing/)
  }))

Deno.test('empty FORM_IP_SALT fails closed', () =>
  withSalt('', async () => {
    await assert.rejects(() => hashIp('203.0.113.7'), /ip_salt_missing/)
  }))

Deno.test('the raw IP is never stored or returned', () =>
  withSalt('test-salt', async () => {
    const ip = '203.0.113.7'
    const db = table()
    const ipHash = await hashIp(ip)
    assert.match(ipHash, /^[0-9a-f]{64}$/)
    assert.notEqual(ipHash, await withSalt('other-salt', () => hashIp(ip)), 'the salt changes the hash')
    const r = await checkAndRecord(serviceStore(db.client()), ipHash, { ...OPTS, now: T0 })
    assert.ok(!JSON.stringify(db.rows).includes(ip))
    assert.ok(!JSON.stringify(r).includes(ip))
  }))

Deno.test('clientIp reads only x-forwarded-for (first entry)', () => {
  const req = (h: Record<string, string>) => new Request('https://x.supabase.co/functions/v1/f', { headers: h })
  assert.equal(clientIp(req({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1' })), '203.0.113.7')
  assert.equal(clientIp(req({ 'x-real-ip': '1.2.3.4', 'cf-connecting-ip': '1.2.3.4', 'true-client-ip': '1.2.3.4' })), null)
  assert.equal(clientIp(req({ 'x-forwarded-for': ' ' })), null)
})
