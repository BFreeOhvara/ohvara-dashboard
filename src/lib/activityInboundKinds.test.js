// Every kind of inbound event reaches Activity and opens its inbound.
//   node --test src/lib/activityInboundKinds.test.js
// Written from the task, not from the builder's code: a fixture with one finished step of each kind runs through
// inboundActivityItems, each gives one item with its words, leadId and page. A source check proves Activity.jsx
// opens that page on a tap. The feed's own kinds (migration 185) are covered through the kind map.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { inboundActivityItems, inboundPath, eventTitle } from './inbounds.js'
import { EVENT_KIND, EVENT_KINDS, kindMeta, groupOf, filterItems, groupCounts, visibleGroups, FILTER_GROUPS } from './activityKinds.js'

const src = p => readFileSync(new URL(p, import.meta.url), 'utf8')
const LEADS = Array.from({ length: 7 }, (_, i) => ({ lead_id: `lead-${i + 1}`, contact_name: `Caller ${i + 1}`, phone: `+1555555010${i}` }))
const ev = (id, lead_id, kind, extra = {}) => ({ id, lead_id, kind, state: 'done', at: '2026-10-30T15:00:00Z', label: null, detail: {}, ...extra })

// One finished step per kind, each on its own inbound, with the words the page should show.
const CASES = [
  { kind: 'came_in', event: {}, text: 'Came in' },
  { kind: 'text_sent', event: {}, text: 'Text sent' },
  { kind: 'text_received', event: { detail: { text: 'Call me after 5' } }, text: 'Replied by text · “Call me after 5”' },
  { kind: 'va_call', event: { detail: { summary: 'Reached, wants Tuesday' } }, text: 'VA called · Reached, wants Tuesday' },
  { kind: 'booked', event: {}, text: 'Booked with you' },
  { kind: 'transferred', event: {}, text: 'Transferred to you' },
  { kind: 'outcome', event: { detail: { summary: 'Follow up' } }, text: 'Outcome marked · Follow up' },
]
const events = CASES.map((c, i) => ev(`e${i + 1}`, `lead-${i + 1}`, c.kind, c.event))

test('fixture covers came_in, text_sent, text_received, va_call, booked, transferred and outcome', () => {
  assert.deepEqual(CASES.map(c => c.kind), ['came_in', 'text_sent', 'text_received', 'va_call', 'booked', 'transferred', 'outcome'])
})

test('each kind gives one item with its words, its leadId and the page it opens', () => {
  const items = inboundActivityItems(events, LEADS)
  assert.equal(items.length, CASES.length)
  CASES.forEach((c, i) => {
    const mine = items.filter(it => it.id === `e${i + 1}`)
    assert.equal(mine.length, 1, `${c.kind}: exactly one item`)
    const [it] = mine
    assert.equal(it.text, c.text, `${c.kind}: text`)
    assert.equal(it.leadId, `lead-${i + 1}`, `${c.kind}: leadId`)
    assert.equal(it.client, `Caller ${i + 1}`, `${c.kind}: client name`)
    assert.equal(it.at, '2026-10-30T15:00:00Z', `${c.kind}: at`)
    assert.equal(it.key, `i-e${i + 1}`)
    assert.equal(it.row, 'inbound')
    assert.equal(inboundPath(it.leadId), `/agent/inbounds/lead-${i + 1}`, `${c.kind}: opens its inbound page`)
  })
})

test('a label on the event wins over the default words, for every kind', () => {
  for (const c of CASES) {
    const labelled = ev('x', 'lead-1', c.kind, { label: `Custom ${c.kind}` })
    assert.equal(eventTitle(labelled), `Custom ${c.kind}`)
    assert.equal(inboundActivityItems([labelled], LEADS)[0].text, `Custom ${c.kind}`)
  }
})

test('two steps on one inbound stay two items that both open that inbound', () => {
  const items = inboundActivityItems([ev('a', 'lead-1', 'came_in'), ev('b', 'lead-1', 'text_sent')], LEADS)
  assert.deepEqual(items.map(i => i.id), ['a', 'b'])
  assert.deepEqual(items.map(i => inboundPath(i.leadId)), ['/agent/inbounds/lead-1', '/agent/inbounds/lead-1'])
})

test('an empty agent: no events and no inbounds give no items', () => {
  assert.deepEqual(inboundActivityItems([], []), [])
  assert.deepEqual(inboundActivityItems(events, []), [])
})

test('Activity.jsx opens the inbound on a tap: navigate(inboundPath(item.leadId))', () => {
  const page = src('../pages/agent/Activity.jsx')
  assert.match(page, /navigate\(inboundPath\(item\.leadId\)\)/)
  assert.match(page, /import \{ inboundPath \} from '\.\.\/\.\.\/lib\/inbounds'/)
  // An item with target "lead" is the one that takes that branch.
  assert.match(page, /if \(item\.target === 'lead'\) return navigate\(inboundPath/)
})

test('the route inboundPath builds exists in the router', () => {
  assert.match(src('../App.jsx'), /agent\/inbounds\/:/)
})

// ── The feed's kinds (agent_activity_feed, migration 185), through the kind map ──────────────────────
const FEED_KINDS = ['inbound', 'text_auto', 'text_reply', 'va_call', 'booked', 'transferred', 'outcome']

test('feed kinds: each has a label, pill and icon, and sits in exactly one visible filter group', () => {
  const visible = new Set(visibleGroups().map(g => g.key))
  for (const k of FEED_KINDS) {
    assert.ok(EVENT_KINDS.includes(k), `${k} in EVENT_KINDS`)
    assert.ok(EVENT_KIND[k].label && EVENT_KIND[k].pill && EVENT_KIND[k].icon, `${k}: label, pill, icon`)
    assert.equal(kindMeta(k), EVENT_KIND[k], `${k}: not the unknown-kind fallback`)
    assert.equal(FILTER_GROUPS.filter(g => g.kinds.includes(k)).length, 1, `${k}: one group`)
    assert.ok(visible.has(groupOf(k)), `${k}: its chip shows`)
  }
})

test('feed kinds: the chips pick the right rows and the box counts each once', () => {
  const rows = FEED_KINDS.map(kind => ({ kind }))
  assert.deepEqual(groupCounts(rows), { leads: 1, texts: 2, calls: 2, bookings: 1, outcomes: 1, clients: 0, billing: 0 })
  const by = key => filterItems(rows, [key]).map(r => r.kind)
  assert.deepEqual(by('leads'), ['inbound'])
  assert.deepEqual(by('texts'), ['text_auto', 'text_reply'])
  assert.deepEqual(by('calls'), ['va_call', 'transferred'])
  assert.deepEqual(by('bookings'), ['booked'])
  assert.deepEqual(by('outcomes'), ['outcome'])
  assert.equal(filterItems(rows, []).length, FEED_KINDS.length)
})

test('feed kinds: Activity.jsx has a sentence for each and sends lead rows to the inbound', () => {
  const page = src('../pages/agent/Activity.jsx')
  for (const k of FEED_KINDS.filter(k => k !== 'inbound')) assert.match(page, new RegExp(`case '${k}':`), `rowText handles ${k}`)
  assert.match(page, /if \(r\.lead_id\) return 'lead'/)
})

test('185 leaves out inbound_events text_sent on purpose: it is not a feed kind', () => {
  assert.ok(!EVENT_KINDS.includes('text_sent'))
  assert.ok(!EVENT_KINDS.includes('text_received'))
  const sql = src('../../supabase/migrations/185_activity_feed.sql')
  assert.match(sql, /Left out on purpose: inbound_events text_sent and reminder rows/)
})

test('fallback (before 185 is applied): every inbound step is one Leads row, whatever its kind', () => {
  // Activity.jsx keeps kind "inbound" for these items, so texts, calls and outcomes count under Leads until the function is live.
  const items = inboundActivityItems(events, LEADS).map(i => ({ ...i, target: 'lead', pill: 'Lead update' }))
  assert.ok(items.every(i => i.kind === 'inbound' && groupOf(i.kind) === 'leads'))
  assert.equal(groupCounts(items).leads, CASES.length)
})
