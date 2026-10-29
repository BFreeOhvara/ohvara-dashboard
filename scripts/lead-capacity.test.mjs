// Lead capacity card: the pure calculation in src/lib/leadCapacity.js. No network.
//   node --test scripts/lead-capacity.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  threshold, fundedAgents, capacity, windowFor, deliveredCounts, countUnassigned, buildCapacity, copyText,
} from '../src/lib/leadCapacity.js'

const T = 3000
const PRICES = [
  { lead_type: 'mortgage_protection', price_cents: 3000, active: true },
  { lead_type: 'policy_help', price_cents: 5500, active: true },
]
const agent = (id, o = {}) => ({ id, role: 'agent', is_active: true, ...o })
const on = (agent_id, daily_cap = 5) => ({ agent_id, active: true, daily_cap })
const iso = s => new Date(s).toISOString()
const hours = w => (w.end - w.start) / 36e5

function funded({ settings, balances, profiles, t = T }) {
  return fundedAgents({ settings, balances, profiles, threshold: t })
}

test('threshold is the lowest active price; inactive rows are ignored', () => {
  assert.equal(threshold(PRICES), 3000)
  assert.equal(threshold([{ ...PRICES[0], active: false }, PRICES[1]]), 5500)
})

test('no active price row: threshold is null and nothing is computed from a price', () => {
  assert.equal(threshold([]), null)
  assert.equal(threshold(PRICES.map(p => ({ ...p, active: false }))), null)
  assert.equal(funded({ settings: [on('a')], balances: [{ agent_id: 'a', balance_cents: 99999 }], profiles: [agent('a')], t: null }), null)
  const c = buildCapacity({ prices: [], settings: [on('a')], balances: [{ agent_id: 'a', balance_cents: 99999 }], profiles: [agent('a')], now: '2026-10-28T12:00:00Z' })
  assert.equal(c.threshold, null)
  assert.equal(c.funded, null)
  assert.equal(c.cap, null)
  assert.equal(c.delivered, null)
  assert.match(copyText(c), /Funded agents: No price set/)
})

test('funded rule: T-1 is not funded, T and T+1 are', () => {
  const ids = ['short', 'equal', 'over']
  const f = funded({
    settings: ids.map(id => on(id)),
    balances: [{ agent_id: 'short', balance_cents: T - 1 }, { agent_id: 'equal', balance_cents: T }, { agent_id: 'over', balance_cents: T + 1 }],
    profiles: ids.map(id => agent(id)),
  })
  assert.deepEqual(f.map(a => a.agent_id), ['equal', 'over'])
})

test('balance equal to the threshold counts as funded', () => {
  const f = funded({ settings: [on('a')], balances: [{ agent_id: 'a', balance_cents: T }], profiles: [agent('a')] })
  assert.equal(f.length, 1)
})

test('no balance row means 0, not funded', () => {
  const f = funded({ settings: [on('a')], balances: [], profiles: [agent('a')] })
  assert.equal(f.length, 0)
})

test('leads off, inactive profile, non-agent role or missing profile are excluded', () => {
  const rich = id => ({ agent_id: id, balance_cents: 50000 })
  const f = funded({
    settings: [on('ok'), { agent_id: 'off', active: false, daily_cap: 5 }, on('gone'), on('admin'), on('noprof')],
    balances: ['ok', 'off', 'gone', 'admin', 'noprof'].map(rich),
    profiles: [agent('ok'), agent('off'), agent('gone', { is_active: false }), agent('admin', { role: 'admin' })],
  })
  assert.deepEqual(f.map(a => a.agent_id), ['ok'])
})

test('null cap is left out of C and counted apart; 0 is a real cap', () => {
  const ids = ['a', 'b', 'c', 'd']
  const f = funded({
    settings: [on('a', 10), on('b', null), on('c', 0), on('d', 3)],
    balances: ids.map(id => ({ agent_id: id, balance_cents: T })),
    profiles: ids.map(id => agent(id)),
  })
  assert.deepEqual(capacity(f), { cap: 13, noCap: 1 })
  assert.deepEqual(capacity([{ agent_id: 'z', daily_cap: 0 }]), { cap: 0, noCap: 0 })
})

test('F = 0 gives C = 0, L7 = 0 and 0.0 a day (no division by zero)', () => {
  const c = buildCapacity({
    prices: PRICES, settings: [on('a')], balances: [], profiles: [agent('a')],
    delivered: [{ assigned_rep_id: 'a', lead_type: 'mortgage_protection', delivered_at: '2026-10-20T15:00:00Z' }],
    now: '2026-10-28T12:00:00Z',
  })
  assert.equal(c.funded, 0)
  assert.equal(c.cap, 0)
  assert.equal(c.noCap, 0)
  assert.equal(c.delivered, 0)
  assert.equal(c.perDay, 0)
  assert.equal(c.deliveredAll, 1)
  assert.ok(Number.isFinite(c.perDay))
})

test('windowFor: Wed Oct 28 2026 gives Oct 18 05:00Z to Oct 25 05:00Z', () => {
  const w = windowFor(new Date('2026-10-28T12:00:00Z'))
  assert.equal(iso(w.start), '2026-10-18T05:00:00.000Z')
  assert.equal(iso(w.end), '2026-10-25T05:00:00.000Z')
  assert.equal(w.label, 'Sun Oct 18 to Sat Oct 24')
})

test('windowFor: Wed Nov 4 2026 gives Oct 25 05:00Z to Nov 1 05:00Z', () => {
  const w = windowFor(new Date('2026-11-04T18:00:00Z'))
  assert.equal(iso(w.start), '2026-10-25T05:00:00.000Z')
  assert.equal(iso(w.end), '2026-11-01T05:00:00.000Z')
  assert.equal(w.label, 'Sun Oct 25 to Sat Oct 31')
})

test('windowFor: Mon Nov 9 2026 (fall back week) gives Nov 1 05:00Z to Nov 8 06:00Z, 169 hours', () => {
  const w = windowFor(new Date('2026-11-09T18:00:00Z'))
  assert.equal(iso(w.start), '2026-11-01T05:00:00.000Z')
  assert.equal(iso(w.end), '2026-11-08T06:00:00.000Z')
  assert.equal(hours(w), 169)
  assert.equal(w.label, 'Sun Nov 1 to Sat Nov 7')
})

test('windowFor: exactly Sunday 00:00 Central uses the week that just ended', () => {
  const at = new Date('2026-10-25T05:00:00Z') // Sun Oct 25 00:00 CDT
  const w = windowFor(at)
  assert.equal(iso(w.start), '2026-10-18T05:00:00.000Z')
  assert.equal(iso(w.end), '2026-10-25T05:00:00.000Z')
  // One millisecond earlier is still Saturday: the week before.
  const before = windowFor(new Date(at.getTime() - 1))
  assert.equal(iso(before.end), '2026-10-18T05:00:00.000Z')
  // Saturday 11 PM Central (Sunday 04:00Z) is not yet the new week.
  assert.equal(iso(windowFor(new Date('2026-10-25T04:00:00Z')).end), '2026-10-18T05:00:00.000Z')
})

test('windowFor: spring forward week Mar 14 to Mar 20 2027 gives Mar 14 06:00Z to Mar 21 05:00Z, 167 hours', () => {
  const w = windowFor(new Date('2027-03-23T17:00:00Z'))
  assert.equal(iso(w.start), '2027-03-14T06:00:00.000Z')
  assert.equal(iso(w.end), '2027-03-21T05:00:00.000Z')
  assert.equal(hours(w), 167)
  assert.equal(w.label, 'Sun Mar 14 to Sat Mar 20')
})

test('L7 counts typed leads inside the window to funded agents; all agents counts every agent', () => {
  const w = windowFor(new Date('2026-10-28T12:00:00Z'))
  const leads = [
    { assigned_rep_id: 'f', lead_type: 'mortgage_protection', delivered_at: '2026-10-20T15:00:00Z' },
    { assigned_rep_id: 'f', lead_type: 'policy_help', delivered_at: '2026-10-24T23:00:00Z' },
    { assigned_rep_id: 'u', lead_type: 'policy_help', delivered_at: '2026-10-21T15:00:00Z' }, // unfunded agent
    { assigned_rep_id: 'f', lead_type: 'cancellation', delivered_at: '2026-10-21T15:00:00Z' }, // not typed
    { assigned_rep_id: 'f', lead_type: 'mortgage_protection', delivered_at: '2026-10-26T15:00:00Z' }, // after
    { assigned_rep_id: 'f', lead_type: 'mortgage_protection', delivered_at: '2026-10-17T15:00:00Z' }, // before
    { assigned_rep_id: 'f', lead_type: 'mortgage_protection', delivered_at: null },
  ]
  assert.deepEqual(deliveredCounts(leads, w, ['f']), { all: 3, funded: 2 })
})

test('a lead at the exact start counts; at the exact end does not', () => {
  const w = windowFor(new Date('2026-10-28T12:00:00Z'))
  const at = t => [{ assigned_rep_id: 'f', lead_type: 'mortgage_protection', delivered_at: t }]
  assert.equal(deliveredCounts(at('2026-10-18T05:00:00.000Z'), w, ['f']).funded, 1)
  assert.equal(deliveredCounts(at('2026-10-25T05:00:00.000Z'), w, ['f']).funded, 0)
  assert.equal(deliveredCounts(at('2026-10-25T04:59:59.999Z'), w, ['f']).funded, 1)
})

test('U counts typed unassigned leads; ignores cancellation and assigned leads', () => {
  const u = countUnassigned([
    { lead_type: 'mortgage_protection', assigned_rep_id: null },
    { lead_type: 'policy_help', assigned_rep_id: null },
    { lead_type: 'policy_review', assigned_rep_id: null },
    { lead_type: 'cancellation', assigned_rep_id: null },
    { lead_type: 'policy_help', assigned_rep_id: 'f' },
  ])
  assert.equal(u, 3)
})

test('copy text has every figure, both windows and the proposal label', () => {
  const ids = ['a', 'b', 'c']
  const c = buildCapacity({
    prices: PRICES,
    settings: [on('a', 20), on('b', 18), on('c', null), on('x', 9)],
    balances: [...ids.map(id => ({ agent_id: id, balance_cents: 4000 })), { agent_id: 'x', balance_cents: 100 }],
    profiles: [...ids.map(id => agent(id)), agent('x')],
    delivered: [
      ...Array.from({ length: 142 }, (_, i) => ({ assigned_rep_id: ids[i % 3], lead_type: 'mortgage_protection', delivered_at: '2026-10-20T15:00:00Z' })),
      ...Array.from({ length: 9 }, () => ({ assigned_rep_id: 'x', lead_type: 'policy_help', delivered_at: '2026-10-21T15:00:00Z' })),
    ],
    unassigned: Array.from({ length: 4 }, () => ({ lead_type: 'mortgage_protection', assigned_rep_id: null })),
    now: '2026-10-29T02:28:00Z', // Wed Oct 28, 9:28 PM Central
  })
  assert.equal(c.funded, 3)
  assert.equal(c.cap, 38)
  assert.equal(c.noCap, 1)
  const txt = copyText(c)
  for (const want of [
    'as of Wed Oct 28, 9:28 PM',
    'Week: Sun Oct 18 to Sat Oct 24',
    '2026-10-18 05:00 (included) to 2026-10-25 05:00 (not included)',
    'Funded agents: 3 (leads on, balance at least $30.00',
    'Daily cap across funded agents: 38 a day (1 funded agent has no cap set)',
    'Mortgage protection: $30.00 (proposal, not decided)',
    'Policy help: $55.00 (proposal, not decided)',
    'Delivered last week to funded agents: 142 (20.3 a day)',
    'Delivered last week, all agents: 151',
    'Unassigned now: 4 typed leads waiting for an agent',
  ]) assert.ok(txt.includes(want), `missing: ${want}\n${txt}`)
})
