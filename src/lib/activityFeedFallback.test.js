// The Activity feed loader: a missing or unavailable agent_activity_feed() must never surface as
// an error; the page gets the policy_events fallback (or its empty state). A stand-in client
// answers; nothing here reads Supabase.
//   node --test src/lib/activityFeedFallback.test.js
import test from 'node:test'
import assert from 'node:assert/strict'
import { fetchActivityFeed, shouldUseFallback, policyEventRow } from './activityFeedFallback.js'

const FROM = '2026-10-30T05:00:00.000Z'
const TO = '2026-10-31T05:00:00.000Z'
const AGENT = '11111111-1111-4111-8111-111111111111'

// The real PostgREST 404 for a missing function, as supabase-js hands it back.
const MISSING = {
  code: 'PGRST202',
  details: 'Searched for the function public.agent_activity_feed with parameters p_agent, p_from, p_to or with a single unnamed json/jsonb parameter, but no matches were found in the schema cache.',
  hint: null,
  message: 'Could not find the function public.agent_activity_feed(p_agent, p_from, p_to) in the schema cache',
}
const ERRORS = {
  'PostgREST 404 body (PGRST202)': MISSING,
  'SQL missing function (42883)': { code: '42883', message: 'function public.agent_activity_feed(timestamptz, timestamptz, uuid) does not exist' },
  'no permission (42501)': { code: '42501', message: 'permission denied for function agent_activity_feed' },
  'a table it reads is not there (42P01)': { code: '42P01', message: 'relation "lead_sms_replies" does not exist' },
  'schema cache (PGRST205)': { code: 'PGRST205', message: 'Could not find the table in the schema cache' },
  'bare 404, empty body': { code: '', message: '', details: '', hint: '', status: 404 },
  'HTML 404 body': { code: '', message: '<html><body><h1>404 Not Found</h1></body></html>', status: 404 },
  'status only': { status: 404 },
  'message only': { message: 'Could not find the function public.agent_activity_feed' },
  'network failure': { name: 'TypeError', message: 'Failed to fetch' },
}

const PE_ROW = {
  id: 'e1', policy_id: 'p1', agent_id: AGENT, kind: 'booked', from_status: null, actor_name: null, actor_role: null,
  detail: { scheduled_call_at: '2026-10-30T20:00:00Z' }, at: '2026-10-30T14:00:00Z',
  policy: { client_first_name: 'Maria', client_last_name: 'Alvarez', state: 'TX', client_timezone: 'America/Chicago' }, agent: { full_name: 'Test Agent' },
}

// A stand-in client: rpc answers `rpc`; policy_events answers each select in turn from `selects`.
function fake({ rpc, selects = [{ data: [] }], names = { data: [] } }) {
  const calls = { rpc: [], selects: [], filters: [] }
  let n = 0
  return {
    calls,
    rpc: async (name, args) => {
      calls.rpc.push([name, args])
      if (rpc instanceof Error) throw rpc
      return rpc
    },
    from: table => {
      const chain = {
        select: cols => { calls.selects.push([table, cols]); return chain },
        gte: () => chain, lt: () => chain, order: () => chain, limit: () => chain, in: () => chain,
        eq: (col, v) => { calls.filters.push([col, v]); return chain },
        then: (ok, bad) => Promise.resolve(table === 'profiles' ? names : selects[Math.min(n++, selects.length - 1)]).then(ok, bad),
      }
      return chain
    },
  }
}

for (const [name, error] of Object.entries(ERRORS)) {
  test(`rpc fails with ${name}: falls back, no error, an empty day is empty rows`, async () => {
    const client = fake({ rpc: { data: null, error }, selects: [{ data: [] }] })
    const out = await fetchActivityFeed(client, FROM, TO, AGENT)
    assert.deepEqual(out, { rows: [], fromFunction: false })
    assert.equal(client.calls.selects[0][0], 'policy_events')
    assert.deepEqual(client.calls.filters, [['agent_id', AGENT]])
  })
}

test('rpc throws instead of returning an error: still falls back', async () => {
  const client = fake({ rpc: new TypeError('Failed to fetch'), selects: [{ data: [PE_ROW] }] })
  const out = await fetchActivityFeed(client, FROM, TO, AGENT)
  assert.equal(out.fromFunction, false)
  assert.equal(out.rows.length, 1)
})

test('the fallback maps policy_events to the rpc row shape', async () => {
  const client = fake({ rpc: { data: null, error: MISSING }, selects: [{ data: [PE_ROW] }] })
  const { rows } = await fetchActivityFeed(client, FROM, TO, AGENT)
  assert.equal(rows[0].id, 'policy_event:e1')
  assert.equal(rows[0].kind, 'booked')
  assert.equal(rows[0].meta.client_first_name, 'Maria')
  assert.equal(rows[0].meta.to, '2026-10-30T20:00:00Z')
  assert.equal(rows[0].agent_name, 'Test Agent')
})

test('a refused embedded select retries with plain columns, and a bad row cannot break the day', async () => {
  const bad = { id: 'e2', at: null, kind: 'booked' }
  const client = fake({
    rpc: { data: null, error: MISSING },
    selects: [{ data: null, error: { code: 'PGRST200', message: 'no relationship' } }, { data: [{ ...PE_ROW, policy: undefined, agent: undefined }, bad, null] }],
  })
  const { rows } = await fetchActivityFeed(client, FROM, TO, AGENT)
  assert.equal(client.calls.selects.length, 2)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].meta.client_first_name, undefined)
})

test('only when the fallback fails too is an error reported', async () => {
  const boom = { code: '500', message: 'down' }
  const client = fake({ rpc: { data: null, error: MISSING }, selects: [{ data: null, error: boom }, { data: null, error: boom }] })
  await assert.rejects(() => fetchActivityFeed(client, FROM, TO, AGENT), e => e === boom)
})

test('the function works: its rows come back as they are; admin rows get agent names', async () => {
  const rows = [{ id: 'inbound:1', kind: 'inbound', at: TO, lead_id: 'l1', agent_id: AGENT, title: 'x', meta: {} }]
  const client = fake({ rpc: { data: rows, error: null }, names: { data: [{ id: AGENT, full_name: 'Test Agent' }] } })
  const admin = await fetchActivityFeed(client, FROM, TO, null)
  assert.equal(admin.fromFunction, true)
  assert.equal(admin.rows[0].agent_name, 'Test Agent')
  assert.deepEqual(client.calls.rpc[0], ['agent_activity_feed', { p_from: FROM, p_to: TO, p_agent: null }])
  const own = await fetchActivityFeed(fake({ rpc: { data: [], error: null } }), FROM, TO, AGENT)
  assert.deepEqual(own, { rows: [], fromFunction: true })
})

test('a 404 with an empty body reaches the page as no data and no error: that is a missing function too', async () => {
  const client = fake({ rpc: { data: null, error: null, status: 204 }, selects: [{ data: [PE_ROW] }] })
  const out = await fetchActivityFeed(client, FROM, TO, AGENT)
  assert.equal(out.fromFunction, false)
  assert.equal(out.rows.length, 1)
})

test('shouldUseFallback: any rpc error, but not a cancelled call or no error', () => {
  for (const e of Object.values(ERRORS)) assert.equal(shouldUseFallback(e), true)
  assert.equal(shouldUseFallback(null), false)
  assert.equal(shouldUseFallback({ name: 'AbortError' }), false)
})

test('policyEventRow: a corrected result is an outcome; an odd row is null, not a throw', () => {
  const fixed = policyEventRow({ ...PE_ROW, kind: 'cancelled', detail: { correction: true, from: 'no_answer' } })
  assert.equal(fixed.kind, 'outcome')
  assert.equal(fixed.meta.result_to, 'cancelled')
  assert.equal(policyEventRow(null), null)
  assert.equal(policyEventRow({ id: 'x' }), null)
  assert.equal(policyEventRow({ ...PE_ROW, detail: 'junk' }).kind, 'booked')
})
