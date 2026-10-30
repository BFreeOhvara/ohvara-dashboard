// The Activity page's kind map: every kind agent_activity_feed() returns has a label,
// a pill, an icon, colour tokens that exist for both themes, and exactly one filter group.
//   node --test src/lib/activityKinds.test.js
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  EVENT_KINDS, EVENT_KIND, FILTER_GROUPS, PENDING_KINDS, kindMeta, itemMeta, itemTone, kindTone, groupOf, activityRow, rowMeta,
} from './activityKinds.js'

// The kinds migration 185 documents, read from the file so a rename there fails here.
const migration = readFileSync(new URL('../../supabase/migrations/185_activity_feed.sql', import.meta.url), 'utf8')
const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8')

// Custom properties defined inside the dark (:root) or light ([data-theme="light"]) blocks.
function tokens(selector) {
  const out = new Set()
  const re = new RegExp(`(?:^|\\n)${selector.replace(/[[\]"=.]/g, '\\$&')}\\s*\\{([^}]*)\\}`, 'g')
  for (const m of css.matchAll(re)) for (const d of m[1].matchAll(/(--[\w-]+)\s*:/g)) out.add(d[1])
  return out
}
const DARK = tokens(':root')
const LIGHT = tokens('[data-theme="light"]')

const LIVE_KINDS = [
  'inbound', 'text_auto', 'text_reply', 'va_call', 'booked', 'moved', 'no_answer', 'in_progress', 'edited', 'reassigned',
  'transferred', 'outcome', 'sold', 'cancelled', 'servicing',
]
const PENDING = ['billing_subscription', 'billing_spend_change', 'billing_spend_pause']

test('EVENT_KINDS lists every live and pending kind', () => {
  assert.deepEqual([...EVENT_KINDS].sort(), [...LIVE_KINDS, ...PENDING].sort())
  assert.deepEqual([...PENDING_KINDS].sort(), [...PENDING].sort())
})

test('the migration still names every kind', () => {
  for (const k of LIVE_KINDS) assert.ok(migration.includes(`'${k}'`), `migration 185 no longer mentions '${k}'`)
  for (const k of PENDING) assert.ok(migration.includes(k), `migration 185 no longer mentions ${k}`)
})

test('every kind has a label, a pill and an icon', () => {
  for (const k of EVENT_KINDS) {
    const m = EVENT_KIND[k]
    assert.ok(m, `${k} is missing from EVENT_KIND`)
    assert.ok(m.label && m.pill, `${k} needs a label and a pill`)
    assert.ok(m.icon, `${k} needs an icon`)
  }
  assert.equal(EVENT_KIND.no_answer.label, 'No-show')
})

test('every colour token a kind names exists in both themes', () => {
  for (const k of EVENT_KINDS) {
    const m = EVENT_KIND[k]
    const names = [m.base, m.tint || `${m.base}-tint`, m.edge || `${m.base}-edge`]
    for (const n of names) {
      assert.ok(DARK.has(n), `${k}: ${n} is not defined under :root`)
      assert.ok(LIGHT.has(n), `${k}: ${n} is not defined under [data-theme="light"]`)
    }
  }
  for (const g of FILTER_GROUPS) {
    for (const n of [g.base, g.tint || `${g.base}-tint`, g.edge || `${g.base}-edge`]) {
      assert.ok(DARK.has(n) && LIGHT.has(n), `group ${g.key}: ${n} is missing from a theme`)
    }
  }
})

test('every kind belongs to exactly one filter group', () => {
  for (const k of EVENT_KINDS) {
    assert.equal(FILTER_GROUPS.filter(g => g.kinds.includes(k)).length, 1, `${k} must be in exactly one group`)
  }
  for (const g of FILTER_GROUPS) for (const k of g.kinds) assert.ok(EVENT_KINDS.includes(k), `${g.key} names unknown kind ${k}`)
  assert.deepEqual(FILTER_GROUPS.map(g => g.label), ['Leads', 'Texts', 'Calls', 'Bookings', 'Outcomes', 'Clients', 'Billing'])
  assert.equal(groupOf('servicing'), 'clients')
})

test('an unknown kind falls back safely', () => {
  assert.equal(kindMeta('mystery'), EVENT_KIND.moved)
  assert.equal(itemMeta({ kind: 'mystery' }), EVENT_KIND.moved)
  assert.deepEqual(kindTone('mystery'), kindTone('moved'))
  assert.equal(groupOf('mystery'), null)
})

test('a VA call that did not reach the client reads as its own row', () => {
  assert.equal(itemMeta({ kind: 'va_call', reason: 'callback' }).pill, 'VA reached')
  assert.equal(itemMeta({ kind: 'va_call', reason: 'not_reached' }).pill, 'Not reached')
  assert.equal(itemTone({ kind: 'va_call', reason: 'not_reached' }).fg, 'var(--ov-st-noanswer)')
})

test('tones use var() tokens only, billing is neutral', () => {
  for (const k of EVENT_KINDS) {
    const t = kindTone(k)
    for (const v of Object.values(t)) assert.match(v, /^var\(--[\w-]+\)$/)
  }
  assert.equal(kindTone('billing_spend_pause').tint, 'var(--ov-neutral-tint)')
})

test('activityRow still maps moved, edited and reassigned to the current status', () => {
  for (const kind of ['moved', 'edited', 'reassigned']) {
    assert.equal(activityRow(kind, 'noAnswer'), 'no_answer')
    assert.equal(activityRow(kind, 'cancelled'), 'cancelled')
    assert.equal(activityRow(kind, 'needs'), 'needs')
    assert.equal(activityRow(kind, null), 'booked')
  }
  assert.equal(activityRow('in_progress', 'booked'), 'in_progress')
  assert.equal(activityRow('cancelled', null), 'cancelled')
  assert.equal(rowMeta('in_progress').label, 'Calls')
})
