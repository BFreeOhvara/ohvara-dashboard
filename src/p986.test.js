import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  ADM_TABS, admRouteOf, money, changeWords, barsOf, halvesOf, flagOf, statusLine, dailySpend, isNew, agentGroups, toWatch,
  callSplit, leadStage, filterLeads, filterClients, searchAll, appOf, pageOf, connectionsOf, takingLeads,
} from './adminshell/m/admModel.js'

// P986 — the admin phone app's rules (src/adminshell/m/admModel.js) and the small fixes in the agent and VA apps.
const src = p => readFileSync(new URL(p, import.meta.url), 'utf8')

test('tabs: Home · Agents · Team · Messages · You', () => {
  assert.deepEqual(ADM_TABS, ['home', 'agents', 'team', 'messages', 'you'])
})

test('desktop admin addresses land on the right tab and screen', () => {
  assert.deepEqual(admRouteOf('/admin'), { tab: 'home', sub: null, id: null })
  assert.deepEqual(admRouteOf('/admin/agents'), { tab: 'agents', sub: null, id: null })
  assert.deepEqual(admRouteOf('/admin/agents/ag-dana'), { tab: 'agents', sub: 'agent', id: 'ag-dana' })
  assert.deepEqual(admRouteOf('/admin/fulfillment/va-maya'), { tab: 'team', sub: 'va', id: 'va-maya' })
  assert.deepEqual(admRouteOf('/admin/inbounds'), { tab: 'you', sub: 'leads', id: null })
  assert.deepEqual(admRouteOf('/admin/inbounds/ib-3'), { tab: 'you', sub: 'lead', id: 'ib-3' })
  assert.deepEqual(admRouteOf('/admin/pipeline/cl-tom'), { tab: 'you', sub: 'client', id: 'cl-tom' })
  assert.equal(admRouteOf('/admin/billing').sub, 'reports')
  assert.equal(admRouteOf('/admin/bugs').sub, 'bugs')
  assert.equal(admRouteOf('/admin/connect').sub, 'setup')
  assert.equal(admRouteOf('/admin/messages').tab, 'messages')
  assert.equal(admRouteOf('/admin/settings').tab, 'you')
  // the preview mount and a ?s= sub-screen over the current tab
  assert.deepEqual(admRouteOf('/preview/admin/agents', '?s=agent&t=ag-ben'), { tab: 'agents', sub: 'agent', id: 'ag-ben' })
  assert.deepEqual(admRouteOf('/preview/admin', '?s=money'), { tab: 'home', sub: 'money', id: null })
  assert.deepEqual(admRouteOf('/admin/settings', '?s=thread&t=th-dana'), { tab: 'you', sub: 'thread', id: 'th-dana' })
})

test('money words', () => {
  assert.equal(money(1234.4), '$1,234')
  assert.equal(money(-80), '-$80')
  assert.equal(changeWords(1500, 1200), '+$300 vs last month')
  assert.equal(changeWords(900, 1200), '-$300 vs last month')
  assert.equal(changeWords(5, 5), 'Same as last month')
  assert.deepEqual(barsOf([50, 100, 0]), [50, 100, 6])
})

test('halves: you first when you are an owner, else both by name', () => {
  const split = [{ id: 'ow-brayden', name: 'Brayden', amount: 10 }, { id: 'ow-jordan', name: 'Jordan', amount: 10 }]
  assert.deepEqual(halvesOf(split, { id: 'ow-jordan' }).map(h => h.label), ['Your half', 'Brayden’s half'])
  assert.deepEqual(halvesOf(split, null).map(h => h.label), ['Brayden’s half', 'Jordan’s half'])
})

const ag = o => ({ id: 'a', name: 'A B', access: true, active: true, spend: 100, picked: ['leads'], billing: { status: 'current' }, week: { booked: 2, transferred: 1 }, ...o })
test('agent flags, groups and the watch list', () => {
  assert.equal(flagOf(ag({ billing: { failed: { what: 'Nightly lead charge', why: 'Card declined', when: 'Thu' } } })).kind, 'failed')
  assert.equal(flagOf(ag({ billing: { status: 'past_due', next: 'Locks Fri' } })).kind, 'past_due')
  assert.equal(flagOf(ag({ access: false })).kind, 'access')
  assert.equal(flagOf(ag({ paused: { until: 'Mon' } })).kind, 'paused')
  assert.equal(flagOf(ag()), null)
  assert.match(statusLine(ag({ onDuty: true })), /Taking calls now · 3 booked this week/)
  assert.match(statusLine(ag({ picked: ['servicing'], clients: 4 })), /4 clients on the books/)
  const list = [ag({ id: 'x' }), ag({ id: 'y', paused: { until: 'Mon' } }), ag({ id: 'z', picked: ['servicing'], spend: 0 }), ag({ id: 'q', comped: true })]
  assert.equal(dailySpend(list), 100)
  assert.deepEqual(agentGroups(list).map(g => [g.key, g.items.length]), [['need', 1], ['fine', 3]])
  assert.deepEqual(agentGroups(list, 'need').map(g => g.key), ['need'])
  assert.equal(toWatch([...list, ag({ id: 'w', week: {} })]).map(a => a.id).join(), 'y,w')
  assert.deepEqual(takingLeads(list).map(a => a.id), ['x'])
})

test('new this week', () => {
  assert.equal(isNew({ joined: 'Nov 3' }, '2026-11-05'), true)
  assert.equal(isNew({ joined: 'Oct 26' }, '2026-11-05'), false)
  assert.equal(isNew({ joined: 'Nov 9' }, '2026-11-05'), false)
})

test("today's desk calls split by result", () => {
  const sp = callSplit([{ status: 'cancelled' }, { status: 'no_answer' }, { status: 'late' }, { status: 'booked' }, { status: 'live' }, { status: 'rebook' }])
  assert.deepEqual(sp.counts, { done: 1, noanswer: 1, open: 1, todo: 3 })
  assert.equal(sp.total, 6)
})

test('All leads: stages, search, filter by agent', () => {
  assert.equal(leadStage({ stage: 'unassigned' }), 'new')
  assert.equal(leadStage({ stage: 'booked', kind: 'live' }), 'live')
  assert.equal(leadStage({ stage: 'booked', kind: 'appointment' }), 'booked')
  assert.equal(leadStage({ stage: 'not_interested' }), 'closed')
  const leads = [{ id: 1, name: 'Angela Moore', phone: '(512) 555-0110', agent_id: 'a', agent: 'Dana', stage: 'sold' }, { id: 2, name: 'Kevin Hill', phone: '(602) 555-0111', agent_id: 'b', agent: 'Priya', stage: 'booked', kind: 'live' }]
  assert.deepEqual(filterLeads(leads, { q: 'kev' }).map(l => l.id), [2])
  assert.deepEqual(filterLeads(leads, { q: '0110' }).map(l => l.id), [1])
  assert.deepEqual(filterLeads(leads, { stage: 'live' }).map(l => l.id), [2])
  assert.deepEqual(filterLeads(leads, { agent: 'a' }).map(l => l.id), [1])
  assert.deepEqual(filterClients([{ name: 'Tom', phone: '', policy: 'FF-1', stage: 'working' }], { q: 'ff-1' }).length, 1)
})

test('search covers agents, VAs, leads and clients, best match first', () => {
  const hits = searchAll({ agents: [{ id: 'a', name: 'Dana Walker' }], vas: [{ id: 'v', name: 'Maya Brooks' }], leads: [{ id: 'l', name: 'Dan Ruiz', agent: 'Dana Walker' }], clients: [{ id: 'c', name: 'Denise Walker', agent: 'Dana Walker' }] }, 'walker')
  assert.deepEqual(hits.map(h => h.kind), ['agent', 'client'])
  assert.deepEqual(searchAll({ vas: [{ id: 'v', name: 'Maya Brooks' }] }, 'maya').map(h => h.kind), ['va'])
  assert.deepEqual(searchAll({}, ''), [])
})

test('bug reports: which app and page', () => {
  assert.equal(appOf({ page: '/fulfillment/calendar', role: 'Fulfillment' }), 'VA app')
  assert.equal(appOf({ page: '/agent/calendar', role: 'Agent' }), 'Agent app')
  assert.equal(appOf({ page: '/preview/admin/agents' }), 'Admin app')
  assert.equal(pageOf({ page: '/agent/calendar?x=1' }), 'Calendar')
})

test('setup: every connection, view only', () => {
  const rows = connectionsOf({ connect: { ghl: { keySaved: false }, texting: { campaign: 'in_review' }, ads: [{ account: '1' }, { account: '' }] }, settings: { switches: {} } })
  assert.deepEqual(rows.map(r => r.key), ['stripe', 'ghl', 'twilio', 'retell', 'elevenlabs', 'meta', 'stores'])
  assert.deepEqual(rows.filter(r => !r.on).map(r => r.key), ['ghl', 'twilio', 'retell', 'elevenlabs', 'meta'])
})

test('admins on a phone get the admin app; the desktop frame is unchanged', () => {
  const shell = src('./adminshell/AdminShell.jsx')
  assert.match(shell, /usePhone\(\) \? <Suspense fallback=\{null\}><AdminApp \/><\/Suspense> : <AdminFrame \/>/)
  assert.match(shell, /lazy\(\(\) => import\('.\/m\/AdminApp'\)\)/)
  const app = src('./adminshell/m/AdminApp.jsx')
  for (const icon of ['Home', 'Briefcase', 'Users', 'MessageCircle']) assert.match(app, new RegExp(`\\b${icon}\\b`))
  assert.doesNotMatch(app, /Headphones/)
})

test('fixes: no phone icon in the VA header, Add is the main call button, notifications close top-right, sign out is plain red text', () => {
  const today = src('./template/m/va/VToday.jsx')
  assert.doesNotMatch(today, /vc\.openPhone/)
  const call = src('./template/m/va/VCall.jsx')
  assert.match(call, /va-addmain/)
  assert.match(call, /va-padbtn/)
  assert.doesNotMatch(call, /btn\('pad', 'Keypad'/)
  for (const f of ['./template/m/ANotes.jsx', './template/m/va/VSubs.jsx', './adminshell/m/ASubsAdm.jsx']) assert.match(src(f), /is-notif"[^>]*arrowRight|arrowRight[^>]*is-notif/)
  const css = src('./template/m/app.css')
  // P989: Sign out is a real glass button again (red text only, no red fill or border) — see p989.test.js.
  assert.match(css, /\.ma-signout \{[^}]*border: 1px solid var\(--ma-glass-b\); background: var\(--ma-glass\);/)
  assert.match(css, /\.ma-back\.is-right \{ margin-left: 0; margin-right: -12px; \}/)
})
