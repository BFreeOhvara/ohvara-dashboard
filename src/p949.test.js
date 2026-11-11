import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { mergeLists, draftRange, mergedQuestion } from './lib/clientCheck.js'
import { stateDiff, diffWords, flipState, statesBlock, startsOn, makeChange } from './template/adStates.js'
import { adminTodos } from './adminshell/todos.js'
import { deskLines, deskOfSpend } from './lib/bookingDesk.js'

const src = p => readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

test('P949: status buttons use the board colours in light mode too (no darkened --sh-cs-* variant)', () => {
  const css = src('./index.css')
  // every --sh-cs-<hue> is the light fill (--sh-f-<hue>) with its dark ink, in both themes
  for (const m of css.matchAll(/--sh-cs-([a-z]+):\s*([^;]+);\s*--sh-csi-\1:\s*([^;]+);/g)) {
    assert.equal(m[2].trim(), `var(--sh-f-${m[1]})`, m[0])
    assert.equal(m[3].trim(), `var(--sh-fi-${m[1]})`, m[0])
  }
  assert.doesNotMatch(css, /--sh-cs-[a-z]+:\s*var\(--sh-(sky|sage|apricot|stone|lilac|butter)\)/)
})

test('P949: every unanswered check is one box with a date range', () => {
  const c = id => ({ id })
  const lists = [{ draft: '2026-11-01', clients: [c('a')] }, { draft: '2026-10-27', clients: [c('b'), c('c')] }]
  const m = mergeLists([...lists].sort((x, y) => (x.draft < y.draft ? -1 : 1)))
  assert.equal(m.rows.length, 3)
  assert.equal(draftRange(m.from, m.to), 'Oct 27 – Nov 1')
  assert.equal(draftRange('2026-11-28', '2026-12-02'), 'Nov 28 – Dec 2')
  assert.equal(draftRange('2026-11-03', '2026-11-03'), 'Nov 3')
  assert.equal(mergedQuestion(m), 'These policies drafted Oct 27 – Nov 1. Are they still on the books?')
  assert.equal(mergeLists([]), null)
  const ui = src('./template/screens/Clients.jsx')
  assert.match(ui, /<CheckBox key=/)
  assert.doesNotMatch(ui, /lists\.map\(\(l, i\) => <CheckList/)
  assert.match(ui, /Show all \$\{m\.rows\.length\}/)
  assert.match(src('./template/m/MClients.jsx'), /<CheckCard key=\{merged\.drafts\.join\(\)\} m=\{merged\}/)
})

test('P949: agent Overview is the P936 chart again; admin keeps the area chart', () => {
  const agent = src('./template/screens/Overview.jsx')
  assert.match(agent, /function BookedChart/)
  assert.match(agent, /<Chart kind=\{days \? 'bar' : 'area'\}/)
  assert.doesNotMatch(agent, /AreaTrend|useDeliveredTrend/)
  assert.match(src('./adminshell/screens/Overview.jsx'), /<AreaTrend\b/)
})

test('P949: Your states: 3 to 10, no New York, tick for added states, next-day start, admin to-do', () => {
  assert.deepEqual(stateDiff(['AZ', 'FL', 'GA', 'TX'], ['FL', 'NC', 'GA', 'TX']), { added: ['NC'], removed: ['AZ'] })
  assert.equal(diffWords({ added: ['FL'], removed: ['GA'] }), '+FL, −GA')
  assert.deepEqual(flipState(['TX'], 'NY'), ['TX'])
  const ten = ['AL', 'AZ', 'CA', 'CO', 'FL', 'GA', 'NC', 'OH', 'TX', 'WA']
  assert.deepEqual(flipState(ten, 'UT'), ten)
  const now = ['AZ', 'FL', 'GA', 'TX']
  assert.equal(statesBlock(now, now, false), 'Nothing changed yet')
  assert.match(statesBlock(now, ['FL', 'TX'], false), /at least 3/)
  assert.match(statesBlock(now, [...now, 'NC'], false), /Tick the box/)
  assert.equal(statesBlock(now, [...now, 'NC'], true), null)
  assert.equal(statesBlock(now, ['FL', 'GA', 'TX'], false), null) // removing needs no tick
  assert.equal(startsOn('2026-11-30'), '2026-12-01')
  const ch = makeChange({ agentId: 'ag-dana', agentName: 'Dana', from: ['GA', 'TX', 'AZ'], to: ['FL', 'TX', 'AZ'], todayIso: '2026-11-10', at: 'Nov 10, 9:00 AM' })
  const rows = adminTodos({ states: [{ ...ch, name: 'Dana Walker', diff: diffWords(ch), startsText: 'Wed, Nov 11', onDone: () => {} }], ap: (...a) => `/admin/${a.join('/')}` })
  assert.equal(rows[0].title, 'Update ad states for Dana Walker: +FL, −GA')
  assert.equal(rows[0].to, '/admin/agents/ag-dana')
  assert.equal(typeof rows[0].onDone, 'function')
  assert.match(src('./template/screens/Billing.jsx'), /<StatesDrawer open=\{panel === 'states'\}/)
  assert.match(src('./template/Licence.jsx'), /useSaveStates/) // Settings › Licence saves the same way
})

test('P949: Change plan shows the nightly charge whole; Booking desk card on Billing', () => {
  assert.deepEqual(deskLines(100, 12), ['$100 to your ads', '$12 booking desk'])
  assert.equal(deskOfSpend(0.12), '12% of your ad spend')
  const css = src('./template/bill910.css')
  assert.doesNotMatch(css, /\.bl-spend-live dd small \{[^}]*text-overflow: ellipsis/)
  const b = src('./template/screens/Billing.jsx')
  assert.match(b, /aria-label="Booking desk"/)
  assert.match(b, /<div className="fx-s5 bl-side">/)
})

test('P949: a booking on the agent calendar opens the Leads pop-up', () => {
  const cal = src('./template/screens/Calendar.jsx')
  assert.match(cal, /import \{ LeadDrawer \} from '\.\/Leads'/)
  assert.match(cal, /open\?\.kind === 'lead' && leadRef && <LeadDrawer id=\{open\.ref\}/)
  assert.match(src('./template/screens/Leads.jsx'), /export function LeadDrawer\(\{ id, onClose, extra = null \}\)/)
})
