import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  isRouted, median, clockS, staffing, deskAlerts, DESK_VAS, DESK_QUEUE, qaScore, reReviewerFor, QA_REVIEWS, sheetTotals, dayHours,
  canWork, ONBOARD_STEPS, adAlerts, reviewHours, ownerOk, consentOf, assignable, daysLeft,
} from './p879.js'

const src = f => readFileSync(new URL(f, import.meta.url), 'utf8')

test('P879 live desk: only Available is rung; speed median; understaffed below the forecast', () => {
  assert.equal(isRouted('available'), true)
  for (const s of ['on_call', 'wrap', 'break', 'lunch', 'training', 'away', 'offline']) assert.equal(isRouted(s), false)
  assert.equal(median([22, 31, 18, 44, 27, 63, 19]), 27)
  assert.equal(median([10, 20]), 15)
  assert.equal(clockS(95), '1:35'); assert.equal(clockS(3600), '1 h 0 min')
  const st = staffing(DESK_VAS, 4)
  assert.equal(st.working, 3); assert.equal(st.under, true); assert.ok(st.deferred.length)
  assert.equal(staffing(DESK_VAS, 3).under, false)
})

test('P879 desk alerts: long wrap-up, break overrun, a lead waiting a minute', () => {
  const a = deskAlerts(DESK_VAS, DESK_QUEUE).map(x => x.id)
  assert.ok(a.includes('wrap-va-keisha'))
  assert.ok(a.includes('brk-va-omar'))
  assert.ok(!a.includes('lead-wait')) // 48 s
  assert.ok(deskAlerts(DESK_VAS, [{ tier: 1, n: 1, oldestS: 61 }]).some(x => x.id === 'lead-wait'))
})

test('P879 quality: score is a percent of the rubric; the other admin re-reviews a dispute', () => {
  assert.equal(qaScore({ scores: [2, 2, 2, 2, 1] }), 90)
  const disputed = QA_REVIEWS.find(r => r.dispute)
  assert.notEqual(reReviewerFor(disputed), disputed.by)
})

test('P879 hours: in to out less breaks; overtime past 40 at 1.5x; pay is hourly', () => {
  assert.equal(dayHours({ in: '8:00 AM', out: '6:00 PM', breakM: 30 }), 9.5)
  const t = sheetTotals({ va: 'x', days: [{ in: '8:00 AM', out: '6:00 PM', breakM: 0 }] }, 8)
  assert.deepEqual([t.hours, t.ot, t.pay], [10, 0, 80])
  const big = sheetTotals({ va: 'x', days: Array.from({ length: 5 }, () => ({ in: '7:00 AM', out: '6:00 PM', breakM: 60 })) }, 10)
  assert.deepEqual([big.hours, big.ot, big.pay], [50, 10, 550])
})

test('P879 onboarding: no real calls until every step is done', () => {
  assert.equal(canWork({ done: ONBOARD_STEPS.length }), true)
  assert.equal(canWork({ done: ONBOARD_STEPS.length - 1 }), false)
})

test('P879 ad alerts: rejected, or in review over 24 h', () => {
  assert.ok(reviewHours({ at: 'Nov 5, 9:40 AM' }) > 24)
  const a = adAlerts()
  assert.ok(a.some(x => x.agent === 'ag-james' && x.kind === 'rejected'))
  assert.ok(a.some(x => x.agent === 'ag-priya' && x.kind === 'review'))
  assert.ok(!a.some(x => x.agent === 'ag-dana'))
  assert.equal(adAlerts({ x: { status: 'in_review', at: 'Nov 6, 9:00 AM' } }).length, 0)
})

test('P879 owner rule: VA cost at or under a third of revenue', () => {
  assert.equal(ownerOk({ revenue: 0, vaCost: 0 }), false)
  assert.equal(ownerOk({ revenue: 300, vaCost: 100 }), true)
  assert.equal(ownerOk({ revenue: 300, vaCost: 101 }), false)
})

test('P879 consent proof and Unassigned picker', () => {
  const c = consentOf({ id: 'ld-12', came: 'Today, 9:02 AM' })
  for (const k of ['at', 'wording', 'page', 'ip', 'cert', 'keepUntil']) assert.ok(c[k])
  const agents = [{ id: 'a', access: true, states: ['TX'], active: true }, { id: 'b', access: true, states: ['TX'], active: false }, { id: 'c', access: false, states: ['TX'], active: true }]
  assert.deepEqual(assignable(agents, { state: 'TX', kind: 'live' }).map(a => a.id), ['a'])
  assert.deepEqual(assignable(agents, { state: 'TX', kind: 'appointment' }).map(a => a.id), ['a', 'b'])
  assert.deepEqual(assignable(agents, { state: 'FL', kind: 'appointment' }), [])
  assert.equal(daysLeft('Dec 2'), 26)
})

test('P879 screens carry the new pieces', () => {
  const team = src('./screens/Team.jsx')
  // P913: Live desk, Quality and Records are gone from Fulfillment.
  for (const k of ['desk', 'quality', 'records']) assert.doesNotMatch(team, new RegExp(`\\['${k}',`))
  assert.match(team, /<HoursPay \/>/); assert.doesNotMatch(team, /a confirmed cancellation/)
  assert.doesNotMatch(src('./screens/Agents.jsx'), /PilotBlock/) // P914: no pilot
  assert.match(src('./screens/Agents.jsx'), /<CampaignBlock agent=\{a\}/)
  assert.match(src('./screens/Billing.jsx'), /\['results', 'Agent results'\]/)
  assert.match(src('./screens/Leads.jsx'), /<ConsentProof lead=\{l\}/)
  assert.match(src('./screens/Leads.jsx'), /<UnassignedBlock/)
  assert.match(src('./paths.js'), /compliance: '\/admin\/compliance'/) // P934: a rail page now
  assert.match(src('./screens/Campaign879.jsx'), /<EngineSlot \/>/) // campaign status is an engine slot
  assert.match(src('./screens/Overview.jsx'), /adAlerts\(\)/)
})
