/**
 * prepaid_balance_concurrency — two real database sessions racing on the
 * prepaid lead ledger (migration 176, Roadmap Goal 3). The single-session
 * checks are in p_prepaid_balance.sql.
 *
 *   1. same lead charged twice at once, one charge
 *   2. charge never takes balance below 0: two different leads, a balance
 *      that covers one price, charged at once → one charged, one insufficient
 *
 * THROWAWAY DATABASES ONLY. The seed (test agents, top-ups, leads) has to be
 * committed so both sessions see it, and the ledger is append-only, so its rows
 * stay. The script refuses any host but localhost / 127.0.0.1 / ::1.
 *
 * Run (166 and 176 applied, as the postgres role):
 *   PREPAID_TEST_DB_URL=postgres://postgres:postgres@127.0.0.1:54322/postgres \
 *     deno test -A --node-modules-dir=none supabase/tests/prepaid_balance_concurrency.mjs
 * or with `pg` installed: node --test supabase/tests/prepaid_balance_concurrency.mjs
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

const pg = await import('pg').catch(() => import('npm:pg@8'))
const { Client } = pg.default ?? pg

const URL_ = process.env.PREPAID_TEST_DB_URL || ''
const host = (() => { try { return new URL(URL_).hostname.replace(/^\[|\]$/g, '') } catch { return '' } })()
if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
  throw new Error('PREPAID_TEST_DB_URL must be a local throwaway database (localhost / 127.0.0.1 / ::1); refusing to run.')
}

const ROUNDS = 10
const tag = randomUUID().slice(0, 8)
let admin                                    // seeds and reads, as postgres
let price                                    // the active mortgage_protection price

const connect = async () => {
  const c = new Client({ connectionString: URL_ })
  await c.connect()
  return c
}

// A racing session: the caller the app uses (service_role) when that role exists.
async function session() {
  const c = await connect()
  const { rows } = await c.query(`select exists (select 1 from pg_roles where rolname = 'service_role') as ok`)
  if (rows[0].ok) await c.query('set role service_role')
  return c
}

let seq = 0
async function agentWithBalance(cents) {
  const id = randomUUID()
  seq++
  await admin.query(
    `insert into auth.users (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
     values ('00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated', $2,
             '{"provider":"email","providers":["email"],"role":"agent"}', '{"full_name":"Prepaid race"}', now(), now())`,
    [id, `prepaid_race_${tag}_${seq}@example.invalid`])
  if (cents > 0) {
    const { rows } = await admin.query('select result from public.credit_topup($1, $2, $3, $4)',
      [id, cents, `cs_test_race_${tag}_${seq}`, `evt_race_${tag}_${seq}`])
    assert.equal(rows[0].result, 'credited')
  }
  return id
}

async function lead(agent) {
  const { rows } = await admin.query(
    `insert into public.leads (business_name, lead_type, assigned_rep_id) values ('Prepaid race', 'mortgage_protection', $1) returning id`,
    [agent])
  return rows[0].id
}

const charge = (c, leadId) => c.query('select * from public.charge_lead($1)', [leadId]).then(r => r.rows[0])

async function ledger(agent) {
  const { rows } = await admin.query(
    `select count(*) filter (where kind = 'charge')::int as charges,
            coalesce(sum(amount_cents), 0)::int as balance,
            coalesce(min(balance_after_cents), 0)::int as lowest
       from public.agent_lead_ledger where agent_id = $1`, [agent])
  return rows[0]
}

// Waits until `pid` is blocked on a lock (so the race is real, not sequential).
async function waitBlocked(pid) {
  for (let i = 0; i < 100; i++) {
    const { rows } = await admin.query('select wait_event_type from pg_stat_activity where pid = $1', [pid])
    if (rows[0]?.wait_event_type === 'Lock') return true
    await new Promise(r => setTimeout(r, 20))
  }
  return false
}

before(async () => {
  admin = await connect()
  const { rows } = await admin.query(`select price_cents from public.lead_prices where lead_type = 'mortgage_protection' and active`)
  assert.ok(rows[0], 'needs an active mortgage_protection price in lead_prices (176 seeds 3000)')
  price = rows[0].price_cents
})
after(async () => { await admin?.end() })

test('same lead charged twice at once, one charge (second session waits on the first)', async () => {
  const agent = await agentWithBalance(price * 3)
  const L = await lead(agent)
  const s1 = await session(), s2 = await session()
  try {
    await s1.query('begin')
    await s2.query('begin')
    const r1 = await charge(s1, L)                       // holds the lead row, its charge uncommitted
    const p2 = charge(s2, L)                             // must wait on the lead row
    assert.ok(await waitBlocked(s2.processID), 'second session should be waiting on a lock')
    await s1.query('commit')
    const r2 = await p2
    await s2.query('commit')
    assert.equal(r1.result, 'charged')
    assert.equal(r2.result, 'already_charged')
    assert.equal(r2.ledger_id, r1.ledger_id)
  } finally { await s1.end(); await s2.end() }
  const l = await ledger(agent)
  assert.equal(l.charges, 1, 'exactly one charge row')
  assert.equal(l.balance, price * 2, 'balance dropped once')
})

test(`each lead charged once: same lead from two sessions at the same instant, ${ROUNDS} rounds`, async () => {
  const s1 = await session(), s2 = await session()
  try {
    for (let i = 0; i < ROUNDS; i++) {
      const agent = await agentWithBalance(price * 3)
      const L = await lead(agent)
      const got = (await Promise.all([charge(s1, L), charge(s2, L)])).map(r => r.result).sort()
      assert.deepEqual(got, ['already_charged', 'charged'], `round ${i}`)
      const l = await ledger(agent)
      assert.equal(l.charges, 1, `round ${i}: one charge row`)
      assert.equal(l.balance, price * 2, `round ${i}: balance dropped once`)
    }
  } finally { await s1.end(); await s2.end() }
})

test('charge never takes balance below 0: two leads, a one-lead balance, second session waits', async () => {
  const agent = await agentWithBalance(price)
  const L1 = await lead(agent), L2 = await lead(agent)
  const s1 = await session(), s2 = await session()
  try {
    await s1.query('begin')
    await s2.query('begin')
    const r1 = await charge(s1, L1)                      // holds the agent lock
    const p2 = charge(s2, L2)                            // a different lead: must wait on the agent lock
    assert.ok(await waitBlocked(s2.processID), 'second session should be waiting on the agent lock')
    await s1.query('commit')
    const r2 = await p2
    await s2.query('commit')
    assert.equal(r1.result, 'charged')
    assert.equal(r2.result, 'insufficient')
    assert.equal(Number(r1.balance_cents), 0)
  } finally { await s1.end(); await s2.end() }
  const l = await ledger(agent)
  assert.equal(l.charges, 1, 'exactly one charge row')
  assert.equal(l.balance, 0)
  assert.ok(l.lowest >= 0, `lowest balance_after ${l.lowest}`)
})

test(`charge never takes balance below 0: two leads at the same instant, ${ROUNDS} rounds`, async () => {
  const s1 = await session(), s2 = await session()
  try {
    for (let i = 0; i < ROUNDS; i++) {
      const agent = await agentWithBalance(price)
      const L1 = await lead(agent), L2 = await lead(agent)
      const got = (await Promise.all([charge(s1, L1), charge(s2, L2)])).map(r => r.result).sort()
      assert.deepEqual(got, ['charged', 'insufficient'], `round ${i}`)
      const l = await ledger(agent)
      assert.equal(l.charges, 1, `round ${i}: one charge row`)
      assert.equal(l.balance, 0, `round ${i}: balance 0`)
      assert.ok(l.lowest >= 0, `round ${i}: lowest balance_after ${l.lowest}`)
    }
  } finally { await s1.end(); await s2.end() }
})
