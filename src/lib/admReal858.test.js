import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  realClock, whenText, fmtPhone, planKey, billingOf, toAgent, toVa, toInvite, leadStage, toLead, toClient, toStep, toCall, toThreads,
  toBug, toAudit, switchesOf, connectOf, suggestAgent, toCampaign, costsOf, setupDone, toOnboard, buildAdmState,
} from './admReal.js'
import { funnel, moneyFor, pipelineOf, PLANS, admSnapshot } from '../adminshell/data.js'

const NOW = Date.parse('2026-11-08T18:00:00Z') // Sun, Nov 8, 12:00 PM Central
const AG = '9f1c2b3a-4d5e-4f60-8a7b-1c2d3e4f5a6b'
const VA = '402a7a07-c9b0-428f-9b9d-ff2b6480bed0'

test('clock: Monday-to-Sunday week in Central, across a month end', () => {
  const c = realClock(NOW)
  assert.equal(c.today, 8)
  assert.deepEqual(c.week, [2, 3, 4, 5, 6, 7, 8])
  assert.equal(c.weekStartIso, '2026-11-02')
  assert.equal(c.dateText(2), 'Mon, Nov 2')
  const e = realClock(Date.parse('2026-12-02T18:00:00Z')) // Wed, Dec 2
  assert.deepEqual(e.week, [30, 1, 2, 3, 4, 5, 6])
  assert.equal(e.dateText(30), 'Mon, Nov 30')
  assert.equal(e.monthStartIso, '2026-12-01')
})

test('when words and phones', () => {
  assert.equal(whenText('2026-11-08T15:05:00Z', NOW), 'Today, 9:05 AM')
  assert.equal(whenText('2026-11-06T15:05:00Z', NOW), 'Fri, 9:05 AM')
  assert.equal(whenText('2026-10-20T15:05:00Z', NOW), 'Oct 20')
  assert.equal(whenText(null, NOW), '')
  assert.equal(fmtPhone('+15125550143'), '(512) 555-0143')
  assert.equal(fmtPhone('n/a'), 'n/a')
})

test('people: agents, billing words, plans that always exist, VAs, invites', () => {
  assert.ok(PLANS[planKey(null, 0)], 'a plan key that exists even with no spend')
  assert.ok(PLANS[planKey('nonsense', 700)])
  assert.equal(billingOf({ billing_exempt: true }).status, 'comped')
  assert.equal(billingOf({ billing_status: 'past_due' }, { price: 199 }).failed.amount, 199)
  assert.equal(billingOf({ billing_status: 'active', stripe_subscription_id: 'sub_1' }).status, 'current')
  const a = toAgent({ id: AG, role: 'agent', full_name: 'Dana Walker', phone: '5125550143', is_active: true, leads_weekly_cents: 60000, created_at: '2026-08-30T12:00:00Z' },
    { settings: [{ agent_id: AG, active: true, states: ['TX', 'OK'] }], onDuty: [AG], plans: PLANS })
  assert.equal(a.name, 'Dana Walker')
  assert.equal(a.spend, 86) // P906: daily spend on the admin side (600 a week / 7)
  assert.deepEqual(a.states, ['TX', 'OK'])
  assert.equal(a.active && a.onDuty && a.access, true)
  assert.ok(PLANS[a.plan])
  assert.equal(a.billing.status, 'current')
  const v = toVa({ id: VA, role: 'fulfillment', full_name: 'Test Fulfill' }, { accounts: [{ rep_id: VA, payouts_enabled: true }] })
  assert.equal(v.bank, 'ready')
  assert.deepEqual(toInvite({ id: 'i1', role: 'agent', invited_email: 'x@example.com', created_at: '2026-11-08T14:00:00Z' }, NOW),
    { id: 'i1', name: 'x@example.com', role: 'agent', via: 'email', to: 'x@example.com', sent: 'Today, 8:00 AM' })
})

test('leads: stage from outcome / transfer, kind from the product, unassigned with why', () => {
  assert.equal(leadStage({ assigned_rep_id: null }), 'unassigned')
  assert.equal(leadStage({ assigned_rep_id: AG, outcome: 'sold' }), 'sold')
  assert.equal(leadStage({ assigned_rep_id: AG, inbound_stage: 'lost' }), 'not_interested')
  // P906: a dropped transfer bounces back and is booked; a live call waits on Booked for its result
  assert.equal(leadStage({ assigned_rep_id: AG, inbound_product: 'live_call', transfer_status: 'dropped' }), 'booked')
  assert.equal(leadStage({ assigned_rep_id: AG, inbound_product: 'live_call', transfer_status: 'connected' }), 'booked')
  assert.equal(leadStage({ assigned_rep_id: AG, outcome: 'no_show' }), 'no_show')
  assert.equal(leadStage({ assigned_rep_id: AG, inbound_stage: 'follow_up' }), 'follow_up')
  // P913: No answer is gone: never reached = a Follow up our team owns
  assert.equal(leadStage({ assigned_rep_id: AG, va_outcome: 'not_reached' }), 'follow_up')
  const team = toLead({ id: 't1', assigned_rep_id: AG, va_outcome: 'not_reached', created_at: '2026-11-06T15:00:00Z' }, { now: NOW })
  assert.equal(team.owner, 'team')
  assert.equal(team.kind, 'none')
  assert.equal(toLead({ id: 't2', assigned_rep_id: AG, outcome: 'follow_up', created_at: '2026-11-06T15:00:00Z' }, { now: NOW }).owner, 'agent')
  assert.equal(leadStage({ assigned_rep_id: AG, inbound_product: 'booked_appointment' }), 'booked')
  const clock = realClock(NOW)
  const l = toLead({ id: 'l1', contact_name: 'Angela Moore', phone: '+15125558201', state: 'TX', inbound_product: 'booked_appointment', lead_type: 'mortgage_protection', lead_source: 'meta', assigned_rep_id: null, created_at: '2026-11-06T15:00:00Z' },
    { clock, now: NOW, intake: { l1: { routing: 'unknown', meta_option: 'page_only', agent_ref: 'agent-42', campaign_id: 'cmp-1' } } })
  assert.equal(l.day, 6)
  assert.equal(l.kind, 'appointment')
  assert.equal(l.stage, 'unassigned')
  assert.match(l.why, /match no agent/)
  assert.equal(l.agentRef, 'agent-42')
  assert.equal(l.source, 'Meta · landing page')
  const old = toLead({ id: 'l2', inbound_product: 'live_call', assigned_rep_id: null, created_at: '2026-10-01T15:00:00Z' }, { clock, now: NOW })
  assert.equal(old.day, null, 'a lead from before this week is not on this week\'s days')
  assert.equal(funnel([l, old]).in, 2)
})

test('clients, servicing steps and the desk', () => {
  assert.equal(toClient({ id: 'p1', agent_id: AG, client_first_name: 'Gloria', client_last_name: 'Santos', status: 'active' }).stage, 'protected')
  // P906: the P899 statuses; a request is a tag, not a status
  const req = toClient({ id: 'p1', agent_id: AG, status: 'active' }, 2)
  assert.equal(req.stage, 'protected')
  assert.equal(req.tag, '2 requests in progress')
  assert.equal(toClient({ id: 'p1', agent_id: AG, status: 'lapsed' }).stage, 'working')
  assert.equal(toClient({ id: 'p1', agent_id: AG, pending_underwriting: true }).stage, 'working')
  assert.equal(toClient({ id: 'p1', agent_id: AG, next_lapse_check_at: '2020-01-01T00:00:00Z' }).stage, 'needs_attention')
  assert.equal(toClient({ id: 'p1', agent_id: AG, status: 'cancelled' }).stage, 'closed')
  const st = toStep({ id: 's1', policy_id: 'p1', kind: 'review_call', due_at: '2026-11-06T15:00:00Z' }, NOW)
  assert.equal(st.kind, 'Review call')
  assert.equal(st.late, true)
  assert.equal(toCall({ id: 'p1', call_live_since: '2026-11-08T17:50:00Z', scheduled_call_at: '2026-11-08T17:45:00Z' }, NOW).status, 'live')
  assert.equal(toCall({ id: 'p1', scheduled_call_at: '2026-11-08T16:00:00Z' }, NOW).status, 'late')
  assert.equal(toCall({ id: 'p1', scheduled_call_at: '2026-11-08T20:00:00Z' }, NOW).status, 'booked')
})

test('messages, bugs, audit', () => {
  const t = toThreads([{ agent_id: AG, peer_key: 'admin', agent_name: 'Dana', unread_count: 2 }, { agent_id: AG, peer_key: VA }],
    [{ id: 'm1', agent_id: AG, sender_id: 'me', body: 'Hi', created_at: '2026-11-08T15:00:00Z' }, { id: 'm2', agent_id: AG, sender_id: AG, sender_role: 'agent', body: 'Hey', created_at: '2026-11-08T15:01:00Z' }], 'me', NOW)
  assert.equal(t.length, 1, 'only agent ↔ admin threads')
  assert.deepEqual(t[0].messages.map(m => m.from), ['me', 'them'])
  assert.equal(toBug({ id: 'b', status: 'resolved', reporter: { full_name: 'Dana' } }, NOW).status, 'fixed')
  assert.equal(toAudit({ id: 1, action: 'route_lead', actor_name: 'Brayden', target_table: 'leads', target_id: 'abcdef123456', at: '2026-11-08T15:00:00Z' }, NOW).what, 'Routed a lead')
})

test('switches and Connect: real values, engine pieces empty until connected', () => {
  const sw = switchesOf({ submit_live: true, self_signup_open: false, agent_billing_enforced: true }, { sms_live: false, payouts_live: true })
  assert.equal(sw.submit_live && sw.billing_enforced && sw.payouts_live, true)
  assert.equal(sw.sms_live || sw.signup_open, false)
  const c = connectOf(null, false, [])
  assert.equal(c.ghl.locationId, '')
  assert.equal(c.engine.connected, false)
  assert.equal(c.sources.forms.length, 0)
  assert.equal(c.texting.campaign, 'not_started')
})

test('campaign → agent suggestion, costs per lead / booked / sale', () => {
  const agents = [{ id: 'a', name: 'Dana Walker' }, { id: 'b', name: 'James Okafor' }, { id: 'c', name: 'Dana Reed' }]
  assert.equal(suggestAgent('Dana Walker - Mortgage Protection', agents), 'a')
  assert.equal(suggestAgent('Okafor live calls', agents), 'b')
  assert.equal(suggestAgent('Dana - MP', agents), null, 'two Danas: no guess')
  assert.equal(toCampaign({ campaign_id: 'c1', campaign_name: 'James Okafor MP' }, agents).suggested, 'b')
  assert.equal(toCampaign({ campaign_id: 'c1', campaign_name: 'James Okafor MP', agent_id: 'a' }, agents).suggested, null)
  const k = costsOf([{ agent_id: 'a', spend_cents: 12345, leads: 6, booked: 3, sold: 0 }])
  assert.deepEqual(k.a, { spend: 123.45, leads: 6, booked: 3, sold: 0, perLead: 20.58, perBooked: 41.15, perSale: null })
})

test('setup: agent steps from their records, Jordan/Ohvara steps from ticks', () => {
  const p = { id: AG, role: 'agent', npn: '123', leads_weekly_cents: 40000, billing_status: 'active', working_hours_start: '09:00', timezone: 'America/Chicago', caller_id_verified_at: 'x', no_answer_sms_opt_in: true }
  const done = setupDone(p, { settings: [{ agent_id: AG, states: ['TX'] }], ticks: [{ agent_id: AG, step: 'campaign' }], mapped: new Set([AG]) })
  assert.deepEqual(done, ['invite', 'profile', 'plan', 'paid', 'calendar', 'callerId', 'alerts', 'mapped', 'campaign'])
  assert.equal(toOnboard(p, { settings: [{ agent_id: AG, states: ['TX'] }] }).lead, 'appointment')
})

test('the whole store: same keys as the sample, and Money / Setup run on it without sample numbers', () => {
  const sample = admSnapshot()
  const s = buildAdmState({
    profiles: [{ id: AG, role: 'agent', full_name: 'Dana Walker', is_active: true, leads_weekly_cents: 50000, created_at: '2026-10-01T00:00:00Z' },
      { id: VA, role: 'fulfillment', full_name: 'Test Fulfill', is_active: true }, { id: 'x', role: 'agent', is_demo: true }],
    leads: [{ id: 'l1', inbound_product: 'booked_appointment', assigned_rep_id: AG, created_at: '2026-11-07T15:00:00Z' }, { id: 'l9', is_sample: true, created_at: '2026-11-07T15:00:00Z' }],
    unassigned: [{ id: 'l1', inbound_product: 'booked_appointment', assigned_rep_id: AG, created_at: '2026-11-07T15:00:00Z' }],
    costsWeek: [{ agent_id: AG, spend_cents: 5000, leads: 1, booked: 1, sold: 0 }],
  }, { now: NOW, base: { settings: sample.settings, plans: PLANS } })
  for (const k of Object.keys(sample)) assert.ok(k in s, `real store has ${k}`)
  assert.equal(s.agents.length, 1, 'demo accounts left out')
  assert.equal(s.leads.length, 1, 'sample leads left out, no duplicates')
  assert.equal(s.revenue.length + s.draws.length + s.setupFees.length + s.threads.length, 0)
  const m = moneyFor(s, 'week')
  assert.equal(m.ads, 50, 'ad spend is the real spend, not Connect\'s sample accounts')
  assert.equal(m.ai, 0, 'no sample AI minutes on real data')
  assert.equal(moneyFor(s, 'last').ads, 0)
  assert.equal(pipelineOf(s).length, 0) // P906: Setup holds paid agents only; this one hasn't paid
  assert.equal(s.connect.ads[0].spent, 50)
})
