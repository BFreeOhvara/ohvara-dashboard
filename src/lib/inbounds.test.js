// Inbounds in the header search and Activity.
//   node --test src/lib/inbounds.test.js
// Pure functions plus source checks for the wiring (no network, no React): the search match, the Activity
// items, the new Activity row, and that admin / Fulfillment never ask for agent_inbounds.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { matchInbounds, inboundActivityItems, inboundPath, leadName, eventTitle } from './inbounds.js'
import { ACTIVITY_ROWS, activityRow, rowMeta, kindMeta } from './activityKinds.js'

const src = p => readFileSync(new URL(p, import.meta.url), 'utf8')
const LEADS = [
  { lead_id: 'l-1', contact_name: 'TEST Inbound (crew)', phone: '+15555550142' },
  { lead_id: 'l-2', contact_name: 'Maria Alvarez', phone: '(850) 555-0199' },
  { lead_id: 'l-3', contact_name: null, phone: '+18505550123' },
]
const ev = (id, lead_id, kind, state, extra = {}) => ({ id, lead_id, kind, state, at: '2026-10-30T15:00:00Z', label: null, detail: {}, ...extra })

test('matchInbounds: name, case-insensitive, sorted by name', () => {
  assert.deepEqual(matchInbounds(LEADS, 'test inb').map(l => l.lead_id), ['l-1'])
  assert.deepEqual(matchInbounds(LEADS, 'a').map(l => l.lead_id), ['l-2', 'l-3'])
})

test('matchInbounds: 3+ typed digits match the phone, 2 do not, formatting is ignored', () => {
  assert.deepEqual(matchInbounds(LEADS, '555').map(l => l.lead_id).sort(), ['l-1', 'l-2', 'l-3'])
  assert.deepEqual(matchInbounds(LEADS, '0142').map(l => l.lead_id), ['l-1'])
  assert.deepEqual(matchInbounds(LEADS, '(850) 555-01').map(l => l.lead_id).sort(), ['l-2', 'l-3'])
  assert.deepEqual(matchInbounds(LEADS, '42'), [])
})

test('matchInbounds: nothing for an empty query or an empty list; unnamed callers match "unknown"', () => {
  assert.deepEqual(matchInbounds(LEADS, '   '), [])
  assert.deepEqual(matchInbounds(undefined, 'maria'), [])
  assert.deepEqual(matchInbounds(LEADS, 'unknown').map(l => l.lead_id), ['l-3'])
  assert.equal(leadName(LEADS[2]), 'Unknown caller')
})

test('choosing an inbound opens its detail page', () => {
  assert.equal(inboundPath('abc-123'), '/agent/inbounds/abc-123')
  assert.match(src('../components/layout/GlobalSearch.jsx'), /navigate\(inboundPath\(item\.l\.lead_id\)\)/)
})

test('inboundActivityItems: only done steps of the agent\'s own inbounds; no scheduled, skipped, notes or strangers', () => {
  const events = [
    ev('e1', 'l-1', 'came_in', 'done', { label: 'Test inbound added for QA' }),
    ev('e2', 'l-1', 'va_call', 'scheduled'),
    ev('e3', 'l-1', 'text_sent', 'skipped'),
    ev('e4', 'l-1', 'note', 'done', { detail: { note: 'private' } }),
    ev('e5', 'not-mine', 'came_in', 'done'),
    ev('e6', 'l-2', 'text_received', 'done', { detail: { text: 'Call me' } }),
  ]
  const items = inboundActivityItems(events, LEADS)
  assert.deepEqual(items.map(i => i.id), ['e1', 'e6'])
  assert.deepEqual(items[0], {
    key: 'i-e1', id: 'e1', kind: 'inbound', inbound: true, at: '2026-10-30T15:00:00Z', leadId: 'l-1',
    client: 'TEST Inbound (crew)', text: 'Test inbound added for QA', row: 'inbound',
  })
  assert.equal(items[1].text, 'Replied by text · “Call me”')
  assert.equal(eventTitle(ev('x', 'l-1', 'came_in', 'done')), 'Came in')
})

test('inboundActivityItems: no events or no inbounds gives nothing', () => {
  assert.deepEqual(inboundActivityItems([], LEADS), [])
  assert.deepEqual(inboundActivityItems(undefined, undefined), [])
  assert.deepEqual(inboundActivityItems([ev('e1', 'l-1', 'came_in', 'done')], []), [])
})

test('Activity: Inbounds is its own row and kind; policy events keep their rows', () => {
  assert.ok(ACTIVITY_ROWS.includes('inbound'))
  assert.equal(rowMeta('inbound').label, 'Inbounds')
  assert.equal(kindMeta('inbound').pill, 'Inbound')
  assert.equal(activityRow('inbound', null), 'inbound')
  assert.equal(activityRow('moved', 'noAnswer'), 'no_answer')
  assert.equal(activityRow('booked', null), 'booked')
})

test('Activity box: the Inbounds row shows only when counts.inbound > 0', () => {
  assert.match(src('../components/agent/AgentUI.jsx'), /ACTIVITY_ROWS\.filter\(k => \(k !== 'needs' && k !== 'inbound'\) \|\| counts\[k\] > 0\)/)
})

test('admin and Fulfillment make no agent_inbounds call', () => {
  const hook = src('../hooks/useInbounds.js')
  // useInbounds can be switched off, and then the query never runs.
  assert.match(hook, /export function useInbounds\(\{ enabled = true \} = \{\}\)/)
  assert.match(hook, /queryKey: \['inbounds', profile\?\.id\],\s+enabled: !!profile\?\.id && enabled,/)
  // The Activity feed and header line only ask for inbounds as an agent.
  assert.match(hook, /const enabled = profile\?\.role === 'agent'\s+const events = useInboundDayEvents\(day, \{ enabled \}\)\s+const leads = useInbounds\(\{ enabled \}\)/)
  // The header search only asks as an agent: admin and Fulfillment pass false.
  assert.match(src('../components/layout/GlobalSearch.jsx'), /useInbounds\(\{ enabled: !!profile\?\.id && role === 'agent' \}\)/)
  // The only Activity code that reaches agent_inbounds goes through those hooks.
  assert.doesNotMatch(src('../pages/agent/Activity.jsx') + src('../components/layout/DashboardLayout.jsx'), /rpc\('agent_inbounds'\)/)
})
