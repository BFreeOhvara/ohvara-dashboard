import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AGENT_STATUSES, agentStatusOf, agentChip, countByStatus, agentEvents } from './template/agentView.js'
import { seedEvents, applyMove, SAMPLE_NOW } from './template/leadLifecycle.js'
import { TIERS, tierOf, expected, monthlyBill, spendOk, nightly, vaCost, bought, slotsNeeded, openSlotsPerWeek, weekVsUsual, dailyTotal } from './template/spendPlan.js'
import { EMPTY_SUBMIT, EMPTY_SPOUSE, missingFields, buildSubmission } from './template/submitModel.js'
import { clearUnknownCarriers } from './lib/carriers/catalog.js'

// P878 — the agent's five statuses, the spend plan, and the policy fields on Submit.
// Words an agent never sees (N-K-14). It lives here, outside src/template, so the template scan doesn't read it.
// "Google Calendar" is allowed: it's the calendar they connect, not where leads come from.
const AGENT_BANNED = /GoHighLevel|\bGHL\b|\bMeta\b|Facebook|Instagram ads|\bads?\b|\bad spend|\bad account|campaign|lead source|\btry \d of \d\b|Google(?! Calendar)/i
const agentSafe = text => !AGENT_BANNED.test(String(text || ''))
const mk = (id, stage, o = {}) => {
  const l = { id, first_name: 'Ann', last_name: 'Test', phone: '(919) 555-0164', city: 'Raleigh', state: 'NC', kind: 'appointment', status: 'assigned', outcome: null, stage, came: '2026-10-30T10:00', apptAt: null, reply: null, tries: 2, ...o }
  return { ...l, events: seedEvents(l) }
}

test('agents see five statuses, with Closed only under a filter (P894: live transfer and booked first)', () => {
  assert.deepEqual(AGENT_STATUSES.map(s => s.label), ['Booked', 'No show', 'Follow up', 'Not interested', 'Sold'])
  const leads = [
    mk('a', 'new'), mk('b', 'calling'), mk('c', 'missed'), mk('d', 'no_show'), mk('e', 'rebooking'),
    mk('f', 'booked', { apptAt: '2026-11-05T15:00' }),
    mk('g', 'booked', { apptAt: '2026-11-02T13:00' }), // time passed: still Booked, with Mark result
    mk('h', 'sold', { submitted: false }), mk('i', 'sold', { submitted: true }),
    mk('j', 'follow_up', { follow: 'Mon, Nov 9' }),
    mk('k', 'opted_out'), mk('l', 'not_interested', { reason: 'Already covered' }),
  ]
  assert.deepEqual(countByStatus(leads), { live: 0, booked: 2, no_show: 1, follow: 1, not_interested: 1, sold: 2, closed: 1, team: 4 })
  assert.equal(agentStatusOf(leads[7]), 'sold')
  assert.deepEqual(agentChip(leads[6]), ['blue', 'Booked · mark result'])
  assert.deepEqual(agentChip(leads[7]), ['green', 'Sold · add the policy details'])
  assert.deepEqual(agentChip(leads[11]), ['warn', 'Not interested · already covered']) // P913: took No show's old colour
})

test("the agent's timeline hides call attempts, chase texts and where the lead came from", () => {
  const l = mk('a', 'unreachable', { tries: 3 })
  const all = l.events
  const shown = agentEvents(l)
  assert.ok(all.some(e => e.kind === 'va_call' && /^(Called, try|Calls again)/.test(e.label)))
  assert.equal(shown.some(e => e.kind === 'va_call' && /^(Called, try|Calls again)/.test(e.label)), false)
  assert.equal(shown.some(e => e.kind === 'text_sent' && /^not_reached/.test(e.step || '')), false)
  assert.equal(shown.find(e => e.kind === 'came_in').label, 'New lead')
  for (const e of shown) assert.equal(agentSafe(`${e.label} ${e.text || ''}`), true, e.label)
  assert.equal(agentSafe('Connect Google Calendar'), true)
  assert.equal(agentSafe('Your Google leads'), false)
  assert.equal(agentSafe('Your lead spend'), true)
  assert.equal(agentSafe('ad spend this week'), false)
})

test('the audit row on a changed outcome is on the agent timeline', () => {
  const sold = applyMove(mk('a', 'booked', { apptAt: '2026-11-02T11:00' }), 'sold', {}, SAMPLE_NOW)
  const back = applyMove(sold, 'not_interested', { reason: 'Changed their mind' }, SAMPLE_NOW)
  assert.equal(agentEvents(back).at(-1).audit, true)
})

test('membership tiers follow total daily spend, and the pilot pays lead spend only', () => {
  // P909: three plans by daily spend band, final prices (price book version 3), plus 12% of lead spend.
  assert.deepEqual([0, 50, 75, 76, 100, 200, 201, 500].map(d => tierOf(d).key), ['starter', 'starter', 'starter', 'growth', 'growth', 'growth', 'pro', 'pro'])
  assert.deepEqual(TIERS.map(t => t.monthly), [699, 1499, 2999])
  const spend = { appts: 60, live: 40 }
  assert.equal(dailyTotal(spend), 100)
  const pilot = monthlyBill({ plan: 'pilot', spend })
  assert.equal(pilot.membership, 0)
  assert.equal(pilot.total, pilot.leadSpend)
  const paid = monthlyBill({ plan: 'paid', spend })
  assert.equal(paid.tier.key, 'growth')
  assert.equal(paid.fee, Math.round(paid.leadSpend * 0.12))
  assert.equal(paid.total, paid.leadSpend + paid.fee + 1499)
  assert.equal(monthlyBill({ plan: 'paid', spend, products: 'servicing' }).total, 499)
  assert.equal(spendOk('pilot', { appts: 5, live: 0 }), true)
  assert.equal(spendOk('paid', { appts: 30, live: 15 }), false)
  assert.equal(spendOk('paid', { appts: 50, live: 0 }), true)
  assert.equal(spendOk('paid', { daily: 505 }), false)
  assert.equal(spendOk('paid', { daily: 505 }, 750), true)
})

test('what the spend is expected to buy is a range, and zero buys nothing', () => {
  const ex = expected({ appts: 25, live: 0 })
  // $25 a day = 7 leads a week at $25, 35% booked = 2.45.
  assert.ok(ex.appts.booked.low <= 2.45 && ex.appts.booked.high >= 2.45)
  assert.equal(ex.live.delivered.high, 0)
  assert.equal(expected({ appts: 0, live: 0 }).soldMonth.high, 0)
})

test('the nightly charge, the pilot VA cost line, and what each type bought', () => {
  // P909: tonight's charge is tomorrow's spend + 12% (pilot: no 12%); what Meta didn't spend comes off it.
  const n = nightly({ nights: [{ spend: 100, delivered: 90, status: 'paid' }, { spend: 100, status: 'failed' }] }, { daily: 100 }, 'paid')
  assert.equal(n.credit, 10)
  assert.equal(n.tonight.total, 100.8)
  assert.equal(n.failed, true)
  assert.equal(nightly({ nights: [] }, { daily: 100 }, 'pilot').tonight.total, 100)
  assert.equal(vaCost({ on: true, hours: 6.5, rate: 8 }), 52)
  assert.equal(vaCost({ on: false, hours: 6.5, rate: 8 }), 0)
  // P889: one line. Booked and transferred apart; old per-type rows add up.
  const r = bought({ spent: 500, leads: 16, booked: 4, offered: 4, transferred: 2, showed: 2, sold: 2, premium: 1900 })
  assert.deepEqual([r.perLead, r.perHandled, r.perSale, r.showRate, r.pickup, r.closeRate], [31.25, 500 / 6, 250, 0.5, 0.5, 0.5])
  const old = bought([{ type: 'appts', spent: 300, leads: 12, booked: 4, showed: 2, sold: 1 }, { type: 'live', spent: 200, calls: 4, offered: 4, delivered: 2, sold: 1 }])
  assert.deepEqual([old.spent, old.leads, old.transferred, old.sold], [500, 16, 2, 2])
})

test('appointments need room on the calendar; a slow week is said plainly', () => {
  const week = { Mon: { on: true, start: '9:00 AM', end: '10:00 AM' }, Tue: { on: false, start: '9:00 AM', end: '6:00 PM' } }
  assert.equal(openSlotsPerWeek(week), 2)
  assert.ok(slotsNeeded({ appts: 100, live: 0 }) > 2)
  const vs = weekVsUsual({ booked: 2, usual: 5, expectedRange: { low: 3, high: 5 } })
  assert.equal(vs.slow, true)
  assert.equal(vs.line, '3 fewer than your usual week.')
})

const base = { ...EMPTY_SUBMIT, name: 'Ruth Ellison', phone: '5125550188', city: 'Austin', state: 'TX', carrier: 'Globe Life' }
const policy = { ...base, premium: '86.40', draftDay: '3' }

test('Submit: the policy details, a licensed state, a replacement and a spouse', () => {
  clearUnknownCarriers()
  // The old call (no policy step) still asks only for name, phone and carrier.
  assert.deepEqual(missingFields(EMPTY_SUBMIT), ['name', 'phone', 'carrier'])
  // P899: city, state and draft day are needed; the premium is optional; no date of birth, policy number or face amount.
  assert.deepEqual(missingFields(base, { policy: true }), ['draftDay'])
  assert.deepEqual(missingFields({ ...base, city: '', state: '' }, { policy: true }), ['city', 'state', 'draftDay'])
  const lean = buildSubmission({ ...base, premium: '52', draftDay: '15', notes: ' Wants a call after 5 ' }, 'agent', { policy: true })
  assert.deepEqual(lean.policy, { premium: 52, draftDay: 15 })
  assert.equal('dob' in lean, false)
  assert.equal(lean.notes, 'Wants a call after 5')
  assert.deepEqual(missingFields(policy, { policy: true, licensed: ['TX'] }), [])
  assert.deepEqual(missingFields(policy, { policy: true, licensed: ['FL'] }), ['licence'])
  assert.deepEqual(missingFields({ ...policy, replacing: true }, { policy: true }), ['oldCarrier', 'oldDraftDay'])
  assert.deepEqual(missingFields({ ...policy, spouse: { ...EMPTY_SPOUSE } }, { policy: true }), ['spouse'])
  const s = buildSubmission({ ...policy, replacing: true, oldCarrier: 'Mutual of Omaha', oldDraftDay: '3', spouse: { name: 'Tom Ellison', premium: '41' } }, 'agent', { policy: true, licensed: ['TX'] })
  assert.deepEqual(s.policy, { premium: 86.4, draftDay: 3 })
  assert.equal(s.replaces.cancelWhen, 'after_new_issued_before_old_draft')
  assert.equal(s.household.length, 1)
  assert.equal(s.household[0].carrier, 'Globe Life')
  assert.equal(buildSubmission(policy, 'agent', { policy: true, licensed: ['FL'] }), null)
})
