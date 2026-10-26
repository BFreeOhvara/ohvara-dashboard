/**
 * Node unit tests for the public lead form. The database is faked: nothing is
 * stored or assigned for real.
 * Run: node --test supabase/functions/submit-mp-lead/core.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { clientIp, handle, Limiter, MP_CONSENT_VERSION, MSG, type Deps, type LeadRow } from './core.ts'

const NOW = new Date('2026-10-26T01:00:00Z')

function deps(over: Partial<Deps> = {}) {
  const rows: (LeadRow & { id: string })[] = []
  const log: string[] = []
  const d: Deps = {
    async countPhone(phone, since) { return rows.filter(r => r.phone === phone && r.consent_at >= since).length },
    async insertLead(row) { const id = `lead-${rows.length + 1}`; rows.push({ ...row, id }); log.push(`insert:${id}`); return id },
    async assign(id) { log.push(`assign:${id}`) },
    limiter: new Limiter(),
    now: () => NOW,
    log: m => log.push(`log:${m}`),
    ...over,
  }
  return { d, rows, log }
}

const good = (over: Record<string, unknown> = {}) => ({
  first_name: 'Sam', last_name: 'Lee', phone: '+15125550123', email: 'Sam@Example.com', state: 'tx',
  age_band: '35-44', mortgage_balance_band: '200-300k', homeowner: true, smoker: false,
  best_time: 'Evenings', consent: true, consent_text_version: MP_CONSENT_VERSION,
  utm_source: 'facebook', website: '',
  ...over,
})

test('a good lead is stored with server consent fields, then assigned; reply is only ok', async () => {
  const { d, rows, log } = deps()
  const r = await handle(d, good({ consent_at: '2000-01-01T00:00:00Z', assigned_agent_id: 'x', status: 'closed' }), '1.2.3.4')
  assert.deepEqual(r, { status: 200, body: { ok: true } })
  assert.deepEqual(log, ['insert:lead-1', 'assign:lead-1'])
  const row = rows[0]
  assert.equal(row.consent_at, NOW.toISOString())
  assert.equal(row.consent_text_version, MP_CONSENT_VERSION)
  assert.equal(row.state, 'TX')
  assert.equal(row.email, 'sam@example.com')
  assert.equal(row.source, 'meta_mp')
  assert.equal(row.utm_source, 'facebook')
  assert.equal(row.utm_term, null)
  // Client can't set anything outside the allowed fields.
  assert.ok(!('assigned_agent_id' in row) && !('status' in row) && !('website' in row))
})

test('the honeypot looks like success and stores nothing', async () => {
  const { d, log } = deps()
  assert.deepEqual(await handle(d, good({ website: 'http://spam' }), '1.2.3.4'), { status: 200, body: { ok: true } })
  assert.deepEqual(log, [])
})

test('bad fields are refused with a field error and nothing stored', async () => {
  const cases: [Record<string, unknown>, string][] = [
    [{ first_name: '  ' }, MSG.name],
    [{ phone: '5125550123' }, MSG.phone],
    [{ phone: '+15120550123' }, MSG.phone],
    [{ phone: '+445125550123' }, MSG.phone],
    [{ state: 'ZZ' }, MSG.state],
    [{ state: 'PR' }, MSG.state],
    [{ email: 'nope' }, MSG.email],
    [{ age_band: '' }, MSG.answers],
    [{ homeowner: 'yes' }, MSG.answers],
    [{ smoker: undefined }, MSG.answers],
    [{ consent: 'true' }, MSG.consent],
    [{ consent_text_version: 'old' }, MSG.stale],
  ]
  for (const [over, msg] of cases) {
    const { d, log } = deps()
    assert.deepEqual(await handle(d, good(over), '1.2.3.4'), { status: 400, body: { error: msg } }, JSON.stringify(over))
    assert.deepEqual(log, [])
  }
})

test('optional fields may be left out', async () => {
  const { d, rows } = deps()
  const body = good()
  for (const k of ['last_name', 'email', 'best_time', 'utm_source', 'website']) delete (body as Record<string, unknown>)[k]
  assert.equal((await handle(d, body, null)).status, 200)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].email, null)
})

test('a repeat phone within 30 days is dropped quietly', async () => {
  const { d, rows } = deps()
  await handle(d, good(), '1.1.1.1')
  // A fresh limiter so only the database check is in play.
  d.limiter = new Limiter()
  const r = await handle(d, good({ first_name: 'Other' }), '2.2.2.2')
  assert.deepEqual(r, { status: 200, body: { ok: true } })
  assert.equal(rows.length, 1)
})

test('the same phone after 30 days is stored again', async () => {
  const { d, rows } = deps()
  rows.push({ ...(good() as unknown as LeadRow), id: 'old', consent_at: '2026-09-20T00:00:00Z' })
  await handle(d, good(), '1.1.1.1')
  assert.equal(rows.length, 2)
})

test('per-IP limit: the sixth in an hour is dropped quietly', async () => {
  const { d, rows } = deps()
  for (let i = 0; i < 6; i++) {
    const r = await handle(d, good({ phone: `+1512555010${i}` }), '9.9.9.9')
    assert.deepEqual(r.body, { ok: true })
  }
  assert.equal(rows.length, 5)
  // Another IP is unaffected.
  await handle(d, good({ phone: '+15125550199' }), '8.8.8.8')
  assert.equal(rows.length, 6)
})

test('an assign failure still keeps the lead and replies ok, logging no phone', async () => {
  const { d, rows, log } = deps({ async assign() { throw new Error('no agent') } })
  const r = await handle(d, good(), '1.2.3.4')
  assert.deepEqual(r, { status: 200, body: { ok: true } })
  assert.equal(rows.length, 1)
  assert.ok(log.every(l => !l.includes('5125550123')))
})

test('clientIp reads the first forwarded address', () => {
  assert.equal(clientIp(new Headers({ 'x-forwarded-for': '203.0.113.5, 10.0.0.1' })), '203.0.113.5')
  assert.equal(clientIp(new Headers()), null)
})
