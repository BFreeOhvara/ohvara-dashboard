// P941 — Setup tickets that make sense: the ticket is the agent's finished sign-up, the launch checks read in plain
// words in the ticket's order, and the agent's setup progress uses the same steps. Plus the sign-up form's rules.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { LAUNCH_CHECKS, AGENT_WORDS, SETUP_STEPS, launchChecks, setupOf, signupOf, paidLine } from './setup.js'
import { admSnapshot, pipelineOf, PLANS } from './data.js'
import { launchOf } from '../lib/admReal.js'
import { emptyDetails, toggleState, detailsMissing, toPayload, fromSaved, hoursText, DEFAULT_WEEK } from '../lib/signupDetails.js'
import { setDay } from '../lib/agentSettings.js'

const src = p => readFileSync(new URL(p, import.meta.url), 'utf8')

const ticket = (o = {}, launch = {}) => ({
  name: 'Rachel Nguyen', agentRef: 'DS-R', states: ['LA', 'OK', 'TX'], lead: 'live', done: ['paid', 'campaign'], paid: { on: 'Today', days: 2 },
  signup: { tier: 'growth', dailyCents: 6500, paidCents: 202200, setupCents: 29900, planCents: 149900, leadCents: 22400, paidOn: 'Today, 9:12 AM', paidShort: 'Nov 10',
    tz: 'America/Chicago', hours: [1, 2, 3, 4, 5].map(weekday => ({ weekday, start: '09:00', end: '17:00' })), live: true },
  launch: { linkRef: 'DS-R', campaignId: '1202', campaignRef: 'DS-R', testLead: { at: 'now', matchedRef: 'DS-R', by: 'link' }, licence: true, hours: '9:00 AM', tz: 'America/Chicago',
    card: 'Visa •••• 5120', app: { installed: true, pushAnswered: true }, testCall: { at: 'now', by: 'AI' }, ...launch },
  ...o,
})

test('the launch checks are the plain steps, in order; no "checked" jargon anywhere', () => {
  assert.deepEqual(LAUNCH_CHECKS.map(x => x.label), [
    'Paid: setup + first 2 days', 'States picked', 'Hours set', 'Ad link + campaign saved', 'Test lead arrived for this agent',
    'Test call reached the agent', 'App installed + test push answered',
  ])
  const all = launchChecks(ticket())
  assert.equal(all.ok, true)
  assert.equal(all.list[0].label, 'Paid: setup + first 2 days ($2,022, Nov 10)')
  assert.equal(all.list[1].label, 'States picked: LA, OK, TX')
  assert.equal(all.list[2].text, 'Mon–Fri 9:00 AM to 5:00 PM · Central')
  for (const f of ['./setup.js', './screens/Setup.jsx', './data.js']) assert.doesNotMatch(src(f), /States and spend checked/, f)
  // appointments only: no app check at all
  assert.equal(launchChecks(ticket({ lead: 'appointment' })).list.some(x => x.key === 'app'), false)
  // each failure says what's missing
  assert.equal(launchChecks(ticket({}, { card: '' })).failed[0].why, 'Not paid yet: no card on file.')
  assert.equal(launchChecks(ticket({ states: ['TX', 'OK'] })).failed[0].why, 'Only 2 states picked (needs 3 to 10).')
  assert.equal(launchChecks(ticket({}, { hours: '' })).failed[0].why, 'No hours set.')
})

test('the agent sees the same steps, about themselves, with no engine or ad-platform names', () => {
  const a = launchChecks(ticket({}, { linkRef: '', campaignId: '', testLead: null, testCall: null }), { who: 'agent' })
  assert.deepEqual(a.list.map(x => x.key), LAUNCH_CHECKS.map(x => x.key))
  assert.equal(a.list[3].label, AGENT_WORDS.link)
  for (const x of a.list) assert.doesNotMatch(`${x.label} ${x.text}`, /GoHighLevel|Meta|Google|Facebook|\bads?\b/i, x.key)
  assert.equal(a.passed, 4) // paid, states, hours, app
})

test('a ticket is the finished sign-up: no states tick, read-only sign-up block at the top', () => {
  assert.equal(SETUP_STEPS[0].label, 'Signed up and paid')
  const c = setupOf(ticket({ done: ['paid'] }))
  assert.equal(c.steps[0].done, true)
  assert.equal(c.stage, 'new')
  assert.equal(c.next.key, 'campaign')
  const s = signupOf(ticket(), { plans: PLANS })
  assert.equal(s.plan, PLANS.growth.label)
  assert.equal(s.daily, 65)
  assert.deepEqual(paidLine(ticket()), { total: 2022, setup: 299, plan: 1499, leads: 224, on: 'Today, 9:12 AM', short: 'Nov 10' })
  assert.equal(s.tz, 'Central')
  assert.equal(s.live, true)
  const ui = src('./screens/Setup.jsx')
  assert.match(ui, /<SignupBlock c=\{c\} \/>/)
  assert.doesNotMatch(ui, /onChange=\{v => tick\(s, v\)\}/) // no hand tick on the ticket
  // every sample ticket carries a sign-up with 3+ states
  for (const t of pipelineOf(admSnapshot())) {
    assert.ok(t.signup && t.signup.paidCents > 0, t.name)
    assert.ok(t.states.length >= 3, t.name)
  }
})

test('real data: the sign-up block from agent_launch_facts lands on the ticket', () => {
  const facts = {
    agentRef: 'DS-R', lead: 'live', states: ['LA', 'OK', 'TX'], state: 'off', paidDays: 2,
    launch: { licence: true, hours: '09:00:00', tz: 'America/Chicago', card: 'Visa •••• 5120', app: {} },
    signup: { tier: 'growth', dailyCents: 6500, paidAt: '2026-11-10T15:12:00Z', paidCents: 202200, setupCents: 29900, planCents: 149900, leadCents: 22400,
      tz: 'America/Chicago', hours: [{ weekday: 1, start: '09:00', end: '17:00' }], live: true },
  }
  const out = launchOf({ checks: { facts } }, ['paid'], Date.parse('2026-11-10T18:00:00Z'))
  assert.equal(out.signup.paidShort, 'Nov 10')
  assert.equal(out.spend, 65)
  assert.equal(out.paid.days, 2)
  assert.equal(signupOf(out).hours, 'Mon 9:00 AM to 5:00 PM')
})

test('sign-up form: 3 to 10 states, no New York, the tick clears when states change, nothing missing = ready', () => {
  let d = emptyDetails('America/Chicago')
  assert.deepEqual(detailsMissing(d).map(m => m.key), ['states', 'licence', 'live'])
  d = toggleState(d, 'NY')
  assert.deepEqual(d.states, [])
  for (const s of ['TX', 'OK', 'LA']) d = toggleState(d, s)
  d = { ...d, licensed: true, live: true, phone: '(512) 555-0142' }
  assert.deepEqual(detailsMissing(d), [])
  assert.equal(toggleState(d, 'AR').licensed, false)
  const p = toPayload(d)
  assert.deepEqual(p.states, ['LA', 'OK', 'TX'])
  assert.equal(p.live_transfer_phone, '+15125550142')
  assert.equal(p.working_hours.length, 5)
  assert.equal(detailsMissing({ ...d, phone: '555' })[0].key, 'phone')
  assert.equal(toPayload({ ...d, live: false }).live_transfer_phone, null)
  // eleven states can't be picked
  let many = emptyDetails('America/Chicago')
  for (const s of ['AL', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA', 'ID', 'IL']) many = toggleState(many, s)
  assert.equal(many.states.length, 10)
  // hours: none on, or ending before they start
  const closed = DEFAULT_WEEK.map(x => ({ ...x, open: false }))
  assert.equal(detailsMissing({ ...d, week: closed })[0].key, 'hours')
  assert.equal(detailsMissing({ ...d, week: setDay(d.week, 1, { start: '18:00', end: '09:00' }) })[0].key, 'hours')
  // saved details fill the form back in
  const back = fromSaved({ states: ['TX', 'OK', 'LA'], licensed: true, timezone: 'America/Denver', workingHours: [{ weekday: 6, start: '10:00', end: '14:00' }], liveTransfers: false, phone: null })
  assert.deepEqual(back.states, ['LA', 'OK', 'TX'])
  assert.equal(back.live, false)
  assert.equal(back.week.filter(x => x.open).length, 1)
  assert.equal(hoursText([{ weekday: 1, start: '09:00', end: '17:00' }, { weekday: 2, start: '09:00', end: '17:00' }, { weekday: 6, start: '10:00', end: '14:00' }]), 'Mon–Tue 9:00 AM to 5:00 PM · Sat 10:00 AM to 2:00 PM')
})

test('the checkout asks for the details before a lead plan is paid, and saves them before the charge', () => {
  const ui = src('../components/agent/SignupCheckout.jsx')
  assert.match(ui, /missing\.length === 0/)
  assert.match(ui, /if \(lead\) await saveSignupDetails\(supabase, details\)\s*\n\s*const r = await signupPay/)
  assert.match(ui, /\{lead && <>[\s\S]*?<SignupDetails /) // P955: inside the Leads block of "What do you need?"
})
