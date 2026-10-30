// The Activity page's type filter: chips, selection, counts and the empty states.
// Fixtures only; nothing here reads Supabase.
//   node --test src/lib/activityFilters.test.js
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  FILTER_GROUPS, PENDING_KINDS, EVENT_KINDS, visibleGroups, groupCounts, toggleGroup, parseSelected, filterItems, groupOf, EMPTY_ALL, EMPTY_MANY,
} from './activityKinds.js'

const row = (kind, n = 1) => ({ key: `${kind}-${n}`, kind })
const DAY = [
  row('inbound', 1), row('inbound', 2), row('text_auto'), row('text_reply'), row('va_call'), row('transferred'), row('booked', 1), row('booked', 2),
  row('moved'), row('no_answer'), row('sold'), row('cancelled'), row('servicing'), row('outcome'),
]

test('counts: one per group over the whole day, zeros included', () => {
  assert.deepEqual(groupCounts(DAY), { leads: 2, texts: 2, calls: 2, bookings: 4, outcomes: 1, clients: 3, billing: 0 })
  assert.deepEqual(groupCounts([]), { leads: 0, texts: 0, calls: 0, bookings: 0, outcomes: 0, clients: 0, billing: 0 })
})

test('counts: an unknown kind is in no group', () => {
  assert.equal(groupCounts([row('mystery')]).leads, 0)
  assert.equal(Object.values(groupCounts([row('mystery')])).reduce((a, b) => a + b, 0), 0)
})

test('All: no selection shows every row', () => {
  assert.equal(filterItems(DAY, []), DAY)
})

test('one group shows only that group', () => {
  assert.deepEqual(filterItems(DAY, ['texts']).map(i => i.kind), ['text_auto', 'text_reply'])
  assert.equal(filterItems(DAY, ['bookings']).length, 4)
  assert.deepEqual(filterItems(DAY, ['outcomes']).map(i => i.kind), ['outcome'])
})

test('several groups show the union, and the counts add up', () => {
  const picked = filterItems(DAY, ['calls', 'bookings'])
  assert.equal(picked.length, 6)
  assert.ok(picked.every(i => ['calls', 'bookings'].includes(groupOf(i.kind))))
  const counts = groupCounts(DAY)
  assert.equal(picked.length, counts.calls + counts.bookings)
})

test('a filter with nothing in it is empty, and an unknown kind never matches one', () => {
  assert.deepEqual(filterItems(DAY.filter(i => i.kind !== 'outcome'), ['outcomes']), [])
  assert.deepEqual(filterItems([row('mystery')], ['leads']), [])
  assert.equal(filterItems([row('mystery')], []).length, 1)
})

test('toggling: add, remove, and every visible chip on is the same as All', () => {
  assert.deepEqual(toggleGroup([], 'calls'), ['calls'])
  assert.deepEqual(toggleGroup(['calls'], 'texts'), ['calls', 'texts'])
  assert.deepEqual(toggleGroup(['calls', 'texts'], 'calls'), ['texts'])
  assert.deepEqual(toggleGroup(['calls'], 'calls'), [])
  const all = visibleGroups().map(g => g.key)
  assert.deepEqual(toggleGroup(all.slice(1), all[0]), [])
})

test('the URL: group keys parse in chip order, junk and hidden groups are dropped', () => {
  assert.deepEqual(parseSelected('texts,calls'), ['texts', 'calls'])
  assert.deepEqual(parseSelected('calls,leads'), ['leads', 'calls'])
  assert.deepEqual(parseSelected('mystery,calls'), ['calls'])
  assert.deepEqual(parseSelected('billing'), [])
  assert.deepEqual(parseSelected(null), [])
  assert.deepEqual(parseSelected(''), [])
})

test('PENDING_KINDS: Billing has no source yet, so its chip is hidden; the rest show', () => {
  assert.deepEqual([...PENDING_KINDS].sort(), ['billing_spend_change', 'billing_spend_pause', 'billing_subscription'])
  const keys = visibleGroups().map(g => g.key)
  assert.ok(!keys.includes('billing'))
  assert.deepEqual(keys, ['leads', 'texts', 'calls', 'bookings', 'outcomes', 'clients'])
  // Servicing has no chip of its own: its rows sit under Clients.
  assert.ok(!keys.includes('servicing'))
  assert.equal(groupOf('servicing'), 'clients')
})

test('a group shows again once any of its kinds has a source', () => {
  // visibleGroups() reads PENDING_KINDS live, so a group with a non-pending kind is visible.
  for (const g of FILTER_GROUPS) {
    assert.equal(visibleGroups().includes(g), g.kinds.some(k => !PENDING_KINDS.includes(k)))
  }
})

test('every chip has its own empty sentence, plus one for All and one for several', () => {
  for (const g of FILTER_GROUPS) assert.match(g.empty, /^No .+ on this day\./)
  assert.equal(new Set(FILTER_GROUPS.map(g => g.empty)).size, FILTER_GROUPS.length)
  assert.match(EMPTY_ALL, /^Nothing yet today\./)
  assert.match(EMPTY_MANY, /^Nothing for these filters on this day\./)
  assert.equal(EVENT_KINDS.length, 18)
})

test('wording: no banned words in what the page says', () => {
  const words = [...FILTER_GROUPS.flatMap(g => [g.label, g.empty]), EMPTY_ALL, EMPTY_MANY].join(' ')
  assert.doesNotMatch(words, /\b(meta|google|facebook|ads?|prepaid|top-?up)\b/i)
})

test('the page keeps the filter in the URL and hides the chip row on an empty day', () => {
  const page = readFileSync(new URL('../pages/agent/Activity.jsx', import.meta.url), 'utf8')
  assert.match(page, /params\.get\('types'\)/)
  assert.match(page, /filter=\{feed\.length \?/)
  const hook = readFileSync(new URL('../hooks/useAgentActivity.js', import.meta.url), 'utf8')
  assert.match(hook, /rpc\('agent_activity_feed'/)
  assert.match(hook, /PGRST202/)
  assert.match(hook, /42883/)
})
