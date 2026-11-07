import { useSyncExternalStore, useMemo } from 'react'
import { instantOf, clockOf, dateOf, zoneOf } from '../../lib/callSlots.js'
import { seedEvents, applyMove, addReply, whenLabel, needsYouNow, forYourInfo, STAGES, SAMPLE_NOW } from '../leadLifecycle.js'

// The one door to sample info for the clickable template. Screens read only through the named functions below.
// Every read returns { data, isLoading: false, error: null }, the shape react-query hooks give, and record fields
// are named like the real hooks (useMpLeads, usePolicies), so the backend swaps in by replacing this file only.
// Changes live in memory and reset on reload. Prices are sample prices: pricing is not final.

const people = {
  gloria: { first: 'Gloria', last: 'Santos', phone: '(305) 555-0156', city: 'Miami', state: 'FL' },
  robert: { first: 'Robert', last: 'Chen', phone: '(480) 555-0142', city: 'Phoenix', state: 'AZ' },
  luis: { first: 'Luis', last: 'Ortega', phone: '(813) 555-0119', city: 'Tampa', state: 'FL' },
  denise: { first: 'Denise', last: 'Walker', phone: '(214) 555-0171', city: 'Dallas', state: 'TX' },
  harold: { first: 'Harold', last: 'Nguyen', phone: '(713) 555-0188', city: 'Houston', state: 'TX' },
  carla: { first: 'Carla', last: 'Jones', phone: '(404) 555-0133', city: 'Atlanta', state: 'GA' },
  renee: { first: 'Renee', last: 'Ortiz', phone: '(303) 555-0127', city: 'Denver', state: 'CO' },
  dana: { first: 'Dana', last: 'Example', phone: '(512) 555-0148', city: 'Austin', state: 'TX' },
  owen: { first: 'Owen', last: 'Price', phone: '(602) 555-0193', city: 'Mesa', state: 'AZ' },
  ellen: { first: 'Ellen', last: 'Park', phone: '(919) 555-0164', city: 'Raleigh', state: 'NC' },
  tanya: { first: 'Tanya', last: 'Bell', phone: '(615) 555-0137', city: 'Nashville', state: 'TN' },
  paul: { first: 'Paul', last: 'Kim', phone: '(206) 555-0182', city: 'Seattle', state: 'WA' },
  grace: { first: 'Grace', last: 'Liu', phone: '(916) 555-0145', city: 'Sacramento', state: 'CA' },
  victor: { first: 'Victor', last: 'Hale', phone: '(317) 555-0129', city: 'Indianapolis', state: 'IN' },
  joan: { first: 'Joan', last: 'Miles', phone: '(502) 555-0176', city: 'Louisville', state: 'KY' },
  sam: { first: 'Sam', last: 'Rivera', phone: '(210) 555-0158', city: 'San Antonio', state: 'TX' },
}

// P873: every lead sits somewhere on its path (leadLifecycle.js STAGES) on the sample clock, Mon, Nov 2, 2:14 PM.
// came / apptAt / followAt are times on the agent's clock; the timeline (events) is built from them, shaped like
// the lead-events rows of migration 180, and every move adds to it.
const mkLead = (id, p, o) => {
  const l = {
    id, first_name: p.first, last_name: p.last, phone: p.phone, state: p.state, city: p.city,
    age_band: '45 to 54', mortgage_balance_band: '$200,000 to $300,000', homeowner: true, smoker: false,
    best_time: 'Evenings', status: 'assigned', outcome: null, kind: 'appointment', appt: null, apptAt: null, note: '', reply: null, fresh: false,
    ...o,
  }
  l.dbStage = STAGES[l.stage].db
  if (l.apptAt) l.appt = whenLabel(l.apptAt)
  l.created = whenLabel(l.came).replace(/, \d+:\d+ [AP]M$/, '')
  l.assigned_at = whenLabel(l.came)
  l.events = seedEvents(l)
  return l
}

const seedLeads = [
  mkLead('sample-lead-1', people.dana, { stage: 'booked', fresh: true, came: '2026-11-02T10:52', apptAt: '2026-11-05T15:00', note: 'Wants coverage until the mortgage is paid off. Two kids, 9 and 12.' }),
  mkLead('sample-lead-2', people.carla, { stage: 'missed', kind: 'live_call', came: '2026-11-02T09:08', best_time: 'Mornings' }),
  mkLead('sample-lead-3', people.harold, { stage: 'ringing', kind: 'live_call', came: '2026-11-02T14:11', age_band: '55 to 64' }),
  mkLead('sample-lead-4', people.renee, { stage: 'no_show', came: '2026-10-29T17:40', apptAt: '2026-11-02T11:00' }),
  mkLead('sample-lead-5', people.denise, { stage: 'sold', status: 'closed', outcome: 'sold', submitted: true, came: '2026-10-24T16:05', apptAt: '2026-10-27T11:00' }),
  mkLead('sample-lead-6', people.robert, { stage: 'follow_up', status: 'contacted', outcome: 'follow_up', came: '2026-10-27T18:12', apptAt: '2026-10-30T15:00', follow: 'Mon, Nov 2', followAt: '2026-11-02T16:00' }),
  mkLead('sample-lead-7', people.owen, { stage: 'booked', came: '2026-10-30T12:20', apptAt: '2026-11-02T14:00', age_band: '35 to 44' }),
  mkLead('sample-lead-8', people.ellen, { stage: 'booked', came: '2026-10-31T09:15', apptAt: '2026-11-02T13:00', firstReply: 'Monday at 1 is good' }),
  mkLead('sample-lead-9', people.tanya, { stage: 'calling', tries: 2, came: '2026-11-01T10:30', reply: { text: 'Can you call after 6? I am at work until then.', at: '2026-11-02T13:52', seen: false } }),
  mkLead('sample-lead-10', people.paul, { stage: 'new', came: '2026-11-02T14:10', mortgage_balance_band: '$300,000 to $400,000' }),
  mkLead('sample-lead-11', people.grace, { stage: 'calling', tries: 3, came: '2026-10-29T08:40' }),
  mkLead('sample-lead-12', people.victor, { stage: 'unreachable', status: 'bad', came: '2026-07-28T19:05' }),
  mkLead('sample-lead-13', people.joan, { stage: 'opted_out', status: 'bad', came: '2026-10-28T11:00' }),
  mkLead('sample-lead-14', people.sam, { stage: 'not_interested', status: 'bad', outcome: 'not_interested', reason: 'Already covered', came: '2026-10-26T15:30', apptAt: '2026-10-29T10:00' }),
]

const mkClient = (id, p, o) => ({
  id, client_first_name: p.first, client_last_name: p.last, client_phone: p.phone, city: p.city, state: p.state,
  carrier_name: 'Northfield Mutual', product_name: 'Mortgage protection', product_type: 'mortgage_protection',
  policy_number: 'SAMPLE-0001', monthly_premium: 86.4, annual_premium: 1036.8, status: 'booked', stage: 'setting_up', is_sample_price: true,
  note: 'Nothing needed from you', next_step: null, attention: null, submitted: 'Tue, Oct 27',
  steps: [
    { label: 'Sale submitted', at: 'Tue, Oct 27', done: true },
    { label: 'Packet check', at: 'Wed, Oct 28', done: true },
    { label: 'Review call', at: 'Fri, Nov 6, 2:00 PM', done: false },
    { label: 'Old policy cancelled', at: 'To be set', done: false },
  ],
  calls: [{ at: 'Wed, Oct 28, 3:10 PM', result: 'Answered', by: 'Fulfillment' }],
  ...o,
})

const seedClients = [
  mkClient('sample-client-1', people.gloria, { policy_number: 'SAMPLE-1001', carrier_name: 'Harborline Life', stage: 'needs_attention', status: 'needs_attention', note: 'We could not reach Gloria after two tries.', attention: 'Confirm the number', next_step: 'Confirm the number', calls: [{ at: 'Thu, Oct 29, 10:02 AM', result: 'No answer', by: 'Fulfillment' }, { at: 'Fri, Oct 30, 5:40 PM', result: 'No answer', by: 'Fulfillment' }] }),
  mkClient('sample-client-2', people.luis, { policy_number: 'SAMPLE-1002', carrier_name: 'Pinecrest Assurance', stage: 'protected', status: 'effective', monthly_premium: 112, annual_premium: 1344, next_step: null }),
  mkClient('sample-client-3', people.robert, { policy_number: 'SAMPLE-1003', stage: 'setting_up', next_step: 'Review call Thu, Nov 5, 3:00 PM' }),
  mkClient('sample-client-4', people.denise, { policy_number: 'SAMPLE-1004', carrier_name: 'Harborline Life', stage: 'setting_up', next_step: 'Packet check Fri, Nov 6' }),
  mkClient('sample-client-5', people.renee, { policy_number: 'SAMPLE-1005', carrier_name: 'Pinecrest Assurance', stage: 'requests', status: 'request_open', note: 'A change on the policy is open', next_step: 'Address change in progress' }),
  mkClient('sample-client-6', people.carla, { policy_number: 'SAMPLE-1006', stage: 'protected', status: 'effective', monthly_premium: 74.25, annual_premium: 891, next_step: null }),
]

const seedThreads = [
  { id: 'thread-1', client_id: 'sample-client-1', name: 'Gloria Santos', unread: 1, messages: [
    { id: 'm1', from: 'team', text: 'We tried Gloria twice and got no answer. Can you confirm the number?', at: 'Fri, Oct 30, 5:44 PM' },
    { id: 'm2', from: 'me', text: 'Checking with her today.', at: 'Fri, Oct 30, 6:02 PM' },
    { id: 'm3', from: 'team', text: 'Thank you. We will text her tomorrow morning and evening.', at: 'Mon, Nov 2, 9:15 AM' }] },
  { id: 'thread-2', client_id: 'sample-client-3', name: 'Robert Chen', unread: 0, messages: [
    { id: 'm4', from: 'team', text: 'Robert is booked for his review call on Thursday at 3:00 PM your time.', at: 'Wed, Oct 28, 3:00 PM' }] },
  { id: 'thread-3', client_id: 'sample-client-5', name: 'Renee Ortiz', unread: 2, messages: [
    { id: 'm5', from: 'team', text: 'Renee asked to change her mailing address. We are on it.', at: 'Mon, Nov 2, 11:20 AM' },
    { id: 'm6', from: 'team', text: 'The carrier needs a signed form. We will send it to her today.', at: 'Mon, Nov 2, 1:05 PM' }] },
]

const seedActivity = [
  { id: 'a1', at: 'Today, 2:06 PM', kind: 'text', who: 'Gloria Santos', text: 'The team texted Gloria to confirm her number.' },
  { id: 'a2', at: 'Today, 1:05 PM', kind: 'client', who: 'Renee Ortiz', text: 'Address change request sent to the carrier.' },
  { id: 'a3', at: 'Today, 11:30 AM', kind: 'lead', who: 'Dana Example', text: 'New lead assigned to you. Appointment booked for Thu, Nov 5.' },
  { id: 'a4', at: 'Today, 9:12 AM', kind: 'call', who: 'Carla Jones', text: 'Missed live call. The team booked the next open slot within the hour.' },
  { id: 'a5', at: 'Fri, Oct 30', kind: 'moved', who: 'Robert Chen', text: 'Moved to Follow up for Mon, Nov 2.' },
  { id: 'a6', at: 'Yesterday, 11:02 AM', kind: 'client', who: 'Luis Ortega', text: 'Policy is now protected.' },
  { id: 'a7', at: 'Fri, Oct 30', kind: 'call', who: 'Gloria Santos', text: 'Fulfillment called. No answer, second try.' },
  { id: 'a8', at: 'Fri, Oct 30', kind: 'lead', who: 'Denise Walker', text: 'Sold. Ready to submit for servicing.' },
]

const seedAppointments = [
  { id: 'ap1', day: 'Mon', date: 2, time: '3:30 PM', who: 'Gloria Santos', label: 'Confirm number, call her', kind: 'client', ref: 'sample-client-1' },
  { id: 'ap2', day: 'Mon', date: 2, time: '1:00 PM', who: 'Ellen Park', label: 'Appointment', kind: 'lead', ref: 'sample-lead-8' },
  { id: 'ap3', day: 'Mon', date: 2, time: '11:00 AM', who: 'Renee Ortiz', label: 'Appointment', kind: 'lead', ref: 'sample-lead-4' },
  { id: 'ap8', day: 'Mon', date: 2, time: '2:00 PM', who: 'Owen Price', label: 'Appointment', kind: 'lead', ref: 'sample-lead-7' },
  { id: 'ap4', day: 'Thu', date: 5, time: '3:00 PM', who: 'Dana Example', label: 'Appointment', kind: 'lead', ref: 'sample-lead-1' },
  { id: 'ap5', day: 'Thu', date: 5, time: '4:00 PM', who: 'Robert Chen', label: 'Review call', kind: 'client', ref: 'sample-client-3' },
  { id: 'ap6', day: 'Fri', date: 6, time: '2:00 PM', who: 'Luis Ortega', label: 'Check-in call', kind: 'client', ref: 'sample-client-2' },
  { id: 'ap7', day: 'Fri', date: 6, time: '4:15 PM', who: 'Gloria Santos', label: 'Review call', kind: 'client', ref: 'sample-client-1' },
]
// P854: each appointment is one instant (iso, seeds: the day and time on the agent's clock) plus the client's zone (tz).
// No two overlap (lib/callSlots agentFree): ap5 moved off ap4's 3:00 PM. date/day/time stay on the agent's clock.
export const AGENT_TZ = 'America/Chicago'
const novDay = d => `2026-11-${String(d).padStart(2, '0')}`
const DOW_OF = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
export const onAgentClock = (iso, tz = AGENT_TZ) => { const date = dateOf(iso, tz); return { date: Number(date.slice(8)), day: DOW_OF[new Date(`${date}T12:00:00Z`).getUTCDay()], time: clockOf(iso, tz) } }
const personOf = ref => [...seedLeads, ...seedClients].find(x => x.id === ref)
seedAppointments.forEach(a => { const p = personOf(a.ref); a.iso = instantOf(novDay(a.date), a.time, AGENT_TZ); a.tz = p ? zoneOf(p.state, p.city) : null })

// P844: sample agents of different ages, so every range of the chart shows. Pick one with ?agent=new | first | empty in
// the address (default: an established agent, 14 weeks in). The sample clock is Monday, Nov 2. Real data swaps in here.
const WEEKS_BEFORE = [['Aug 3', 3], ['Aug 10', 4], ['Aug 17', 3], ['Aug 24', 5], ['Aug 31', 4], ['Sep 7', 3], ['Sep 14', 5], ['Sep 21', 4], ['Sep 28', 6], ['Oct 5', 5], ['Oct 12', 4], ['Oct 19', 6], ['Oct 26', 5]]
const SAMPLE_AGENTS = {
  established: { days: 98, weeks: WEEKS_BEFORE },
  new: { days: 21, weeks: [['Oct 12', 3], ['Oct 19', 4], ['Oct 26', 5]] },
  first: { days: 5, weeks: [] },
  empty: { days: 0, weeks: [], none: true },
}
const sampleAgent = () => {
  const k = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('agent') : null
  return SAMPLE_AGENTS[k] || SAMPLE_AGENTS.established
}
const seed = {
  leads: seedLeads, clients: seedClients, threads: seedThreads, activity: seedActivity, appointments: seedAppointments,
  duty: true, tasks: { t1: false, t2: false, t3: false },
  settings: {
    profile: { name: 'Dana Whitfield', email: 'dana.whitfield@example.com', phone: '(214) 555-0100', plan: 'Weekly budget and servicing' },
    hours: { start: '9:00 AM', end: '6:00 PM', days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'] },
    // P847: the Overview clock's zone (profiles.timezone values) and the optional caller ID: when fulfillment calls a
    // client, the call shows the agent's number. status: not_set | pending | confirmed. Sample only: no call or text goes out.
    timeZone: 'America/Chicago',
    callerId: { status: 'not_set', number: '' },
    notifications: [
      { key: 'lead', label: 'New lead', push: true, email: true },
      { key: 'appt', label: 'Appointment reminders', push: true, email: false },
      { key: 'msg', label: 'Messages from the team', push: true, email: true },
      { key: 'client', label: 'Client needs you', push: true, email: true },
    ],
  },
  // Prompt 835: a weekly budget (slider), monthly servicing, a one-time setup fee. Prices live in lib/planPricing.
  // cancellations: the old cancellation plan, shown only for an agent already on one (this sample agent is not).
  billing: {
    budget: { weekly: 1000, mode: 'appts' }, booked: sampleAgent().none ? 0 : 4, paused: false, next_charge: 'Mon, Nov 9',
    servicing: { status: 'active', next: 'Tue, Dec 1' }, setup: { paid: true, at: 'Mon, Oct 12' }, cancellations: null,
    history: [{ id: 'inv1', at: 'Mon, Nov 2', label: 'Weekly budget, booked appointments', amount: 1000 }, { id: 'inv2', at: 'Sun, Nov 1', label: 'Policy servicing, November', amount: 299 }, { id: 'inv3', at: 'Mon, Oct 26', label: 'Weekly budget, booked appointments', amount: 1000 }, { id: 'inv4', at: 'Mon, Oct 12', label: 'One-time setup', amount: 1997 }],
  },
  submitted: 11,
}

let state = seed
const listeners = new Set()
const subscribe = fn => { listeners.add(fn); return () => listeners.delete(fn) }
const set = fn => { state = fn(state); listeners.forEach(l => l()) }
const useStore = () => useSyncExternalStore(subscribe, () => state)
const ok = data => ({ data, isLoading: false, error: null })
const fullName = c => `${c.client_first_name} ${c.client_last_name}`

export function useSampleLeads() { const s = useStore(); return ok(s.leads) }
export function useSampleLead(id) { const s = useStore(); return ok(s.leads.find(l => l.id === id) || s.leads[0]) }
export function useSampleClients() { const s = useStore(); return ok(s.clients) }
export function useSampleClient(id) { const s = useStore(); return ok(s.clients.find(c => c.id === id) || s.clients[0]) }
export function useSampleAppointments() { const s = useStore(); return ok(s.appointments) }
export function useSampleThreads() { const s = useStore(); return ok(s.threads) }
export function useSampleActivity() { const s = useStore(); return ok(s.activity) }
export function useSampleBilling() { const s = useStore(); return ok({ ...s.billing, submitted: s.submitted }) }
export function useSampleSettings() { const s = useStore(); return ok({ ...s.settings, duty: s.duty }) }
// P873: Needs you now (the six triggers, most urgent first) and the quiet FYI list, for the Overview and the bell.
export function useSampleNeeds() { const s = useStore(); return ok(useMemo(() => ({ now: needsYouNow(s, SAMPLE_NOW), fyi: forYourInfo(s) }), [s])) }
export function useSampleSignup() {
  return useMemo(() => ok({
    covers: ['Booked appointments or live calls, your pick', 'A team that follows up with every client', 'Updates in your bell and by text'],
  }), [])
}
// The sample clock is fixed at Monday, November 2, 2:14 PM, like the frame.
const NOW = { label: 'Monday, November 2', time: '2:14', ampm: 'PM', min: 14 * 60 + 14, date: 2 }
const minutesOf = t => { const m = /(\d+):(\d+)\s*(AM|PM)/.exec(t); return ((Number(m[1]) % 12) + (m[3] === 'PM' ? 12 : 0)) * 60 + Number(m[2]) }
const untilText = t => { const d = minutesOf(t) - NOW.min; return d <= 0 ? 'now' : `in ${d >= 60 ? `${Math.floor(d / 60)} h ` : ''}${d % 60} min` }
const LEAD_NEW = ['booked', 'ringing', 'missed']

// First 2 weeks: day by day this week. 2 to 8 weeks: week by week since joining. 8+ weeks: the last 8 weeks.
// points: [label, value, upcoming]. prev: last week's total, or null when there was no last week.
function bookedChart(thisWeek) {
  const a = sampleAgent()
  const booked = a.none ? 0 : thisWeek
  if (a.days < 14) {
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
    return { mode: 'days', range: 'This week, day by day', empty: booked === 0, prev: null,
      points: days.map((d, i) => [d, i === 0 ? booked : 0, i > 0]) }
  }
  const all = [...a.weeks, ['Nov 2', booked]]
  const weeks = a.days < 56 ? all : all.slice(-8)
  return { mode: 'weeks', range: a.days < 56 ? 'Since you joined' : 'Last 8 weeks', empty: false, prev: a.weeks.length ? a.weeks[a.weeks.length - 1][1] : null, points: weeks }
}

export function useSampleOverview() {
  const s = useStore()
  const open = Object.values(s.tasks).filter(v => !v).length
  const by = st => s.clients.filter(c => c.stage === st).length
  return ok({
    name: 'Dana', book: { protected: by('protected'), settingUp: by('setting_up'), needsAttention: by('needs_attention'), requestsOpen: by('requests') },
    duty: s.duty, stepsOpen: open,
    attention: s.clients.filter(c => c.stage === 'needs_attention'),
    dueSoon: [
      { id: 't1', label: 'Review call', clientName: 'Robert Chen', clientId: 'sample-client-3', dueAt: 'Thu, Nov 5, 3:00 PM', day: 'Thu', date: 5, done: s.tasks.t1 },
      { id: 't2', label: 'Packet check', clientName: 'Denise Walker', clientId: 'sample-client-4', dueAt: 'Fri, Nov 6, 10:00 AM', day: 'Fri', date: 6, done: s.tasks.t2 },
      { id: 't3', label: 'Check-in call', clientName: 'Luis Ortega', clientId: 'sample-client-2', dueAt: 'Fri, Nov 6, 2:00 PM', day: 'Fri', date: 6, done: s.tasks.t3 },
    ],
    doneByDay: [
      { day: 'Mon', date: 'Oct 26', packet: 2, review: 1, cancel: 0, save: 0 }, { day: 'Tue', date: 'Oct 27', packet: 1, review: 2, cancel: 1, save: 0 },
      { day: 'Wed', date: 'Oct 28', packet: 3, review: 1, cancel: 0, save: 1 }, { day: 'Thu', date: 'Oct 29', packet: 0, review: 2, cancel: 0, save: 0 },
      { day: 'Fri', date: 'Oct 30', packet: 2, review: 0, cancel: 1, save: 1 }, { day: 'Sat', date: 'Oct 31', packet: 0, review: 0, cancel: 0, save: 0 }, { day: 'Sun', date: 'Nov 1', packet: 0, review: 0, cancel: 0, save: 0 },
    ],
    // P844: the "Booked this week" chart picks its range from how long the agent has been on Ohvara
    bookedChart: bookedChart(s.billing.booked),
    upNext: s.appointments.slice(0, 3),
    leadsToday: s.leads.length,
    today: NOW.label, clock: { time: NOW.time, ampm: NOW.ampm },
    doneRange: 'Oct 26 to Nov 1',
    dutySince: '9:02 AM',
    nextAppt: (() => { const a = s.appointments.find(x => x.date === NOW.date && minutesOf(x.time) > NOW.min); return a ? { ...a, inText: untilText(a.time) } : null })(),
    todayAppts: s.appointments.filter(a => a.date === NOW.date).map(a => ({ ...a, inText: untilText(a.time) })),
    newLeads: s.leads.filter(l => LEAD_NEW.includes(l.stage)).map(l => ({ id: l.id, name: `${l.first_name} ${l.last_name}`, kind: l.kind, stage: l.stage, appt: l.appt })),
  })
}

const stamp = 'Today, 2:14 PM'
const soldToClient = l => {
  const sold = l.stage === 'sold' ? l : applyMove(l, 'sold', {}, SAMPLE_NOW)
  return { ...sold, submitted: true, events: [...sold.events, { id: `${l.id}-c${sold.events.length + 1}`, kind: 'became_client', at: SAMPLE_NOW, label: 'Submitted for servicing. Now a client', state: 'done', by: 'You', role: 'you' }] }
}
const log = (s, who, text, kind) => [{ id: `a${s.activity.length + 1}-${text.length}`, at: stamp, kind, who, text }, ...s.activity]

export function useSampleActions() {
  return useMemo(() => ({
    moveLead: (id, stage, extra = {}) => set(s => {
      const lead = s.leads.find(l => l.id === id)
      return { ...s, leads: s.leads.map(l => (l.id === id ? applyMove(l, stage, extra, SAMPLE_NOW) : l)), activity: log(s, `${lead.first_name} ${lead.last_name}`, `Moved to ${STAGES[stage].label}.`, 'moved') }
    }),
    // P873: the agent's text back to a lead. Saved on the timeline; it sends once texting is switched on.
    replyLead: (id, text) => set(s => ({ ...s, leads: s.leads.map(l => (l.id === id ? addReply(l, text, SAMPLE_NOW) : l)) })),
    addLeadNote: (id, text) => set(s => ({ ...s, leads: s.leads.map(l => (l.id === id ? { ...l, note: l.note ? `${l.note}\n${text}` : text } : l)) })),
    setDuty: on => set(s => ({ ...s, duty: on })),
    doneTask: id => set(s => ({ ...s, tasks: { ...s.tasks, [id]: true } })),
    clientAction: (id, action) => set(s => {
      const c = s.clients.find(x => x.id === id)
      const patch = action === 'confirm' ? { stage: 'setting_up', status: 'booked', attention: null, note: 'Number confirmed. We text her tomorrow morning and evening.' } : { note: action }
      return { ...s, clients: s.clients.map(x => (x.id === id ? { ...x, ...patch } : x)), activity: log(s, fullName(c), action === 'confirm' ? 'Number confirmed.' : action, 'client') }
    }),
    sendMessage: (threadId, text) => set(s => ({ ...s, threads: s.threads.map(t => (t.id === threadId ? { ...t, unread: 0, messages: [...t.messages, { id: `m${t.messages.length + 10}-${text.length}`, from: 'me', text, at: stamp }] } : t)) })),
    readThread: threadId => set(s => ({ ...s, threads: s.threads.map(t => (t.id === threadId ? { ...t, unread: 0 } : t)) })),
    // P868: form is lib submitModel buildSubmission (phone in E.164; booking = the call booked with it, or null).
    // P873: a sale picked from one of the agent's leads (form.linked) moves that lead to Sold and makes it a client.
    submitSale: form => set(s => ({ ...s, submitted: s.submitted + 1, sales: [...(s.sales || []), form], leads: form.linked?.kind === 'lead' ? s.leads.map(l => (l.id === form.linked.id ? soldToClient(l) : l)) : s.leads, activity: log(s, form.name || 'New client', form.booking ? `Sale submitted for servicing. Call booked for ${form.booking.time} (their time)${form.booking.va ? ` with ${form.booking.va}` : ''}.` : 'Sale submitted for servicing.', 'client') })),
    submitRequest: form => set(s => ({ ...s, activity: log(s, form.name || 'Client', `Service request sent: ${form.kind}.`, 'client') })),
    setNotification: (key, field, on) => set(s => ({ ...s, settings: { ...s.settings, notifications: s.settings.notifications.map(n => (n.key === key ? { ...n, [field]: on } : n)) } })),
    setPaused: paused => set(s => ({ ...s, billing: { ...s.billing, paused } })),
    // P854: iso = the instant picked on the client's clock, tz = the client's zone; day/date/time land on the agent's clock.
    bookCall: ({ ref, kind, who, iso, tz, label, clientText }) => set(s => {
      const { day, date, time } = onAgentClock(iso, s.settings.timeZone || AGENT_TZ)
      return { ...s, appointments: [...s.appointments, { id: `ap${s.appointments.length + 1}-${Date.now()}`, day, date, time, iso, tz, who, label, kind, ref }], activity: log(s, who, `${label} booked for ${day}, Nov ${date}, ${time}${clientText ? ` (${clientText})` : ''}.`, kind === 'lead' ? 'lead' : 'client') }
    }),
    setBudget: (weekly, mode) => set(s => ({ ...s, billing: { ...s.billing, budget: { weekly, mode } } })),
    saveSettings: patch => set(s => ({ ...s, settings: { ...s.settings, ...patch } })),
    // P847: a cancellation or service call for fulfillment, booked while the agent is on the phone with the client.
    // b = { who, kind: 'cancellation' | 'service', mode: 'exact' | 'window' | 'none', day, date, time, window, va }
    bookFulfillmentCall: b => set(s => {
      const what = b.kind === 'cancellation' ? 'Cancellation call' : 'Service call'
      const when = b.mode === 'exact' ? `${b.day}, Nov ${b.date}, ${b.time} with ${b.va}` : b.mode === 'window' ? `best time ${b.window.toLowerCase()}` : 'the team sets the time'
      return { ...s, activity: log(s, b.who, `${what} booked: ${when}.`, 'client') }
    }),
  }), [])
}
