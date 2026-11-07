/**
 * P881 — nipr-check: the PDB XML parser, the judge (verified / no life / expired / not found / down / name
 * mismatch), the registry adapter with a mocked fetch, the handler (auth, cron, admin re-run) and the daily run.
 * No network, no database. Run: node --test supabase/functions/nipr-check/core.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseEntityXml, pdbRegistry, isoDate, type Lookup } from './registry.ts'
import { judge, sameName, handle, daily, MESSAGES, type Store, type Judged } from './core.ts'

const XML = `<?xml version="1.0"?>
<PDB><PRODUCER><INDIVIDUAL>
  <ENTITY_BIOGRAPHIC><BIOGRAPHIC><NAME_FIRST>JANE</NAME_FIRST><NAME_MIDDLE>Q</NAME_MIDDLE><NAME_LAST>DOE</NAME_LAST><ID_NPN>1234567</ID_NPN></BIOGRAPHIC></ENTITY_BIOGRAPHIC>
  <PRODUCER_LICENSING><LICENSE_INFORMATION>
    <STATE name="TX"><LICENSE license_num="TX-1" date_expire_license="03/31/2030" active="Yes">
      <DETAILS><DETAIL><LOA>Life</LOA><LOA_STATUS>Active</LOA_STATUS></DETAIL><DETAIL><LOA>Accident &amp; Health</LOA><LOA_STATUS>Active</LOA_STATUS></DETAIL></DETAILS>
    </LICENSE></STATE>
    <STATE name="OH"><LICENSE license_num="OH-1" date_expire_license="03/31/2030" active="Yes">
      <DETAILS><DETAIL><LOA>Property</LOA><LOA_STATUS>Active</LOA_STATUS></DETAIL></DETAILS>
    </LICENSE></STATE>
    <STATE name="FL"><LICENSE license_num="FL-1" date_expire_license="01/01/2020" active="No">
      <DETAILS><DETAIL><LOA>Life</LOA><LOA_STATUS>Inactive</LOA_STATUS></DETAIL></DETAILS>
    </LICENSE></STATE>
    <STATE name="GA"><LICENSE><LICENSE_NUM>GA-1</LICENSE_NUM><DATE_EXPIRE_LICENSE>2030-06-30</DATE_EXPIRE_LICENSE><ACTIVE>Yes</ACTIVE>
      <DETAILS><DETAIL><LOA>Life, Accident and Health</LOA><STATUS>Active</STATUS></DETAIL></DETAILS>
    </LICENSE></STATE>
  </LICENSE_INFORMATION></PRODUCER_LICENSING>
</INDIVIDUAL></PRODUCER></PDB>`

test('parser: name, states, life line, expiry, both attribute and element forms', () => {
  const e = parseEntityXml(XML, '1234567')!
  assert.equal(e.name, 'JANE Q DOE')
  assert.deepEqual(e.licences.map(l => [l.state, l.active, l.life, l.expires_on, l.number]), [
    ['TX', true, true, '2030-03-31', 'TX-1'],
    ['OH', true, false, '2030-03-31', 'OH-1'],
    ['FL', false, false, '2020-01-01', 'FL-1'],
    ['GA', true, true, '2030-06-30', 'GA-1'],
  ])
  assert.equal(parseEntityXml('<PDB><ERROR>No records found</ERROR></PDB>', '1'), null)
  assert.equal(isoDate('3/5/2031'), '2031-03-05')
})

test('names: same person passes, a different one does not', () => {
  assert.ok(sameName('Jane Doe', { first: 'JANE', last: 'DOE', name: null }))
  assert.ok(sameName('Jim Smith Jr', { first: 'JAMES', last: 'SMITH', name: null }))
  assert.ok(sameName('Ana De La Cruz', { first: 'ANA', last: 'DE LA CRUZ', name: null }))
  assert.ok(!sameName('Jane Doe', { first: 'JOHN', last: 'ROE', name: null }))
  assert.ok(!sameName('Jane Doe', { first: 'MARY', last: 'DOE', name: null }))
  assert.ok(!sameName('Jane', { first: 'JANE', last: 'DOE', name: null }))
})

const found: Lookup = { kind: 'found', entity: parseEntityXml(XML, '1234567')! }
test('judge: verified, no life, expired, not found, down, mismatch', () => {
  assert.equal(judge(found, 'Jane Doe', false, '2026-11-07').status, 'verified')
  assert.equal(judge(found, 'Bob Roe', false, '2026-11-07').status, 'mismatch')
  assert.equal(judge(found, 'Bob Roe', true, '2026-11-07').status, 'verified', 'daily skips the name')
  assert.equal(judge(found, 'Jane Doe', false, '2031-01-01').status, 'no_life', 'every life licence expired')
  const noLife: Lookup = { kind: 'found', entity: { ...found.entity, licences: found.entity.licences.filter(l => !l.life) } }
  assert.equal(judge(noLife, 'Jane Doe', false).status, 'no_life')
  assert.equal(judge({ kind: 'not_found' }, 'Jane Doe', false).status, 'not_found')
  assert.equal(judge({ kind: 'down', reason: 'x' }, 'Jane Doe', false).status, 'registry_down')
})

test('registry: not configured = down (manual review); outages are never "not found"', async () => {
  assert.deepEqual(await pdbRegistry({}).lookup('1234567'), { kind: 'down', reason: 'no_registry' })
  let asked = ''
  const ok = pdbRegistry({ customer: 'c', pin: 'p', fetch: async u => { asked = u; return new Response(XML) } })
  assert.equal((await ok.lookup('1234567')).kind, 'found')
  assert.match(asked, /id_entity=1234567/)
  assert.equal((await pdbRegistry({ customer: 'c', pin: 'p', fetch: async () => new Response('<PDB><ERROR>none</ERROR></PDB>') }).lookup('1')).kind, 'not_found')
  assert.equal((await pdbRegistry({ customer: 'c', pin: 'p', fetch: async () => new Response('busy', { status: 503 }) }).lookup('1')).kind, 'down')
  assert.equal((await pdbRegistry({ customer: 'c', pin: 'p', fetch: async () => { throw new Error('timeout') } }).lookup('1')).kind, 'down')
  assert.equal((await pdbRegistry({ customer: 'c', pin: 'p', fetch: async () => new Response('Invalid customer number or PIN') }).lookup('1')).kind, 'down')
})

function fakeStore(over: Partial<Store> = {}) {
  const applied: { agentId: string; npn: string; j: Judged; daily: boolean }[] = []
  const people: Record<string, { role: string; is_active: boolean; full_name: string }> = {
    agent: { role: 'agent', is_active: true, full_name: 'Jane Doe' },
    va: { role: 'fulfillment', is_active: true, full_name: 'Val Va' },
    admin: { role: 'admin', is_active: true, full_name: 'Zed Admin' },
    other: { role: 'agent', is_active: true, full_name: 'Bob Roe' },
  }
  const store: Store = {
    userFromJwt: async jwt => (jwt in people ? jwt : null),
    caller: async id => people[id] ?? null,
    cronOk: async s => s === 'cron',
    apply: async (agentId, npn, j, d) => { applied.push({ agentId, npn, j, daily: d }); return { status: j.status } },
    view: async id => ({ id }),
    dailyAgents: async () => [{ id: 'agent', npn: '1234567', full_name: 'Jane Doe' }, { id: 'other', npn: '7654321', full_name: 'Bob Roe' }],
    ...over,
  }
  return { store, applied }
}
const req = (body: unknown, h: Record<string, string> = {}) =>
  new Request('http://x', { method: 'POST', headers: { 'content-type': 'application/json', ...h }, body: JSON.stringify(body) })
const reg = (l: Lookup) => ({ configured: true, lookup: async () => l })

test('handler: agent checks their own NPN', async () => {
  const { store, applied } = fakeStore()
  const r = await handle(req({ action: 'check', npn: '123-4567' }, { authorization: 'Bearer agent' }), store, reg(found))
  const b = await r.json()
  assert.equal(r.status, 200)
  assert.equal(b.status, 'verified')
  assert.equal(b.message, MESSAGES.verified)
  assert.deepEqual([applied[0].agentId, applied[0].npn, applied[0].daily], ['agent', '1234567', false])
})

test('handler: refusals and the not-connected path', async () => {
  const { store } = fakeStore()
  assert.equal((await handle(req({ action: 'check', npn: '1234567' }), store, reg(found))).status, 401)
  assert.equal((await handle(req({ action: 'check', npn: '1234567' }, { authorization: 'Bearer va' }), store, reg(found))).status, 403)
  assert.equal((await handle(req({ action: 'check', npn: '12' }, { authorization: 'Bearer agent' }), store, reg(found))).status, 400)
  assert.equal((await handle(req({ action: 'nope' }, { authorization: 'Bearer agent' }), store, reg(found))).status, 400)
  // An agent can't check someone else; profile_id is ignored for non-admins.
  const s2 = fakeStore()
  await handle(req({ action: 'check', npn: '1234567', profile_id: 'other' }, { authorization: 'Bearer agent' }), s2.store, reg(found))
  assert.equal(s2.applied[0].agentId, 'agent')
  // No NIPR subscription yet: recorded as registry_down, the agent is offered the manual review.
  const s3 = fakeStore()
  const b = await (await handle(req({ action: 'check', npn: '1234567' }, { authorization: 'Bearer agent' }), s3.store, pdbRegistry({}))).json()
  assert.equal(b.status, 'registry_down')
  assert.equal(b.registry, 'not_connected')
  assert.match(b.message, /check by hand/)
})

test('handler: admin re-runs for an agent, judged against that agent\'s name', async () => {
  const { store, applied } = fakeStore()
  const b = await (await handle(req({ action: 'check', npn: '1234567', profile_id: 'other' }, { authorization: 'Bearer admin' }), store, reg(found))).json()
  assert.equal(applied[0].agentId, 'other')
  assert.equal(b.status, 'mismatch')
})

test('daily: cron secret, outage drops nothing, not configured skips', async () => {
  const { store, applied } = fakeStore()
  assert.equal((await handle(req({ action: 'daily' }, { 'x-ohvara-cron': 'guess' }), store, reg(found))).status, 401)
  const b = await (await handle(req({ action: 'daily' }, { 'x-ohvara-cron': 'cron' }), store, reg(found))).json()
  assert.deepEqual([b.checked, b.down], [2, 0])
  assert.ok(applied.every(a => a.daily && a.j.status === 'verified'), 'daily skips the name check')
  const s2 = fakeStore()
  const d = await daily(s2.store, reg({ kind: 'down', reason: 'x' }))
  assert.deepEqual([d.checked, d.down, s2.applied.length], [0, 2, 0])
  assert.equal((await daily(s2.store, pdbRegistry({}))).skipped, 'no_registry')
})
