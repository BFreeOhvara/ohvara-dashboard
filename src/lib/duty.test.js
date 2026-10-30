// Active for live transfers: the one hook's read/write logic (useAgentDuty runs these with
// the real supabase client and query client) and the Coming soon state.
//   node --test src/lib/duty.test.js
// Mocked supabase and query client only: no network, no React.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { isDutyMissing, dutyKey, readMyDuty, dutyMutation, dutyState, dutySince } from './duty.js'

const AGENT = '11111111-1111-4111-8111-111111111111'
const MISSING = { code: 'PGRST205', message: "Could not find the table 'public.agent_duty' in the schema cache" }
const src = p => readFileSync(new URL(p, import.meta.url), 'utf8')

// A supabase stand-in that records every call.
function mockDb({ row = null, readError = null, writeError = null } = {}) {
  const calls = []
  const db = {
    calls,
    from(table) {
      return {
        select(cols) {
          const q = { eq: (c, v) => { calls.push({ table, op: 'select', cols, where: [c, v] }); return q }, maybeSingle: async () => ({ data: row, error: readError }) }
          return q
        },
        upsert: async (values, opts) => { calls.push({ table, op: 'upsert', values, opts }); return { error: writeError } },
      }
    },
  }
  return db
}

// A query client stand-in: one cache, the four calls the mutation makes.
function mockQc(initial) {
  const cache = new Map([[JSON.stringify(dutyKey(AGENT)), initial]])
  const log = []
  return {
    log,
    get: () => cache.get(JSON.stringify(dutyKey(AGENT))),
    cancelQueries: async q => { log.push(['cancel', q.queryKey]) },
    getQueryData: k => cache.get(JSON.stringify(k)),
    setQueryData: (k, v) => cache.set(JSON.stringify(k), typeof v === 'function' ? v(cache.get(JSON.stringify(k))) : v),
    invalidateQueries: q => { log.push(['invalidate', q.queryKey]) },
  }
}

test('writes on_duty both ways', async () => {
  const db = mockDb()
  const qc = mockQc({ on_duty: false, since: null })
  const m = dutyMutation({ db, qc, id: AGENT, now: () => '2026-10-29T19:14:00.000Z' })

  const ctxOn = await m.onMutate(true)
  assert.deepEqual(qc.get(), { on_duty: true, since: '2026-10-29T19:14:00.000Z' }, 'optimistic: on, since now')
  await m.mutationFn(true)
  m.onSettled()

  const ctxOff = await m.onMutate(false)
  assert.deepEqual(qc.get(), { on_duty: false, since: null }, 'optimistic: off, since cleared')
  await m.mutationFn(false)

  const writes = db.calls.filter(c => c.op === 'upsert')
  assert.deepEqual(writes.map(w => w.values), [{ agent_id: AGENT, on_duty: true }, { agent_id: AGENT, on_duty: false }])
  assert.ok(writes.every(w => w.table === 'agent_duty' && w.opts.onConflict === 'agent_id'))
  assert.deepEqual(ctxOn.prev, { on_duty: false, since: null })
  assert.deepEqual(ctxOff.prev.on_duty, true)
  assert.deepEqual(qc.log.find(l => l[0] === 'invalidate')[1], dutyKey(AGENT), 'refetches the server row (and its since)')
})

test('a failed save rolls back to the row before it', async () => {
  const db = mockDb({ writeError: { code: '42501', message: 'Only an active agent can go on duty.' } })
  const qc = mockQc({ on_duty: false, since: null })
  const m = dutyMutation({ db, qc, id: AGENT })
  const ctx = await m.onMutate(true)
  assert.equal(qc.get().on_duty, true)
  await assert.rejects(m.mutationFn(true))
  m.onError(new Error('x'), true, ctx)
  assert.deepEqual(qc.get(), { on_duty: false, since: null })
})

test('writes only the signed-in agent\'s own row, and nothing when signed out', async () => {
  const db = mockDb()
  await dutyMutation({ db, qc: mockQc(null), id: AGENT }).mutationFn(true)
  assert.equal(db.calls[0].values.agent_id, AGENT)
  await assert.rejects(dutyMutation({ db, qc: mockQc(null), id: undefined }).mutationFn(true), /Not signed in/)
  assert.equal(db.calls.length, 1)
})

test('turning on again keeps the first since', async () => {
  const qc = mockQc({ on_duty: true, since: '2026-10-29T19:14:00.000Z' })
  await dutyMutation({ db: mockDb(), qc, id: AGENT, now: () => 'later' }).onMutate(true)
  assert.equal(qc.get().since, '2026-10-29T19:14:00.000Z')
})

test('reads the agent\'s own row', async () => {
  const db = mockDb({ row: { on_duty: true, since: '2026-10-29T19:14:00Z' } })
  assert.deepEqual(await readMyDuty(db, AGENT), { on_duty: true, since: '2026-10-29T19:14:00Z' })
  assert.deepEqual(db.calls[0].where, ['agent_id', AGENT])
  await assert.rejects(readMyDuty(mockDb({ readError: MISSING }), AGENT), e => isDutyMissing(e))
})

test('switch shows Coming soon when agent_duty is missing', () => {
  for (const code of ['PGRST205', 'PGRST202', '42P01', '42883']) {
    const s = dutyState({ error: { code }, isLoading: false })
    assert.equal(s.soon, true, code)
    assert.equal(s.on, false, code)
    assert.equal(s.failed, false, `${code} is not an error card`)
  }
  // A real failure is not "soon"; a live table is not "soon".
  assert.deepEqual(dutyState({ error: { code: '500' } }), { on: false, since: null, soon: false, loading: false, failed: true })
  assert.deepEqual(dutyState({ data: { on_duty: true, since: 'x' } }), { on: true, since: 'x', soon: false, loading: false, failed: false })
  assert.deepEqual(dutyState({ data: null }), { on: false, since: null, soon: false, loading: false, failed: false })
  // A save that finds the table gone flips the switch to soon too.
  assert.equal(dutyState({ data: { on_duty: true } }, { error: MISSING }).soon, true)

  // Today's cards (TodayCards, inside the Overview since portal parity T3) render the soon state
  // as the "Coming soon" line, disable the switch, and have no old code flag or "display only" leftovers.
  const today = src('../components/agent/TodayCards.jsx')
  assert.match(today, /soon \? 'Coming soon'/)
  assert.match(today, /role="switch"[^>]*disabled=\{!live\}/)
  assert.doesNotMatch(today, new RegExp(["aria-disabled", "Display only", "Shown here for now", "DUTY" + "_LIVE"].join("|")))
  assert.match(today, /import \{ useAgentDuty \} from '..\/..\/hooks\/useAgentDuty'/)
  assert.doesNotMatch(src('../hooks/useInbounds.js'), /function useAgentDuty/)
})

test('Active since reads the agent\'s own clock', () => {
  const now = new Date('2026-10-29T21:20:00Z')
  assert.equal(dutySince('2026-10-29T19:14:00Z', now), '2:14 PM')
  assert.equal(dutySince('2026-10-29T19:14:00Z', now, 'America/New_York'), '3:14 PM')
  assert.equal(dutySince('2026-10-27T19:14:00Z', now), 'Oct 27, 2:14 PM')
  assert.equal(dutySince(null, now), '')
})
