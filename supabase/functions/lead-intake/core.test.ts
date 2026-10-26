/**
 * Node unit tests for the Meta lead intake. The database is faked: nothing is
 * stored or assigned for real.
 * Run: node --test supabase/functions/lead-intake/core.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { clientIp, handle, Limiter, MSG, toE164, type Deps, type LeadRow } from './core.ts'

const NOW = new Date('2026-10-26T02:00:00Z')

function deps(over: Partial<Deps> = {}, clock = { t: NOW.getTime() }) {
  const rows: (LeadRow & { id: string; created_at: string; delivered_at: string | null })[] = []
  const log: string[] = []
  const limiter = new Limiter()
  const d: Deps = {
    async findRecent(phone, since) {
      const hit = rows.filter(r => r.phone === phone && r.created_at >= since).at(-1)
      return hit?.id ?? null
    },
    async insertLead(row) {
      const id = `lead-${rows.length + 1}`
      rows.push({ ...row, id, created_at: new Date(clock.t).toISOString(), delivered_at: null })
      log.push(`insert:${id}`)
      return id
    },
    async assign(id) { log.push(`assign:${id}`); return 'agent-1' },
    async markDelivered(id, at) { rows.find(r => r.id === id)!.delivered_at = at; log.push(`delivered:${id}`) },
    async overLimit(key, limit, windowMs) { return limiter.over(key, limit, windowMs, clock.t) },
    now: () => new Date(clock.t),
    log: m => log.push(`log:${m}`),
    ...over,
  }
  return { d, rows, log, clock }
}

const good = (over: Record<string, unknown> = {}) => ({
  first_name: ' Sam ', phone: '(512) 555-0123', state: 'tx',
  age_range: '40–49', mortgage_balance_range: '$200k–$350k', homeowner: true,
  best_time: 'Evenings', consent_checked: true,
  utm: { source: 'facebook', campaign: 'mp-fall', ad: 'ad-7' },
  ...over,
})

test('a good lead is stored as a Meta mortgage_protection lead, assigned and delivered', async () => {
  const { d, rows, log } = deps()
  const r = await handle(d, good({ assigned_rep_id: 'x', lead_type: 'cancellation', delivered_at: '2000-01-01' }), '1.2.3.4')
  assert.deepEqual(r, { status: 200, body: { ok: true, lead_id: 'lead-1' } })
  assert.deepEqual(log, ['insert:lead-1', 'assign:lead-1', 'delivered:lead-1'])
  const row = rows[0]
  assert.equal(row.lead_type, 'mortgage_protection')
  assert.equal(row.lead_source, 'meta')
  assert.equal(row.phone, '+15125550123')
  assert.equal(row.state, 'TX')
  assert.equal(row.business_name, 'Sam')
  assert.equal(row.contact_name, 'Sam')
  assert.equal(row.delivered_at, NOW.toISOString())
  assert.deepEqual(row.qualifier_answers, {
    age_range: '40–49', mortgage_balance_range: '$200k–$350k', homeowner: true, best_time: 'Evenings',
    consent_checked: true, consent_at: NOW.toISOString(),
    utm: { source: 'facebook', campaign: 'mp-fall', ad: 'ad-7' },
  })
  // Client can't set anything outside the allowed fields.
  assert.ok(!('assigned_rep_id' in row))
})

test('consent_checked must be exactly true', async () => {
  for (const consent_checked of [false, undefined, 'true', 1]) {
    const { d, rows } = deps()
    const r = await handle(d, good({ consent_checked }), '1.2.3.4')
    assert.deepEqual(r, { status: 400, body: { ok: false, error: MSG.consent } })
    assert.equal(rows.length, 0)
  }
})

test('bad fields are rejected with a clear error and nothing is stored', async () => {
  const cases: [Record<string, unknown>, string][] = [
    [{ first_name: '' }, MSG.name],
    [{ first_name: 'x'.repeat(101) }, MSG.name],
    [{ phone: '555-0123' }, MSG.phone],
    [{ phone: '+445125550123' }, MSG.phone],
    [{ phone: '(012) 555-0123' }, MSG.phone],
    [{ phone: '512-CALL-NOW' }, MSG.phone],
    [{ phone: 5125550123 }, MSG.phone],
    [{ state: 'ZZ' }, MSG.state],
    [{ age_range: '' }, MSG.answers],
    [{ mortgage_balance_range: undefined }, MSG.answers],
    [{ homeowner: 'yes' }, MSG.answers],
    [{ best_time: 42 }, MSG.answers],
  ]
  for (const [over, msg] of cases) {
    const { d, rows } = deps()
    const r = await handle(d, good(over), '1.2.3.4')
    assert.deepEqual(r, { status: 400, body: { ok: false, error: msg } }, JSON.stringify(over))
    assert.equal(rows.length, 0)
  }
})

test('phone formats normalise to E.164', () => {
  for (const p of ['5125550123', '512.555.0123', '1 512 555 0123', '+1 (512) 555-0123', '+15125550123']) {
    assert.equal(toE164(p), '+15125550123', p)
  }
  assert.equal(toE164('+1 512 155 0123'), null)   // exchange can't start with 1
})

test('best_time may be blank; bad utm is dropped, not an error', async () => {
  const { d, rows } = deps()
  const r = await handle(d, good({ best_time: '', utm: 'nope' }), '1.2.3.4')
  assert.equal(r.status, 200)
  assert.equal(rows[0].qualifier_answers.best_time, null)
  assert.deepEqual(rows[0].qualifier_answers.utm, { source: null, campaign: null, ad: null })
})

test('same phone within 24h returns the existing lead; after 24h it is a new lead', async () => {
  const { d, rows, log, clock } = deps()
  await handle(d, good(), '1.1.1.1')
  clock.t += 2 * 3600e3
  const again = await handle(d, good({ phone: '512-555-0123' }), '2.2.2.2')
  assert.deepEqual(again, { status: 200, body: { ok: true, lead_id: 'lead-1' } })
  assert.equal(rows.length, 1)
  assert.equal(log.filter(l => l.startsWith('assign')).length, 1)

  clock.t += 23 * 3600e3
  const later = await handle(d, good(), '3.3.3.3')
  assert.deepEqual(later, { status: 200, body: { ok: true, lead_id: 'lead-2' } })
})

test('rate limit: over the per-IP limit gets 429', async () => {
  const { d, rows } = deps()
  for (let i = 0; i < 5; i++) {
    const r = await handle(d, good({ phone: `51255501${String(i).padStart(2, '0')}` }), '9.9.9.9')
    assert.equal(r.status, 200)
  }
  const r = await handle(d, good({ phone: '5125550199' }), '9.9.9.9')
  assert.deepEqual(r, { status: 429, body: { ok: false, error: MSG.limited } })
  assert.equal(rows.length, 5)
  // Bad bodies count against the IP too.
  const { d: d2 } = deps()
  for (let i = 0; i < 5; i++) await handle(d2, good({ phone: 'x' }), '8.8.8.8')
  assert.equal((await handle(d2, good(), '8.8.8.8')).status, 429)
})

test('rate limit: over the per-phone limit gets 429 across IPs', async () => {
  const { d } = deps()
  for (let i = 0; i < 3; i++) assert.equal((await handle(d, good(), `10.0.0.${i}`)).status, 200)
  assert.equal((await handle(d, good(), '10.0.0.9')).status, 429)
})

test('no agent available: lead is saved, not delivered, still ok', async () => {
  const { d, rows, log } = deps({ async assign() { return null } })
  const r = await handle(d, good(), '1.2.3.4')
  assert.deepEqual(r, { status: 200, body: { ok: true, lead_id: 'lead-1' } })
  assert.equal(rows[0].delivered_at, null)
  assert.ok(!log.some(l => l.startsWith('delivered')))
})

test('assignment error: lead is saved, logged without PII, still ok', async () => {
  const { d, rows, log } = deps({ async assign() { throw new Error('function assign_lead does not exist') } })
  const r = await handle(d, good(), '1.2.3.4')
  assert.equal(r.status, 200)
  assert.equal(rows[0].delivered_at, null)
  const logged = log.filter(l => l.startsWith('log:')).join(' ')
  assert.match(logged, /assign failed/)
  assert.ok(!logged.includes('555') && !logged.includes('Sam') && !logged.includes('1.2.3.4'))
})

test('a database error on insert bubbles up (index.ts turns it into a generic 500)', async () => {
  const { d } = deps({ async insertLead() { throw new Error('db down') } })
  await assert.rejects(handle(d, good(), '1.2.3.4'), /db down/)
})

test('clientIp reads the first x-forwarded-for entry', () => {
  assert.equal(clientIp(new Headers({ 'x-forwarded-for': '1.2.3.4, 10.0.0.1' })), '1.2.3.4')
  assert.equal(clientIp(new Headers({ 'x-real-ip': '5.6.7.8' })), '5.6.7.8')
  assert.equal(clientIp(new Headers()), null)
})
