import { useSyncExternalStore } from 'react'

// P849 — the one door to the Admin side's sample info, like src/template/ful/data.js for the VA side. Screens read only
// through the hooks below; every read returns { data, isLoading: false, error: null }, the react-query shape, so the
// backend swaps in by replacing this file (today's admin hooks: useAdminWeek, useFulfillmentPayouts, useAppSettings,
// useRecoveryConfig, admin_give_call, admin_set_user_access ...). Changes live in memory and reset on reload. Nothing
// leaves the browser. The sample day is Thursday, Nov 5; the week is Mon Nov 2 to Sun Nov 8. Prices are sample prices.

export const TODAY = 5
const WEEKDAY = { 0: 'Sun', 1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri', 6: 'Sat' }
// November 2026 starts on a Sunday, so date d falls on weekday d % 7 ... with Nov 1 = Sun (0).
export const dayName = d => WEEKDAY[(d - 1) % 7]
export const dateText = d => `${dayName(d)}, Nov ${d}`
export const WEEK = [2, 3, 4, 5, 6, 7, 8]
export const NEXT_WEEK = [9, 10, 11, 12, 13, 14, 15]

export const ME = { name: 'Sam Ellis', email: 'sam@ohvara.com', phone: '(512) 555-0100', role: 'Admin' }
export const PARTNER = { id: 'pt-jordan', name: 'Jordan Hale', email: 'jordan@example.com', role: 'Partner' }

// Sample weekly plan prices (not decided: the real ones come from settings).
export const PLANS = {
  servicing16: { label: 'Servicing 16', price: 349, sub: '16 submissions a week' },
  servicing7: { label: 'Servicing 7', price: 199, sub: '7 submissions a week' },
  leads: { label: 'Leads only', price: 0, sub: 'Pays for leads only' },
}
export const LEAD_PRICE = { appointment: 45, live: 65 }

const mkAgent = (id, name, o) => ({
  id, name, role: 'agent', city: 'Austin', state: 'TX', email: `${name.split(' ')[0].toLowerCase()}@example.com`, phone: '(555) 555-0100',
  plan: 'servicing16', spend: 500, active: true, onDuty: false, servicing: true, access: true, comped: false, joined: 'Sep 14', lastOn: 'Today',
  billing: { status: 'current', next: 'Mon, Nov 9', method: 'Visa •••• 4242', failed: null }, states: ['TX'], ...o,
})
const seedAgents = [
  mkAgent('ag-dana', 'Dana Walker', { city: 'Austin', state: 'TX', phone: '(512) 555-0143', spend: 600, onDuty: true, states: ['TX', 'OK'], joined: 'Aug 30' }),
  mkAgent('ag-marcus', 'Marcus Reed', { city: 'Phoenix', state: 'AZ', phone: '(602) 555-0118', plan: 'servicing7', spend: 400, active: false, states: ['AZ', 'NV'], lastOn: 'Wed', billing: { status: 'current', next: 'Mon, Nov 9', method: 'Visa •••• 1881', failed: null } }),
  mkAgent('ag-priya', 'Priya Shah', { city: 'Tampa', state: 'FL', phone: '(813) 555-0170', spend: 750, onDuty: true, states: ['FL', 'GA'], joined: 'Aug 30', billing: { status: 'current', next: 'Mon, Nov 9', method: 'Amex •••• 3005', failed: null } }),
  mkAgent('ag-elena', 'Elena Torres', { city: 'San Antonio', state: 'TX', phone: '(210) 555-0191', plan: 'leads', spend: 300, servicing: false, states: ['TX'], joined: 'Oct 12', billing: { status: 'current', next: 'Top-up at $50 left', method: 'Visa •••• 7310', failed: { what: 'Lead top-up', when: 'Thu, Nov 5', why: 'Card declined', amount: 150 } } }),
  mkAgent('ag-james', 'James Okafor', { city: 'Atlanta', state: 'GA', phone: '(404) 555-0126', plan: 'servicing7', spend: 500, onDuty: true, states: ['GA', 'SC'], joined: 'Sep 28', billing: { status: 'current', next: 'Mon, Nov 9', method: 'Mastercard •••• 6022', failed: null } }),
  mkAgent('ag-grace', 'Grace Kim', { city: 'Denver', state: 'CO', phone: '(303) 555-0164', spend: 450, active: false, comped: true, states: ['CO'], lastOn: 'Tue', billing: { status: 'comped', next: 'Comped to Dec 1', method: 'None needed', failed: null } }),
  mkAgent('ag-ben', 'Ben Carter', { city: 'Charlotte', state: 'NC', phone: '(704) 555-0137', plan: 'servicing7', spend: 350, active: false, states: ['NC'], joined: 'Oct 19', lastOn: 'Mon', billing: { status: 'past_due', next: 'Locks Fri, Nov 6, 9:00 AM', method: 'Visa •••• 0094', failed: { what: 'Weekly plan', when: 'Wed, Nov 4', why: 'Card declined', amount: 199 } } }),
]

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
  { id: 'inv-1', name: 'Sofia Alvarez', role: 'agent', via: 'email', to: 'sofia.alvarez@example.com', sent: 'Tue, Nov 3' },
  { id: 'inv-2', name: 'Rosa Diaz', role: 'fulfillment', via: 'text', to: '(512) 555-0177', sent: 'Wed, Nov 4' },
]

// Leads this week across every agent. kind = appointment (booked onto the agent's calendar) or live (a warm transfer).
// stage: unassigned (no agent yet) | missed (a transfer nobody picked up) | booked | transferred | sold | not_sold.
const FIRST = ['Angela', 'Kevin', 'Shirley', 'Marcus', 'Teresa', 'Daniel', 'Brenda', 'Frank', 'Joyce', 'Victor', 'Monica', 'Gary', 'Linda', 'Raymond', 'Carmen', 'Dennis', 'Yolanda', 'Russell', 'Tanya', 'Curtis', 'Wanda', 'Hector', 'Bonnie', 'Leon', 'Sheila', 'Wayne', 'Diane', 'Ruben', 'Gail', 'Marvin', 'Rita', 'Terrence', 'Lorraine', 'Felix', 'Darlene', 'Clyde']
const LAST = ['Moore', 'Brooks', 'Adams', 'Hill', 'Lane', 'Ruiz', 'Cole', 'Ellis', 'Turner', 'Hayes', 'Diaz', 'Foster', 'Grant', 'Perry', 'Vega', 'Wells', 'Ford', 'Mills', 'Reyes', 'Bates', 'Long', 'Ortiz', 'Hunt', 'Webb', 'Ross', 'Fox', 'Barnes', 'Soto', 'Lowe', 'Pope', 'Rice', 'Tate', 'Kerr', 'Nash', 'Boyd', 'Gray']
const PRODUCTS = ['Mortgage protection', 'Mortgage protection', 'Final expense', 'Term life']
const CITY = { TX: ['Austin', 'Plano', 'Round Rock'], AZ: ['Phoenix', 'Mesa', 'Tempe'], FL: ['Tampa', 'Brandon', 'Ocala'], GA: ['Atlanta', 'Macon', 'Marietta'], CO: ['Denver', 'Aurora'], NC: ['Charlotte', 'Durham'], OK: ['Tulsa'], NV: ['Henderson'], SC: ['Greenville'] }
const APPT_STAGES = ['booked', 'sold', 'booked', 'not_sold', 'booked', 'sold', 'booked']
const LIVE_STAGES = ['transferred', 'sold', 'missed', 'transferred', 'not_sold', 'sold']
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
      const kind = i % 3 === 0 ? 'live' : 'appointment'
      const agent = seedAgents.find(x => x.id === ROUTE_TO[i % ROUTE_TO.length])
      const state = agent.states[i % agent.states.length]
      const cities = CITY[state]
      let stage = kind === 'live' ? LIVE_STAGES[l++ % LIVE_STAGES.length] : APPT_STAGES[a++ % APPT_STAGES.length]
      // Today's newest come in unrouted; today's appointments are still to happen (booked), never sold yet.
      if (day === TODAY && k >= PER_DAY[day] - 3) stage = 'unassigned'
      else if (day === TODAY && kind === 'appointment' && stage !== 'booked') stage = 'booked'
      const name = `${FIRST[i % FIRST.length]} ${LAST[(i * 7) % LAST.length]}`
      const time = clock(k + (day === TODAY ? 2 : 0))
      out.push({
        id: `ib-${i + 1}`, name, phone: `(${['512', '602', '813', '404', '303', '704'][i % 6]}) 555-0${String(110 + i).padStart(3, '0')}`, state, city: cities[i % cities.length],
        kind, product: PRODUCTS[i % PRODUCTS.length], day, time, came: day === TODAY ? `Today, ${time}` : `${dayName(day)}, ${time}`,
        source: kind === 'live' ? 'Google Ads · live calls' : (i % 4 === 1 ? "Jordan's mortgage site" : 'Google Ads · appointments'),
        agent_id: stage === 'unassigned' ? null : agent.id, stage, premium: stage === 'sold' ? 38 + ((i * 13) % 80) : 0,
        appt: kind === 'appointment' ? `${dateText(Math.min(day + 1 + (i % 3), 9))}, ${clock((i * 3) % 18)}` : null,
        note: stage === 'missed' ? 'Rang the agent 3 times, no pickup. Caller was told someone will call back.' : '',
        log: [],
      })
    }
  }
  return out
})()

// Clients across every agent's book (sold policies) and the servicing steps open on them.
const mkClient = (id, name, agent, va, o) => ({ id, name, agent_id: agent, va_id: va, phone: '(555) 555-0100', state: 'TX', carrier: 'Mutual of Omaha', product: 'Term Life 20', policy: 'MO-4471023', premium: 64.5, stage: 'protected', sold: 'Oct 21', attention: null, ...o })
const seedClients = [
  mkClient('cl-gloria', 'Gloria Santos', 'ag-dana', 'va-maya', { phone: '(305) 555-0156', state: 'FL', stage: 'setting_up', carrier: 'Americo', product: 'Mortgage Protection 25', policy: 'AM-2209184', premium: 88.4, sold: 'Nov 2' }),
  mkClient('cl-robert', 'Robert Chen', 'ag-marcus', 'va-keisha', { phone: '(480) 555-0142', state: 'AZ', carrier: 'Foresters', product: 'Strong Foundation', policy: 'FF-7712406', premium: 52.1, sold: 'Oct 14' }),
  mkClient('cl-luis', 'Luis Ortega', 'ag-priya', 'va-omar', { phone: '(813) 555-0119', state: 'FL', stage: 'needs_attention', attention: 'Draft failed on Nov 1', carrier: 'Transamerica', product: 'Trendsetter Super 20', policy: 'TA-5530981', premium: 71.25, sold: 'Oct 9' }),
  mkClient('cl-denise', 'Denise Walker', 'ag-dana', 'va-maya', { phone: '(214) 555-0171', stage: 'requests', carrier: 'Mutual of Omaha', policy: 'MO-4471188', premium: 47.9, sold: 'Sep 30' }),
  mkClient('cl-harold', 'Harold Nguyen', 'ag-marcus', 'va-keisha', { phone: '(713) 555-0188', stage: 'setting_up', carrier: 'Americo', policy: 'AM-2209377', premium: 96, sold: 'Nov 3' }),
  mkClient('cl-carla', 'Carla Jones', 'ag-james', 'va-andre', { phone: '(404) 555-0133', state: 'GA', carrier: 'Foresters', policy: 'FF-7712589', premium: 39.75, sold: 'Oct 2' }),
  mkClient('cl-renee', 'Renee Ortiz', 'ag-grace', 'va-lily', { phone: '(303) 555-0127', state: 'CO', stage: 'needs_attention', attention: 'Packet not delivered', carrier: 'Transamerica', policy: 'TA-5531044', premium: 58.3, sold: 'Oct 20' }),
  mkClient('cl-walter', 'Walter Price', 'ag-james', 'va-omar', { phone: '(678) 555-0194', state: 'GA', stage: 'setting_up', carrier: 'Mutual of Omaha', policy: 'MO-4471342', premium: 61, sold: 'Nov 4' }),
  mkClient('cl-irene', 'Irene Baker', 'ag-priya', 'va-omar', { phone: '(727) 555-0109', state: 'FL', carrier: 'Americo', policy: 'AM-2209455', premium: 73.6, sold: 'Sep 22' }),
  mkClient('cl-tom', 'Tom Fischer', 'ag-dana', 'va-maya', { phone: '(512) 555-0122', stage: 'requests', carrier: 'Foresters', policy: 'FF-7712633', premium: 44.2, sold: 'Oct 6' }),
  mkClient('cl-nadia', 'Nadia Khan', 'ag-elena', 'va-andre', { phone: '(210) 555-0177', carrier: 'Transamerica', policy: 'TA-5531102', premium: 82.9, sold: 'Oct 27' }),
  mkClient('cl-paul', 'Paul Rivera', 'ag-priya', 'va-lily', { phone: '(813) 555-0165', state: 'FL', stage: 'setting_up', carrier: 'Mutual of Omaha', policy: 'MO-4471399', premium: 55.5, sold: 'Nov 4' }),
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
// booked (to call) | late (past its time, not started: an admin can give it to someone free).
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

// The rota: who is on shift each day (date in November -> VA ids). Two or three every day.
const seedRota = {
  2: ['va-maya', 'va-andre', 'va-keisha'], 3: ['va-maya', 'va-omar'], 4: ['va-andre', 'va-keisha', 'va-lily'], 5: ['va-maya', 'va-keisha', 'va-omar'],
  6: ['va-andre', 'va-omar', 'va-lily'], 7: ['va-keisha', 'va-lily'], 8: ['va-omar', 'va-maya'],
  9: ['va-maya', 'va-andre', 'va-lily'], 10: ['va-keisha', 'va-omar'], 11: ['va-maya', 'va-andre', 'va-keisha'], 12: ['va-lily', 'va-omar'],
  13: ['va-maya', 'va-keisha', 'va-andre'], 14: ['va-omar', 'va-lily'], 15: ['va-keisha', 'va-andre'],
}
export const SHIFT_MIN = 2
export const SHIFT_MAX = 3
const seedDayOff = [
  { id: 'do-1', va_id: 'va-andre', date: 6, reason: "Kid's school event", asked: 'Wed, Nov 4', status: 'pending' },
  { id: 'do-2', va_id: 'va-lily', date: 9, reason: 'Doctor appointment', asked: 'Wed, Nov 4', status: 'pending' },
  { id: 'do-3', va_id: 'va-omar', date: 14, reason: 'Family wedding', asked: 'Thu, Nov 5', status: 'pending' },
  { id: 'do-4', va_id: 'va-keisha', date: 3, reason: 'Moving day', asked: 'Fri, Oct 30', status: 'approved' },
]

// VA pay: a flat amount per confirmed cancellation (sample amount). status = verified | checking | needs_listen.
const seedCancels = [
  { id: 'pc-1', va_id: 'va-keisha', client: 'Irene Baker', carrier: 'Colonial Penn', conf: 'CP-88231', day: 5, status: 'checking' },
  { id: 'pc-2', va_id: 'va-keisha', client: 'Robert Chen', carrier: 'Gerber Life', conf: 'GB-44019', day: 5, status: 'checking' },
  { id: 'pc-3', va_id: 'va-maya', client: 'Tom Fischer', carrier: 'Lincoln Heritage', conf: 'LH-90812', day: 5, status: 'checking' },
  { id: 'pc-4', va_id: 'va-maya', client: 'Carla Jones', carrier: 'Globe Life', conf: 'GL-301977', day: 3, status: 'verified' },
  { id: 'pc-5', va_id: 'va-maya', client: 'Nadia Khan', carrier: 'AARP / New York Life', conf: 'NYL-55120', day: 2, status: 'verified' },
  { id: 'pc-6', va_id: 'va-andre', client: 'Ruth Simmons', carrier: 'Globe Life', conf: 'GL-302114', day: 2, status: 'verified' },
  { id: 'pc-7', va_id: 'va-andre', client: 'Earl Watts', carrier: 'Colonial Penn', conf: '', day: 4, status: 'needs_listen', why: 'The rep never read back a confirmation number', at: '3:12' },
  { id: 'pc-8', va_id: 'va-lily', client: 'June Porter', carrier: 'Gerber Life', conf: 'GB-44102', day: 4, status: 'needs_listen', why: 'Carrier said "pending", not "cancelled"', at: '5:47' },
  { id: 'pc-9', va_id: 'va-lily', client: 'Ray Dunn', carrier: 'Globe Life', conf: 'GL-302190', day: 4, status: 'verified' },
  { id: 'pc-10', va_id: 'va-omar', client: 'Mae Holt', carrier: 'Lincoln Heritage', conf: 'LH-90877', day: 3, status: 'verified' },
  { id: 'pc-11', va_id: 'va-keisha', client: 'Ida Fuller', carrier: 'Globe Life', conf: 'GL-301990', day: 2, status: 'verified' },
]
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

// P864 — Money: the owners who split the profit, their draws, and what each period cost besides VA pay (sample).
// Brought in = what agents paid (lead budgets charged, servicing plans, setup fees). VA payouts count when the run is paid.
export const OWNERS = [{ id: 'ow-brayden', name: 'Brayden' }, { id: 'ow-jordan', name: 'Jordan' }]
export const SETUP_FEE = 297
const seedSetupFees = [
  { id: 'su-1', agent: 'Elena Torres', paid: 'Mon, Oct 12', period: 'last' },
  { id: 'su-2', agent: 'Ben Carter', paid: 'Mon, Oct 19', period: 'last' },
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
const PERIOD_COSTS = {
  week: { adsExtra: 0, tools: 0 },
  month: { adsExtra: 140, tools: 412 },
  last: { ads: 6140, tools: 412 },
}
export const PERIODS = [['week', 'This week', 'Mon, Nov 2 to today'], ['month', 'This month', 'Nov 1 to today'], ['last', 'Last month', 'October']]
export const CARD_FEE = 0.03

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
  { id: 'th-jordan', who: PARTNER.id, unread: 0, messages: [
    { id: 'm1', from: 'them', text: 'GoHighLevel workflows are ready. I will drop the key in Connect once the bridge is live.', at: 'Tue, 2:15 PM' },
    { id: 'm2', from: 'me', text: 'Perfect. Location ID and the three workflows can go in now; they save and wait.', at: 'Tue, 2:31 PM' },
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
  { id: 'f1', who: 'Ben Carter', text: 'Weekly plan card declined', at: 'Wed', kind: 'billing' },
  { id: 'f2', who: 'Andre Lewis', text: 'Asked for Fri, Nov 6 off', at: 'Wed', kind: 'team' },
  { id: 'f3', who: 'Elena Torres', text: 'Lead top-up declined', at: '9:05 AM', kind: 'billing' },
  { id: 'f4', who: 'Carla Jones', text: "Keisha's 12:15 call is past its time", at: '12:30 PM', kind: 'desk' },
  { id: 'f5', who: 'Jordan Hale', text: 'Saved the GoHighLevel location', at: 'Tue', kind: 'connect' },
]

export const SWITCHES = [
  { key: 'sms_live', label: 'Texting live', sub: 'Off means no text is sent by any flow. Stays off until the A2P campaign is approved.', group: 'Calling and texting' },
  { key: 'voice_live', label: 'Calling in the portal', sub: 'Off opens the portal phone as a preview.', group: 'Calling and texting' },
  { key: 'recording_live', label: 'Record calls', sub: 'Records cancellation calls and plays the notice first.', group: 'Calling and texting' },
  { key: 'invite_sms_live', label: 'Invite by text', sub: 'Lets Add someone send the invite as a text.', group: 'Calling and texting' },
  { key: 'payouts_live', label: 'Payouts send real money', sub: 'On means the Monday run pays VAs through Stripe.', group: 'Money' },
  { key: 'billing_enforced', label: 'Lock unpaid agents', sub: 'After 48 hours past due an agent stops getting leads.', group: 'Money' },
  { key: 'submit_live', label: 'Submit page live', sub: 'Opens the new Submit page to every agent.', group: 'Agents' },
  { key: 'carrier_lookup_live', label: 'Live carrier lookup', sub: 'Agents can look up carrier hours themselves.', group: 'Agents' },
  { key: 'signup_open', label: 'Sign-up open', sub: 'Lets new agents sign up without an invite.', group: 'Agents' },
]
const seedSettings = {
  profile: { name: ME.name, email: ME.email, phone: ME.phone },
  tz: 'America/Chicago',
  switches: { sms_live: false, voice_live: false, recording_live: false, invite_sms_live: false, payouts_live: false, billing_enforced: false, submit_live: true, carrier_lookup_live: false, signup_open: false },
  payRules: { perCancel: 18, weeklyMin: 0, holdCap: 40 },
  payoutsPaused: false,
  split: { brayden: 50, changed: null },
  liveRoom: 'https://meet.example.com/ohvara-room',
  notifications: [
    { key: 'lead', label: 'A lead comes in with no agent', push: true, email: false },
    { key: 'missed', label: 'A live transfer is missed', push: true, email: true },
    { key: 'dayoff', label: 'A VA asks for a day off', push: true, email: false },
    { key: 'payment', label: 'A payment fails', push: true, email: true },
    { key: 'listen', label: 'A cancellation needs a listen', push: true, email: false },
    { key: 'bug', label: 'A bug report comes in', push: false, email: true },
  ],
}
const seedCarriers = [
  { id: 'cr-1', name: 'Globe Life', phone: '(800) 742-6787', hours: 'Mon to Fri, 7:00 AM to 7:00 PM CT', status: 'verified' },
  { id: 'cr-2', name: 'Colonial Penn', phone: '(800) 523-9100', hours: 'Mon to Fri, 8:00 AM to 8:00 PM ET', status: 'verified' },
  { id: 'cr-3', name: 'AARP / New York Life', phone: '(800) 607-6763', hours: 'Mon to Fri, 8:00 AM to 6:00 PM ET', status: 'review' },
  { id: 'cr-4', name: 'Gerber Life', phone: '(800) 704-2180', hours: 'Mon to Fri, 8:00 AM to 8:00 PM ET', status: 'verified' },
  { id: 'cr-5', name: 'Lincoln Heritage', phone: '(800) 433-8181', hours: '', status: 'none' },
  { id: 'cr-6', name: 'Mutual of Omaha', phone: '(800) 775-6000', hours: 'Mon to Fri, 7:00 AM to 6:00 PM CT', status: 'review' },
]
const seedBugs = [
  { id: 'bg-1', who: 'Dana Walker', text: 'Calendar shows my 9:00 AM twice on Monday.', at: 'Wed, 5:12 PM', shot: true, resolved: false },
  { id: 'bg-2', who: 'Omar Haddad', text: 'The bank form closed before I could finish.', at: 'Tue, 7:40 PM', shot: false, resolved: false },
  { id: 'bg-3', who: 'Priya Shah', text: 'Search did not find a client by policy number.', at: 'Mon, 11:03 AM', shot: true, resolved: true },
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
  settings: seedSettings, carriers: seedCarriers, bugs: seedBugs, audit: seedAudit, connect: seedConnect, viewAs: 'admin', setupFees: seedSetupFees, draws: seedDraws,
}
const listeners = new Set()
const set = fn => { state = { ...state, ...fn(state) }; listeners.forEach(l => l()) }
const subscribe = fn => { listeners.add(fn); return () => listeners.delete(fn) }
const useStore = () => useSyncExternalStore(subscribe, () => state)
const ok = data => ({ data, isLoading: false, error: null })
// The sample store as it is now (tests read Money's numbers from it without React).
export const admSnapshot = () => state

const nameOf = (s, id) => s.agents.find(a => a.id === id)?.name || s.vas.find(v => v.id === id)?.name || (id === PARTNER.id ? PARTNER.name : '')
export const RATE = () => state.settings.payRules.perCancel
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
    booked: leads.filter(l => l.kind === 'appointment' && ['booked', 'sold', 'not_sold'].includes(l.stage)).length,
    transferred: leads.filter(l => l.kind === 'live' && ['transferred', 'sold', 'not_sold'].includes(l.stage)).length,
    sold: leads.filter(l => l.stage === 'sold').length,
    premium: leads.reduce((t, l) => t + l.premium, 0),
  }
}

export function useAdmAgents() {
  const s = useStore()
  return ok(s.agents.map(a => {
    const mine = s.leads.filter(l => l.agent_id === a.id)
    return { ...a, week: funnel(mine), clients: s.clients.filter(c => c.agent_id === a.id).length, planInfo: PLANS[a.plan] }
  }))
}
export function useAdmVas() {
  const s = useStore()
  const rate = s.settings.payRules.perCancel
  return ok(s.vas.map(v => {
    const mine = s.cancels.filter(c => c.va_id === v.id)
    const calls = s.calls.filter(c => c.va_id === v.id)
    return {
      ...v, onShift: (s.rota[TODAY] || []).includes(v.id), onCall: calls.some(c => c.status === 'live'),
      today: { total: calls.length, done: calls.filter(c => ['cancelled', 'no_answer'].includes(c.status)).length, late: calls.filter(c => c.status === 'late').length },
      week: { cancels: mine.length, verified: mine.filter(c => c.status === 'verified').length * rate, checking: mine.filter(c => c.status === 'checking').length * rate, listen: mine.filter(c => c.status === 'needs_listen').length },
      days: WEEK.filter(d => (s.rota[d] || []).includes(v.id)).length,
      steps: s.steps.filter(x => x.va_id === v.id).length,
    }
  }))
}
export function useAdmInvites() { const s = useStore(); return ok(s.invites) }
export function useAdmLeads() {
  const s = useStore()
  return ok(s.leads.map(l => ({ ...l, agent: l.agent_id ? nameOf(s, l.agent_id) : null })))
}
export function useAdmClients() {
  const s = useStore()
  return ok(s.clients.map(c => ({ ...c, agent: nameOf(s, c.agent_id), va: nameOf(s, c.va_id), steps: s.steps.filter(x => x.client_id === c.id) })))
}
export function useAdmSteps() {
  const s = useStore()
  return ok(s.steps.map(x => { const c = s.clients.find(k => k.id === x.client_id); return { ...x, client: c.name, agent: nameOf(s, c.agent_id), va: nameOf(s, x.va_id) } }))
}
export function useAdmDesk() {
  const s = useStore()
  return ok(s.calls.map(c => ({ ...c, va: nameOf(s, c.va_id), agent: nameOf(s, c.agent_id) })))
}
export function useAdmRota() { const s = useStore(); return ok({ rota: s.rota, dayOff: s.dayOff.map(d => ({ ...d, va: nameOf(s, d.va_id) })) }) }
export function useAdmThreads() {
  const s = useStore()
  return ok(s.threads.map(t => {
    const agent = s.agents.find(a => a.id === t.who)
    const role = agent ? 'Agent' : t.who === PARTNER.id ? 'Partner' : 'Fulfillment'
    return { ...t, name: nameOf(s, t.who), role }
  }))
}
export function useAdmFeed() { const s = useStore(); return ok(s.feed) }
export function useAdmSettings() { const s = useStore(); return ok(s.settings) }
export function useAdmCarriers() { const s = useStore(); return ok(s.carriers) }
export function useAdmBugs() { const s = useStore(); return ok(s.bugs) }
export function useAdmAudit() { const s = useStore(); return ok(s.audit) }
export function useAdmConnect() { const s = useStore(); return ok(s.connect) }
export function useAdmViewAs() { const s = useStore(); return ok(s.viewAs) }

// Money: this week's revenue (plans + leads charged), the weeks before, agent bills, failed payments, the VA pay run.
export function useAdmMoney() {
  const s = useStore()
  const rate = s.settings.payRules.perCancel
  const plans = s.agents.filter(a => !a.comped && a.billing.status !== 'past_due').reduce((t, a) => t + PLANS[a.plan].price, 0)
  const leadsCharged = s.leads.filter(l => l.agent_id).reduce((t, l) => t + LEAD_PRICE[l.kind], 0)
  const weeks = [...s.revenue, { wk: 'Nov 2', plans, leads: leadsCharged, now: true }]
  const failed = s.agents.filter(a => a.billing.failed).map(a => ({ ...a.billing.failed, agent: a.name, agent_id: a.id, status: a.billing.status }))
  const cancels = s.cancels.map(c => ({ ...c, va: nameOf(s, c.va_id), amount: rate }))
  const run = s.vas.map(v => {
    const mine = cancels.filter(c => c.va_id === v.id && c.status === 'verified')
    return { va_id: v.id, name: v.name, count: mine.length, amount: mine.length * rate, bank: v.bank }
  })
  const runTotal = run.filter(r => r.bank === 'ready').reduce((t, r) => t + r.amount, 0)
  return ok({
    plans, leadsCharged, total: plans + leadsCharged, lastWeek: s.revenue[s.revenue.length - 1].plans + s.revenue[s.revenue.length - 1].leads, weeks,
    failed, cancels, listen: cancels.filter(c => c.status === 'needs_listen'), run, runTotal, runs: s.runs, payday: 'Mon, Nov 9',
    stripeBalance: 2140, rate, paused: s.settings.payoutsPaused, live: s.settings.switches.payouts_live,
    adSpend: s.connect.ads.reduce((t, a) => t + a.spent, 0), adBudget: s.connect.ads.reduce((t, a) => t + a.budget, 0),
  })
}

// P864 — Money for one period ('week' | 'month' | 'last'): brought in, costs, profit and the owners' split. Every number
// comes from the same sample as the rest of admin (agents' plans, leads charged, Connect's ad spend, past pay runs).
export function moneyFor(s, period) {
  const weekPlans = s.agents.filter(a => !a.comped && a.billing.status !== 'past_due').reduce((t, a) => t + PLANS[a.plan].price, 0)
  const weekLeads = s.leads.filter(l => l.agent_id).reduce((t, l) => t + LEAD_PRICE[l.kind], 0)
  const oct = s.revenue.filter(w => w.wk.startsWith('Oct'))
  const cur = period === 'last' ? 'last' : 'now'
  const setup = s.setupFees.filter(f => (f.period === 'last') === (cur === 'last')).reduce(t => t + SETUP_FEE, 0)
  const budgets = cur === 'last' ? oct.reduce((t, w) => t + w.leads, 0) : weekLeads
  const servicing = cur === 'last' ? oct.reduce((t, w) => t + w.plans, 0) : weekPlans
  const inTotal = budgets + servicing + setup
  const weekAds = s.connect.ads.reduce((t, a) => t + a.spent, 0)
  const pc = PERIOD_COSTS[period]
  const ads = period === 'last' ? pc.ads : weekAds + pc.adsExtra
  // Pay runs paid inside the period: Mon, Nov 2 for this week and month; Oct 12, 19 and 26 for October.
  const runs = s.runs.filter(r => (cur === 'last' ? r.paid.includes('Oct') : r.paid.includes('Nov')))
  const vaPay = runs.reduce((t, r) => t + r.amount, 0)
  const fees = Math.round(inTotal * CARD_FEE)
  const tools = pc.tools
  const costTotal = ads + vaPay + fees + tools
  const profit = inTotal - costTotal
  const bp = s.settings.split.brayden
  const split = OWNERS.map((o, i) => {
    const pct = i === 0 ? bp : 100 - bp
    const amount = i === 0 ? Math.round((profit * pct) / 100) : profit - Math.round((profit * bp) / 100)
    const draws = s.draws.filter(d => d.owner === o.id && (d.period === 'last') === (cur === 'last'))
    const paid = draws.reduce((t, d) => t + d.amount, 0)
    return { ...o, pct, amount, paid, owed: Math.max(0, amount - paid) }
  })
  return {
    period, budgets, servicing, setup, setupCount: setup / SETUP_FEE, inTotal,
    ads, vaPay, runs, fees, tools, costTotal, profit, split, splitChanged: s.settings.split.changed,
  }
}
export function useAdmPeriod(period = 'week') { const s = useStore(); return ok(moneyFor(s, period)) }
export function useAdmDraws() {
  const s = useStore()
  return ok(OWNERS.map(o => ({ ...o, draws: s.draws.filter(d => d.owner === o.id), total: s.draws.filter(d => d.owner === o.id).reduce((t, d) => t + d.amount, 0) })))
}

// The page heads and the Overview read this: the business today in one place.
export function useAdmDay() {
  const s = useStore()
  const week = funnel(s.leads)
  const byDay = WEEK.map(d => ({ day: d, name: dayName(d), ...funnel(s.leads.filter(l => l.day === d)), later: d > TODAY }))
  const unassigned = s.leads.filter(l => l.stage === 'unassigned')
  const missed = s.leads.filter(l => l.stage === 'missed')
  const late = s.calls.filter(c => c.status === 'late')
  const requests = s.dayOff.filter(d => d.status === 'pending').map(d => ({ ...d, va: nameOf(s, d.va_id) }))
  const failed = s.agents.filter(a => a.billing.failed)
  const listen = s.cancels.filter(c => c.status === 'needs_listen')
  return ok({
    week, byDay, unassigned, missed, late, requests, failed, listen,
    payingAgents: s.agents.filter(a => !a.comped && a.billing.status === 'current' && a.access).length,
    onShift: (s.rota[TODAY] || []).map(id => s.vas.find(v => v.id === id)).filter(Boolean),
    onDuty: s.agents.filter(a => a.onDuty && a.active),
    needs: unassigned.length + missed.length + late.length + requests.length + failed.length + listen.length,
    unread: s.threads.reduce((n, t) => n + t.unread, 0),
    openBugs: s.bugs.filter(b => !b.resolved).length,
  })
}

const feedAdd = (s, who, text, kind) => ({ feed: [{ id: `f${Date.now()}`, who, text, at: stamp(), kind }, ...s.feed] })
const patchById = (list, id, patch) => list.map(x => (x.id === id ? { ...x, ...(typeof patch === 'function' ? patch(x) : patch) } : x))

export function useAdmActions() {
  return {
    // Leads: route to an agent, or move one along.
    assignLead: (id, agentId) => set(s => {
      const l = s.leads.find(x => x.id === id)
      const stage = l.stage === 'unassigned' || l.stage === 'missed' ? (l.kind === 'live' ? 'transferred' : 'booked') : l.stage
      return { leads: patchById(s.leads, id, { agent_id: agentId, stage, log: [...l.log, `Routed to ${nameOf(s, agentId)} at ${stamp()}`] }), ...audit(s, l.agent_id ? 'Moved a lead' : 'Routed a lead', `${l.name} to ${nameOf(s, agentId)}`) }
    }),
    setLeadStage: (id, stage) => set(s => { const l = s.leads.find(x => x.id === id); return { leads: patchById(s.leads, id, { stage, premium: stage === 'sold' ? l.premium || 60 : 0 }), ...audit(s, 'Changed a lead stage', `${l.name}: ${stage.replace('_', ' ')}`) } }),
    // Agents
    setAgentActive: (id, on) => set(s => ({ agents: patchById(s.agents, id, { active: on, onDuty: on && s.agents.find(a => a.id === id).onDuty }), ...audit(s, on ? 'Turned live transfers on' : 'Turned live transfers off', nameOf(s, id)) })),
    setAgentSpend: (id, spend) => set(s => ({ agents: patchById(s.agents, id, { spend }), ...audit(s, 'Changed a weekly lead budget', `${nameOf(s, id)}: $${spend}`) })),
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
        : { vas: s.vas.filter(x => x.id !== id), agents: [...s.agents, { ...seedAgents[0], ...who, role, id, active: false, onDuty: false, spend: 0, plan: 'leads', states: ['TX'], billing: { status: 'current', next: 'Not set up', method: 'None yet', failed: null } }] }
      return { ...out, ...audit(s, 'Changed a role', `${who.name} to ${role === 'agent' ? 'Agent' : 'Fulfillment'}`) }
    }),
    invite: ({ name, role, via, to }) => set(s => ({ invites: [{ id: `inv-${Date.now()}`, name, role, via, to, sent: `Today, ${stamp()}` }, ...s.invites], ...audit(s, 'Sent an invite', `${name} (${role === 'agent' ? 'agent' : 'Fulfillment'})`) })),
    resendInvite: id => set(s => ({ invites: patchById(s.invites, id, { sent: `Today, ${stamp()}` }), ...audit(s, 'Resent an invite', s.invites.find(i => i.id === id).name) })),
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
    // Pay: decide a cancellation the AI could not confirm (fulfillment_decide_cancel), pause the Monday run.
    decideCancel: (id, pay, note) => set(s => {
      const c = s.cancels.find(x => x.id === id)
      return { cancels: pay ? patchById(s.cancels, id, { status: 'verified', note }) : s.cancels.filter(x => x.id !== id), ...audit(s, pay ? 'Marked a cancellation paid' : "Didn't pay a cancellation", `${c.client}, ${c.carrier}${note ? ` (${note})` : ''}`) }
    }),
    // P864: the owners' profit split (Brayden's share; Jordan gets the rest). Written to the audit log.
    setSplit: brayden => set(s => {
      const b = Math.max(0, Math.min(100, Math.round(brayden)))
      return { settings: { ...s.settings, split: { brayden: b, changed: { who: ME.name, at: `Today, ${stamp()}` } } }, ...audit(s, 'Changed the profit split', `Brayden ${b}% · Jordan ${100 - b}%`) }
    }),
    setPaused: on => set(s => ({ settings: { ...s.settings, payoutsPaused: on }, ...audit(s, on ? 'Paused payouts' : 'Resumed payouts', 'Monday pay run') })),
    // Settings
    setSwitch: (key, on) => set(s => ({ settings: { ...s.settings, switches: { ...s.settings.switches, [key]: on } }, ...audit(s, `${on ? 'Turned on' : 'Turned off'} ${SWITCHES.find(x => x.key === key).label}`, 'Sample only') })),
    savePayRules: payRules => set(s => ({ settings: { ...s.settings, payRules }, ...audit(s, 'Changed pay rules', `$${payRules.perCancel} a cancellation, cap ${payRules.holdCap}`) })),
    saveSettings: patch => set(s => ({ settings: { ...s.settings, ...patch } })),
    setTz: tz => set(s => ({ settings: { ...s.settings, tz } })),
    saveCarrier: (id, patch) => set(s => ({ carriers: patchById(s.carriers, id, patch), ...audit(s, 'Saved carrier hours', s.carriers.find(c => c.id === id).name) })),
    resolveBug: id => set(s => ({ bugs: patchById(s.bugs, id, { resolved: true }), ...audit(s, 'Resolved a bug report', s.bugs.find(b => b.id === id).who) })),
    // Messages
    sendMessage: (threadId, text, from = 'me') => set(s => ({ threads: patchById(s.threads, threadId, t => ({ messages: [...t.messages, { id: `m${Date.now()}`, from, text, at: `Today, ${stamp()}` }] })) })),
    readThread: threadId => set(s => ({ threads: patchById(s.threads, threadId, { unread: 0 }) })),
    // Connect (Jordan). A key is kept only as "saved" plus its last four; the value itself is dropped here.
    saveConnect: (part, patch, what) => set(s => {
      const next = Array.isArray(s.connect[part]) ? patch : { ...s.connect[part], ...patch }
      return { connect: { ...s.connect, [part]: next }, ...audit(s, what || 'Saved a Connect setting', 'Waits for the bridge (P850)'), ...feedAdd(s, s.viewAs === 'partner' ? PARTNER.name : ME.name, what || 'Saved a Connect setting', 'connect') }
    }),
    setViewAs: viewAs => set(() => ({ viewAs })),
  }
}
