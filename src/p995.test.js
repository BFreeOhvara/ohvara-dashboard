import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { LEAD_FILTERS, LEAD_TONE, leadStage, filterLeads, leadCounts, groupLeads, leadEvents, leadWhen } from './adminshell/m/admModel.js'
import { TONE } from './template/m/appModel.js'

// P995 — admin All leads built like the agent Leads page, and admin Search with suggestions before typing.
const src = p => readFileSync(new URL(p, import.meta.url), 'utf8')
const L = (id, stage, o = {}) => ({ id, name: `Lead ${id}`, phone: '(512) 555-0100', agent_id: 'a', agent: 'Dana Walker', stage, kind: 'appointment', came: 'Today, 9:12 AM', ...o })
const leads = [
  L(1, 'booked'), L(2, 'booked', { kind: 'live' }), L(3, 'follow_up'), L(4, 'not_interested'), L(5, 'sold', { premium: 64 }),
  L(6, 'no_show'), L(7, 'unassigned', { agent_id: null, agent: null }), L(8, 'follow_up', { owner: 'team', kind: 'none', agent_id: 'b' }),
]

test('four filters, no New: Delivered, Follow up, Not interested, Sold', () => {
  assert.deepEqual(LEAD_FILTERS.map(f => f[0]), ['delivered', 'follow', 'not_interested', 'sold'])
  assert.equal(leadStage(leads[0]), 'delivered')
  assert.equal(leadStage(leads[1]), 'delivered') // a live transfer is Delivered too
  assert.equal(leadStage(leads[2]), 'follow')
  assert.equal(leadStage(leads[7]), 'follow')
  assert.equal(leadStage(leads[5]), 'closed')
  assert.equal(leadStage(leads[6]), 'new')
})

test('the agent Leads page colours', () => {
  assert.equal(LEAD_TONE.delivered, TONE.booked)
  assert.equal(LEAD_TONE.follow, TONE.follow)
  assert.equal(LEAD_TONE.sold, TONE.sold)
  assert.equal(LEAD_TONE.not_interested, TONE.lost)
  assert.equal(LEAD_TONE.closed, TONE.lost)
})

test('Show closed: off hides no-shows, on adds them (to every view)', () => {
  assert.ok(!filterLeads(leads).some(l => l.id === 6))
  assert.ok(filterLeads(leads, { closed: true }).some(l => l.id === 6))
  assert.deepEqual(filterLeads(leads, { stage: 'sold' }).map(l => l.id), [5])
  assert.deepEqual(filterLeads(leads, { stage: 'sold', closed: true }).map(l => l.id), [5, 6])
  assert.deepEqual(filterLeads(leads, { stage: 'delivered' }).map(l => l.id), [1, 2])
})

test('tile counts follow the agent filter and the search, never count closed', () => {
  assert.deepEqual(leadCounts(leads), { delivered: 2, follow: 2, not_interested: 1, sold: 1 })
  assert.deepEqual(leadCounts(leads, { agent: 'b' }), { delivered: 0, follow: 1, not_interested: 0, sold: 0 })
  assert.equal(leadCounts(leads, { q: 'lead 5' }).sold, 1)
})

test('grouped by status in filter order, newest first, no-agent leads lead', () => {
  const g = groupLeads(filterLeads(leads, { closed: true }))
  assert.deepEqual(g.map(x => x[0]), ['new', 'delivered', 'follow', 'not_interested', 'sold', 'closed'])
  assert.deepEqual(g[1][1].map(l => l.id), [2, 1])
})

test('rows say booked or live and when; the lead screen has a timeline', () => {
  assert.match(leadWhen(leads[1]), /^Live transfer · Today/)
  assert.match(leadWhen(L(9, 'booked', { appt: 'Fri, Nov 6, 2:00 PM' })), /^Booked · Fri/)
  assert.match(leadWhen(leads[5]), /^No show/)
  const ev = leadEvents({ ...leads[4], matchedBy: 'link', log: ['Assigned to Dana Walker at 9:20 AM'] })
  assert.deepEqual(ev.map(e => e.what), ['Came in', 'Matched to Dana Walker', 'Appointment booked', 'Sold', 'Assigned to Dana Walker at 9:20 AM'])
  assert.equal(leadEvents(leads[6])[1].what, 'Waiting for an agent')
})

test('All leads screen: tiles, Show closed switch, status cards; results never set by hand', () => {
  const y = src('./adminshell/m/AYou.jsx')
  assert.match(y, /am-ltile/)
  assert.match(y, /Show closed<Toggle/)
  assert.match(y, /className=\{`ma-lead is-\$\{LEAD_TONE\[st\]\}`\}/)
  assert.match(y, /Filter by agent/)
  assert.match(y, /never set by hand/)
  assert.doesNotMatch(y, /\['new', 'New'\]/)
})

test('admin Search shows suggestions before typing', () => {
  const s = src('./adminshell/m/ASubsAdm.jsx')
  for (const w of ['Recent', 'Needs you', 'Booked today', 'Agents to watch', 'VAs on shift now', 'Jump to', 'All leads', 'All clients', 'Reports', 'Bug reports']) assert.ok(s.includes(w), w)
  assert.match(s, /<SearchSuggest/)
  assert.match(s, /RECENT\.add/)
})
