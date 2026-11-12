import { useSyncExternalStore, createContext, useContext, createElement } from 'react'
import { sampleTrend } from '../template/leadTrend.js'
import { addDays, buildDays, isoFromText, rolling, sampleHistory, spreadWeek } from './revTrend.js'
import { useSampleBugs, setSampleBugStatus } from '../template/bugReport.js'
import { SETUP_STEPS, setupOf, hasTicket } from './setup.js'
import { hasLeads, planPriceOf, planLineOf, NO_PLAN, sampleSplit } from './products955.js'
import { PRICES, SETTINGS, bandText, nightlyCharge } from '../lib/priceBook.js'
import { tierOf } from '../template/spendPlan.js'
import { TIMESHEET, HOURLY, sheetTotals } from './p879.js'
import { matchAgent } from '../lib/leadMatch.js'
import { isTrained } from '../fulshell/training/store.js'
import { escalateCall, stepText } from '../lib/callEscalation.js'

// P849 — the one door to the Admin side's sample info, like src/template/ful/data.js for the VA side. Screens read only
// through the hooks below; every read returns { data, isLoading: false, error: null }, the react-query shape, so the
// backend swaps in by replacing this file (today's admin hooks: useAdminWeek, useFulfillmentPayouts, useAppSettings,
// useRecoveryConfig, admin_give_call, admin_set_user_access ...). Changes live in memory and reset on reload. Nothing
// leaves the browser. The sample day is Thursday, Nov 5; the week is Mon Nov 2 to Sun Nov 8. Prices are sample prices.

export const TODAY = 5
const SAMPLE_TODAY_ISO = '2026-11-05' // P942: the sample clock's today (Thu, Nov 5)
const WEEKDAY = { 0: 'Sun', 1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri', 6: 'Sat' }
// November 2026 starts on a Sunday, so date d falls on weekday d % 7 ... with Nov 1 = Sun (0).
export const dayName = d => WEEKDAY[(d - 1) % 7]
export const dateText = d => `${dayName(d)}, Nov ${d}`
export const WEEK = [2, 3, 4, 5, 6, 7, 8]
export const NEXT_WEEK = [9, 10, 11, 12, 13, 14, 15]

export const ME = { name: 'Sam Ellis', email: 'sam@ohvara.com', phone: '(512) 555-0100', role: 'Admin' }

// P909: the plans and their monthly prices, from the one price source (price book version 3). An agent's plan
// follows their daily lead spend band (P906: `spend` is the daily spend in dollars everywhere on the admin side);
// servicing only has its own price. price = dollars a month.
// Lead plans also pay 12% of their lead spend (PRICES.leadFee), shown apart from the plan fee in Revenue.
export const PLANS = {
  ...Object.fromEntries(PRICES.tiers.map(t => [t.key, { label: t.label, price: t.monthly, sub: bandText(t) }])),
  servicing: { label: 'Servicing only', price: PRICES.servicingOnly, sub: 'No leads' },
}
const planFor = o => o.plan ?? (o.spend ? tierOf(o.spend ?? 0).key : null)
// A month's membership counted against one week.
const weekShare = monthly => Math.round((monthly * 12) / 52)
export const LEAD_PRICE = { appointment: 45, live: 65 }

// P921: planNext = a move down scheduled for the next bill ({ key, on }); upgrades are charged at once, so only moves
// down wait. lastUpgrade = the last move up and what it charged.
// P906: spend = daily lead spend in dollars (the plan follows its band). billing: the card on file and its last
// nightly charge, how many days of leads are paid ahead (one, charged the night before), credit the ads didn't spend,
// the setup fee, the founding lock and the next charge. Sample.
const mkBill = o => ({
  status: 'current', next: 'Tonight, 8:00 PM', method: 'Visa •••• 4242', failed: null, card: 'Visa •••• 4242',
  last: { when: 'Wed, Nov 4, 8:00 PM', result: 'approved' }, paidAhead: 1, credit: 0,
  setup: { paid: 'Sep 14', amount: PRICES.setupFee }, ...o,
})
// P913: the Meta campaign ID saved on the agent when GoHighLevel creates their campaign (one campaign per agent).
const metaId = id => `12021${String([...id].reduce((n, ch) => (n * 31 + ch.charCodeAt(0)) % 1e10, 7)).padStart(10, '0')}`
const mkAgent = (id, name, o) => ({
  id, name, role: 'agent', city: 'Austin', state: 'TX', email: `${name.split(' ')[0].toLowerCase()}@example.com`, phone: '(555) 555-0100',
  spend: 100, active: true, onDuty: false, servicing: true, access: true, comped: false, joined: 'Sep 14', lastOn: 'Today',
  agentRef: `DS-${id.slice(3, 7).toUpperCase()}`, campaignId: metaId(id), states: ['TX'], ...o, billing: mkBill(o.billing),
  plan: planFor({ spend: 100, ...o }),
})
const seedAgents = [
  mkAgent('ag-dana', 'Dana Walker', { city: 'Austin', state: 'TX', phone: '(512) 555-0143', spend: 120, onDuty: true, states: ['TX', 'OK'], joined: 'Aug 30', picked: ['leads', 'reactivation'],
    planNext: { key: 'starter', on: 'Tue, Dec 1' },
    billing: { credit: 14, setup: { paid: 'Aug 30', amount: PRICES.setupFee } } }),
  mkAgent('ag-marcus', 'Marcus Reed', { city: 'Phoenix', state: 'AZ', phone: '(602) 555-0118', spend: 60, active: false, states: ['AZ', 'NV'], lastOn: 'Wed',
    billing: { method: 'Visa •••• 1881', card: 'Visa •••• 1881' } }),
  mkAgent('ag-priya', 'Priya Shah', { city: 'Tampa', state: 'FL', phone: '(813) 555-0170', spend: 600, onDuty: false, paused: { since: 'Wed, Nov 4', until: 'Mon, Nov 16' }, states: ['FL', 'GA'], joined: 'Aug 30',
    billing: { next: 'Paused to Mon, Nov 16', method: 'Amex •••• 3005', card: 'Amex •••• 3005', paidAhead: 0, last: { when: 'Tue, Nov 3, 8:00 PM', result: 'approved' }, setup: { paid: 'Aug 30', amount: PRICES.setupFee } } }),
  mkAgent('ag-elena', 'Elena Torres', { city: 'San Antonio', state: 'TX', phone: '(210) 555-0191', spend: 50, servicing: false, states: ['TX'], joined: 'Oct 12',
    billing: { next: 'Retry Fri, 8:00 AM', method: 'Visa •••• 7310', card: 'Visa •••• 7310', paidAhead: 0, last: { when: 'Thu, Nov 5, 8:00 PM', result: 'declined', why: 'Card declined' },
      failed: { what: 'Nightly lead charge', when: 'Thu, Nov 5', why: 'Card declined', amount: 56 }, setup: { paid: 'Oct 12', amount: PRICES.setupFee } } }),
  mkAgent('ag-james', 'James Okafor', { city: 'Atlanta', state: 'GA', phone: '(404) 555-0126', spend: 85, onDuty: true, states: ['GA', 'SC'], joined: 'Sep 28', picked: ['leads', 'reactivation'],
    lastUpgrade: { from: 'starter', to: 'growth', on: 'Mon, Nov 2', amount: 773.33, days: 29 },
    billing: { method: 'Mastercard •••• 6022', card: 'Mastercard •••• 6022', setup: { paid: 'Sep 28', amount: PRICES.setupFee } } }),
  mkAgent('ag-grace', 'Grace Kim', { city: 'Denver', state: 'CO', phone: '(303) 555-0164', spend: 65, active: false, comped: true, states: ['CO'], lastOn: 'Tue',
    billing: { status: 'comped', next: 'Comped to Dec 1', method: 'None needed', card: null, last: null, paidAhead: 0, setup: null } }),
  mkAgent('ag-ben', 'Ben Carter', { city: 'Charlotte', state: 'NC', phone: '(704) 555-0137', spend: 50, active: false, states: ['NC'], joined: 'Oct 19', lastOn: 'Mon',
    billing: { status: 'past_due', next: 'Locks Fri, Nov 6, 9:00 AM', method: 'Visa •••• 0094', card: 'Visa •••• 0094', paidAhead: 0, last: { when: 'Wed, Nov 4, 8:00 PM', result: 'declined', why: 'Card declined' },
      failed: { what: 'Monthly plan', when: 'Wed, Nov 4', why: 'Card declined', amount: 699 }, setup: { paid: 'Oct 19', amount: PRICES.setupFee } } }),
  // P955: agents without Leads. No lead spend, no band plan, no transfers, never a Setup ticket. Tasha's Servicing ends
  // at her next bill date (a removal waiting); Marcus Webb only buys Reactivation lists (no monthly plan, no setup fee).
  mkAgent('ag-sofia', 'Sofia Alvarez', { city: 'Houston', state: 'TX', phone: '(713) 555-0149', spend: 0, plan: 'servicing', picked: ['servicing'], active: false, states: ['TX'], joined: 'Oct 5',
    billing: { next: 'Renews Dec 5', method: 'Visa •••• 2218', card: 'Visa •••• 2218', paidAhead: 0, last: { when: 'Mon, Oct 5', result: 'approved' }, setup: { paid: 'Oct 5', amount: PRICES.setupFee } } }),
  mkAgent('ag-tasha', 'Tasha Greene', { city: 'Mobile', state: 'AL', phone: '(251) 555-0176', spend: 0, plan: 'servicing', picked: ['servicing', 'reactivation'], pickedNext: ['reactivation'], pickedNextFrom: '2026-12-09',
    active: false, states: ['AL'], joined: 'Sep 9', lastOn: 'Wed',
    billing: { next: 'Renews Dec 9', method: 'Mastercard •••• 4410', card: 'Mastercard •••• 4410', paidAhead: 0, last: { when: 'Mon, Nov 9', result: 'approved' }, setup: { paid: 'Sep 9', amount: PRICES.setupFee } } }),
  mkAgent('ag-webb', 'Marcus Webb', { city: 'Little Rock', state: 'AR', phone: '(501) 555-0133', spend: 0, plan: null, picked: ['reactivation'], active: false, states: ['AR'], joined: 'Oct 26', lastOn: 'Mon',
    billing: { next: 'Pays per list', method: 'Visa •••• 9035', card: 'Visa •••• 9035', paidAhead: 0, last: { when: 'Wed, Oct 28', result: 'approved' }, setup: null } }),
]
// Tonight's charge for an agent: tomorrow's spend minus credit, plus 12% (nothing while paused or comped).
export const chargeFor = a => (a.comped || a.paused || !hasLeads(a) ? null : nightlyCharge({ daily: a.spend, credit: a.billing?.credit || 0 }))

const mkVa = (id, name, o) => ({
  id, name, role: 'fulfillment', email: `${name.split(' ')[0].toLowerCase()}@example.com`, phone: '(555) 555-0150', hours: '9:00 AM to 5:00 PM',
  access: true, bank: 'ready', joined: 'Sep 2', lastOn: 'Today', missed: 0, ...o,
})
const seedVas = [
  mkVa('va-maya', 'Maya Brooks', { phone: '(512) 555-0161', joined: 'Aug 24' }),
  mkVa('va-andre', 'Andre Lewis', { phone: '(737) 555-0120', hours: '10:00 AM to 6:00 PM', lastOn: 'Wed' }),
  mkVa('va-keisha', 'Keisha Grant', { phone: '(512) 555-0185', hours: '8:00 AM to 4:00 PM', missed: 1 }),
  mkVa('va-omar', 'Omar Haddad', { phone: '(346) 555-0102', hours: '12:00 PM to 8:00 PM', bank: 'none', joined: 'Oct 5' }),
  mkVa('va-lily', 'Lily Chen', { phone: '(214) 555-0158', lastOn: 'Wed', bank: 'held' }),
]

const seedInvites = [
  { id: 'inv-2', name: 'Rosa Diaz', role: 'fulfillment', via: 'text', to: '(512) 555-0177', sent: 'Wed, Nov 4' },
]

// P906 — Setup tickets: agents who signed up themselves. A ticket shows only once they've PAID (the setup fee plus
// their first days of lead spend: `done` holds 'paid'); Nadia, Monique and Carl haven't, so they aren't on Setup.
// `done` lists the SETUP_STEPS keys ticked (src/adminshell/setup.js works out the column, % and blocker).
// spend = daily lead spend; lead = 'appointment' or 'live' (Appointments + live transfers); paid = when and for how
// many days of leads; campaignReq = the "Create campaign" request sent through the GoHighLevel engine slot.
// P941: a paid ticket carries its sign-up (signupFor): plan, daily spend, the one sign-up charge (setup + first month +
// the first 2 days of leads with the booking desk), hours by day and time zone, live transfers yes/no.
const WEEKDAY_ROWS = (start, end, days = [1, 2, 3, 4, 5]) => days.map(weekday => ({ weekday, start, end }))
const TZ = { Central: 'America/Chicago', Eastern: 'America/New_York', Mountain: 'America/Denver', Pacific: 'America/Los_Angeles' }
const signupFor = (o, plan) => {
  if (!o.paid) return null
  const leads = Math.round(nightlyCharge({ daily: (o.spend || 0) * 2 }).total * 100)
  const planCents = Math.round((PLANS[plan]?.price || 0) * 100)
  const setupCents = Math.round(PRICES.setupFee * 100)
  return {
    tier: plan, dailyCents: Math.round((o.spend || 0) * 100), paidOn: o.paid.on, paidShort: o.paid.short || o.paid.on,
    paidCents: setupCents + planCents + leads, setupCents, planCents, leadCents: leads,
    tz: TZ[o.launch?.tz] || 'America/Chicago', hours: o.hours || WEEKDAY_ROWS('09:00', '17:00'), live: o.lead === 'live',
  }
}
const mkNew = (id, name, o) => {
  const plan = o.spend ? planFor(o) : null
  return {
    id, name, city: '', state: '', states: [], lead: 'appointment', spend: 0, done: [], since: 'Mon, Nov 2', campaignReq: null, picked: ['leads'],
    agentRef: `DS-${id.slice(3, 7).toUpperCase()}`, ...o, plan, signup: signupFor(o, plan),
  }
}
const made = (name, at) => ({ status: 'created', at, name })
// P913: the launch checks' sample facts (src/adminshell/setup.js launchChecks). launchOk(ref, extra) = every check passes.
const launchOk = (ref, o = {}) => ({
  linkRef: ref, campaignId: `12021${ref.slice(3).padEnd(4, '0').split('').map(ch => ch.charCodeAt(0) % 10).join('')}880`, campaignRef: ref,
  testLead: { at: 'Wed, Nov 4, 2:10 PM', matchedRef: ref, by: 'link' }, licence: true, hours: '9:00 AM to 6:00 PM', tz: 'Central', card: 'Visa •••• 4242',
  app: { installed: true, pushAnswered: true }, testCall: { at: 'Wed, Nov 4, 2:14 PM', by: 'AI' }, ...o,
})
const seedOnboard = [
  mkNew('ob-nadia', 'Nadia Brooks', { city: 'Dallas', state: 'TX', states: ['TX'], spend: 75, since: 'Wed, Nov 4' }),
  // P955: paid, but no Leads: Servicing only and Reactivation only never get a Setup ticket.
  mkNew('ob-keith', 'Keith Lam', { city: 'Fresno', state: 'CA', states: ['CA'], picked: ['servicing'], done: ['paid'], paid: { on: 'Wed, Nov 4', short: 'Nov 4', days: 0 }, since: 'Wed, Nov 4' }),
  mkNew('ob-joan', 'Joan Pierce', { city: 'Boise', state: 'ID', states: ['ID'], picked: ['reactivation'], done: ['paid'], since: 'Tue, Nov 3' }),
  // Signed up for Servicing, then added Leads in Billing: the ticket opens once that charge is paid (its 'paid' step).
  mkNew('ob-tom', 'Tom Alvarez', { city: 'Lubbock', state: 'TX', states: ['TX', 'NM', 'OK'], spend: 70, picked: ['leads', 'servicing'], done: ['paid'], paid: { on: 'Wed, Nov 4', short: 'Nov 4', days: 2 },
    leadsAdded: { on: 'Nov 4' }, since: 'Wed, Nov 4', launch: { licence: true, hours: '9:00 AM to 5:00 PM', tz: 'Central', card: 'Visa •••• 6650' } }),
  mkNew('ob-monique', 'Monique Price', { city: 'Orlando', state: 'FL', states: ['FL'], spend: 100, since: 'Tue, Nov 3' }),
  mkNew('ob-carl', 'Carl Jensen', { city: 'Mesa', state: 'AZ', states: ['AZ', 'NM'], spend: 60, note: 'Card declined on the setup fee', since: 'Mon, Nov 2' }),
  mkNew('ob-rachel', 'Rachel Nguyen', { city: 'Houston', state: 'TX', states: ['LA', 'OK', 'TX'], spend: 65, done: ['paid'], paid: { on: 'Today, 9:12 AM', short: 'Nov 10', days: 2 }, since: 'Thu, Nov 5',
    launch: { licence: true, hours: '9:00 AM to 5:00 PM', tz: 'Central', card: 'Visa •••• 5120' } }),
  mkNew('ob-luis', 'Luis Ortega', { city: 'El Paso', state: 'TX', states: ['TX', 'NM', 'AZ'], lead: 'live', spend: 150, done: ['paid'], paid: { on: 'Wed, Nov 4', short: 'Nov 4', days: 2 }, since: 'Wed, Nov 4', hours: WEEKDAY_ROWS('08:00', '17:00', [1, 2, 3, 4, 5, 6]),
    launch: { licence: true, hours: '8:00 AM to 5:00 PM', tz: 'Mountain', card: 'Visa •••• 7781', app: { installed: true, pushAnswered: false } } }),
  mkNew('ob-hannah', 'Hannah Wright', { city: 'Savannah', state: 'GA', states: ['GA', 'FL', 'SC'], spend: 90, done: ['paid'], paid: { on: 'Tue, Nov 3', short: 'Nov 3', days: 2 },
    campaignReq: { status: 'sent', at: 'Today, 9:05 AM' }, since: 'Tue, Nov 3', launch: { linkRef: 'DS-HANN', licence: true, hours: '9:00 AM to 5:00 PM', tz: 'Eastern', card: 'Mastercard •••• 3391' } }),
  // Every check passes but the test call: Place test call unlocks Turn campaign on.
  mkNew('ob-owen', 'Owen Fisher', { city: 'Raleigh', state: 'NC', states: ['NC', 'SC', 'VA'], lead: 'live', spend: 220, done: ['paid', 'campaign'], paid: { on: 'Mon, Nov 2', short: 'Nov 2', days: 2 },
    campaignReq: made('Deedstone · Owen Fisher · DS-OWEN', 'Wed, Nov 4'), since: 'Mon, Nov 2', launch: launchOk('DS-OWEN', { tz: 'Eastern', testCall: null }) }),
  // Was on; the card failed last night, so the campaign paused and the ticket reopened on that tick.
  mkNew('ob-derek', 'Derek Shaw', { city: 'Tulsa', state: 'OK', states: ['OK', 'KS', 'MO'], lead: 'live', spend: 130, done: ['paid', 'campaign', 'on'], paid: { on: 'Fri, Oct 30', short: 'Oct 30', days: 2 },
    campaignReq: made('Deedstone · Derek Shaw · DS-DERE', 'Mon, Nov 2'), since: 'Fri, Oct 30', launch: launchOk('DS-DERE', { cardFailed: 'declined Thu, Nov 5, 8:00 PM' }) }),
  mkNew('ob-ivy', 'Ivy Morgan', { city: 'Scottsdale', state: 'AZ', states: ['AZ', 'NV', 'NM'], spend: 55, done: ['paid', 'campaign', 'on', 'live'], paid: { on: 'Thu, Oct 29', short: 'Oct 29', days: 2 },
    campaignReq: made('Deedstone · Ivy Morgan · DS-IVY', 'Fri, Oct 30'), liveOn: 'Wed, Nov 4', since: 'Thu, Oct 29', launch: launchOk('DS-IVY', { tz: 'Mountain', testCall: { at: 'Fri, Oct 30, 11:02 AM', by: 'VA' } }) }),
  mkNew('ob-paul', 'Paul Novak', { city: 'Columbus', state: 'OH', states: ['OH', 'IN', 'KY'], lead: 'live', spend: 110, done: ['paid', 'campaign', 'on', 'live'], paid: { on: 'Tue, Oct 27', short: 'Oct 27', days: 2 },
    campaignReq: made('Deedstone · Paul Novak · DS-PAUL', 'Wed, Oct 28'), liveOn: 'Mon, Nov 2', since: 'Tue, Oct 27', launch: launchOk('DS-PAUL', { tz: 'Eastern' }) }),
]
// What a ticket's agent paid to open it: the setup fee plus their first days of spend and its 12%.
export const paidFor = c => {
  if (!c.paid) return null
  const days = c.paid.days || 1
  const leads = nightlyCharge({ daily: (c.spend || 0) * days }).total
  return { on: c.paid.on, days, setup: PRICES.setupFee, leads, total: PRICES.setupFee + leads }
}
// Each ticket's history, newest first (the drawer's audit lines).
const seedSetupLog = {
  'ob-rachel': [{ at: 'Today, 9:12 AM', who: 'Stripe', what: 'Signed up and paid: setup, first month and 2 days of leads' }],
  'ob-tom': [{ at: 'Wed, Nov 4', who: 'Stripe', what: 'Added Leads in Billing and paid: setup, first month and 2 days of leads' }],
  'ob-luis': [{ at: 'Wed, Nov 4', who: 'Stripe', what: 'Signed up and paid: setup, first month and 2 days of leads' }],
  'ob-hannah': [{ at: 'Today, 9:05 AM', who: 'Sam Ellis', what: 'Sent Create campaign to GoHighLevel' }, { at: 'Tue, Nov 3', who: 'Stripe', what: 'Signed up and paid: setup, first month and 2 days of leads' }],
  'ob-owen': [{ at: 'Wed, Nov 4', who: 'GoHighLevel', what: 'Campaign created: Deedstone · Owen Fisher · DS-OWEN' }],
  'ob-derek': [{ at: 'Today, 8:40 AM', who: 'Sam Ellis', what: 'Ticked Campaign on' }, { at: 'Mon, Nov 2', who: 'GoHighLevel', what: 'Campaign created: Deedstone · Derek Shaw · DS-DERE' }],
  'ob-ivy': [{ at: 'Wed, Nov 4', who: 'Sam Ellis', what: 'Marked done' }],
  'ob-paul': [{ at: 'Mon, Nov 2', who: 'Sam Ellis', what: 'Marked done' }],
}

// Leads this week across every agent. kind = appointment (booked onto the agent's calendar), live (a live transfer)
// or none (never reached). stage (P913): booked | no_show | follow_up | sold | not_interested, plus unassigned (matched
// no agent: the admin alert). owner on a follow-up: 'team' (the AI or no-answer texts still trying) or 'agent'.
// agentRef / campaignId are what came in with the lead; matchedBy is how matchAgent found the agent. A live call waits
// on booked until the agent marks the result.
const FIRST = ['Angela', 'Kevin', 'Shirley', 'Marcus', 'Teresa', 'Daniel', 'Brenda', 'Frank', 'Joyce', 'Victor', 'Monica', 'Gary', 'Linda', 'Raymond', 'Carmen', 'Dennis', 'Yolanda', 'Russell', 'Tanya', 'Curtis', 'Wanda', 'Hector', 'Bonnie', 'Leon', 'Sheila', 'Wayne', 'Diane', 'Ruben', 'Gail', 'Marvin', 'Rita', 'Terrence', 'Lorraine', 'Felix', 'Darlene', 'Clyde']
const LAST = ['Moore', 'Brooks', 'Adams', 'Hill', 'Lane', 'Ruiz', 'Cole', 'Ellis', 'Turner', 'Hayes', 'Diaz', 'Foster', 'Grant', 'Perry', 'Vega', 'Wells', 'Ford', 'Mills', 'Reyes', 'Bates', 'Long', 'Ortiz', 'Hunt', 'Webb', 'Ross', 'Fox', 'Barnes', 'Soto', 'Lowe', 'Pope', 'Rice', 'Tate', 'Kerr', 'Nash', 'Boyd', 'Gray']
const PRODUCTS = ['Mortgage protection', 'Mortgage protection', 'Final expense', 'Term life']
const CITY = { TX: ['Austin', 'Plano', 'Round Rock'], AZ: ['Phoenix', 'Mesa', 'Tempe'], FL: ['Tampa', 'Brandon', 'Ocala'], GA: ['Atlanta', 'Macon', 'Marietta'], CO: ['Denver', 'Aurora'], NC: ['Charlotte', 'Durham'], OK: ['Tulsa'], NV: ['Henderson'], SC: ['Greenville'] }
const APPT_STAGES = ['booked', 'sold', 'no_show', 'not_interested', 'booked', 'sold', 'follow_up', 'team_follow']
const LIVE_STAGES = ['booked', 'sold', 'follow_up', 'not_interested', 'sold', 'booked']
const ROUTE_TO = ['ag-dana', 'ag-priya', 'ag-james', 'ag-dana', 'ag-elena', 'ag-priya', 'ag-marcus', 'ag-grace', 'ag-james', 'ag-priya', 'ag-dana', 'ag-elena']
const PER_DAY = { 2: 9, 3: 10, 4: 10, 5: 9 }
const clock = n => { const h = 8 + Math.floor(n / 2); const m = n % 2 ? 40 : 12; return `${h > 12 ? h - 12 : h}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}` }
const seedLeads = (() => {
  const out = []
  let i = 0
  let a = 0
  let l = 0
  for (const day of [2, 3, 4, 5]) {
    for (let k = 0; k < PER_DAY[day]; k += 1, i += 1) {
      let kind = i % 3 === 0 ? 'live' : 'appointment'
      const agent = seedAgents.find(x => x.id === ROUTE_TO[i % ROUTE_TO.length])
      const state = agent.states[i % agent.states.length]
      const cities = CITY[state]
      let stage = kind === 'live' ? LIVE_STAGES[l++ % LIVE_STAGES.length] : APPT_STAGES[a++ % APPT_STAGES.length]
      // P913: every lead carries the agent ID from its ad link, or only its Meta campaign ID (every 5th); matchAgent
      // finds the agent either way. P934: no sample lead matches no one. The "couldn't be matched" alert is a real
      // safety net (a paid lead with no agent ID and no known campaign) and only shows if that really happens.
      const sent = i % 5 === 2 ? { campaignId: agent.campaignId } : { agentRef: agent.agentRef, campaignId: agent.campaignId }
      const hit = matchAgent(sent, seedAgents)
      if (!hit.agent_id) stage = 'unassigned'
      else if (day === TODAY && kind === 'appointment' && !['booked', 'team_follow'].includes(stage)) stage = 'booked'
      const owner = stage === 'team_follow' ? 'team' : stage === 'follow_up' ? 'agent' : null
      if (stage === 'team_follow') { stage = 'follow_up'; kind = 'none' }
      const name = `${FIRST[i % FIRST.length]} ${LAST[(i * 7) % LAST.length]}`
      const time = clock(k + (day === TODAY ? 2 : 0))
      out.push({
        id: `ib-${i + 1}`, name, phone: `(${['512', '602', '813', '404', '303', '704'][i % 6]}) 555-0${String(110 + i).padStart(3, '0')}`, state, city: cities[i % cities.length],
        kind, product: PRODUCTS[i % PRODUCTS.length], day, time, came: day === TODAY ? `Today, ${time}` : `${dayName(day)}, ${time}`,
        source: i % 4 === 1 ? 'Meta · landing page' : 'Meta · form',
        agent_id: hit.agent_id, stage, owner, agentRef: sent.agentRef || '', campaignId: sent.campaignId || '', matchedBy: hit.by, why: hit.why,
        premium: stage === 'sold' ? 38 + ((i * 13) % 80) : 0,
        appt: kind === 'appointment' ? `${dateText(Math.min(day + 1 + (i % 3), 9))}, ${clock((i * 3) % 18)}` : null,
        note: owner === 'team' ? 'The AI called twice, no answer. Our team keeps trying: the day 30, 60 and 90 check-in texts are set.' : '',
        log: [],
      })
    }
  }
  return out
})()

// Clients across every agent's book (sold policies) and the servicing steps open on them.
// P906: stage = the P899 client status (working | needs_attention | protected | closed); tag = an open request.
const mkClient = (id, name, agent, va, o) => ({ id, name, agent_id: agent, va_id: va, phone: '(555) 555-0100', state: 'TX', carrier: 'Mutual of Omaha', product: 'Term Life 20', policy: 'MO-4471023', premium: 64.5, stage: 'protected', sold: 'Oct 21', city: 'Austin', draft: 12, attention: null, tag: null, ...o })
const seedClients = [
  mkClient('cl-gloria', 'Gloria Santos', 'ag-dana', 'va-maya', { city: 'Miami', draft: 3, phone: '(305) 555-0156', state: 'FL', stage: 'working', attention: 'New policy being set up', carrier: 'Americo', product: 'Mortgage Protection 25', policy: 'AM-2209184', premium: 88.4, sold: 'Nov 2' }),
  mkClient('cl-robert', 'Robert Chen', 'ag-marcus', 'va-keisha', { city: 'Mesa', draft: 14, phone: '(480) 555-0142', state: 'AZ', carrier: 'Foresters', product: 'Strong Foundation', policy: 'FF-7712406', premium: 52.1, sold: 'Oct 14' }),
  mkClient('cl-luis', 'Luis Ortega', 'ag-priya', 'va-omar', { city: 'Tampa', draft: 1, phone: '(813) 555-0119', state: 'FL', stage: 'working', attention: 'Draft failed on Nov 1: the team is fixing it', carrier: 'Transamerica', product: 'Trendsetter Super 20', policy: 'TA-5530981', premium: 71.25, sold: 'Oct 9' }),
  mkClient('cl-denise', 'Denise Walker', 'ag-dana', 'va-maya', { city: 'Dallas', draft: 18, phone: '(214) 555-0171', tag: 'Address change in progress', carrier: 'Mutual of Omaha', policy: 'MO-4471188', premium: 47.9, sold: 'Sep 30' }),
  mkClient('cl-harold', 'Harold Nguyen', 'ag-marcus', 'va-keisha', { city: 'Houston', draft: 5, phone: '(713) 555-0188', stage: 'working', attention: 'New policy being set up', carrier: 'Americo', policy: 'AM-2209377', premium: 96, sold: 'Nov 3' }),
  mkClient('cl-carla', 'Carla Jones', 'ag-james', 'va-andre', { city: 'Atlanta', draft: 2, phone: '(404) 555-0133', state: 'GA', carrier: 'Foresters', policy: 'FF-7712589', premium: 39.75, sold: 'Oct 2' }),
  mkClient('cl-renee', 'Renee Ortiz', 'ag-grace', 'va-lily', { city: 'Denver', draft: 20, phone: '(303) 555-0127', state: 'CO', stage: 'needs_attention', attention: 'Still on the books? Draft on the 20th', carrier: 'Transamerica', policy: 'TA-5531044', premium: 58.3, sold: 'Oct 20' }),
  mkClient('cl-walter', 'Walter Price', 'ag-james', 'va-omar', { city: 'Marietta', draft: 9, phone: '(678) 555-0194', state: 'GA', stage: 'working', attention: 'New policy being set up', carrier: 'Mutual of Omaha', policy: 'MO-4471342', premium: 61, sold: 'Nov 4' }),
  mkClient('cl-irene', 'Irene Baker', 'ag-priya', 'va-omar', { city: 'Clearwater', draft: 22, phone: '(727) 555-0109', state: 'FL', carrier: 'Americo', policy: 'AM-2209455', premium: 73.6, sold: 'Sep 22' }),
  mkClient('cl-tom', 'Tom Fischer', 'ag-dana', 'va-maya', { city: 'Austin', draft: 6, phone: '(512) 555-0122', tag: 'Beneficiary change in progress', carrier: 'Foresters', policy: 'FF-7712633', premium: 44.2, sold: 'Oct 6' }),
  mkClient('cl-nadia', 'Nadia Khan', 'ag-elena', 'va-andre', { city: 'San Antonio', draft: 27, phone: '(210) 555-0177', carrier: 'Transamerica', policy: 'TA-5531102', premium: 82.9, sold: 'Oct 27' }),
  mkClient('cl-agnes', 'Agnes Moore', 'ag-james', 'va-andre', { city: 'Savannah', draft: 12, phone: '(404) 555-0181', state: 'GA', stage: 'closed', attention: 'Lapsed after the save call', carrier: 'Americo', policy: 'AM-2208810', premium: 49, sold: 'Aug 12' }),
  mkClient('cl-paul', 'Paul Rivera', 'ag-priya', 'va-lily', { city: 'Tampa', draft: 4, phone: '(813) 555-0165', state: 'FL', stage: 'needs_attention', attention: 'Still on the books? Draft on the 4th', carrier: 'Mutual of Omaha', policy: 'MO-4471399', premium: 55.5, sold: 'Nov 4' }),
]
const mkStep = (id, kind, client, va, o) => ({ id, kind, client_id: client, va_id: va, due: 'Today', late: false, status: 'requested', ...o })
const seedSteps = [
  mkStep('ss-1', 'Payment change', 'cl-luis', 'va-omar', { due: 'Was due Wed', late: true }),
  mkStep('ss-2', 'Policy packet check', 'cl-renee', 'va-lily', { due: 'Was due Tue', late: true }),
  mkStep('ss-3', 'Beneficiary change', 'cl-denise', 'va-maya', { due: 'Today, 1:00 PM', status: 'scheduled' }),
  mkStep('ss-4', 'Address change', 'cl-tom', 'va-maya', { due: 'Today, 4:00 PM' }),
  mkStep('ss-5', 'Review call', 'cl-carla', 'va-andre', { due: 'Fri, Nov 6' }),
  mkStep('ss-6', 'Chargeback watch', 'cl-harold', 'va-keisha', { due: 'Mon, Nov 9' }),
]

// Today's desk: every cancellation call on the Fulfillment team's day. status: done | cancelled | no_answer | live |
// booked (to call) | late (its time, not started yet) | rebook (nobody was free: the AI front desk is rebooking it).
// P945: a call nobody starts escalates by itself (lib/callEscalation.js): + 5 min the VA is pinged, + 10 min it goes
// to the next free VA (pod first) and the first VA is told, or the AI front desk texts the client to rebook.
const mkCall = (id, va, time, client, status, o) => ({ id, va_id: va, time, client, status, old_carrier: 'Globe Life', agent_id: 'ag-dana', ...o })
const seedCalls = [
  mkCall('dc-1', 'va-keisha', '8:30 AM', 'Irene Baker', 'cancelled', { old_carrier: 'Colonial Penn', agent_id: 'ag-priya' }),
  mkCall('dc-2', 'va-keisha', '9:45 AM', 'Robert Chen', 'cancelled', { old_carrier: 'Gerber Life', agent_id: 'ag-marcus' }),
  mkCall('dc-3', 'va-maya', '10:30 AM', 'Tom Fischer', 'cancelled', { old_carrier: 'Lincoln Heritage' }),
  mkCall('dc-4', 'va-maya', '11:45 AM', 'Luis Ortega', 'no_answer', { agent_id: 'ag-priya' }),
  mkCall('dc-5', 'va-keisha', '12:15 PM', 'Carla Jones', 'late', { agent_id: 'ag-james' }),
  mkCall('dc-6', 'va-omar', '12:30 PM', 'Nadia Khan', 'late', { old_carrier: 'AARP / New York Life', agent_id: 'ag-elena' }),
  mkCall('dc-7', 'va-keisha', '1:15 PM', 'Harold Nguyen', 'live', { old_carrier: 'Colonial Penn', agent_id: 'ag-marcus' }),
  mkCall('dc-8', 'va-maya', '2:00 PM', 'Gloria Santos', 'booked'),
  mkCall('dc-9', 'va-omar', '2:45 PM', 'Paul Rivera', 'booked', { agent_id: 'ag-priya' }),
  mkCall('dc-10', 'va-maya', '3:30 PM', 'Denise Walker', 'booked'),
  mkCall('dc-11', 'va-omar', '4:15 PM', 'Walter Price', 'booked', { old_carrier: 'AARP / New York Life', agent_id: 'ag-james' }),
  mkCall('dc-12', 'va-omar', '6:00 PM', 'Renee Ortiz', 'booked', { agent_id: 'ag-grace' }),
]

// P945: run the escalation on the sample's two unstarted calls as of the sample "now" (1:30 PM, on shift today:
// Maya, Keisha, Omar). Whoever takes one calls it right away (done); a call nobody could take is the AI's to rebook.
const SAMPLE_NOW = 13 * 60 + 30
const minOf = t => { const m = /^(\d{1,2}):(\d{2}) (AM|PM)$/.exec(t); if (!m) return 0; let h = Number(m[1]) % 12; if (m[3] === 'PM') h += 12; return h * 60 + Number(m[2]) }
const ON_TODAY = ['va-maya', 'va-keisha', 'va-omar']
const OPEN = ['booked', 'late', 'live']
export const SAMPLE_ESCALATIONS = []
for (const c of seedCalls) {
  if (c.status !== 'late') continue
  const r = escalateCall({
    call: { id: c.id, va_id: c.va_id, min: minOf(c.time) },
    nowMin: SAMPLE_NOW,
    vas: ON_TODAY.map(id => ({ id, onShift: true, onCall: false })),
    calls: seedCalls.filter(x => x.id !== c.id).map(x => ({ id: x.id, va_id: x.va_id, min: x.moved ? minOf(x.time) + x.moved.after : minOf(x.time), open: !!x.moved || OPEN.includes(x.status) })),
  })
  SAMPLE_ESCALATIONS.push({ call: c.id, client: c.client, time: c.time, steps: r.steps })
  if (r.to) Object.assign(c, { va_id: r.to, status: 'cancelled', moved: { from: c.va_id, after: 10 } })
  else if (r.rebook) Object.assign(c, { status: 'rebook' })
}

// The rota: who is on shift each day (date in November -> VA ids). Two or three every day.
const seedRota = {
  2: ['va-maya', 'va-andre', 'va-keisha'], 3: ['va-maya', 'va-omar'], 4: ['va-andre', 'va-keisha', 'va-lily'], 5: ['va-maya', 'va-keisha', 'va-omar'],
  6: ['va-andre', 'va-omar', 'va-lily'], 7: ['va-keisha', 'va-lily'], 8: ['va-omar', 'va-maya'],
  9: ['va-maya', 'va-andre', 'va-lily'], 10: ['va-keisha', 'va-omar'], 11: ['va-maya', 'va-andre', 'va-keisha'], 12: ['va-lily', 'va-omar'],
  13: ['va-maya', 'va-keisha', 'va-andre'], 14: ['va-omar', 'va-lily'], 15: ['va-keisha', 'va-andre'],
}
export const SHIFT_MIN = 2
export const SHIFT_MAX = 3
// P913: VAs book their own days off inside the monthly allowance, so every row is booked (approved), none pending.
const seedDayOff = [
  { id: 'do-1', va_id: 'va-andre', date: 6, reason: "Kid's school event", asked: 'Wed, Nov 4', status: 'approved' },
  { id: 'do-2', va_id: 'va-lily', date: 9, reason: 'Doctor appointment', asked: 'Wed, Nov 4', status: 'approved' },
  { id: 'do-3', va_id: 'va-omar', date: 14, reason: 'Family wedding', asked: 'Thu, Nov 5', status: 'approved' },
  { id: 'do-4', va_id: 'va-keisha', date: 3, reason: 'Moving day', asked: 'Fri, Oct 30', status: 'approved' },
]

// P890/P945: VA pay is hourly ($8/hr) on scheduled hours minus days off (p879 TIMESHEET). No per-cancel pay, so no cancel rows.
const seedCancels = []
const seedRuns = [
  { id: 'pr-1', week: 'Oct 26 to Nov 1', paid: 'Mon, Nov 2', amount: 486, people: 5, status: 'paid' },
  { id: 'pr-2', week: 'Oct 19 to 25', paid: 'Mon, Oct 26', amount: 522, people: 5, status: 'paid' },
  { id: 'pr-3', week: 'Oct 12 to 18', paid: 'Mon, Oct 19', amount: 396, people: 4, status: 'paid' },
  { id: 'pr-4', week: 'Oct 5 to 11', paid: 'Mon, Oct 12', amount: 342, people: 4, status: 'paid' },
]
// Revenue by week (servicing plans + lead spend charged). Sample amounts.
const seedRevenue = [
  { wk: 'Sep 28', plans: 1294, leads: 2210 }, { wk: 'Oct 5', plans: 1493, leads: 2480 }, { wk: 'Oct 12', plans: 1692, leads: 2725 },
  { wk: 'Oct 19', plans: 1891, leads: 2960 }, { wk: 'Oct 26', plans: 1891, leads: 3105 },
]

// P934: Brayden's share of the profit, in percent (Jordan gets the rest). Fixed: no admin can change it in the portal.
export const OWNER_SPLIT = 50
// P864 — Money: the owners who split the profit, their draws, and what each period cost besides VA pay (sample).
// Brought in = what agents paid (lead budgets charged, servicing plans, setup fees). VA payouts count when the run is paid.
export const OWNERS = [{ id: 'ow-brayden', name: 'Brayden' }, { id: 'ow-jordan', name: 'Jordan' }]
// P945: which owner a signed-in admin is (by first name), so Revenue › Payouts shows each admin only their own payouts.
export const ownerOf = name => OWNERS.find(o => String(name || '').trim().toLowerCase().split(/\s+/)[0] === o.name.toLowerCase()) || null
export const SETUP_FEE = PRICES.setupFee // P884/P901: from the one price source
const seedSetupFees = [
  { id: 'su-1', agent: 'Elena Torres', paid: 'Mon, Oct 12', period: 'last' },
  { id: 'su-2', agent: 'Ben Carter', paid: 'Mon, Oct 19', period: 'last' },
  // P913: this week's (the Setup tickets paid this week); day = the WEEK day it was paid.
  { id: 'su-3', agent: 'Owen Fisher', paid: 'Mon, Nov 2', period: 'now', day: 2 },
  { id: 'su-4', agent: 'Hannah Wright', paid: 'Tue, Nov 3', period: 'now', day: 3 },
  { id: 'su-5', agent: 'Luis Ortega', paid: 'Wed, Nov 4', period: 'now', day: 4 },
  { id: 'su-7', agent: 'Tom Alvarez', paid: 'Wed, Nov 4', period: 'now', day: 4 }, // P955: Leads added in Billing
  { id: 'su-6', agent: 'Rachel Nguyen', paid: 'Today', period: 'now', day: 5 },
]
// Owner draws: paid out of a month's profit. October was paid in two draws; November is not paid yet.
const seedDraws = [
  { id: 'dr-1', owner: 'ow-brayden', paid: 'Mon, Nov 2', amount: 2500, period: 'last' },
  { id: 'dr-2', owner: 'ow-jordan', paid: 'Mon, Nov 2', amount: 2500, period: 'last' },
  { id: 'dr-3', owner: 'ow-brayden', paid: 'Fri, Oct 16', amount: 2000, period: 'last' },
  { id: 'dr-4', owner: 'ow-jordan', paid: 'Fri, Oct 16', amount: 2000, period: 'last' },
]
// The rest of each period's costs. Ad spend this week is read from Connect's ad accounts; Nov 1 (a Sunday) adds a little.
// Tools (texting, phone lines, software) bill on the 1st, so they land in a month and not in this week.
// P913: aiMins = AI caller minutes in the period (speed-to-lead and test calls), costed at AI_RATE a minute.
const PERIOD_COSTS = {
  week: { adsExtra: 0, tools: 0, aiMins: 318 },
  month: { adsExtra: 140, tools: 412, aiMins: 342 },
  last: { ads: 6140, tools: 412, aiMins: 1460 },
}
export const AI_RATE = 0.13 // $ a minute all in (Retell, src/lib/aiCaller.js "expect about $0.13")
export const PERIODS = [['week', 'This week', 'Mon, Nov 2 to today'], ['month', 'This month', 'Nov 1 to today'], ['last', 'Last month', 'October']]
export const CARD_FEE = PRICES.cardFee // P884/P901: from the one price source

const seedThreads = [
  { id: 'th-dana', who: 'ag-dana', unread: 1, messages: [
    { id: 'm1', from: 'them', text: 'Can I take more live transfers next week? I have Tuesday and Thursday open.', at: 'Today, 10:02 AM' },
  ] },
  { id: 'th-ben', who: 'ag-ben', unread: 1, messages: [
    { id: 'm1', from: 'me', text: 'Hi Ben, your weekly card was declined Wednesday. Update it by Friday 9 AM so leads keep coming.', at: 'Wed, 4:10 PM' },
    { id: 'm2', from: 'them', text: 'New card is coming Friday morning. Can you hold it a day?', at: 'Today, 8:41 AM' },
  ] },
  { id: 'th-andre', who: 'va-andre', unread: 1, messages: [
    { id: 'm1', from: 'them', text: "I asked for Friday off for my kid's school thing. Omar said he can cover.", at: 'Wed, 6:20 PM' },
  ] },
  { id: 'th-keisha', who: 'va-keisha', unread: 0, messages: [
    { id: 'm1', from: 'me', text: 'Nice work on the morning calls. Carla Jones at 12:15 is still open, can you get to it?', at: 'Today, 12:40 PM' },
  ] },
  { id: 'th-priya', who: 'ag-priya', unread: 0, messages: [
    { id: 'm1', from: 'them', text: 'Luis Ortega has a new card ending 4410 for the draft.', at: 'Wed, 9:15 AM' },
    { id: 'm2', from: 'me', text: 'Thanks, Omar has the payment change.', at: 'Wed, 9:22 AM' },
  ] },
]

const seedFeed = [
  { id: 'f1', who: 'Ben Carter', text: 'Monthly plan card declined', at: 'Wed', kind: 'billing' },
  { id: 'f2', who: 'Andre Lewis', text: 'Took Fri, Nov 6 off', at: 'Wed', kind: 'team' },
  { id: 'f3', who: 'Elena Torres', text: 'Nightly lead charge declined', at: '9:05 AM', kind: 'billing' },
  // P945: the escalation's own steps (handed on or sent to the AI to rebook), not a to-do.
  ...SAMPLE_ESCALATIONS.map((e, i) => {
    const last = e.steps[e.steps.length - 1]
    const first = id => (seedVas.find(v => v.id === id)?.name || 'A VA').split(' ')[0]
    return { id: `f4-${i}`, who: e.client, text: last ? stepText(last, { client: e.client, time: e.time, nameOf: first }) : `${e.client}'s call`, at: last ? `${((Math.floor(last.at / 60) + 11) % 12) + 1}:${String(last.at % 60).padStart(2, '0')} PM` : '', kind: 'desk' }
  }),
  { id: 'f5', who: 'Jordan Hale', text: 'Saved the GoHighLevel location', at: 'Tue', kind: 'connect' },
]

const seedSettings = {
  daysOffPerMonth: 3, // P913/P945: days off a month per VA (they book their own; no approvals)
  profile: { name: ME.name, email: ME.email, phone: ME.phone },
  tz: 'America/Chicago',
  switches: { sms_live: false, voice_live: false, ai_caller_live: false, recording_live: false, invite_sms_live: false, payouts_live: false, owner_payouts_live: false, billing_enforced: false, submit_live: true, carrier_lookup_live: false, signup_open: false },
  payRules: { hourly: 8 },
  // P906: the gap kept free around every booked call (lib/callSlots.js AGENT_GAP_MIN; server: p894_booking_gap.sql).
  bookingGap: 30,
  // P909: lead billing (billing_settings): the max daily spend, the nightly charge and morning retry hours (Central),
  // the founding lock. maxOverride = agents an admin raised by hand.
  billing: { ...SETTINGS, maxOverride: { 'ag-priya': 750 } },
  payoutsPaused: false,
  liveRoom: 'https://meet.example.com/ohvara-room',
  notifications: [
    { key: 'lead', label: 'A lead comes in with no agent', push: true, email: false },
    { key: 'missed', label: 'A live transfer is missed', push: true, email: true },
    { key: 'dayoff', label: 'A VA takes a day off', push: true, email: false },
    { key: 'payment', label: 'A payment fails', push: true, email: true },
    { key: 'bug', label: 'A bug report comes in', push: true, email: true }, // P876: an app notification, never a text
  ],
}
// P876: status new → seen → fixed, plus what Report a bug captures (page, browser, screen).
const seedBugs = [
  { id: 'bg-1', who: 'Dana Walker', role: 'Agent', text: 'Calendar shows my 9:00 AM twice on Monday.', at: 'Wed, 5:12 PM', shot: true, status: 'new', page: '/agent/calendar', browser: 'Chrome 142 on Mac', screen: '1512×982 screen' },
  { id: 'bg-2', who: 'Omar Haddad', role: 'Agent', text: 'The bank form closed before I could finish.', expected: 'To save my bank details.', at: 'Tue, 7:40 PM', shot: false, status: 'seen', page: '/agent/settings', browser: 'Safari 19 on iOS', screen: '390×844 screen' },
  { id: 'bg-3', who: 'Priya Shah', role: 'Agent', text: 'Search did not find a client by policy number.', at: 'Mon, 11:03 AM', shot: true, status: 'fixed', page: '/agent/clients', browser: 'Edge 142 on Windows', screen: '1920×1080 screen' },
]
const seedAudit = [
  { id: 'au-1', at: 'Wed, 4:08 PM', who: ME.name, what: 'Turned access off', target: 'Ben Carter' },
  { id: 'au-2', at: 'Wed, 11:20 AM', who: ME.name, what: 'Gave a call to Maya Brooks', target: 'Tom Fischer, 10:30 AM' },
  { id: 'au-3', at: 'Tue, 3:02 PM', who: ME.name, what: 'Approved a day off', target: 'Keisha Grant, Tue, Nov 3' },
  { id: 'au-4', at: 'Tue, 9:45 AM', who: ME.name, what: 'Sent an invite', target: 'Sofia Alvarez (agent)' },
  { id: 'au-5', at: 'Mon, 2:18 PM', who: ME.name, what: 'Marked a cancellation paid', target: 'Ida Fuller, Globe Life' },
  { id: 'au-6', at: 'Mon, 8:00 AM', who: 'Pay run', what: 'Paid 5 people', target: '$486' },
]

// Connect: what Jordan plugs in. Keys are write-only: the page keeps only "saved" and the last four, never the key.
export const GHL_WORKFLOWS = ['New lead: welcome text + book', 'Appointment reminder (24 h + 1 h)', 'No-show: rebook sequence', 'Missed call: text back', 'Long-term nurture']
const seedConnect = {
  ghl: { keySaved: false, keyEnd: '', locationId: 'loc_8XK2Q7', workflows: { newLead: GHL_WORKFLOWS[0], reminder: GHL_WORKFLOWS[1], noShow: '' }, saved: 'Tue, 2:14 PM' },
  texting: { number: '(512) 555-0199', brand: 'approved', campaign: 'in_review', sender: 'Ohvara Insurance' },
  ads: [
    { kind: 'appointment', label: 'Appointments', account: '482-913-5570', budget: 1500, spent: 1035, status: 'waiting' },
    { kind: 'live', label: 'Live calls', account: '', budget: 1200, spent: 0, status: 'not_set' },
  ],
  sources: {
    domain: 'protectmyhomeloan.com',
    forms: [
      { id: 'fm-1', name: 'Mortgage protection quote', fields: 6, on: true, leads: 7 },
      { id: 'fm-2', name: 'Final expense check', fields: 5, on: true, leads: 2 },
      { id: 'fm-3', name: 'Call me now', fields: 3, on: false, leads: 0 },
    ],
  },
}

// P864 — Connect > Setup (sample until P858): the playbook's workflows (A1 to E3, GHL Build Spec) and the tracking numbers.
export const PLAYBOOK = [
  { code: 'A1', name: 'New lead: instant text', on: true, last: 'Today, 9:42 AM' },
  { code: 'A2', name: 'Not reached: check-in texts', on: true, last: 'Today, 9:15 AM' },
  { code: 'A3', name: 'Booked: confirmation and reminders', on: true, last: 'Today, 10:03 AM' },
  { code: 'A4', name: 'Rescheduled: new reminders', on: true, last: 'Wed, 4:20 PM' },
  { code: 'A5', name: 'No-show: rebook texts', on: true, last: 'Wed, 2:05 PM' },
  { code: 'B1', name: 'Tracking number call: forward to the VA desk', on: true, last: 'Today, 10:11 AM' },
  { code: 'B2', name: 'Missed call: text back', on: true, last: 'Today, 8:57 AM' },
  { code: 'B3', name: 'Booked after a call: reminders', on: true, last: 'Today, 9:30 AM' },
  { code: 'C1', name: 'Cancellation call: confirmation and reminders', on: true, last: 'Wed, 11:40 AM' },
  { code: 'C2', name: 'Cancellation call missed: rebook text', on: true, last: 'Tue, 3:12 PM' },
  { code: 'D1', name: 'Policy issued: packet texts', on: true, last: 'Wed, 1:18 PM' },
  { code: 'D2', name: 'Review call: reminders', on: true, last: 'Mon, 10:00 AM' },
  { code: 'D3', name: 'Payment missed: reminder text', on: false, last: '' },
  { code: 'D4', name: 'Annual review: booking text', on: false, last: '' },
  { code: 'E1', name: 'Agent alert: new lead', on: true, last: 'Today, 9:42 AM' },
  { code: 'E2', name: 'Agent alert: booked', on: true, last: 'Today, 10:03 AM' },
  { code: 'E3', name: 'Agent alert: no-show or missed transfer', on: true, last: 'Wed, 2:05 PM' },
]
export const TRACKING = [
  { id: 'tn-1', number: '(512) 555-0142', label: 'Mortgage protection campaigns', to: 'the VA desk', calls: 23 },
  { id: 'tn-2', number: '(512) 555-0177', label: 'Final expense campaigns', to: 'the VA desk', calls: 9 },
  { id: 'tn-3', number: '(512) 555-0188', label: 'Landing page', to: 'the VA desk', calls: 4 },
]

let state = {
  agents: seedAgents, vas: seedVas, invites: seedInvites, leads: seedLeads, clients: seedClients, steps: seedSteps, calls: seedCalls,
  rota: seedRota, dayOff: seedDayOff, cancels: seedCancels, runs: seedRuns, revenue: seedRevenue, threads: seedThreads, feed: seedFeed,
  settings: seedSettings, bugs: seedBugs, audit: seedAudit, connect: seedConnect, setupFees: seedSetupFees, draws: seedDraws,
  onboard: seedOnboard, setupLog: seedSetupLog,
}
const listeners = new Set()
const set = fn => { state = { ...state, ...fn(state) }; listeners.forEach(l => l()) }
const subscribe = fn => { listeners.add(fn); return () => listeners.delete(fn) }
const useStore = () => useSyncExternalStore(subscribe, () => state)
const ok = data => ({ data, isLoading: false, error: null })
// P858 — sample or real. Screens keep calling the hooks below. Inside the signed-in admin portal, when the viewer's
// data mode is real (lib/dataMode.js), AdminShell wraps the pages in AdmDataProvider with the real store
// (hooks/admRealData.js: same keys, built from the tables) and the real actions; everything derived here (funnel,
// Money, Setup) then reads the real store unchanged. Outside a provider (/preview/admin, tests) it stays sample.
const SourceCtx = createContext(null)
export function AdmDataProvider({ value, children }) { return createElement(SourceCtx.Provider, { value }, children) }
const useS = () => { const real = useContext(SourceCtx); const sample = useStore(); return real?.state || sample }
const okS = (s, data) => (s.meta ? { data, isLoading: s.meta.isLoading, error: s.meta.error } : ok(data))
// 'sample' | 'real' (screens use it for empty-state words); meta = { isLoading, error, failed, retry } on real data.
export const useAdmSource = () => (useContext(SourceCtx) ? 'real' : 'sample')
export const useAdmMeta = () => useContext(SourceCtx)?.state?.meta || null
// The sample store as it is now (tests read Money's numbers from it without React).
export const admSnapshot = () => state

const nameOf = (s, id) => s.agents.find(a => a.id === id)?.name || s.vas.find(v => v.id === id)?.name || ''
export const RATE = () => state.settings.payRules.hourly
const stamp = () => new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
// Every admin action is written to the audit log, newest first. Append-only: nothing edits or removes a row.
const audit = (s, what, target) => ({ audit: [{ id: `au-${Date.now()}-${s.audit.length}`, at: `Today, ${stamp()}`, who: ME.name, what, target }, ...s.audit] })

// Funnel numbers for a list of leads.
// What is plugged in on Connect, in a fixed order (key, location + workflows, texting, ads, lead site).
export const plugged = c => [
  !!c.ghl.keySaved,
  !!c.ghl.locationId && !!c.ghl.workflows.newLead,
  c.texting.campaign === 'approved',
  c.ads.every(a => a.account),
  !!c.sources.domain && c.sources.forms.some(f => f.on),
]

export function funnel(leads) {
  return {
    in: leads.length,
    // P906: booked = appointments set with an agent; transferred = live calls an agent took (both whatever came next).
    booked: leads.filter(l => l.kind === 'appointment' && l.agent_id).length,
    transferred: leads.filter(l => l.kind === 'live' && l.agent_id).length,
    teamFollow: leads.filter(l => l.stage === 'follow_up' && l.owner === 'team').length,
    sold: leads.filter(l => l.stage === 'sold').length,
    premium: leads.reduce((t, l) => t + l.premium, 0),
  }
}

export function useAdmAgents() {
  const s = useS()
  return okS(s, s.agents.map(a => {
    const mine = s.leads.filter(l => l.agent_id === a.id)
    return { ...a, week: funnel(mine), clients: s.clients.filter(c => c.agent_id === a.id).length, planInfo: PLANS[a.plan] || NO_PLAN }
  }))
}
export function useAdmVas() {
  const s = useS()
  const rate = s.settings.payRules.hourly
  return okS(s, s.vas.map(v => {
    const sheet = TIMESHEET.find(t => t.va === v.id)
    const pay = sheet ? sheetTotals(sheet, HOURLY[v.id] || rate) : { hours: 0, pay: 0 }
    const calls = s.calls.filter(c => c.va_id === v.id)
    return {
      ...v, onShift: (s.rota[s.clock?.today ?? TODAY] || []).includes(v.id), onCall: calls.some(c => c.status === 'live'), trained: s.real ? undefined : isTrained(v.name),
      today: { total: calls.length, done: calls.filter(c => ['cancelled', 'no_answer'].includes(c.status)).length, late: calls.filter(c => c.status === 'late').length },
      week: { hours: pay.hours, pay: pay.pay },
      days: WEEK.filter(d => (s.rota[d] || []).includes(v.id)).length,
      steps: s.steps.filter(x => x.va_id === v.id).length,
    }
  }))
}
export function useAdmInvites() { const s = useS(); return okS(s, s.invites) }
// P942: { all: true } = every lead we have (real: the last 91 days; sample: the sample week), for "Showing: All".
export function useAdmLeads({ all = false } = {}) {
  const s = useS()
  return okS(s, (all && s.allLeads ? s.allLeads : s.leads).map(l => ({ ...l, agent: l.agent_id ? nameOf(s, l.agent_id) : null })))
}
export function useAdmClients() {
  const s = useS()
  return okS(s, s.clients.map(c => ({ ...c, agent: nameOf(s, c.agent_id), va: nameOf(s, c.va_id), steps: s.steps.filter(x => x.client_id === c.id) })))
}
export function useAdmSteps() {
  const s = useS()
  return okS(s, s.steps.map(x => { const c = s.clients.find(k => k.id === x.client_id); return { ...x, client: c.name, agent: nameOf(s, c.agent_id), va: nameOf(s, x.va_id) } }))
}
export function useAdmDesk() {
  const s = useS()
  return okS(s, s.calls.map(c => ({ ...c, va: nameOf(s, c.va_id), agent: nameOf(s, c.agent_id) })))
}
export function useAdmRota() { const s = useS(); return okS(s, { rota: s.rota, dayOff: s.dayOff.map(d => ({ ...d, va: nameOf(s, d.va_id) })) }) }
export function useAdmThreads() {
  const s = useS()
  return okS(s, s.threads.map(t => {
    const agent = s.agents.find(a => a.id === t.who)
    // P858: a real thread whose person isn't on the agent or VA list (inactive, or not loaded) keeps the name it came with.
    const va = s.vas.find(v => v.id === t.who)
    const role = agent || !va ? 'Agent' : 'Fulfillment'
    return { ...t, name: nameOf(s, t.who) || t.agentName || 'Someone', role }
  }))
}
// P876: a bug report sent from Help & Support lands in Bug reports and in the bell as an app notification (the
// sample store, template/bugReport, until P858 reads bug_reports).
const bugWhen = iso => { try { return new Date(iso).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' }) } catch { return 'Just now' } }
const fromSample = r => ({ id: r.id, who: r.ctx.who, role: r.ctx.role, text: r.text, expected: r.expected, at: bugWhen(r.ctx.at), shot: !!r.file, file: r.file?.name || null, status: r.status, page: r.ctx.page, browser: r.ctx.browser, screen: r.ctx.screen, sample: true })
export const bugsWithSent = (bugs, sent) => [...sent.map(fromSample), ...bugs]
export const feedWithSent = (feed, sent) => [...sent.map(r => ({ id: `fb-${r.id}`, who: r.ctx.who, text: `Reported a bug: ${r.text}`, at: bugWhen(r.ctx.at), kind: 'bug' })), ...feed]
export const openBugCount = (bugs, sent) => [...bugs, ...sent].filter(b => b.status !== 'fixed').length
export function useAdmFeed() { const s = useS(); const sent = useSampleBugs(); return okS(s, feedWithSent(s.feed, sent)) }
export function useAdmSettings() { const s = useS(); return okS(s, s.settings) }
export function useAdmBugs() { const s = useS(); const sent = useSampleBugs(); return okS(s, bugsWithSent(s.bugs, sent)) }
export function useAdmAudit() { const s = useS(); return okS(s, s.audit) }
export function useAdmConnect() { const s = useS(); return okS(s, s.connect) }
// P906 — Setup: one ticket per agent who has paid (setup fee + first days of spend). Unpaid sign-ups aren't here.
// P955: only agents with Leads (a Servicing-only or Reactivation-only agent never gets a ticket; see products955.js).
export function pipelineOf(s) {
  return s.onboard.filter(hasTicket).map(c => ({ ...c, ...setupOf(c), log: s.setupLog[c.id] || [] }))
}
export function useAdmSetup() { const s = useS(); return okS(s, pipelineOf(s)) }

// Money: this week's revenue (plans + leads charged), the weeks before, agent bills, failed payments, the VA pay run.
export function useAdmMoney() {
  const s = useS()
  const rate = s.settings.payRules.hourly
  const plans = weekShare(s.agents.filter(a => !a.comped && a.billing.status !== 'past_due').reduce((t, a) => t + planPriceOf(a, PLANS), 0))
  const leadsCharged = s.leads.filter(l => l.agent_id).reduce((t, l) => t + (LEAD_PRICE[l.kind] ?? LEAD_PRICE.appointment), 0)
  const leadFee = Math.round(leadsCharged * PRICES.leadFee)
  // P913: revenue = plan fees + the 12% fee + setup fees. Lead spend (leads) rides along only to show it apart.
  const setupWeek = (s.setupFees || []).filter(f => f.period !== 'last').length * SETUP_FEE
  const revOf = w => w.plans + Math.round(w.leads * PRICES.leadFee) + (w.setup || 0)
  const weeks = [...s.revenue, { wk: 'Nov 2', plans, leads: leadsCharged, setup: setupWeek, now: true }].map(w => ({ ...w, fee: Math.round(w.leads * PRICES.leadFee), revenue: revOf(w) }))
  // This week by day, Mon to Sun: plan fees accrue evenly, the 12% fee from that day's leads, setup fees the day paid.
  const week = s.clock?.week || WEEK
  const today = s.clock?.today ?? TODAY
  const days = week.map(d => {
    const later = d > today
    const dayLeads = s.leads.filter(l => l.agent_id && l.day === d).reduce((t, l) => t + (LEAD_PRICE[l.kind] ?? LEAD_PRICE.appointment), 0)
    const setupD = (s.setupFees || []).filter(f => f.period !== 'last' && f.day === d).length * SETUP_FEE
    const planD = later ? 0 : Math.round(plans / 7)
    const fee = Math.round(dayLeads * PRICES.leadFee)
    return { day: d, name: (s.clock?.dayName || dayName)(d), later, isToday: d === today, plans: planD, fee, setup: setupD, revenue: planD + fee + setupD, leadSpend: dayLeads }
  })
  const failed = s.agents.filter(a => a.billing.failed).map(a => ({ ...a.billing.failed, agent: a.name, agent_id: a.id, status: a.billing.status }))
  // P890/P945: Monday's run pays each VA's scheduled hours (days off taken out) x their hourly rate (overtime past 40 at 1.5x).
  const run = s.vas.map(v => {
    const sheet = TIMESHEET.find(t => t.va === v.id)
    const t = sheet ? sheetTotals(sheet, HOURLY[v.id] || rate) : { hours: 0, pay: 0 }
    return { va_id: v.id, name: v.name, hours: t.hours, amount: t.pay, bank: v.bank }
  })
  const runTotal = run.filter(r => r.bank === 'ready').reduce((t, r) => t + r.amount, 0)
  return okS(s, {
    plans, leadsCharged, leadSpend: leadsCharged, leadFee, setup: setupWeek, total: plans + leadFee + setupWeek, lastWeek: s.revenue.length ? revOf(s.revenue[s.revenue.length - 1]) : 0, weeks, days,
    failed, run, runTotal, runs: s.runs, payday: 'Mon, Nov 9',
    stripeBalance: s.real ? s.stripeBalance : 2140, rate, paused: s.settings.payoutsPaused, live: s.settings.switches.payouts_live,
    adSpend: s.connect.ads.reduce((t, a) => t + a.spent, 0), adBudget: s.connect.ads.reduce((t, a) => t + a.budget, 0),
  })
}

// P943 — the Revenue page's stock-style chart: every day's revenue and costs (revTrend.js), then rolling 7-day sums.
// This week is useAdmMoney's own days (so the chart and By week agree). Before it: sample = a year of sample weeks
// growing into the seeded weeks (s.revenue), spread over their days, the seeded setup fees and pay runs on the day
// paid; real = the last 91 days of leads charged to agents (lib/admReal.js leadSpendTrendOf), plan fees from each
// paying agent's join day, pay runs on their pay date. Real AI minutes and setup fees aren't recorded yet (0).
export function useAdmRevTrend() {
  const s = useS()
  const { data: m } = useAdmMoney()
  return okS(s, revTrendOf(s, m))
}
// The pure part (tests call it with a real or sample store and useAdmMoney's days).
export function revTrendOf(s, m) {
  const todayIso = s.clock?.todayIso || SAMPLE_TODAY_ISO
  const weekStart = s.clock?.weekStartIso || addDays(SAMPLE_TODAY_ISO, -3)
  const feeRate = PRICES.leadFee
  // This week's AI minutes (sample) shared out by each day's lead spend, so the week adds up to the card.
  const weekSpend = m.days.reduce((t, d) => t + (d.later ? 0 : d.leadSpend), 0)
  const weekAi = s.real ? 0 : Math.round(((s.periodCosts || PERIOD_COSTS).week.aiMins || 0) * AI_RATE)
  const aiRate = weekSpend > 0 ? weekAi / weekSpend : 0
  const week = m.days.filter(d => !d.later).map((d, i) => ({ date: addDays(weekStart, i), plans: d.plans, fee: d.fee, setup: d.setup, leadSpend: d.leadSpend, ai: d.leadSpend * aiRate }))
  let before
  let runs
  if (s.real) {
    const paying = s.agents.filter(a => !a.comped && a.billing.status !== 'past_due')
    before = (s.spendTrend || []).filter(r => r.date < weekStart).map(r => {
      const leadSpend = (r.appointment || 0) * LEAD_PRICE.appointment + (r.live || 0) * LEAD_PRICE.live
      const plans = paying.filter(a => !a.joinedIso || a.joinedIso <= r.date).reduce((t, a) => t + planPriceOf(a, PLANS), 0)
      return { date: r.date, plans: weekShare(plans) / 7, leadSpend, fee: leadSpend * feeRate }
    })
    runs = (s.runs || []).map(r => ({ date: r.payIso, amount: r.amount }))
  } else {
    const year = Number(todayIso.slice(0, 4))
    const seeded = (s.revenue || []).map(w => ({ startIso: isoFromText(w.wk, year), plans: w.plans, leads: w.leads, setup: 0 })).filter(w => w.startIso)
    const older = seeded.length ? sampleHistory(seeded[0].startIso, seeded[0]) : []
    const weeks = [...older, ...seeded]
    before = weeks.map(w => spreadWeek(w.startIso, { plans: w.plans, leads: w.leads, setup: w.setup * SETUP_FEE }, { feeRate, aiRate, wobble: 0.55 }))
    // Last month's setup fees, the day each was paid.
    before.push((s.setupFees || []).filter(f => f.period === 'last').map(f => ({ date: isoFromText(f.paid, year), setup: SETUP_FEE })))
    // Pay runs: the seeded ones on their Monday; before them, a run each Monday for the week before (about 14% of
    // that week's lead spend, the seeded runs' rate).
    const seededRuns = (s.runs || []).map(r => ({ date: isoFromText(r.paid, year), amount: r.amount })).filter(r => r.date)
    const firstRun = seededRuns.map(r => r.date).sort()[0] || weekStart
    runs = [...seededRuns, ...weeks.map(w => ({ date: addDays(w.startIso, 7), amount: Math.round(w.leads * 0.14) })).filter(r => r.date < firstRun)]
  }
  const days = buildDays({ todayIso, parts: [...before, week], runs, cardRate: CARD_FEE })
  return { todayIso, days, roll: rolling(days), real: !!s.real }
}

// P864 — Money for one period ('week' | 'month' | 'last'): brought in, costs, profit and the owners' split. Every number
// comes from the same sample as the rest of admin (agents' plans, leads charged, Connect's ad spend, past pay runs).
export function moneyFor(s, period) {
  const monthPlans = s.agents.filter(a => !a.comped && a.billing.status !== 'past_due').reduce((t, a) => t + planPriceOf(a, PLANS), 0)
  const weekPlans = weekShare(monthPlans)
  const weekLeads = s.leads.filter(l => l.agent_id).reduce((t, l) => t + (LEAD_PRICE[l.kind] ?? LEAD_PRICE.appointment), 0)
  const oct = s.revenue.filter(w => w.wk.startsWith('Oct'))
  const cur = period === 'last' ? 'last' : 'now'
  const setup = s.setupFees.filter(f => (f.period === 'last') === (cur === 'last')).reduce(t => t + SETUP_FEE, 0)
  const budgets = cur === 'last' ? oct.reduce((t, w) => t + w.leads, 0) : weekLeads
  const servicing = cur === 'last' ? oct.reduce((t, w) => t + w.plans, 0) : period === 'month' ? monthPlans : weekPlans
  // P909: 12% of lead spend on every lead plan, kept apart from the plan fee.
  const leadFee = Math.round(budgets * PRICES.leadFee)
  // P913: lead spend is the agents' money passed to Meta, never Ohvara's: it's shown on its own, never inside revenue,
  // profit or totals. Revenue = plan fees + the 12% fee + setup fees.
  const leadSpend = budgets
  const inTotal = leadFee + servicing + setup
  const weekAds = s.connect.ads.reduce((t, a) => t + a.spent, 0)
  const pc = (s.periodCosts || PERIOD_COSTS)[period]
  // Real: ad spend from ad_spend_daily for the period (admin_ad_costs), never Connect's sample accounts.
  const spendOf = c => Math.round(Object.values(c || {}).reduce((t, x) => t + x.spend, 0))
  const ads = s.real ? spendOf(period === 'week' ? s.costs : period === 'month' ? s.costsMonth : s.costsLast) : period === 'last' ? pc.ads : weekAds + pc.adsExtra
  // Pay runs paid inside the period: Mon, Nov 2 for this week and month; Oct 12, 19 and 26 for October.
  const runs = s.runs.filter(r => (cur === 'last' ? r.paid.includes('Oct') : r.paid.includes('Nov')))
  const vaPay = runs.reduce((t, r) => t + r.amount, 0)
  // Card fees are on everything charged to the card (revenue and the lead spend that passes through).
  const fees = Math.round((inTotal + leadSpend) * CARD_FEE)
  const aiMins = s.real ? 0 : pc.aiMins || 0
  const ai = Math.round(aiMins * AI_RATE)
  // P913: Profit = revenue minus VA pay, AI minutes and card fees.
  const costTotal = vaPay + ai + fees
  const profit = inTotal - costTotal
  const bp = OWNER_SPLIT
  const split = OWNERS.map((o, i) => {
    const pct = i === 0 ? bp : 100 - bp
    const amount = i === 0 ? Math.round((profit * pct) / 100) : profit - Math.round((profit * bp) / 100)
    const draws = s.draws.filter(d => d.owner === o.id && (d.period === 'last') === (cur === 'last'))
    const paid = draws.reduce((t, d) => t + d.amount, 0)
    return { ...o, pct, amount, paid, owed: Math.max(0, amount - paid) }
  })
  return {
    period, budgets, leadSpend, leadFee, servicing, setup, setupCount: setup / SETUP_FEE, inTotal,
    ads, vaPay, runs, fees, ai, aiMins, costTotal, profit, split,
  }
}
// P914 — Agent results (was Pilot results; there is no pilot, every agent pays from day one). Per agent for the period:
// what they paid Ohvara (their plan fee + 12% of their lead spend + a setup fee if they joined then), their lead spend
// passed to Meta (in no total), the VA and AI cost of working their leads and clients, card fees, and what Ohvara kept.
// Every column is the period's total (moneyFor) shared out, so the rows add up to the Revenue page: plan fees by plan
// price, the 12% and lead spend by each agent's leads, VA pay and AI minutes by each agent's leads + clients worked.
export function agentResults(s, period) {
  const p = moneyFor(s, period)
  const cur = period === 'last' ? 'last' : 'now'
  const planOf = a => (a.comped || a.billing.status === 'past_due' ? 0 : planPriceOf(a, PLANS))
  const planAll = s.agents.reduce((t, a) => t + planOf(a), 0) || 1
  const spendOf = a => s.leads.filter(l => l.agent_id === a.id).reduce((t, l) => t + (LEAD_PRICE[l.kind] ?? LEAD_PRICE.appointment), 0)
  const spendAll = s.agents.reduce((t, a) => t + spendOf(a), 0) || 1
  const workOf = a => s.leads.filter(l => l.agent_id === a.id).length + s.clients.filter(c => c.agent_id === a.id).length
  const workAll = s.agents.reduce((t, a) => t + workOf(a), 0) || 1
  const setupOf = a => s.setupFees.filter(f => f.agent === a.name && (f.period === 'last') === (cur === 'last')).length * SETUP_FEE
  const rows = s.agents.map(a => {
    const sp = spendOf(a) / spendAll
    const wk = workOf(a) / workAll
    const paid = Math.round(p.servicing * (planOf(a) / planAll) + p.leadFee * sp) + setupOf(a)
    const leadSpend = Math.round(p.leadSpend * sp)
    const va = Math.round(p.vaPay * wk)
    const ai = Math.round(p.ai * wk)
    const fees = Math.round((paid + leadSpend) * CARD_FEE)
    const kept = paid - va - ai - fees
    return { id: a.id, name: a.name, plan: planLineOf(a, PLANS).label, comped: !!a.comped, paid, leadSpend, va, ai, fees, kept, vaPct: paid > 0 ? Math.round((va / paid) * 100) : null }
  })
  // Agents still in Setup who paid their setup fee this period aren't on the agent list yet: one row each, so the
  // Paid column adds up to the Revenue page.
  const named = new Set(s.agents.map(a => a.name))
  for (const f of s.setupFees.filter(x => !named.has(x.agent) && (x.period === 'last') === (cur === 'last'))) {
    const fees = Math.round(SETUP_FEE * CARD_FEE)
    rows.push({ id: f.id, name: f.agent, plan: 'In setup', comped: false, paid: SETUP_FEE, leadSpend: 0, va: 0, ai: 0, fees, kept: SETUP_FEE - fees, vaPct: 0 })
  }
  rows.sort((x, y) => y.paid - x.paid)
  const sum = k => rows.reduce((t, r) => t + r[k], 0)
  const total = { paid: sum('paid'), leadSpend: sum('leadSpend'), va: sum('va'), ai: sum('ai'), fees: sum('fees'), kept: sum('kept') }
  total.vaPct = total.paid > 0 ? Math.round((total.va / total.paid) * 100) : null
  return { rows, total }
}
export function useAdmAgentResults(period = 'week') { const s = useS(); return okS(s, agentResults(s, period)) }
export function useAdmPeriod(period = 'week') { const s = useS(); return okS(s, moneyFor(s, period)) }

// P955 — Revenue by product (sample): Leads (lead plan fees + the booking desk), Servicing (its plan fees), Reactivation
// (lists paid in the period, the same lists as the Reactivation page's sample) and Setup, with how many agents have
// each. Leads + Servicing + Setup = the period's revenue (moneyFor.inTotal); Reactivation lists are on top of it. Real
// numbers come from admin_billing_revenue (by_product, counts) in ProductSplit.jsx.
const seedReactPaid = [
  { agent: 'Tasha Greene', paid: 'Sun, Nov 1', amount: 402, period: 'month' },
  { agent: 'Marcus Webb', paid: 'Wed, Oct 28', amount: 960, period: 'last' },
]
export const reactivationFor = (period, rows = seedReactPaid) => rows
  .filter(r => (period === 'last' ? r.period === 'last' : period === 'month' ? r.period !== 'last' : r.period === 'week'))
  .reduce((t, r) => t + r.amount, 0)
export function productSplitFor(s, period) {
  return sampleSplit({ p: moneyFor(s, period), agents: s.agents, plans: PLANS, reactivation: s.real ? 0 : reactivationFor(period) })
}
export function useAdmProductSplit(period = 'week') { const s = useS(); return okS(s, productSplitFor(s, period)) }
export function useAdmDraws() {
  const s = useS()
  return okS(s, OWNERS.map(o => ({ ...o, draws: s.draws.filter(d => d.owner === o.id), total: s.draws.filter(d => d.owner === o.id).reduce((t, d) => t + d.amount, 0) })))
}

// The page heads and the Overview read this: the business today in one place.
export function useAdmDay() {
  const s = useS()
  const sentBugs = useSampleBugs()
  const week = funnel(s.leads)
  const today = s.clock?.today ?? TODAY
  const byDay = (s.clock?.week || WEEK).map((d, i) => ({ day: d, name: (s.clock?.dayName || dayName)(d), ...funnel(s.leads.filter(l => l.day === d)), later: s.clock ? i > (s.clock.week.indexOf(today)) : d > TODAY }))
  const unassigned = s.leads.filter(l => !l.agent_id)
  const late = s.calls.filter(c => c.status === 'late')
  const requests = s.dayOff.filter(d => d.status === 'pending').map(d => ({ ...d, va: nameOf(s, d.va_id) }))
  const failed = s.agents.filter(a => a.billing.failed)
  // P942: 91 days for the Overview leads chart (real: lib/admReal.js leadTrendOf; sample: a steady history whose
  // current week is the sample week, so the chart and the numbers agree).
  const todayIso = s.clock?.todayIso || SAMPLE_TODAY_ISO
  const trend = s.real ? (s.trend || []) : sampleTrend(todayIso, {
    base: 13, ratio: { delivered: 0.6, sold: 0.15 },
    week: byDay.filter(d => !d.later).map((d, i) => ({ offset: i, values: { in: d.in, delivered: d.booked + d.transferred, sold: d.sold } })),
  })
  return okS(s, {
    week, byDay, today, todayIso, trend, unassigned, late, requests, failed, real: !!s.real,
    range: s.clock ? `${s.clock.dateText(s.clock.week[0])} to today` : 'Mon, Nov 2 to today',
    payingAgents: s.agents.filter(a => !a.comped && a.billing.status === 'current' && a.access).length,
    onShift: (s.rota[today] || []).map(id => s.vas.find(v => v.id === id)).filter(Boolean),
    onDuty: s.agents.filter(a => a.onDuty && a.active),
    needs: unassigned.length + late.length + failed.length,
    unread: s.threads.reduce((n, t) => n + t.unread, 0),
    openBugs: openBugCount(s.bugs, s.real ? [] : sentBugs),
  })
}

// P858: ad cost per lead / booked / sale per agent, from real spend (ad_spend_daily) and real outcomes (admin_ad_costs).
// null = no spend data yet (sample mode, or GoHighLevel not connected): screens show the engine slot instead.
export function useAdmCosts() {
  const s = useS()
  const c = s.real && s.costs && Object.keys(s.costs).length ? s.costs : null
  if (!c) return okS(s, null)
  const sum = k => Object.values(c).reduce((t, x) => t + (x[k] || 0), 0)
  const spend = sum('spend')
  const per = n => (n > 0 ? spend / n : null)
  return okS(s, { byAgent: c, total: { spend, leads: sum('leads'), booked: sum('booked'), sold: sum('sold'), perLead: per(sum('leads')), perBooked: per(sum('booked')), perSale: per(sum('sold')) } })
}

// P866: one audit line on a client's setup history, newest first.
const setupLogAdd = (s, id, what, who = ME.name) => ({ setupLog: { ...s.setupLog, [id]: [{ at: `Today, ${stamp()}`, who, what }, ...(s.setupLog[id] || [])] } })
const feedAdd = (s, who, text, kind) => ({ feed: [{ id: `f${Date.now()}`, who, text, at: stamp(), kind }, ...s.feed] })
const patchById = (list, id, patch) => list.map(x => (x.id === id ? { ...x, ...(typeof patch === 'function' ? patch(x) : patch) } : x))

const SAMPLE_ACTIONS = {
    // Leads: assign an Unassigned lead to an agent (the AI then calls and books it), move one, or change its status.
    assignLead: (id, agentId) => set(s => {
      const l = s.leads.find(x => x.id === id)
      const stage = l.stage === 'unassigned' ? 'booked' : l.stage
      const kind = l.stage === 'unassigned' ? 'appointment' : l.kind
      return { leads: patchById(s.leads, id, { agent_id: agentId, stage, kind, matchedBy: l.agent_id ? l.matchedBy : 'admin', log: [...l.log, `Assigned to ${nameOf(s, agentId)} at ${stamp()}`] }), ...audit(s, l.agent_id ? 'Moved a lead' : 'Assigned a lead', `${l.name} to ${nameOf(s, agentId)}`) }
    }),
    // Agents
    setAgentActive: (id, on) => set(s => ({ agents: patchById(s.agents, id, { active: on, onDuty: on && s.agents.find(a => a.id === id).onDuty }), ...audit(s, on ? 'Turned live transfers on' : 'Turned live transfers off', nameOf(s, id)) })),
    // P906: daily lead spend (the plan follows its band from the next monthly bill), and pausing lead spend.
    setAgentSpend: (id, spend) => set(s => ({ agents: patchById(s.agents, id, { spend }), ...audit(s, 'Changed a daily lead spend', `${nameOf(s, id)}: $${spend} a day`) })),
    setAgentPaused: (id, on) => set(s => ({
      agents: patchById(s.agents, id, a => ({ paused: on ? { since: dateText(TODAY), until: null } : null, billing: { ...a.billing, next: on ? 'Paused' : 'Tonight, 8:00 PM' } })),
      ...audit(s, on ? 'Paused lead spend' : 'Resumed lead spend', nameOf(s, id)),
    })),
    setServicing: (id, on) => set(s => ({ agents: patchById(s.agents, id, { servicing: on }), ...audit(s, on ? 'Turned Servicing on' : 'Turned Servicing off', nameOf(s, id)) })),
    setComped: (id, on) => set(s => ({ agents: patchById(s.agents, id, a => ({ comped: on, billing: { ...a.billing, status: on ? 'comped' : 'current', next: on ? 'Comped to Dec 1' : 'Mon, Nov 9' } })), ...audit(s, on ? 'Comped an account' : 'Ended a comp', nameOf(s, id)) })),
    // People and access (agents and VAs). Admin accounts are not changed from here.
    setAccess: (id, on) => set(s => {
      const key = s.agents.some(a => a.id === id) ? 'agents' : 'vas'
      return { [key]: patchById(s[key], id, { access: on }), ...audit(s, on ? 'Turned access back on' : 'Turned access off', nameOf(s, id)) }
    }),
    setRole: (id, role) => set(s => {
      const a = s.agents.find(x => x.id === id)
      const v = s.vas.find(x => x.id === id)
      const who = a || v
      if (!who || who.role === role) return {}
      const out = role === 'fulfillment'
        ? { agents: s.agents.filter(x => x.id !== id), vas: [...s.vas, { ...seedVas[0], ...who, role, id, bank: 'none', missed: 0, hours: '9:00 AM to 5:00 PM' }] }
        : { vas: s.vas.filter(x => x.id !== id), agents: [...s.agents, { ...seedAgents[0], ...who, role, id, active: false, onDuty: false, spend: 0, states: ['TX'], billing: { status: 'current', next: 'Not set up', method: 'None yet', failed: null } }] }
      return { ...out, ...audit(s, 'Changed a role', `${who.name} to ${role === 'agent' ? 'Agent' : 'Fulfillment'}`) }
    }),
    invite: ({ name, role, via, to }) => set(s => {
      const id = `inv-${Date.now()}`
      return { invites: [{ id, name, role, via, to, sent: `Today, ${stamp()}` }, ...s.invites], ...audit(s, 'Sent an invite', `${name} (${role === 'agent' ? 'agent' : 'Fulfillment'})`) }
    }),
    resendInvite: id => set(s => ({ invites: patchById(s.invites, id, { sent: `Today, ${stamp()}` }), ...audit(s, 'Resent an invite', s.invites.find(i => i.id === id).name) })),
    // P906 — Setup tickets. Admins tick the checklist; "Create campaign" goes through the GoHighLevel engine slot and
    // its answer comes back to the ticket (sample: GoHighLevel answers a moment later; nothing is sent).
    tickSetup: (id, key, on) => set(s => {
      const c = s.onboard.find(x => x.id === id)
      const st = SETUP_STEPS.find(x => x.key === key)
      if (!c || !st || ['checks', 'on', 'live'].includes(key)) return {} // P913: never ticked by hand
      const done = on ? [...new Set([...c.done, key])] : c.done.filter(k => k !== key)
      return { onboard: patchById(s.onboard, id, { done }), ...setupLogAdd(s, id, `${on ? 'Ticked' : 'Unticked'} ${st.label}`), ...audit(s, on ? 'Ticked a setup step' : 'Unticked a setup step', `${c.name}: ${st.label}`) }
    }),
    // P913 — the seatbelt: Turn campaign on works only when every launch check passes (no skipping).
    turnCampaignOn: id => set(s => {
      const c = s.onboard.find(x => x.id === id)
      if (!c || !setupOf(c).canLaunch) return {}
      return { onboard: patchById(s.onboard, id, { done: [...new Set([...c.done, 'on'])] }), ...setupLogAdd(s, id, 'Turned the campaign on (every launch check passed)'), ...audit(s, 'Turned a campaign on', c.name) }
    }),
    // Sample: the AI places the test call from the test lead to the agent's own number.
    placeTestCall: id => set(s => {
      const c = s.onboard.find(x => x.id === id)
      if (!c?.launch?.testLead) return {}
      return { onboard: patchById(s.onboard, id, { launch: { ...c.launch, testCall: { at: `Today, ${stamp()}`, by: 'AI' } } }), ...setupLogAdd(s, id, 'AI test call placed to their own number') }
    }),
    requestCampaign: id => {
      set(s => {
        const c = s.onboard.find(x => x.id === id)
        if (!c) return {}
        return { onboard: patchById(s.onboard, id, { campaignReq: { status: 'sent', at: `Today, ${stamp()}` } }), ...setupLogAdd(s, id, 'Sent Create campaign to GoHighLevel'), ...audit(s, 'Asked GoHighLevel for a campaign', c.name) }
      })
      setTimeout(() => set(s => {
        const c = s.onboard.find(x => x.id === id)
        if (!c || c.campaignReq?.status !== 'sent') return {}
        const name = `Deedstone · ${c.name} · ${c.agentRef}`
        const campaignId = `12021${String(Date.now()).slice(-9)}`
        return { onboard: patchById(s.onboard, id, { campaignReq: { status: 'created', at: `Today, ${stamp()}`, name }, done: [...new Set([...c.done, 'campaign'])], launch: { ...c.launch, linkRef: c.agentRef, campaignId, campaignRef: c.agentRef } }), ...setupLogAdd(s, id, `Campaign created: ${name} · campaign ID ${campaignId} saved`, 'GoHighLevel') }
      }), 1600)
    },
    markLive: id => set(s => {
      const c = s.onboard.find(x => x.id === id)
      if (!c || !setupOf(c).canLive) return {}
      return { onboard: patchById(s.onboard, id, { done: [...c.done, 'live'], liveOn: dateText(TODAY) }), ...setupLogAdd(s, id, 'Marked done'), ...audit(s, 'Marked a setup ticket done', c.name) }
    }),
    cancelInvite: id => set(s => ({ invites: s.invites.filter(i => i.id !== id), ...audit(s, 'Cancelled an invite', s.invites.find(i => i.id === id).name) })),
    // The desk: give a stuck or not-started call to someone free (admin_give_call).
    giveCall: (callId, vaId) => set(s => {
      const c = s.calls.find(x => x.id === callId)
      return { calls: patchById(s.calls, callId, { va_id: vaId, status: c.status === 'late' ? 'booked' : c.status }), ...audit(s, `Gave a call to ${nameOf(s, vaId)}`, `${c.client}, ${c.time}`) }
    }),
    giveStep: (stepId, vaId) => set(s => {
      const x = s.steps.find(k => k.id === stepId)
      const c = s.clients.find(k => k.id === x.client_id)
      return { steps: patchById(s.steps, stepId, { va_id: vaId }), ...audit(s, `Gave a servicing step to ${nameOf(s, vaId)}`, `${x.kind} for ${c.name}`) }
    }),
    // The rota. Two or three on shift a day is the rule; screens warn, this only stores.
    addShift: (date, vaId) => set(s => {
      const day = s.rota[date] || []
      if (day.includes(vaId)) return {}
      return { rota: { ...s.rota, [date]: [...day, vaId] }, ...audit(s, 'Put someone on shift', `${nameOf(s, vaId)}, ${dateText(date)}`) }
    }),
    removeShift: (date, vaId) => set(s => ({ rota: { ...s.rota, [date]: (s.rota[date] || []).filter(x => x !== vaId) }, ...audit(s, 'Took someone off shift', `${nameOf(s, vaId)}, ${dateText(date)}`) })),
    moveShift: (from, to, vaId) => set(s => {
      if (from === to || (s.rota[to] || []).includes(vaId)) return {}
      return { rota: { ...s.rota, [from]: (s.rota[from] || []).filter(x => x !== vaId), [to]: [...(s.rota[to] || []), vaId] }, ...audit(s, 'Moved a shift', `${nameOf(s, vaId)}, ${dateText(from)} to ${dateText(to)}`) }
    }),
    decideDayOff: (id, approve) => set(s => {
      const d = s.dayOff.find(x => x.id === id)
      const out = { dayOff: patchById(s.dayOff, id, { status: approve ? 'approved' : 'declined' }), ...audit(s, approve ? 'Approved a day off' : 'Declined a day off', `${nameOf(s, d.va_id)}, ${dateText(d.date)}`) }
      if (approve) out.rota = { ...s.rota, [d.date]: (s.rota[d.date] || []).filter(x => x !== d.va_id) }
      return out
    }),
    // P890: no per-cancel decisions (VA pay is hourly). The Monday run can still be paused.
    // P934: no split setter. The owners' profit split is fixed at 50/50 (OWNER_SPLIT); changing it is a code and migration change.
    setPaused: on => set(s => ({ settings: { ...s.settings, payoutsPaused: on }, ...audit(s, on ? 'Paused payouts' : 'Resumed payouts', 'Monday pay run') })),
    // Settings (P950: no live-switch setter. Live flags are changed only by Ohvara's server role, with Brayden's yes)
    savePayRules: payRules => set(s => ({ settings: { ...s.settings, payRules }, ...audit(s, 'Changed pay rules', `$${payRules.hourly} an hour`) })),
    saveBilling: billing => set(s => ({ settings: { ...s.settings, billing: { ...s.settings.billing, ...billing } },
      ...audit(s, 'Changed lead billing', `Max $${billing.maxDaily} a day · charge ${billing.chargeHour}:00`) })),
    setMaxDaily: (id, dollars) => set(s => {
      const o = { ...s.settings.billing.maxOverride }
      const before = o[id] ?? s.settings.billing.maxDaily // P964: the stepper lowers it too, so the log says which
      if (dollars == null) delete o[id]; else o[id] = dollars
      return { settings: { ...s.settings, billing: { ...s.settings.billing, maxOverride: o } }, ...audit(s, dollars == null ? 'Reset a max daily spend' : dollars < before ? 'Lowered a max daily spend' : 'Raised a max daily spend', `${nameOf(s, id)}${dollars == null ? '' : `: $${dollars} a day`}`) }
    }),
    saveSettings: patch => set(s => ({ settings: { ...s.settings, ...patch } })),
    setTz: tz => set(s => ({ settings: { ...s.settings, tz } })),
    setBookingGap: min => set(s => ({ settings: { ...s.settings, bookingGap: min }, ...audit(s, 'Changed the booking gap', `${min} minutes`) })),
    // P876: new → seen → fixed. Reports sent this visit live in the sample store (template/bugReport), the rest here.
    setBugStatus: (id, status, who) => {
      const what = status === 'fixed' ? 'Marked a bug report fixed' : 'Marked a bug report seen'
      if (id.startsWith('br-')) { setSampleBugStatus(id, status); set(s => audit(s, what, who)); return }
      set(s => ({ bugs: patchById(s.bugs, id, { status }), ...audit(s, what, s.bugs.find(b => b.id === id).who) }))
    },
    // Messages
    sendMessage: (threadId, text, from = 'me') => set(s => ({ threads: patchById(s.threads, threadId, t => ({ messages: [...t.messages, { id: `m${Date.now()}`, from, text, at: `Today, ${stamp()}` }] })) })),
    readThread: threadId => set(s => ({ threads: patchById(s.threads, threadId, { unread: 0 }) })),
    // Connect (Jordan). A key is kept only as "saved" plus its last four; the value itself is dropped here.
    saveConnect: (part, patch, what) => set(s => {
      const next = Array.isArray(s.connect[part]) ? patch : { ...s.connect[part], ...patch }
      return { connect: { ...s.connect, [part]: next }, ...audit(s, what || 'Saved a Connect setting', 'Waits for the bridge (P850)'), ...feedAdd(s, ME.name, what || 'Saved a Connect setting', 'connect') }
    }),
}
// The sample actions, or the real ones inside AdmDataProvider (same names; see hooks/admRealData.js).
export function useAdmActions() { const real = useContext(SourceCtx); return real?.actions || SAMPLE_ACTIONS }
