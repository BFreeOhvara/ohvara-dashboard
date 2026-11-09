import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { LEAD_LANES, followOwner } from './words.js'
import { AGENT_STATUSES, CLOSED_STATUS, LIVE_STATUS, agentStatusOf } from '../template/agentView.js'
import { matchAgent, unmatchedLine } from '../lib/leadMatch.js'
import { canBookDayOff, daysLeft } from '../lib/dayOff.js'
import { setupOf, launchChecks, LAUNCH_CHECKS } from './setup.js'
import { admSnapshot, moneyFor } from './data.js'

// P913 — Brayden's admin walk-through: statuses and colours, agent matching, the "seatbelt" launch checks.
const src = p => readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

test('colours: No show is grey, Not interested took its apricot, and no two statuses share one (agent and admin)', () => {
  const admin = Object.fromEntries(LEAD_LANES.map(l => [l.key, l.tone]))
  assert.equal(admin.no_show, 'mute')
  assert.equal(admin.not_interested, 'warn')
  assert.equal(new Set(Object.values(admin)).size, LEAD_LANES.length)
  const agent = [...AGENT_STATUSES, CLOSED_STATUS, LIVE_STATUS]
  assert.equal(agent.find(s => s.key === 'no_show').tone, 'mute')
  assert.equal(agent.find(s => s.key === 'not_interested').tone, 'warn')
  assert.equal(new Set(agent.map(s => s.tone)).size, agent.length, 'board, Closed and the live call: all different')
  // violet (the live call) is lilac now, not butter like Follow up's teal; rose is Closed's coral
  const css = src('../template/flow.css')
  assert.match(css, /\.fx \.is-violet, \.fx-layer \.is-violet \{ --c: var\(--sh-lilac\); \}/)
  assert.match(css, /\.tp \.is-rose \{ --cb: var\(--sh-f-coral\)/)
  assert.doesNotMatch(css, /\.tp :is\(\.is-teal, \.is-violet\)/)
})

test('No answer is gone: those are Follow ups owned by Our team, and agents never see them', () => {
  assert.ok(!LEAD_LANES.some(l => l.key === 'no_answer'))
  const leads = admSnapshot().leads
  const team = leads.filter(l => l.stage === 'follow_up' && l.owner === 'team')
  const mine = leads.filter(l => l.stage === 'follow_up' && l.owner === 'agent')
  assert.ok(team.length > 0 && mine.length > 0, 'the sample has both owners')
  for (const l of team) assert.equal(followOwner(l), 'team')
  for (const l of mine) assert.equal(followOwner(l), 'agent')
  assert.equal(agentStatusOf({ stage: 'follow_up', owner: 'team' }), 'team') // not on the agent's board
  assert.equal(agentStatusOf({ stage: 'follow_up', owner: 'agent' }), 'follow')
  assert.match(src('./screens/Leads.jsx'), /FOLLOW_OWNER\[owner\]/)
})

test('matching: the agent ID in the ad link, else the Meta campaign ID; only both missing or wrong needs a person', () => {
  const agents = [{ id: 'ag-1', agentRef: 'DS-ONE', campaignId: '120211' }, { id: 'ag-2', agentRef: 'DS-TWO', campaignId: '120222' }]
  assert.deepEqual(matchAgent({ agentRef: 'DS-ONE', campaignId: '120222' }, agents), { agent_id: 'ag-1', by: 'link', why: '' })
  assert.deepEqual(matchAgent({ campaignId: '120222' }, agents), { agent_id: 'ag-2', by: 'campaign', why: '' }) // only the campaign ID
  assert.deepEqual(matchAgent({ agentRef: 'DS-NOPE', campaignId: '120211' }, agents), { agent_id: 'ag-1', by: 'campaign', why: '' })
  assert.equal(matchAgent({}, agents).agent_id, null)
  assert.equal(matchAgent({}, agents).why, 'missing')
  assert.equal(matchAgent({ agentRef: 'DS-NOPE', campaignId: '999' }, agents).why, 'unknown')
  // the sample: some leads matched by campaign alone, one by nothing
  const leads = admSnapshot().leads
  assert.ok(leads.some(l => l.matchedBy === 'campaign' && !l.agentRef && l.agent_id))
  assert.equal(leads.filter(l => !l.agent_id).length, 1)
})

test('an unmatched lead raises the admin alert with Assign, not an Unassigned section on Leads', () => {
  assert.equal(unmatchedLine(1), "1 lead couldn't be matched to an agent. Pick one.")
  const alert = src('./screens/Unmatched913.jsx')
  assert.match(alert, /role="alert"/)
  assert.match(alert, />Assign</)
  assert.doesNotMatch(src('./screens/Leads.jsx'), /<Unassigned |UserX/)
  // P914: on Overview the unmatched lead is a To-do row with Assign (todos.js), not a separate alert.
  assert.match(src('./screens/Overview.jsx'), /adminTodos\(\{[^)]*unassigned/)
  assert.match(src('./todos.js'), /action: 'Assign'/)
  assert.match(src('./AdminFrame.jsx'), /<UnmatchedAlert onDone=\{onClose\} \/>/)
})

const ticket = (o = {}) => ({
  agentRef: 'DS-T', states: ['TX', 'OK', 'KS'], lead: 'live', done: ['paid', 'states', 'campaign'], paid: { days: 2 },
  launch: {
    linkRef: 'DS-T', campaignId: '1202', campaignRef: 'DS-T', testLead: { at: 'now', matchedRef: 'DS-T', by: 'link' }, licence: true, hours: '9 to 5', tz: 'Central',
    card: 'Visa', app: { installed: true, pushAnswered: true }, testCall: { at: 'now', by: 'AI' }, ...o,
  },
})

test('the seatbelt: Turn campaign on stays locked until every check passes, each failure says what is wrong', () => {
  assert.equal(LAUNCH_CHECKS.length, 6)
  assert.equal(setupOf(ticket()).canLaunch, true)
  const breaks = {
    link: { campaignId: '' }, testLead: { testLead: null }, profile: { tz: '' }, paid: { card: '' }, app: { app: { installed: true, pushAnswered: false } }, testCall: { testCall: null },
  }
  for (const [key, o] of Object.entries(breaks)) {
    const c = setupOf(ticket(o))
    assert.equal(c.canLaunch, false, key)
    const bad = c.checks.list.find(x => !x.ok)
    assert.equal(bad.key, key)
    assert.ok(bad.why.length > 10, `${key} says what's wrong`)
  }
  // states 3 to 10; a test lead that went to someone else fails; appointments-only needs no app
  assert.equal(launchChecks({ ...ticket(), states: ['TX', 'OK'] }).ok, false)
  assert.match(launchChecks(ticket({ testLead: { matchedRef: 'DS-X' } })).failed[0].why, /DS-X/)
  assert.equal(launchChecks({ ...ticket({ app: null }), lead: 'appointment' }).ok, true)
})

test('a check that breaks after launch pauses the campaign and reopens the ticket on the failed tick', () => {
  const on = { ...ticket(), done: ['paid', 'states', 'campaign', 'on', 'live'] }
  assert.equal(setupOf(on).stage, 'live')
  assert.equal(setupOf(on).paused, false)
  const broken = setupOf({ ...on, launch: { ...on.launch, cardFailed: 'declined' } })
  assert.equal(broken.paused, true)
  assert.equal(broken.stage, 'checks')
  assert.equal(broken.steps.find(s => s.key === 'on').done, false)
  assert.match(broken.blocker, /^Campaign paused: The card failed/)
  // no skipping: Campaign on is not a switch and the sample action refuses while a check fails
  assert.doesNotMatch(src('./screens/Setup.jsx'), /\['states', 'on', 'test'\]/)
  assert.match(src('./data.js'), /turnCampaignOn: id => set\(s => \{[\s\S]*?if \(!c \|\| !setupOf\(c\)\.canLaunch\) return \{\}/)
  const sample = admSnapshot().onboard
  assert.equal(setupOf(sample.find(c => c.id === 'ob-derek')).paused, true)
  assert.equal(setupOf(sample.find(c => c.id === 'ob-owen')).canLaunch, false) // only the test call left
})

test('days off: an allowance a month, no approvals, no booking past it', () => {
  const rows = [{ va_id: 'v', date: 3, status: 'approved' }, { va_id: 'v', date: 9, status: 'pending' }, { va_id: 'v', date: 12, status: 'declined' }]
  assert.equal(daysLeft(rows, 'v', 2), 0)
  assert.equal(canBookDayOff(rows, 'v', 20, 2).ok, false)
  assert.equal(canBookDayOff(rows, 'v', 20, 3).ok, true)
  assert.equal(canBookDayOff(rows, 'v', 3, 5).ok, false)
  const team = src('./screens/Team.jsx').replace(/\/\/.*$/gm, '')
  assert.doesNotMatch(team, />Approve<|>Decline</)
  assert.doesNotMatch(team, /Need a hand|Who is free/)
})

test('revenue: lead spend is never Ohvara money; one page that never moves when the view changes', () => {
  const s = admSnapshot()
  const p = moneyFor(s, 'week')
  assert.equal(p.inTotal, p.servicing + p.leadFee + p.setup)
  assert.equal(p.profit, p.inTotal - (p.vaPay + p.ai + p.fees))
  const b = src('./screens/Billing.jsx')
  assert.match(b, /Agent lead spend \(passed to Meta\)/)
  assert.match(b, /className="adm-rev-body" key=\{tab\}/)
  // P914: no fixed height and no inner scroll: the box grows to fit each view (Grow), so the wheel scrolls the page.
  assert.doesNotMatch(src('./p913.css'), /\.adm-rev-stage \.adm-rev-body \{ height:/)
  assert.match(b, /<Grow>/)
  assert.doesNotMatch(b, /function MoneyTop|function Waterfall/)
})

test('header: every count badge is the grey circle', () => {
  assert.match(src('./AdminFrame.jsx'), /<span className="fx-tb is-circle"/)
})
