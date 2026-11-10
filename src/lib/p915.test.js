// P915 — the GoHighLevel gaps' front-end twins: DS-XXXX and full IDs both match (leadMatch.js, the twin of agent_by_ref
// in migration 253), the server's launch facts turn into the Setup ticket (admReal.js launchOf), the last GoHighLevel
// send per side (pushOf), the VA day-off allowance (dayOff.js), and the VA lead lanes (leadLifecycle.js).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { matchAgent, refMatches, codeOf } from './leadMatch.js'
import { launchOf, pushOf } from './admReal.js'
import { canBookDayOff } from './dayOff.js'
import { launchChecks } from '../adminshell/setup.js'
import { LEAD_LANES, STAGE_KEYS, laneOwner } from '../template/leadLifecycle.js'
import { LEAD_LANES as ADMIN_LANES } from '../adminshell/words.js'

const ID = 'f9150000-0000-4000-8000-00000000000b'
const agents = [{ id: ID, agentRef: 'DS-OWEN', campaignId: '120210001' }, { id: 'x2', agentRef: 'DS-OWE2' }]

test('DS-XXXX in any form and the full ID all match the same agent', () => {
  for (const ref of ['DS-OWEN', 'ds-owen', ' OWEN ', ID, ID.toUpperCase()]) {
    assert.deepEqual(matchAgent({ agentRef: ref }, agents), { agent_id: ID, by: 'link', why: '' }, ref)
  }
  assert.equal(codeOf('owen'), 'DS-OWEN')
  assert.equal(codeOf(ID), '')
  assert.ok(!refMatches('DS-OWE', agents[0]))
  assert.deepEqual(matchAgent({ agentRef: 'DS-NOPE' }, agents), { agent_id: null, by: null, why: 'unknown' })
  assert.deepEqual(matchAgent({ campaignId: '120210001' }, agents), { agent_id: ID, by: 'campaign', why: '' })
})

const facts = (o = {}) => ({
  agentRef: 'DS-OWEN', lead: 'appointment', states: ['TX', 'OK', 'LA'], state: 'off',
  launch: {
    linkRef: 'DS-OWEN', campaignId: '120210001', campaignRef: 'DS-OWEN',
    testLead: { at: '2026-11-09T15:00:00Z', matchedRef: 'DS-OWEN', by: 'link', leadId: 'l1' },
    licence: true, hours: '09:00', tz: 'America/Chicago', card: 'Card on file', cardFailed: null,
    app: { installed: false, pushAnswered: false }, testCall: { at: '2026-11-09T15:05:00Z', by: 'VA' },
  },
  ...o,
})

test('the server\'s launch facts pass the same six checks on the Setup page', () => {
  const t = { name: 'Owen Fisher', done: ['paid', 'states', 'campaign'], paid: { days: 2 }, ...launchOf({ checks: { facts: facts() } }, ['paid', 'states', 'campaign']) }
  assert.equal(t.agentRef, 'DS-OWEN')
  assert.equal(launchChecks(t).ok, true)
  const noCall = { ...t, ...launchOf({ checks: { facts: facts({ launch: { ...facts().launch, testCall: null } }) } }) }
  assert.deepEqual(launchChecks(noCall).failed.map(x => x.key), ['testCall'])
  const on = launchOf({ checks: { facts: facts({ state: 'on' }) } }, ['paid'])
  assert.deepEqual(on.done, ['paid', 'on'])
  assert.deepEqual(launchOf(null), {})
})

test('the last GoHighLevel send per side: sent, waiting, failing', () => {
  const now = Date.parse('2026-11-09T16:00:00Z')
  assert.equal(pushOf({ lead_type: 'appts', run: true, daily_budget_cents: 2500, changed_at: '2026-11-09T15:00:00Z', pushed_at: '2026-11-09T15:01:00Z' }, now).tone, 'green')
  const wait = pushOf({ lead_type: 'live', run: false, reason: 'paused by agent', changed_at: '2026-11-09T15:00:00Z', pushed_at: null }, now)
  assert.equal(wait.tone, 'mute')
  assert.equal(wait.side, 'Call ads')
  assert.match(wait.what, /paused by agent/)
  const bad = pushOf({ lead_type: 'appts', run: false, changed_at: '2026-11-09T15:00:00Z', error: 'GHL hook: HTTP 503', attempts: 3 }, now)
  assert.equal(bad.tone, 'warn')
  assert.match(bad.text, /Failed 3x · GHL hook: HTTP 503/)
})

test('a VA can\'t book a 3rd day off at a 2-day allowance', () => {
  const rows = [{ va_id: 'me', date: '2026-12-02', status: 'approved' }, { va_id: 'me', date: '2026-12-03', status: 'approved' }]
  assert.equal(canBookDayOff(rows.slice(0, 1), 'me', '2026-12-04', 2).ok, true)
  const third = canBookDayOff(rows, 'me', '2026-12-04', 2)
  assert.equal(third.ok, false)
  assert.equal(third.why, "No days left: you've used all 2 of your days off this month.")
  assert.equal(third.none, true)
  assert.equal(canBookDayOff(rows, 'me', '2026-12-04', 3).ok, true)
})

test('the VA lead lanes are admin\'s five statuses, every stage in exactly one', () => {
  assert.deepEqual(LEAD_LANES.map(l => [l.key, l.label, l.tone]), ADMIN_LANES.map(l => [l.key, l.label, l.tone]))
  for (const k of STAGE_KEYS) assert.equal(LEAD_LANES.filter(l => l.stages.includes(k)).length, 1, k)
  assert.equal(laneOwner('calling'), 'team')
  assert.equal(laneOwner('follow_up'), 'agent')
  assert.equal(laneOwner('booked'), null)
})
