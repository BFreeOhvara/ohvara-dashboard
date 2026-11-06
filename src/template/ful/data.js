import { useSyncExternalStore } from 'react'
import { CALL_WORD, CALL_TONE } from './words.js'

// P845 — the one door to the Fulfillment (VA) side's sample info, like ../data for the agent side. Screens read only
// through the hooks below; every read returns { data, isLoading: false, error: null }, the react-query shape, so the
// backend swaps in by replacing this file (P837's real hooks: src/fulshell/useFulData.js, useVaDesk, useVaServicing,
// useFulfillmentPayouts, usePolicyMessages). Changes live in memory and reset on reload. Nothing leaves the browser.
// The sample day is Thursday, Nov 5. Pay amounts are sample amounts.

const LOAD = Date.now()
const MIN = 60e3

export const ME = { name: 'Maya Brooks', email: 'maya.brooks@example.com', phone: '(512) 555-0161', role: 'Fulfillment' }

export const AGENTS = [
  { id: 'ag-dana', name: 'Dana Walker', city: 'Austin, TX', clients: 0, hours: 'Mon to Fri, 9:00 AM to 6:00 PM', duty: true },
  { id: 'ag-marcus', name: 'Marcus Reed', city: 'Phoenix, AZ', clients: 0, hours: 'Mon to Sat, 8:00 AM to 5:00 PM', duty: false },
  { id: 'ag-priya', name: 'Priya Shah', city: 'Tampa, FL', clients: 0, hours: 'Tue to Sat, 10:00 AM to 7:00 PM', duty: true },
]
export const agentName = id => AGENTS.find(a => a.id === id)?.name || 'Agent'

// P846 — VAs do not switch themselves Active or Away. They work set hours (the carriers' hours, about 8 AM to 6 PM),
// in a rotation with two or three VAs on shift each day. Sample rota; real shifts and day-off requests are stored
// with the admin side later (a migration through Brayden's door).
export const VAS = [
  { id: 'va-maya', name: ME.name, me: true },
  { id: 'va-leo', name: 'Leo Grant' },
  { id: 'va-sasha', name: 'Sasha Ortiz' },
  { id: 'va-devon', name: 'Devon Hale' },
]
export const SHIFT = { start: '8:00 AM', end: '6:00 PM', text: '8:00 AM to 6:00 PM' }
const ROTA = {
  2: ['va-maya', 'va-leo', 'va-sasha'], 3: ['va-leo', 'va-sasha', 'va-devon'], 4: ['va-maya', 'va-devon', 'va-sasha'],
  5: ['va-maya', 'va-leo', 'va-devon'], 6: ['va-maya', 'va-sasha'],
  9: ['va-maya', 'va-leo', 'va-devon'], 10: ['va-sasha', 'va-devon', 'va-leo'], 11: ['va-maya', 'va-sasha', 'va-devon'],
  12: ['va-maya', 'va-leo'], 13: ['va-leo', 'va-sasha', 'va-devon'],
}
export const WEEKS = [[2, 3, 4, 5, 6], [9, 10, 11, 12, 13]]
const DOW = { 2: 'Mon', 3: 'Tue', 4: 'Wed', 5: 'Thu', 6: 'Fri', 9: 'Mon', 10: 'Tue', 11: 'Wed', 12: 'Thu', 13: 'Fri' }

// Clients across every agent this VA serves. stage = the agent side's servicing stage (../stages stageLabel).
const mkClient = (id, first, last, agent, o) => ({
  id, client_first_name: first, client_last_name: last, agent_id: agent, client_phone: '(555) 555-0100', city: 'Austin', state: 'TX',
  carrier_name: 'Mutual of Omaha', product_name: 'Term Life 20', policy_number: 'MO-4471023', monthly_premium: 64.5, stage: 'protected',
  next_step: '', submitted: 'Oct 21', attention: null, note: '', calls: [], ...o,
})
const seedClients = [
  mkClient('fc-gloria', 'Gloria', 'Santos', 'ag-dana', { client_phone: '(305) 555-0156', city: 'Miami', state: 'FL', stage: 'setting_up', next_step: 'Cancellation call today 2:00 PM', carrier_name: 'Americo', product_name: 'Mortgage Protection 25', policy_number: 'AM-2209184', monthly_premium: 88.4, note: 'Replacing an older Globe policy. Wants the old one closed the day the new one starts.' }),
  mkClient('fc-robert', 'Robert', 'Chen', 'ag-marcus', { client_phone: '(480) 555-0142', city: 'Phoenix', state: 'AZ', stage: 'protected', carrier_name: 'Foresters', product_name: 'Strong Foundation', policy_number: 'FF-7712406', monthly_premium: 52.1 }),
  mkClient('fc-luis', 'Luis', 'Ortega', 'ag-priya', { client_phone: '(813) 555-0119', city: 'Tampa', state: 'FL', stage: 'needs_attention', attention: 'Draft failed on Nov 1', next_step: 'Payment change call', carrier_name: 'Transamerica', product_name: 'Trendsetter Super 20', policy_number: 'TA-5530981', monthly_premium: 71.25 }),
  mkClient('fc-denise', 'Denise', 'Walker', 'ag-dana', { client_phone: '(214) 555-0171', city: 'Dallas', state: 'TX', stage: 'requests', next_step: 'Beneficiary change', carrier_name: 'Mutual of Omaha', policy_number: 'MO-4471188', monthly_premium: 47.9 }),
  mkClient('fc-harold', 'Harold', 'Nguyen', 'ag-marcus', { client_phone: '(713) 555-0188', city: 'Houston', state: 'TX', stage: 'setting_up', next_step: 'Cancellation call today 3:30 PM', carrier_name: 'Americo', policy_number: 'AM-2209377', monthly_premium: 96 }),
  mkClient('fc-carla', 'Carla', 'Jones', 'ag-priya', { client_phone: '(404) 555-0133', city: 'Atlanta', state: 'GA', stage: 'protected', carrier_name: 'Foresters', policy_number: 'FF-7712589', monthly_premium: 39.75 }),
  mkClient('fc-renee', 'Renee', 'Ortiz', 'ag-dana', { client_phone: '(303) 555-0127', city: 'Denver', state: 'CO', stage: 'needs_attention', attention: 'Packet not delivered', next_step: 'Policy packet check', carrier_name: 'Transamerica', policy_number: 'TA-5531044', monthly_premium: 58.3 }),
  mkClient('fc-walter', 'Walter', 'Price', 'ag-marcus', { client_phone: '(602) 555-0194', city: 'Mesa', state: 'AZ', stage: 'setting_up', next_step: 'Cancellation call today 4:15 PM', carrier_name: 'Mutual of Omaha', policy_number: 'MO-4471342', monthly_premium: 61 }),
  mkClient('fc-irene', 'Irene', 'Baker', 'ag-priya', { client_phone: '(727) 555-0109', city: 'Clearwater', state: 'FL', stage: 'protected', carrier_name: 'Americo', policy_number: 'AM-2209455', monthly_premium: 73.6 }),
  mkClient('fc-tom', 'Tom', 'Fischer', 'ag-dana', { client_phone: '(512) 555-0122', city: 'Round Rock', state: 'TX', stage: 'requests', next_step: 'Address change', carrier_name: 'Foresters', policy_number: 'FF-7712633', monthly_premium: 44.2 }),
  mkClient('fc-nadia', 'Nadia', 'Khan', 'ag-marcus', { client_phone: '(480) 555-0177', city: 'Tempe', state: 'AZ', stage: 'protected', carrier_name: 'Transamerica', policy_number: 'TA-5531102', monthly_premium: 82.9 }),
  mkClient('fc-paul', 'Paul', 'Rivera', 'ag-priya', { client_phone: '(813) 555-0165', city: 'Brandon', state: 'FL', stage: 'setting_up', next_step: 'Cancellation call Fri 10:00 AM', carrier_name: 'Mutual of Omaha', policy_number: 'MO-4471399', monthly_premium: 55.5 }),
]

// Cancellation calls: the VA calls the old carrier with the client to close the old policy once the new one is in
// force. status: booked (still to call), cancelled (done, confirmation number), no_answer, passed (given back).
// day = date in November; today is 5. The next call counts down from page load so the tile is alive.
const mkCall = (id, client, day, time, o) => ({ id, client_id: client, day, time, status: 'booked', old_carrier: 'Globe Life', confirmation: '', notes: '', at: null, ...o })
const seedCalls = [
  mkCall('cl-1', 'fc-irene', 2, '10:00 AM', { status: 'cancelled', old_carrier: 'Colonial Penn', confirmation: 'CP-88231' }),
  mkCall('cl-2', 'fc-nadia', 2, '1:30 PM', { status: 'cancelled', old_carrier: 'AARP / New York Life', confirmation: 'NYL-55120' }),
  mkCall('cl-3', 'fc-carla', 3, '11:00 AM', { status: 'cancelled', old_carrier: 'Globe Life', confirmation: 'GL-301977' }),
  mkCall('cl-4', 'fc-robert', 4, '9:30 AM', { status: 'cancelled', old_carrier: 'Gerber Life', confirmation: 'GB-44019' }),
  mkCall('cl-5', 'fc-denise', 4, '3:00 PM', { status: 'no_answer', old_carrier: 'Globe Life', notes: 'Voicemail. Retry set for Fri.' }),
  mkCall('cl-6', 'fc-tom', 5, '10:30 AM', { status: 'cancelled', old_carrier: 'Lincoln Heritage', confirmation: 'LH-90812' }),
  mkCall('cl-7', 'fc-luis', 5, '11:45 AM', { status: 'no_answer', old_carrier: 'Globe Life', notes: 'No answer. Texted to pick a new time.' }),
  mkCall('cl-8', 'fc-gloria', 5, '2:00 PM', { old_carrier: 'Globe Life', at: LOAD + 28 * MIN }),
  mkCall('cl-9', 'fc-harold', 5, '3:30 PM', { old_carrier: 'Colonial Penn', at: LOAD + 118 * MIN }),
  mkCall('cl-10', 'fc-walter', 5, '4:15 PM', { old_carrier: 'AARP / New York Life', at: LOAD + 163 * MIN }),
  mkCall('cl-11', 'fc-paul', 6, '10:00 AM', { old_carrier: 'Globe Life' }),
  mkCall('cl-12', 'fc-denise', 6, '1:00 PM', { old_carrier: 'Globe Life' }),
]

// The queue: people who asked for help with a policy. bucket = callback_due | new | not_reached (lib/vaQueue).
// checklist = what the VA fills before booking an agent (question type, carrier, state, urgency).
const mkLead = (id, name, o) => ({
  id, name, phone: '(555) 555-0100', city: 'Austin', state: 'TX', type: 'Policy help', bucket: 'new', came: 'Today, 12:58 PM', tries: 0,
  callback: null, note: '', checklist: { question_type: '', carrier: '', state: '', urgency: '' }, held_until: null, ...o,
})
const seedQueue = [
  mkLead('vq-1', 'Angela Moore', { bucket: 'callback_due', callback: 'Today, 1:45 PM', tries: 1, phone: '(210) 555-0147', city: 'San Antonio', note: 'Asked us to call back after lunch.', checklist: { question_type: 'Coverage question', carrier: 'Globe Life', state: 'TX', urgency: '' } }),
  mkLead('vq-2', 'Kevin Brooks', { bucket: 'callback_due', callback: 'Today, 2:30 PM', tries: 1, phone: '(602) 555-0113', city: 'Phoenix', state: 'AZ', type: 'Mortgage protection' }),
  mkLead('vq-3', 'Shirley Adams', { came: 'Today, 1:12 PM', phone: '(904) 555-0138', city: 'Jacksonville', state: 'FL' }),
  mkLead('vq-4', 'Marcus Hill', { came: 'Today, 12:40 PM', phone: '(469) 555-0152', city: 'Plano', type: 'Mortgage protection' }),
  mkLead('vq-5', 'Teresa Lane', { came: 'Today, 11:58 AM', phone: '(520) 555-0129', city: 'Tucson', state: 'AZ' }),
  mkLead('vq-6', 'Daniel Ruiz', { came: 'Today, 10:21 AM', phone: '(727) 555-0186', city: 'St. Petersburg', state: 'FL', type: 'Mortgage protection' }),
  mkLead('vq-7', 'Brenda Cole', { bucket: 'not_reached', tries: 2, came: 'Wed, 4:05 PM', phone: '(817) 555-0174', city: 'Fort Worth' }),
  mkLead('vq-8', 'Frank Ellis', { bucket: 'not_reached', tries: 1, came: 'Wed, 2:30 PM', phone: '(480) 555-0105', city: 'Chandler', state: 'AZ' }),
  mkLead('vq-9', 'Joyce Turner', { bucket: 'not_reached', tries: 3, came: 'Tue, 6:12 PM', phone: '(352) 555-0191', city: 'Ocala', state: 'FL' }),
]

// Servicing steps the agents asked for. kind = lib/vaServicing KIND_LABEL keys; due = overdue | today | later | none.
const mkTask = (id, kind, client, o) => ({ id, kind, client_id: client, due: 'today', due_text: 'Today', status: 'requested', outcome: null, held: false, note: '', ...o })
const seedTasks = [
  mkTask('st-1', 'payment_change', 'fc-luis', { due: 'overdue', due_text: 'Was due Wed', status: 'requested', note: 'Draft failed on Nov 1. Client has a new card ending 4410.' }),
  mkTask('st-2', 'packet_check', 'fc-renee', { due: 'overdue', due_text: 'Was due Tue', note: 'Carrier says the packet went out Oct 28.' }),
  mkTask('st-3', 'beneficiary_change', 'fc-denise', { due: 'today', due_text: 'Today, 1:00 PM', status: 'scheduled', note: 'Add her daughter Kayla as 50% beneficiary.' }),
  mkTask('st-4', 'address_change', 'fc-tom', { due: 'today', due_text: 'Today, 4:00 PM', note: 'Moved to 18 Oak Hollow Dr, Round Rock.' }),
  mkTask('st-5', 'review_call', 'fc-carla', { due: 'today', due_text: 'Today, 5:00 PM', status: 'scheduled' }),
  mkTask('st-6', 'chargeback_watch', 'fc-harold', { due: 'later', due_text: 'Mon, Nov 9' }),
  mkTask('st-7', 'draft_date_change', 'fc-irene', { due: 'later', due_text: 'Tue, Nov 10', note: 'Wants the draft on the 3rd, after payday.' }),
  mkTask('st-8', 'annual_review', 'fc-nadia', { due: 'none', due_text: 'No date yet' }),
  mkTask('st-9', 'packet_check', 'fc-robert', { due: 'done', due_text: 'Done Tue', status: 'done', outcome: 'delivered' }),
  mkTask('st-10', 'lapse_save', 'fc-irene', { due: 'done', due_text: 'Done Mon', status: 'done', outcome: 'saved' }),
]

// Pay: a flat amount per cancellation the carrier confirms (sample amount). status = verified | checking | needs_listen.
const RATE = 18
const seedCancels = [
  { id: 'pc-1', call: 'cl-1', day: 2, status: 'verified' }, { id: 'pc-2', call: 'cl-2', day: 2, status: 'verified' },
  { id: 'pc-3', call: 'cl-3', day: 3, status: 'verified' }, { id: 'pc-4', call: 'cl-4', day: 4, status: 'needs_listen' },
  { id: 'pc-5', call: 'cl-6', day: 5, status: 'checking' },
]
const seedPayouts = [
  { id: 'po-1', week: 'Oct 26 to Nov 1', paid: 'Mon, Nov 2', amount: 162, count: 9, status: 'paid' },
  { id: 'po-2', week: 'Oct 19 to 25', paid: 'Mon, Oct 26', amount: 198, count: 11, status: 'paid' },
  { id: 'po-3', week: 'Oct 12 to 18', paid: 'Mon, Oct 19', amount: 144, count: 8, status: 'paid' },
  { id: 'po-4', week: 'Oct 5 to 11', paid: 'Mon, Oct 12', amount: 126, count: 7, status: 'paid' },
]

// Messages: the VA and an agent, one thread per client (the client never sees them).
const seedThreads = [
  { id: 'th-1', client_id: 'fc-gloria', agent_id: 'ag-dana', unread: 2, messages: [
    { id: 'm1', from: 'agent', text: 'Gloria wants the Globe policy closed the same day Americo starts. Can you do it on today\'s call?', at: 'Today, 9:12 AM' },
    { id: 'm2', from: 'me', text: 'Yes. Her call is at 2:00 PM. I\'ll ask Globe for an end date of Nov 5.', at: 'Today, 9:20 AM' },
    { id: 'm3', from: 'agent', text: 'Perfect. She may ask about her cash value. That one comes back to me.', at: 'Today, 9:24 AM' },
    { id: 'm4', from: 'agent', text: 'Also, her daughter may join the call.', at: 'Today, 9:25 AM' },
  ] },
  { id: 'th-2', client_id: 'fc-luis', agent_id: 'ag-priya', unread: 1, messages: [
    { id: 'm1', from: 'me', text: 'Luis didn\'t pick up at 11:45. I texted him to pick a new time.', at: 'Today, 11:52 AM' },
    { id: 'm2', from: 'agent', text: 'Thanks. He works nights, try after 4.', at: 'Today, 12:30 PM' },
  ] },
  { id: 'th-3', client_id: 'fc-denise', agent_id: 'ag-dana', unread: 0, messages: [
    { id: 'm1', from: 'agent', text: 'Denise wants to add Kayla as a beneficiary. Form is signed.', at: 'Wed, 3:02 PM' },
    { id: 'm2', from: 'me', text: 'Got it. I have the carrier call at 1:00 PM tomorrow.', at: 'Wed, 3:10 PM' },
  ] },
  { id: 'th-4', client_id: 'fc-harold', agent_id: 'ag-marcus', unread: 0, messages: [
    { id: 'm1', from: 'agent', text: 'Harold\'s old Colonial Penn policy has a rider. Make sure it all closes.', at: 'Tue, 10:40 AM' },
    { id: 'm2', from: 'me', text: 'Will do. Noted on his call for today.', at: 'Tue, 10:44 AM' },
  ] },
]

const seedFeed = [
  { id: 'f1', who: 'Dana Walker', text: 'Wrote about Gloria Santos', at: '9:25 AM', kind: 'message' },
  { id: 'f2', who: 'Angela Moore', text: 'Callback due at 1:45 PM', at: '1:30 PM', kind: 'queue' },
  { id: 'f3', who: 'Tom Fischer', text: 'Cancellation confirmed, checking now', at: '10:52 AM', kind: 'pay' },
  { id: 'f4', who: 'Priya Shah', text: 'Asked for a payment change for Luis Ortega', at: 'Wed', kind: 'servicing' },
  { id: 'f5', who: 'Robert Chen', text: 'Cancellation needs a listen', at: 'Wed', kind: 'pay' },
]

// Appointments the VA booked for agents (they land on the agent's calendar). day = date in November.
const mkBooked = (id, name, agent, day, time, o) => ({ id, name, agent_id: agent, day, time, type: 'Policy help', phone: '(555) 555-0100', city: 'Austin', state: 'TX', ...o })
const seedBooked = [
  mkBooked('ap-1', 'Rosa Delgado', 'ag-dana', 5, '4:00 PM', { phone: '(512) 555-0138', type: 'Mortgage protection' }),
  mkBooked('ap-2', 'Ellen Park', 'ag-marcus', 6, '10:30 AM', { phone: '(480) 555-0166', city: 'Phoenix', state: 'AZ' }),
  mkBooked('ap-3', 'Hector Vega', 'ag-priya', 6, '2:30 PM', { phone: '(813) 555-0152', city: 'Tampa', state: 'FL', type: 'Mortgage protection' }),
  mkBooked('ap-4', 'June Whitfield', 'ag-dana', 9, '11:30 AM', { phone: '(214) 555-0181', city: 'Dallas' }),
]

const seedSettings = {
  profile: { name: ME.name, email: ME.email, phone: ME.phone },
  timeZone: 'Central',
  payDetails: { bank: 'Chase', last4: '4821', taxEmail: ME.email, status: 'Payouts on' },
  notifications: [
    { key: 'queue', label: 'New people in the queue', push: true, email: false },
    { key: 'callback', label: 'A callback comes due', push: true, email: false },
    { key: 'call', label: 'Ten minutes before a call', push: true, email: false },
    { key: 'servicing', label: 'An agent asks for a servicing step', push: true, email: true },
    { key: 'message', label: 'An agent writes to you', push: true, email: true },
    { key: 'pay', label: 'A payout is sent', push: false, email: true },
  ],
}

let state = {
  clients: seedClients, calls: seedCalls, queue: seedQueue, tasks: seedTasks, cancels: seedCancels, payouts: seedPayouts,
  threads: seedThreads, feed: seedFeed, settings: seedSettings, log: [], booked: seedBooked, dayOffs: [], live: null,
}
const listeners = new Set()
const set = fn => { state = { ...state, ...fn(state) }; listeners.forEach(l => l()) }
const subscribe = fn => { listeners.add(fn); return () => listeners.delete(fn) }
const useStore = () => useSyncExternalStore(subscribe, () => state)
const ok = data => ({ data, isLoading: false, error: null })

const fullName = c => `${c.client_first_name} ${c.client_last_name}`
const clientOf = (s, id) => s.clients.find(c => c.id === id)
// A call row with its client and agent filled in.
const callRow = (s, k) => { const c = clientOf(s, k.client_id); return { ...k, name: fullName(c), client: c, agent: agentName(c.agent_id), carrier: c.carrier_name } }
const taskRow = (s, t) => { const c = clientOf(s, t.client_id); return { ...t, name: fullName(c), client: c, agent: agentName(c.agent_id), carrier: c.carrier_name } }
const DAY = { 2: 'Mon', 3: 'Tue', 4: 'Wed', 5: 'Thu', 6: 'Fri', 9: 'Mon', 10: 'Tue', 11: 'Wed', 12: 'Thu', 13: 'Fri' }
export const TODAY = 5
export const dayName = d => DAY[d] || ''
export const RATE_PER_CANCEL = RATE

export function useFulClients() { const s = useStore(); return ok(s.clients.map(c => ({ ...c, name: fullName(c), agent: agentName(c.agent_id) }))) }
export function useFulCalls() { const s = useStore(); return ok(s.calls.map(k => callRow(s, k))) }
export function useFulQueue() { const s = useStore(); return ok(s.queue) }
export function useFulTasks() { const s = useStore(); return ok(s.tasks.map(t => taskRow(s, t))) }
export function useFulThreads() {
  const s = useStore()
  return ok(s.threads.map(t => { const c = clientOf(s, t.client_id); return { ...t, name: fullName(c), agent: agentName(t.agent_id) } }))
}
export function useFulFeed() { const s = useStore(); return ok(s.feed) }
export function useFulSettings() { const s = useStore(); return ok(s.settings) }
export function useFulAgents() {
  const s = useStore()
  return ok(AGENTS.map(a => ({ ...a, clients: s.clients.filter(c => c.agent_id === a.id).length })))
}

// When a time text like 'Today, 4:00 PM', 'Fri, 10:00 AM' or 'Thu, Nov 5, 2:30 PM' lands on the calendar: { day, time }.
const DAY_OF = { Mon: 2, Tue: 3, Wed: 4, Thu: 5, Fri: 6 }
export function whenOf(text) {
  const m = /^(Today|Mon|Tue|Wed|Thu|Fri)(?:, Nov (\d+))?, (\d{1,2}:\d{2} [AP]M)$/.exec(String(text || '').trim())
  if (!m) return null
  return { day: m[2] ? Number(m[2]) : m[1] === 'Today' ? TODAY : DAY_OF[m[1]], time: m[3] }
}
// '3:30 PM' to minutes after midnight (the Schedule grid and its order).
export function minutesOf(time) {
  const [, h, m, ap] = /(\d+):(\d+)\s*(AM|PM)/.exec(time) || [0, 8, 0, 'AM']
  return (Number(h) % 12 + (ap === 'PM' ? 12 : 0)) * 60 + Number(m)
}

// The VA's shift and rota: today's shift, who is on with them, the two weeks of the rota, and day-off requests.
export function useFulShift() {
  const s = useStore()
  const off = d => s.dayOffs.some(o => o.day === d)
  const days = WEEKS.map(w => w.map(d => ({
    day: d, name: DOW[d], today: d === TODAY, past: d < TODAY,
    vas: (ROTA[d] || []).map(id => { const v = VAS.find(x => x.id === id); return { ...v, off: v.me && off(d) } }),
  })))
  const me = VAS.find(v => v.me)
  const mine = days.flat().filter(d => d.vas.some(v => v.me))
  const today = (ROTA[TODAY] || []).map(id => VAS.find(v => v.id === id))
  return ok({
    me, shift: SHIFT, days, mine,
    onToday: today.some(v => v.me), mates: today.filter(v => !v.me),
    // Days a VA can still ask off: their shift days after today that are not asked yet.
    askable: mine.filter(d => d.day > TODAY && !off(d.day)),
    dayOffs: s.dayOffs, thisWeek: mine.filter(d => WEEKS[0].includes(d.day) && !off(d.day)).length,
  })
}

// Everything the VA has to do at a time, in one list: cancellation calls, booked callbacks (people from the queue)
// and appointments they booked for agents. ref = the id in the item's own address (/fulfillment/schedule/<ref>).
export function useFulSchedule() {
  const s = useStore()
  const items = []
  s.calls.map(k => callRow(s, k)).forEach(k => items.push({
    ref: k.id, kind: 'call', day: k.day, time: k.time, tone: CALL_TONE[k.status], status: k.status, word: CALL_WORD[k.status],
    name: k.name, label: `${k.old_carrier} to ${k.carrier}`, sub: `${k.agent}'s client`, done: k.status === 'cancelled' || k.status === 'passed',
  }))
  s.queue.filter(l => l.bucket === 'callback_due' && whenOf(l.callback)).forEach(l => {
    const w = whenOf(l.callback)
    items.push({ ref: l.id, kind: 'callback', day: w.day, time: w.time, tone: 'warn', status: 'callback', word: 'Callback', name: l.name, label: `${l.type} · call back`, sub: `${l.city}, ${l.state}`, done: false })
  })
  s.booked.forEach(b => items.push({
    ref: b.id, kind: 'booked', day: b.day, time: b.time, tone: 'teal', status: 'booked_for', word: `Booked for ${agentName(b.agent_id).split(' ')[0]}`,
    name: b.name, label: `${b.type} · with ${agentName(b.agent_id)}`, sub: `${b.city}, ${b.state}`, done: false,
  }))
  return ok(items.sort((a, b) => a.day - b.day || minutesOf(a.time) - minutesOf(b.time)))
}
export function useFulBooked() { const s = useStore(); return ok(s.booked.map(b => ({ ...b, agent: agentName(b.agent_id) }))) }
export const useFulLive = () => { const s = useStore(); return s.live }

// This week's pay: each cancel with its call, the totals, by day, and the payouts so far.
export function useFulPay() {
  const s = useStore()
  const rows = s.cancels.map(p => { const k = s.calls.find(x => x.id === p.call); return { ...p, amount: RATE, call: callRow(s, k) } })
  const sum = st => rows.filter(r => st.includes(r.status)).reduce((t, r) => t + r.amount, 0)
  const byDay = [2, 3, 4, 5, 6].map(d => ({ day: d, name: DAY[d], verified: rows.filter(r => r.day === d && r.status === 'verified').length, checking: rows.filter(r => r.day === d && r.status !== 'verified').length, later: d > TODAY }))
  return ok({
    rate: RATE, rows, byDay, payouts: s.payouts, verified: sum(['verified']), checking: sum(['checking']), listen: rows.filter(r => r.status === 'needs_listen').length,
    earned: sum(['verified', 'checking']), payday: 'Mon, Nov 9', account: s.settings.payDetails, lastWeek: s.payouts[0].amount,
  })
}

// The page head and the Overview read these: the day in one place.
export function useFulDay() {
  const s = useStore()
  const calls = s.calls.map(k => callRow(s, k))
  const today = calls.filter(k => k.day === TODAY)
  const next = today.find(k => k.status === 'booked') || null
  const tasks = s.tasks.map(t => taskRow(s, t))
  return ok({
    today, next, later: today.filter(k => k.status === 'booked' && k.id !== next?.id), done: today.filter(k => k.status !== 'booked'),
    tomorrow: calls.filter(k => k.day === TODAY + 1),
    week: calls,
    queue: { callback_due: s.queue.filter(l => l.bucket === 'callback_due'), new: s.queue.filter(l => l.bucket === 'new'), not_reached: s.queue.filter(l => l.bucket === 'not_reached') },
    tasks: { overdue: tasks.filter(t => t.due === 'overdue'), today: tasks.filter(t => t.due === 'today'), later: tasks.filter(t => t.due === 'later'), none: tasks.filter(t => t.due === 'none'), done: tasks.filter(t => t.due === 'done') },
    unread: s.threads.reduce((n, t) => n + t.unread, 0),
  })
}

const stamp = () => new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
const feedAdd = (s, who, text, kind) => ({ feed: [{ id: `f${Date.now()}`, who, text, at: stamp(), kind }, ...s.feed] })

export function useFulActions() {
  return {
    // Queue
    holdLead: id => set(s => ({ queue: s.queue.map(l => (l.id === id ? { ...l, held_until: Date.now() + 15 * MIN } : l)) })),
    releaseLead: id => set(s => ({ queue: s.queue.map(l => (l.id === id ? { ...l, held_until: null } : l)) })),
    setChecklist: (id, checklist) => set(s => ({ queue: s.queue.map(l => (l.id === id ? { ...l, checklist } : l)) })),
    notReached: id => set(s => ({ queue: s.queue.map(l => (l.id === id ? { ...l, bucket: 'not_reached', tries: l.tries + 1, held_until: null, came: l.came } : l)) })),
    callback: (id, when) => set(s => ({ queue: s.queue.map(l => (l.id === id ? { ...l, bucket: 'callback_due', callback: when, tries: l.tries + 1, held_until: null } : l)) })),
    bookLead: (id, agentId, when) => set(s => {
      const l = s.queue.find(x => x.id === id)
      const w = whenOf(when)
      // It lands on the Schedule as an appointment booked for the agent.
      const booked = w ? [...s.booked, { id: `ap-${Date.now()}`, name: l.name, agent_id: agentId, day: w.day, time: w.time, type: l.type, phone: l.phone, city: l.city, state: l.state }] : s.booked
      return { queue: s.queue.filter(x => x.id !== id), booked, ...feedAdd(s, l.name, `Booked with ${agentName(agentId)}, ${when}`, 'queue') }
    }),
    closeLead: id => set(s => ({ queue: s.queue.filter(x => x.id !== id) })),
    // Calls
    markCall: (id, status, extra = {}) => set(s => {
      const k = s.calls.find(x => x.id === id)
      const out = { calls: s.calls.map(x => (x.id === id ? { ...x, status, ...extra } : x)) }
      if (status === 'cancelled') out.cancels = [...s.cancels, { id: `pc-${Date.now()}`, call: id, day: k.day, status: 'checking' }]
      return out
    }),
    saveCallNotes: (id, notes) => set(s => ({ calls: s.calls.map(x => (x.id === id ? { ...x, notes } : x)) })),
    moveCall: (id, day, time) => set(s => ({ calls: s.calls.map(x => (x.id === id ? { ...x, day, time, status: 'booked', at: null } : x)) })),
    // Servicing
    startTask: id => set(s => ({ tasks: s.tasks.map(t => (t.id === id ? { ...t, held: true, status: 'in_progress' } : { ...t, held: false })) })),
    putBack: id => set(s => ({ tasks: s.tasks.map(t => (t.id === id ? { ...t, held: false, status: t.status === 'in_progress' ? 'requested' : t.status } : t)) })),
    finishTask: (id, outcome) => set(s => ({ tasks: s.tasks.map(t => (t.id === id ? { ...t, held: false, status: 'done', due: 'done', due_text: `Done ${stamp()}`, outcome } : t)) })),
    scheduleTask: (id, when) => set(s => ({ tasks: s.tasks.map(t => (t.id === id ? { ...t, status: 'scheduled', due: 'later', due_text: when } : t)) })),
    sendToAgent: (id, reason) => set(s => {
      const t = s.tasks.find(x => x.id === id)
      const c = clientOf(s, t.client_id)
      return { tasks: s.tasks.filter(x => x.id !== id), ...feedAdd(s, agentName(c.agent_id), `Sent back: ${reason} for ${fullName(c)}`, 'servicing') }
    }),
    // Messages
    sendMessage: (threadId, text) => set(s => ({ threads: s.threads.map(t => (t.id === threadId ? { ...t, messages: [...t.messages, { id: `m${Date.now()}`, from: 'me', text, at: `Today, ${stamp()}` }] } : t)) })),
    readThread: threadId => set(s => ({ threads: s.threads.map(t => (t.id === threadId ? { ...t, unread: 0 } : t)) })),
    // Settings
    // Shift: a day-off request tells the team ahead of time (sample: it shows on the rota and in the bell).
    requestDayOff: (day, why) => set(s => ({ dayOffs: [...s.dayOffs, { id: `do-${Date.now()}`, day, why }], ...feedAdd(s, ME.name, `Asked for ${DOW[day]}, Nov ${day} off${why ? `: ${why}` : ''}`, 'shift') })),
    cancelDayOff: day => set(s => ({ dayOffs: s.dayOffs.filter(o => o.day !== day) })),
    // The live-call screen (an overlay): one call at a time.
    showLive: id => set(() => ({ live: id })),
    hideLive: () => set(() => ({ live: null })),
    saveSettings: patch => set(s => ({ settings: { ...s.settings, ...patch } })),
  }
}
