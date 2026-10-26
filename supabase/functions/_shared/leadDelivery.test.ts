/**
 * Node unit tests for lead delivery with the prepaid lead charge. Fakes stand
 * in for assignment, recovery_config and charge_lead (migrations 169 and 171).
 * Run: node --test supabase/functions/_shared/leadDelivery.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deliver, priceFromMap, type ChargeResult, type DeliveryDeps } from './leadDelivery.ts'

const AGENT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

function deps(o: { agent?: string | null; price?: number | null; charge?: ChargeResult | Error } = {}) {
  const log: string[] = []
  const d: DeliveryDeps = {
    async assign(id) { log.push(`assign:${id}`); return o.agent === undefined ? AGENT : o.agent },
    async unassign(id, agent) { log.push(`unassign:${id}:${agent}`) },
    async priceFor(type) { log.push(`price:${type}`); return o.price === undefined ? null : o.price },
    async charge(id) {
      log.push(`charge:${id}`)
      if (o.charge instanceof Error) throw o.charge
      return o.charge ?? 'charged'
    },
    async markDelivered(id, at) { log.push(`delivered:${id}:${at}`) },
    now: () => new Date('2026-10-26T02:21:00Z'),
    log: m => log.push(`log:${m}`),
  }
  return { d, log }
}

test('no price set for the type: delivered with no charge at all', async () => {
  const { d, log } = deps({ price: null })
  assert.deepEqual(await deliver(d, 'L1', 'mortgage_protection'), { outcome: 'delivered', agent: AGENT, charged: false })
  assert.deepEqual(log, ['assign:L1', 'price:mortgage_protection', 'delivered:L1:2026-10-26T02:21:00.000Z'])
})

test('price set and balance covers it: charged, then delivered', async () => {
  const { d, log } = deps({ price: 2500 })
  assert.deepEqual(await deliver(d, 'L1', 'mortgage_protection'), { outcome: 'delivered', agent: AGENT, charged: true })
  assert.deepEqual(log, ['assign:L1', 'price:mortgage_protection', 'charge:L1', 'delivered:L1:2026-10-26T02:21:00.000Z'])
})

test('a repeat (already charged) is delivered without a second charge row', async () => {
  const { d } = deps({ price: 2500, charge: 'already_charged' })
  assert.deepEqual(await deliver(d, 'L1', 'mortgage_protection'), { outcome: 'delivered', agent: AGENT, charged: true })
})

test('balance short: the lead is unassigned again and not delivered', async () => {
  const { d, log } = deps({ price: 2500, charge: 'insufficient' })
  assert.deepEqual(await deliver(d, 'L1', 'mortgage_protection'), { outcome: 'short_balance', agent: AGENT })
  assert.ok(log.includes(`unassign:L1:${AGENT}`))
  assert.ok(!log.some(l => l.startsWith('delivered:')))
})

test('charge errors: unassigned, then the error goes up', async () => {
  const { d, log } = deps({ price: 2500, charge: new Error('db down') })
  await assert.rejects(deliver(d, 'L1', 'mortgage_protection'), /db down/)
  assert.ok(log.includes(`unassign:L1:${AGENT}`))
  assert.ok(!log.some(l => l.startsWith('delivered:')))
})

test('nobody qualifies: unassigned, no price lookup, no charge', async () => {
  const { d, log } = deps({ agent: null, price: 2500 })
  assert.deepEqual(await deliver(d, 'L1', 'mortgage_protection'), { outcome: 'unassigned' })
  assert.deepEqual(log, ['assign:L1'])
})

test('priceFromMap reads one type; anything odd is no price', () => {
  assert.equal(priceFromMap({ mortgage_protection: 2500 }, 'mortgage_protection'), 2500)
  assert.equal(priceFromMap({ mortgage_protection: 2500 }, 'policy_review'), null)
  for (const m of [null, undefined, [], 'x', { mortgage_protection: 0 }, { mortgage_protection: -5 }, { mortgage_protection: 12.5 }, { mortgage_protection: '2500' }]) {
    assert.equal(priceFromMap(m, 'mortgage_protection'), null, JSON.stringify(m))
  }
})
