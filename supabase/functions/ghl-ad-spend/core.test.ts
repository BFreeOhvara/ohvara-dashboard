/**
 * Unit tests for ghl-ad-spend (Prompt 858): off by default, cron-only, pulls the last 3 Central days one call
 * each, parses GHL's string metrics into cents, saves partial days on a failure, never logs a key.
 * Recorded GHL payload (fixtures/), fake database and network.
 * Run: node --test supabase/functions/ghl-ad-spend/core.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { centralDay, daysToPull, handle, rowsOf, run, type Deps, type SpendRow } from './core.ts'
import { ghlReport, reportUrl } from './api.ts'

const FX = JSON.parse(readFileSync(new URL('./fixtures/reporting-list-campaigns.json', import.meta.url), 'utf8'))
const NOW = new Date('2026-11-08T15:00:00Z') // Sun Nov 8, 9 AM Central
const KEY = 'pit-test-key-000'

function fake(o: { enabled?: boolean; key?: string | null; loc?: string | null; failOn?: string } = {}) {
  const saves: { rows: SpendRow[]; status: string; error: string | null }[] = []
  const asked: string[] = []
  const logs: string[] = []
  const d: Deps = {
    apiKey: o.key === null ? undefined : (o.key ?? KEY),
    settings: async () => ({ data: { ad_spend_enabled: o.enabled ?? true, location_id: o.loc === null ? null : (o.loc ?? 'l1C08ntBrFjLS0elLIYU') }, error: null }),
    report: async (_k, _l, day) => {
      asked.push(day)
      if (day === o.failOn) return { ok: false, status: 401, error: 'Unauthorized' }
      return { ok: true, rows: rowsOf(FX, day) }
    },
    save: async (rows, status, error) => { saves.push({ rows, status, error }); return { data: { rows: rows.length }, error: null } },
    now: () => NOW,
    log: m => logs.push(m),
  }
  return { d, saves, asked, logs }
}

test('days: yesterday and the two before it, in Central time', () => {
  assert.equal(centralDay(new Date('2026-11-08T03:00:00Z')), '2026-11-07') // 9 PM Sat in Chicago
  assert.deepEqual(daysToPull(NOW), ['2026-11-05', '2026-11-06', '2026-11-07'])
})

test('parse: string metrics → cents and counts; Meta lead actions, not CDP leads; no id skipped', () => {
  const rows = rowsOf(FX, '2026-11-07')
  assert.equal(rows.length, 2)
  assert.deepEqual(rows[0], {
    campaign_id: '6650a1b2c3d4e5f6a7b8c9d0', campaign_name: 'Dana Walker - Mortgage Protection', fb_campaign_id: '120210000000000001',
    status: 'published', date: '2026-11-07', spend_cents: 12345, impressions: 4052, clicks: 118, leads: 6,
  })
  assert.equal(rows[1].spend_cents, 0)
  assert.deepEqual(rowsOf({ items: FX }, 'd').length, 2)
  assert.deepEqual(rowsOf(null, 'd'), [])
})

test('switch off (the default): nothing asked, nothing saved', async () => {
  const f = fake({ enabled: false })
  assert.deepEqual(await run(f.d), { skipped: 'off' })
  assert.equal(f.asked.length + f.saves.length, 0)
})

test('no key or no location: not_configured is stamped, GHL never called', async () => {
  const a = fake({ key: null })
  assert.deepEqual(await run(a.d), { skipped: 'not_configured' })
  assert.equal(a.asked.length, 0)
  assert.equal(a.saves[0].status, 'not_configured')
  const b = fake({ loc: null })
  await run(b.d)
  assert.match(String(b.saves[0].error), /location/)
})

test('on: one call per day, all rows saved once with status ok', async () => {
  const f = fake()
  const out = await run(f.d)
  assert.equal(out.ok, true)
  assert.deepEqual(f.asked, ['2026-11-05', '2026-11-06', '2026-11-07'])
  assert.equal(f.saves.length, 1)
  assert.equal(f.saves[0].status, 'ok')
  assert.equal(f.saves[0].rows.length, 6)
})

test('a refused key mid-run: earlier days kept, error stamped, key never logged', async () => {
  const f = fake({ failOn: '2026-11-06' })
  const out = await run(f.d)
  assert.match(String(out.error), /adPublishing\.readonly/)
  assert.equal(f.saves.length, 1)
  assert.equal(f.saves[0].status, 'error')
  assert.equal(f.saves[0].rows.length, 2)
  assert.ok(f.logs.every(l => !l.includes(KEY)))
})

test('handler: POST from cron with action run only', async () => {
  const f = fake()
  const mk = (body: unknown, method = 'POST') => new Request('https://x/functions/v1/ghl-ad-spend', { method, body: method === 'GET' ? undefined : JSON.stringify(body) })
  assert.equal((await handle(mk({}, 'GET'), { ...f.d, isCron: async () => true })).status, 405)
  assert.equal((await handle(mk({ action: 'run' }), { ...f.d, isCron: async () => false })).status, 401)
  assert.equal((await handle(mk({ action: 'other' }), { ...f.d, isCron: async () => true })).status, 400)
  const ok = await handle(mk({ action: 'run' }), { ...f.d, isCron: async () => true })
  assert.equal(ok.status, 200)
})

test('api: the documented URL and headers; a 401 comes back as not ok', async () => {
  assert.equal(reportUrl('loc123456', '2026-11-07'),
    'https://services.leadconnectorhq.com/ad-publishing/facebook/reporting/list?locationId=loc123456&listType=campaigns&startDate=2026-11-07&endDate=2026-11-07&type=AD_MANAGER')
  let seen: RequestInit | undefined
  const good = ghlReport(async (_u, init) => { seen = init; return new Response(JSON.stringify(FX), { status: 200 }) })
  const r = await good(KEY, 'loc123456', '2026-11-07')
  assert.ok(r.ok && r.rows.length === 2)
  const h = seen?.headers as Record<string, string>
  assert.equal(h.Authorization, `Bearer ${KEY}`)
  assert.equal(h.Version, 'v3')
  const bad = ghlReport(async () => new Response('nope', { status: 401 }))
  assert.deepEqual(await bad(KEY, 'loc123456', '2026-11-07'), { ok: false, status: 401, error: 'nope' })
  const down = ghlReport(async () => { throw new Error('ECONNRESET') })
  assert.deepEqual(await down(KEY, 'l', 'd'), { ok: false, status: 0, error: 'ECONNRESET' })
})

// ── P939: the key saved on the Connect page is the one used ──
test('P939: a saved key wins over the env value and is what GHL is asked with', async () => {
  const t = fake({ key: 'env-key-fallback' })
  const keys: string[] = []
  t.d.secrets = async () => ({ apiKey: 'saved-key-from-connect' })
  const inner = t.d.report
  t.d.report = async (k, l, day) => { keys.push(k); return inner(k, l, day) }
  await run(t.d)
  assert.ok(keys.length > 0 && keys.every(k => k === 'saved-key-from-connect'))
})

test('P939: no saved key and no env key: not connected, GHL never asked', async () => {
  const t = fake({ key: null })
  t.d.secrets = async () => ({})
  await run(t.d)
  assert.equal(t.asked.length, 0)
  assert.equal(t.saves[0].status, 'not_configured')
  assert.match(String(t.saves[0].error), /not connected/)
})
