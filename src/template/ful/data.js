import { useSyncExternalStore, createContext, useContext, createElement } from 'react'
import { shortDate } from '../../lib/clientCheck.js'
import { instantOf, clockOf, dateOf, zoneOf, freeVa, blockTime, nextSlot, preferredWindow, windowOfMinute, minuteOf, zoneAbbr } from '../../lib/callSlots.js'
import { typeOfKind, isCallKind, callType, CALL_TYPES, RETRY_KINDS, CALLBACK_WHY } from './bookings.js'
import { draftIn } from '../../lib/clientCheck.js'
import { SUPPORT_THREAD } from '../support911.js'

// P845 — the one door to the Fulfillment (VA) side's sample info, like ../data for the agent side. Screens read only
// through the hooks below; every read returns { data, isLoading: false, error: null }, the react-query shape, so the
// backend swaps in by replacing this file (P837's real hooks: src/fulshell/useFulData.js, useVaDesk, useVaServicing,
// useFulfillmentPayouts, usePolicyMessages). Changes live in memory and reset on reload. Nothing leaves the browser.
// The sample day is Thursday, Nov 5. Pay amounts are sample amounts.

const LOAD = Date.now()
const MIN = 60e3

export const ME = { name: 'Maya Brooks', email: 'maya.brooks@example.com', phone: '(512) 555-0161', role: 'Fulfillment' }

// P854: tz = the agent's own zone; open/close = their hours on that clock (minutes); days = the weekdays they work
// (0 = Sun); appt = appointment length + buffer in minutes (null = the 30-minute default).
// P881: states = the agent's verified life-licence states (licence_verified_states); never New York.
export const AGENTS = [
  { id: 'ag-dana', name: 'Dana Walker', city: 'Austin, TX', states: ['TX', 'OK'], clients: 0, hours: 'Mon to Fri, 9:00 AM to 6:00 PM', duty: true, tz: 'America/Chicago', open: 540, close: 1080, days: [1, 2, 3, 4, 5], appt: null },
  { id: 'ag-marcus', name: 'Marcus Reed', city: 'Phoenix, AZ', states: ['AZ', 'NV', 'TX'], clients: 0, hours: 'Mon to Sat, 8:00 AM to 5:00 PM', duty: false, tz: 'America/Phoenix', open: 480, close: 1020, days: [1, 2, 3, 4, 5, 6], appt: { length: 45, buffer: 15 } },
  { id: 'ag-priya', name: 'Priya Shah', city: 'Tampa, FL', states: ['FL', 'GA'], clients: 0, hours: 'Tue to Sat, 10:00 AM to 7:00 PM', duty: true, tz: 'America/New_York', open: 600, close: 1140, days: [2, 3, 4, 5, 6], appt: null },
]
export const agentName = id => AGENTS.find(a => a.id === id)?.name || 'Agent'

// P846 — VAs do not switch themselves Active or Away. They work set hours (the carriers' hours, about 8 AM to 6 PM),
// in a rotation with two or three VAs on shift each day. Sample rota; real shifts and day-off requests are stored
// with the admin side later (a migration through Brayden's door).
// P854: tz = the VA's own zone; the shift (8 AM to 6 PM) is on that clock. Maya's follows her Settings zone.
export const VA_TZ = 'America/Chicago'
export const VAS = [
  { id: 'va-maya', name: ME.name, me: true, tz: VA_TZ },
  { id: 'va-leo', name: 'Leo Grant', tz: VA_TZ },
  { id: 'va-sasha', name: 'Sasha Ortiz', tz: VA_TZ },
  { id: 'va-devon', name: 'Devon Hale', tz: VA_TZ },
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

// P847 — auto-assign for a call an agent books at an exact time (the sample of fulfillment_pick_rep with the shift
// key on). P854: the rule lives in lib/callSlots (freeVa): the VAs on shift then and not off, minus anyone with a
// call starting under 30 minutes away, the usual VA first, else the lightest day, rota order on a tie.
const novDate = d => `2026-11-${String(d).padStart(2, '0')}`
export const atVa = (day, time) => instantOf(novDate(day), time, VA_TZ) // a sample day + team-clock time as an instant
const dayNumOf = (iso, tz) => Number(dateOf(iso, tz).slice(8))
const placed = (iso, tz) => ({ day: dayNumOf(iso, tz), time: clockOf(iso, tz) })
const SAMPLE_LOAD = { 'va-leo': 4, 'va-sasha': 5, 'va-devon': 3 }
// The rota at an instant (by the day on the team's clock), each VA with their zone and whether they're off.
export function teamOn(iso, offDays = [], meTz = VA_TZ) {
  const d = dayNumOf(iso, VA_TZ)
  return (ROTA[d] || []).map(id => { const v = VAS.find(x => x.id === id); return { ...v, tz: v.me ? meTz : v.tz, off: !!v.me && offDays.includes(d) } })
}
// Every call start a VA has: Maya's calls (not passed on) and the ones that went to other VAs.
// P907: plus every booked servicing call (extra carries them with their VA).
export const busyOf = (calls = [], extra = []) => [
  ...calls.filter(k => k.status !== 'passed').map(k => ({ id: k.id, va_id: k.va_id || 'va-maya', iso: k.iso || atVa(k.day, k.time) })),
  ...extra.map(k => ({ ...k, iso: k.iso || atVa(k.day, k.time) })),
]
export const loadOf = busy => (id, iso) => { const d = dateOf(iso, VA_TZ); return (SAMPLE_LOAD[id] || 0) + busy.filter(k => k.va_id === id && dateOf(k.iso, VA_TZ) === d).length }
export function pickVa(day, time, calls = [], extra = []) {
  const iso = atVa(day, time)
  const busy = busyOf(calls, extra)
  const load = loadOf(busy)
  const hit = freeVa({ iso, team: teamOn(iso), calls: busy, load })
  if (hit) return VAS.find(v => v.id === hit.id)
  // Nobody on shift (a weekend): the whole team, like the live pick, so nothing sits unassigned.
  const on = ROTA[day] || VAS.map(v => v.id)
  return VAS.find(v => v.id === on.slice().sort((a, b) => load(a, iso) - load(b, iso) || on.indexOf(a) - on.indexOf(b))[0])
}
export const rotaOf = day => (ROTA[day] || []).map(id => VAS.find(v => v.id === id))

// Clients across every agent this VA serves. stage = the agent side's servicing stage (../stages stageLabel).
const mkClient = (id, first, last, agent, o) => ({
  id, client_first_name: first, client_last_name: last, agent_id: agent, client_phone: '(555) 555-0100', city: 'Austin', state: 'TX',
  carrier_name: 'Mutual of Omaha', product_name: 'Term Life 20', policy_number: 'MO-4471023', monthly_premium: 64.5, stage: 'protected',
  next_step: '', submitted: 'Oct 21', attention: null, note: '', calls: [], ...o,
})
const seedClients = [
  mkClient('fc-gloria', 'Gloria', 'Santos', 'ag-dana', { client_phone: '(305) 555-0156', city: 'Miami', state: 'FL', stage: 'setting_up', next_step: 'Cancellation call today 2:00 PM', carrier_name: 'Americo', product_name: 'Mortgage Protection 25', policy_number: 'AM-2209184', monthly_premium: 88.4, note: 'Replacing an older Globe policy. Wants the old one closed the day the new one starts.', answered_in: 'afternoon',
    // P911: new policy, step 4 (the old policy's cancel call is today).
    track: { kind: 'new_policy', done: { sold: 'Oct 28', handoff: 'Oct 29', approved: 'Nov 2' }, next: 'today, 2:00 PM' } }),
  mkClient('fc-robert', 'Robert', 'Chen', 'ag-marcus', { client_phone: '(480) 555-0142', city: 'Phoenix', state: 'AZ', stage: 'protected', carrier_name: 'Foresters', product_name: 'Strong Foundation', policy_number: 'FF-7712406', monthly_premium: 52.1 }),
  mkClient('fc-luis', 'Luis', 'Ortega', 'ag-priya', { client_phone: '(813) 555-0119', city: 'Tampa', state: 'FL', stage: 'needs_attention', attention: 'Draft failed on Nov 1', next_step: 'Payment change call', carrier_name: 'Transamerica', product_name: 'Trendsetter Super 20', policy_number: 'TA-5530981', monthly_premium: 71.25, best_window: 'Evening' }),
  mkClient('fc-denise', 'Denise', 'Walker', 'ag-dana', { client_phone: '(214) 555-0171', city: 'Dallas', state: 'TX', stage: 'requests', next_step: 'Beneficiary change', carrier_name: 'Mutual of Omaha', policy_number: 'MO-4471188', monthly_premium: 47.9 }),
  mkClient('fc-harold', 'Harold', 'Nguyen', 'ag-marcus', { client_phone: '(713) 555-0188', city: 'Houston', state: 'TX', stage: 'setting_up', next_step: 'Cancellation call today 3:30 PM', carrier_name: 'Americo', policy_number: 'AM-2209377', monthly_premium: 96,
    track: { kind: 'new_policy', done: { sold: 'Oct 29', handoff: 'Oct 30', approved: 'Nov 3' }, next: 'today, 3:30 PM' } }),
  mkClient('fc-carla', 'Carla', 'Jones', 'ag-priya', { client_phone: '(404) 555-0133', city: 'Atlanta', state: 'GA', stage: 'protected', carrier_name: 'Foresters', policy_number: 'FF-7712589', monthly_premium: 39.75, draft_day: 1, check_from: '2026-05-20' }),
  mkClient('fc-renee', 'Renee', 'Ortiz', 'ag-dana', { client_phone: '(303) 555-0127', city: 'Denver', state: 'CO', stage: 'needs_attention', attention: 'Packet not delivered', next_step: 'Policy packet check', carrier_name: 'Transamerica', policy_number: 'TA-5531044', monthly_premium: 58.3 }),
  mkClient('fc-walter', 'Walter', 'Price', 'ag-marcus', { client_phone: '(602) 555-0194', city: 'Mesa', state: 'AZ', stage: 'setting_up', next_step: 'Cancellation call today 4:15 PM', carrier_name: 'Mutual of Omaha', policy_number: 'MO-4471342', monthly_premium: 61,
    track: { kind: 'new_policy', done: { sold: 'Oct 30', handoff: 'Oct 31', approved: 'Nov 3' }, next: 'today, 4:15 PM' } }),
  mkClient('fc-irene', 'Irene', 'Baker', 'ag-priya', { client_phone: '(727) 555-0109', city: 'Clearwater', state: 'FL', stage: 'protected', carrier_name: 'Americo', policy_number: 'AM-2209455', monthly_premium: 73.6 }),
  mkClient('fc-tom', 'Tom', 'Fischer', 'ag-dana', { client_phone: '(512) 555-0122', city: 'Round Rock', state: 'TX', stage: 'requests', next_step: 'Address change', carrier_name: 'Foresters', policy_number: 'FF-7712633', monthly_premium: 44.2 }),
  mkClient('fc-nadia', 'Nadia', 'Khan', 'ag-marcus', { client_phone: '(480) 555-0177', city: 'Tempe', state: 'AZ', stage: 'protected', carrier_name: 'Transamerica', policy_number: 'TA-5531102', monthly_premium: 82.9 }),
  mkClient('fc-paul', 'Paul', 'Rivera', 'ag-priya', { client_phone: '(813) 555-0165', city: 'Brandon', state: 'FL', stage: 'setting_up', next_step: 'Cancellation call Fri 10:00 AM', carrier_name: 'Mutual of Omaha', policy_number: 'MO-4471399', monthly_premium: 55.5, best_window: 'Morning', submitted: 'Nov 4',
    // P911: new policy, step 2 (the hand-off call comes first; the old policy's cancel is booked for Fri).
    track: { kind: 'new_policy', done: { sold: 'Nov 4' }, next: 'Thu, 11:00 AM' } }),
  // P885: a year-one client whose Nov 3 draft was returned (found from Dana's forwarded carrier email).
  // P891: clients Dana brought in from her own book (Add clients / Import), waiting for their welcome call.
  mkClient('fc-maria', 'Maria', 'Lopez', 'ag-dana', { added: true, client_phone: '(512) 555-0199', city: 'Austin', state: 'TX', stage: 'setting_up', next_step: 'Welcome call today', carrier_name: 'Americo', product_name: 'Mortgage Protection 25', policy_number: 'AM-1234567', monthly_premium: 84.2, face_amount: 250000, draft_day: 3, effective: 'Jun 1, 2025', email: 'maria@example.com', submitted: 'Nov 3', note: 'Prefers evenings.', best_window: 'Evening' }),
  mkClient('fc-gene', 'Gene', 'Wallace', 'ag-dana', { added: true, client_phone: '(512) 555-0131', city: 'Cedar Park', state: 'TX', stage: 'setting_up', next_step: 'Welcome call Fri', carrier_name: 'Foresters', product_name: 'Strong Foundation', policy_number: 'FF-5520881', monthly_premium: 47.6, face_amount: 120000, draft_day: 20, effective: 'Jan 1, 2024', submitted: 'Nov 3' }),
  mkClient('fc-ann', 'Ann', 'Lee', 'ag-dana', { client_phone: '(512) 555-0164', city: 'Round Rock', state: 'TX', stage: 'needs_attention', attention: 'Payment missed Nov 3', next_step: 'Save call today', carrier_name: 'Harborline Life', policy_number: 'HL-4410917', monthly_premium: 64.1, submitted: 'Jul 6', answered_in: 'morning' }),
]

// Cancellation calls: the VA calls the old carrier with the client to close the old policy once the new one is in
// force. status: booked (still to call), cancelled (done, confirmation number), no_answer, passed (given back).
// day = date in November; today is 5. The next call counts down from page load so the tile is alive.
// P854: iso = the one stored instant (seeds: the day and time on the team's clock); tz = the client's zone (callRow).
const mkCall = (id, client, day, time, o) => { const k = { id, client_id: client, day, time, status: 'booked', old_carrier: 'Globe Life', confirmation: '', notes: '', at: null, ...o }; return { ...k, iso: k.iso || atVa(k.day, k.time) } }
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

// Servicing steps the agents asked for. kind = lib/vaServicing KIND_LABEL keys; due = overdue | today | later | none.
const mkTask = (id, kind, client, o) => ({ id, kind, client_id: client, due: 'none', due_text: 'Booking…', status: 'requested', outcome: null, held: false, note: '', ...o })
const seedTasks = [
  // P907: every step that is a call with the client is booked by the system (bookTask below): the next open slot in
  // the client's preferred window. `at` = a seed fixed at a team-clock time; the rest book themselves at load.
  mkTask('st-1', 'payment_change', 'fc-luis', { note: 'Draft failed on Nov 1. Client has a new card ending 4410. Works nights: evenings are best.' }),
  mkTask('st-2', 'packet_check', 'fc-renee', { due: 'overdue', due_text: 'Was due Tue', note: 'Carrier says the packet went out Oct 28.' }),
  mkTask('st-3', 'beneficiary_change', 'fc-denise', { at: [5, '1:00 PM'], status: 'done', outcome: 'completed', note: 'Add her daughter Kayla as 50% beneficiary.' }),
  mkTask('st-4', 'address_change', 'fc-tom', { note: 'Moved to 18 Oak Hollow Dr, Round Rock.' }),
  mkTask('st-5', 'review_call', 'fc-carla', { at: [5, '5:30 PM'] }),
  mkTask('st-6', 'chargeback_watch', 'fc-harold', { due: 'later', due_text: 'Mon, Nov 9' }),
  mkTask('st-7', 'draft_date_change', 'fc-irene', { note: 'Wants the draft on the 3rd, after payday.' }),
  mkTask('st-8', 'annual_review', 'fc-nadia', { window: 'Morning', note: 'A year since her policy started. Check it still fits.' }),
  mkTask('st-9', 'packet_check', 'fc-robert', { due: 'done', due_text: 'Done Tue', status: 'done', outcome: 'delivered' }),
  mkTask('st-10', 'lapse_save', 'fc-irene', { due: 'done', due_text: 'Done Mon', status: 'done', outcome: 'saved' }),
  // P885: opened by a Payment missed event.
  mkTask('st-11', 'lapse_save', 'fc-ann', { note: 'Ann’s Nov 3 payment didn’t go through. Call her and get it fixed.',
    missed: { notice: 'missed', what: 'The Nov 3 draft was returned', due: 'Nov 3', how: 'Dana’s forwarded carrier email', grace: 'about Dec 4', chargeback: true, month: 4, of: 12, repeat: false } }),
  // P891: welcome calls for clients an agent added.
  mkTask('st-13', 'welcome_call', 'fc-maria', { note: 'Added by Dana from her own book. Introduce her client care team, check the details, ask about texts.' }),
  mkTask('st-14', 'welcome_call', 'fc-gene', { note: 'Added by Dana from her own book (import of 2 on Tue).' }),
  // P888: a lapse notice the agent passed on with Request service → payment problem.
  mkTask('st-12', 'lapse_save', 'fc-nadia', { note: 'Transamerica sent a lapse notice. Call Nadia and get the payment back on.',
    missed: { notice: 'lapse_notice', what: 'Lapse notice: the Oct 28 payment is in its grace period', due: 'Oct 28', how: 'Marcus asked (Request service)', grace: 'about Nov 27', chargeback: false, repeat: false } }),
  // P907: the hand-off call after every sale (welcome, check the details, explain who to call), even with no replacement.
  mkTask('ho-1', 'handoff_call', 'fc-paul', { note: 'Sold by Priya on Nov 4. Replacing a Globe Life policy: the cancel call is booked too.' }),
  mkTask('ho-2', 'handoff_call', 'fc-walter', { due: 'done', due_text: 'Done Wed', status: 'done', outcome: 'welcomed' }),
  // P907: a cancel request is a save attempt; a name change is a change request.
  mkTask('st-15', 'cancel_request', 'fc-robert', { note: 'Robert called in and asked to cancel: money is tight this month. Try to save it (a lower amount, a later draft date).' }),
  mkTask('st-16', 'name_change', 'fc-irene', { window: 'Morning', note: 'Got married: Irene Baker becomes Irene Cole. Carrier needs the marriage certificate.' }),
  // P907: callbacks. A missed incoming call, a text reply that needs a person, or someone who asked: each one is a
  // booked call, never a queue. who = the person when they aren't a client yet.
  mkTask('cb-1', 'callback', null, { why: 'asked', agent_id: 'ag-dana', who: { name: 'Angela Moore', phone: '(210) 555-0147', city: 'San Antonio', state: 'TX' }, window: 'Afternoon', note: 'Asked us to call back after lunch. A question about her Globe Life policy.' }),
  mkTask('cb-2', 'callback', null, { why: 'missed_call', agent_id: 'ag-marcus', who: { name: 'Owen Price', phone: '(702) 555-0119', city: 'Henderson', state: 'NV' }, note: 'Called us at 8:31 AM and nobody picked up. The system booked this callback.' }),
  mkTask('cb-3', 'callback', null, { why: 'reply', agent_id: 'ag-dana', who: { name: 'Hector Ruiz', phone: '(469) 555-0193', city: 'Plano', state: 'TX' }, note: 'Replied “yes call me” to the day-60 check-in text. The automatic answer already went.' }),
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
  // P911: Ohvara Support, pinned at the top of Messages: the admin team answers here as Ohvara Support.
  { id: SUPPORT_THREAD, support: true, client_id: null, agent_id: null, unread: 1, messages: [
    { id: 's1', from: 'support', text: 'Welcome to Ohvara Support. Anything about your shifts, pay or the app, write here. Brayden or Jordan answers, usually the same day.', at: 'Mon, 8:00 AM' },
    { id: 's2', from: 'support', text: 'Days off go through Settings › Shift. For anything else, this is the place.', at: 'Today, 8:05 AM' },
  ] },
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
  { id: 'f2', who: 'Angela Moore', text: 'Callback booked on your Schedule', at: '1:30 PM', kind: 'call' },
  { id: 'f3', who: 'Tom Fischer', text: 'Cancellation confirmed, checking now', at: '10:52 AM', kind: 'pay' },
  { id: 'f4', who: 'Priya Shah', text: 'Asked for a payment change for Luis Ortega', at: 'Wed', kind: 'servicing' },
  { id: 'f5', who: 'Robert Chen', text: 'Cancellation needs a listen', at: 'Wed', kind: 'pay' },
]

// Appointments the VA booked for agents (they land on the agent's calendar). day = date in November.
const mkBooked = (id, name, agent, day, time, o) => { const b = { id, name, agent_id: agent, day, time, type: 'Policy help', phone: '(555) 555-0100', city: 'Austin', state: 'TX', ...o }; return { ...b, iso: b.iso || atVa(b.day, b.time), tz: b.tz || zoneOf(b.state, b.city) } }
const seedBooked = [
  mkBooked('ap-1', 'Rosa Delgado', 'ag-dana', 5, '4:00 PM', { phone: '(512) 555-0138', type: 'Mortgage protection' }),
  mkBooked('ap-2', 'Ellen Park', 'ag-marcus', 6, '10:30 AM', { phone: '(480) 555-0166', city: 'Phoenix', state: 'AZ' }),
  mkBooked('ap-3', 'Hector Vega', 'ag-priya', 6, '2:30 PM', { phone: '(813) 555-0152', city: 'Tampa', state: 'FL', type: 'Mortgage protection' }),
  mkBooked('ap-4', 'June Whitfield', 'ag-dana', 9, '11:30 AM', { phone: '(214) 555-0181', city: 'Dallas' }),
]

const seedSettings = {
  profile: { name: ME.name, email: ME.email, phone: ME.phone },
  timeZone: 'America/Chicago', // P847: an IANA zone (profiles.timezone), picked in Settings; the Overview clock reads it
  payDetails: { bank: 'Chase', last4: '4821', taxEmail: ME.email, status: 'Payouts on' },
  notifications: [
    { key: 'callback', label: 'A call is booked on your Schedule', push: true, email: false },
    { key: 'call', label: 'Ten minutes before a call', push: true, email: false },
    { key: 'servicing', label: 'An agent asks for a servicing step', push: true, email: true },
    { key: 'message', label: 'An agent writes to you', push: true, email: true },
    { key: 'pay', label: 'A payout is sent', push: false, email: true },
  ],
}

let state = {
  clients: seedClients, calls: seedCalls, tasks: seedTasks, cancels: seedCancels, payouts: seedPayouts,
  threads: seedThreads, feed: seedFeed, settings: seedSettings, log: [], booked: seedBooked, dayOffs: [], live: null,
  // P847: calls that went to another VA on shift (kept so the auto-assign sees them). P854: a few seeded so the
  // 30-minute rule has something to bump into: on Thu 5 and Fri 6 everyone on shift is busy at some times.
  others: [
    { id: 'ot-1', va_id: 'va-leo', iso: atVa(5, '2:00 PM') }, { id: 'ot-2', va_id: 'va-devon', iso: atVa(5, '2:00 PM') },
    { id: 'ot-3', va_id: 'va-leo', iso: atVa(5, '4:30 PM') },
    { id: 'ot-4', va_id: 'va-sasha', iso: atVa(6, '10:00 AM') }, { id: 'ot-5', va_id: 'va-sasha', iso: atVa(6, '1:15 PM') },
  ],
}
const listeners = new Set()
const set = fn => { state = { ...state, ...fn(state) }; listeners.forEach(l => l()) }
const subscribe = fn => { listeners.add(fn); return () => listeners.delete(fn) }
const useStore = () => useSyncExternalStore(subscribe, () => state)
const ok = data => ({ data, isLoading: false, error: null })

const fullName = c => `${c.client_first_name} ${c.client_last_name}`
const clientOf = (s, id) => s.clients.find(c => c.id === id)
// A call row with its client and agent filled in.
// P854: day and time are where the call sits on the viewer's clock (Settings zone); tz is the client's; when shows both.
const viewTz = s => s.settings.timeZone || VA_TZ
const callRow = (s, k) => {
  const c = clientOf(s, k.client_id)
  const tz = k.tz || zoneOf(c.state, c.city)
  return { ...k, ...placed(k.iso, viewTz(s)), tz, when: blockTime(k.iso, viewTz(s), tz), name: fullName(c), client: c, agent: agentName(c.agent_id), carrier: c.carrier_name }
}
// P907: a person who isn't a client yet (a callback for a missed call or a text reply) reads like a client row.
const whoOf = (s, t) => clientOf(s, t.client_id) || (() => {
  const [first, ...rest] = String(t.who?.name || 'Caller').split(' ')
  return { id: null, lead: true, client_first_name: first, client_last_name: rest.join(' '), client_phone: t.who?.phone || '', city: t.who?.city || '', state: t.who?.state || '',
    agent_id: t.agent_id || null, carrier_name: '', product_name: '', policy_number: '', monthly_premium: 0, stage: 'lead' }
})()
// A servicing row with its client and agent. P907: a booked call also gets where it sits on the viewer's clock
// (day, time, when), its due group from that, and who has it.
const taskRow = (s, t) => {
  const c = whoOf(s, t)
  const row = { ...t, name: fullName(c).trim(), client: c, agent: agentName(c.agent_id || t.agent_id), carrier: c.carrier_name, type: typeOfKind(t.kind) }
  if (!t.iso) return row
  const vt = viewTz(s)
  const tz = t.tz || zoneOf(c.state, c.city) || VA_TZ
  const p = placed(t.iso, vt)
  const when = blockTime(t.iso, vt, tz)
  const done = t.status === 'done'
  const due = done ? 'done' : p.day < TODAY ? 'overdue' : p.day === TODAY ? 'today' : 'later'
  const dayText = p.day === TODAY ? 'Today' : `${DAY[p.day] || ''}, Nov ${p.day}`
  return { ...row, ...p, tz, when, due, due_text: done ? `Done ${p.day === TODAY ? 'today' : DAY[p.day] || ''}` : `${dayText}, ${when}`,
    mine: (t.va_id || 'va-maya') === 'va-maya', vaName: VAS.find(v => v.id === (t.va_id || 'va-maya'))?.name || ME.name }
}
const DAY = { 2: 'Mon', 3: 'Tue', 4: 'Wed', 5: 'Thu', 6: 'Fri', 9: 'Mon', 10: 'Tue', 11: 'Wed', 12: 'Thu', 13: 'Fri' }
export const TODAY = 5
// P854: the sample clock (1:32 PM on the team's clock): nothing can be booked before the next half hour.
export const NOW_ISO = atVa(TODAY, '2:00 PM')
export const dayName = d => DAY[d] || ''
export const RATE_PER_CANCEL = RATE

// P907 — the system books every call. The next open slot in the client's preferred window (the one picked, else the
// one they answered in before, else afternoon), on their clock, with a VA on shift who is free (lib/callSlots
// nextSlot). Seeds with `at` sit at a fixed team-clock time; every other call seed books itself here at load.
// The sample clock reads 1:32 PM; nothing books before the next half hour (NOW_ISO).
export const SAMPLE_CLOCK_ISO = atVa(TODAY, '1:32 PM')
function slotFor(s, { client, tz, window, exact = null, date = null, exceptId = null, before = null, from = NOW_ISO }) {
  const t = bookingTeam(s)
  const win = preferredWindow(window || client?.best_window, client?.answered_in)
  return nextSlot({ from, window: win, exact, date, clientTz: tz, team: t.team, calls: t.calls, load: t.load, prefer: t.me, exceptId, before })
}
function bookTask(s, t, opts = {}) {
  const c = whoOf(s, t)
  const tz = t.tz || zoneOf(c.state, c.city) || VA_TZ
  const hit = slotFor(s, { client: c, tz, window: opts.window || t.window, exact: opts.exact, date: opts.date, exceptId: t.id, from: opts.from })
  if (!hit) return t
  return { ...t, iso: hit.iso, tz, va_id: hit.va.id, window: hit.window, inWindow: hit.inWindow, status: t.status === 'requested' ? 'scheduled' : t.status, at: undefined }
}
const fixedAt = (s, t) => {
  if (!t.at) return t
  const c = whoOf(s, t)
  return { ...t, iso: atVa(t.at[0], t.at[1]), tz: zoneOf(c.state, c.city) || VA_TZ, va_id: 'va-maya', status: t.status === 'requested' ? 'scheduled' : t.status, at: undefined }
}
// Seeds book in this order (first come, first served), so Maya's sample day shows a callback, a welcome call and a
// hand-off among her calls; the rest spread over the team like the live pick.
const SEED_ORDER = ['cb-1', 'st-13', 'ho-1', 'st-15', 'st-11', 'st-16', 'st-8', 'st-4', 'st-12', 'st-1', 'st-7', 'st-14', 'cb-2', 'cb-3']
{
  const booked = new Map()
  let s = { ...state, tasks: state.tasks.map(t => fixedAt(state, t)) }
  const ids = [...SEED_ORDER, ...s.tasks.map(t => t.id).filter(id => !SEED_ORDER.includes(id))]
  ids.forEach(id => {
    const t = s.tasks.find(x => x.id === id)
    if (!t || !isCallKind(t.kind) || t.status === 'done' || t.iso) return
    const b = bookTask(s, t)
    booked.set(id, b)
    s = { ...s, tasks: s.tasks.map(x => (x.id === id ? b : x)) }
  })
  state = { ...state, tasks: s.tasks }
}
// A day after `iso` at 8:00 AM on the team clock: where a No answer's next try starts looking.
const nextDayFrom = (iso, n = 1) => { const d = new Date(Date.parse(`${dateOf(iso || NOW_ISO, VA_TZ)}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10); return instantOf(d, '8:00 AM', VA_TZ) }
// The old policy's next draft (P899's gate: cancel before it), as 8:00 AM on that date on the client's clock.
function nextDraftIso(day, tz) {
  const today = dateOf(NOW_ISO, tz)
  const y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7)) - 1
  const d = draftIn(y, m, Number(day)) >= today ? draftIn(y, m, Number(day)) : draftIn(m === 11 ? y + 1 : y, (m + 1) % 12, Number(day))
  return instantOf(d, '8:00 AM', tz)
}
// "Thu, Nov 5, 3:00 PM ET (their time)" for a booking.
export function bookedText(iso, tz) {
  if (!iso) return ''
  const day = new Date(`${dateOf(iso, tz)}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
  return `${day}, ${clockOf(iso, tz)} ${zoneAbbr(tz, iso)} (their time)`
}

function useFulClientsSample() { const s = useStore(); return ok(s.clients.map(c => ({ ...c, name: fullName(c), agent: agentName(c.agent_id) }))) }
function useFulCallsSample() { const s = useStore(); return ok(s.calls.map(k => callRow(s, k))) }
// P907: VAs never see new leads; there is no Queue. Kept empty so an old caller reads nothing, not an error.
const NO_QUEUE = ok([])
function useFulQueueSample() { return NO_QUEUE }
function useFulTasksSample() { const s = useStore(); return ok(s.tasks.map(t => taskRow(s, t))) }
function useFulThreadsSample() {
  const s = useStore()
  // P911: Ohvara Support has no client or agent.
  return ok(s.threads.map(t => { if (t.support) return { ...t, name: 'Ohvara Support', agent: 'Ohvara Support' }; const c = clientOf(s, t.client_id); return { ...t, name: fullName(c), agent: agentName(t.agent_id) } }))
}
function useFulFeedSample() { const s = useStore(); return ok(s.feed) }
function useFulSettingsSample() { const s = useStore(); return ok(s.settings) }
function useFulAgentsSample() {
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
// P851 Phase 2: the real rota (src/hooks/useVaShifts, plugged in by ./Shift so this file stays network-free for the
// node tests) wins once migration 231 is applied and a VA is signed in; until then this sample. live = real.
let useRealShift = () => null
export const plugRealShift = hook => { useRealShift = hook }
// P852: the real data door reads the same plug, so a real VA sees the rota once 231 is applied, "not set" until then.
export const usePluggedShift = () => useRealShift()
function useFulShiftSample() {
  const sample = useSampleShift()
  const real = useRealShift()
  return real ? ok(real) : sample
}
function useSampleShift() {
  const s = useStore()
  const off = d => s.dayOffs.some(o => o.day === d)
  const days = WEEKS.map(w => w.map(d => ({
    date: novDate(d), day: d, name: DOW[d], today: d === TODAY, past: d < TODAY,
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
    dayOffs: s.dayOffs.map(o => ({ ...o, date: novDate(o.day), status: 'pending' })), live: false, thisWeek: mine.filter(d => WEEKS[0].includes(d.day) && !off(d.day)).length,
  })
}

// P907 — the Schedule is booked calls only: the cancel-the-old-policy calls and every booked servicing call (hand-off,
// save, change, cancel request, callback, welcome, yearly review) that's this VA's. One row shape for all of them:
// ref = the id in its address (/fulfillment/schedule/<ref>); kind = 'call' (a cancellation call) | 'task' (a booked
// servicing call); type = bookings.js CALL_TYPES key; at = the countdown instant (the sample clock runs from load).
const isMine = x => (x.va_id || 'va-maya') === 'va-maya'
const atOf = iso => LOAD + (Date.parse(iso) - Date.parse(SAMPLE_CLOCK_ISO))
const KIND_WORD = {
  handoff_call: 'Hand-off call', lapse_save: 'Save call', payment_change: 'Bank or card change', beneficiary_change: 'Beneficiary change', address_change: 'Address change',
  draft_date_change: 'Draft date change', name_change: 'Name change', change_request: 'Change request', cancel_request: 'Cancel request', welcome_call: 'Welcome call',
  annual_review: 'Yearly review', review_call: 'Review call',
}
export const STATE_WORD = { open: 'To call', done: 'Done', no_answer: 'No answer', passed: 'Passed on' }
function scheduleOf(s) {
  const items = []
  s.calls.map(k => callRow(s, k)).forEach(k => {
    const done = k.status === 'cancelled' || k.status === 'passed'
    items.push({
      ref: k.id, id: k.id, kind: 'call', type: 'cancel_old', day: k.day, time: k.time, iso: k.iso, tz: k.tz, when: k.when, status: k.status, done,
      state: k.status === 'cancelled' ? 'done' : k.status === 'booked' ? 'open' : k.status,
      tone: done ? (k.status === 'cancelled' ? 'green' : 'mute') : k.status === 'no_answer' ? 'warn' : CALL_TYPES.cancel_old.tone,
      word: CALL_TYPES.cancel_old.label, name: k.name, label: `${k.old_carrier} to ${k.carrier}`, sub: `${k.agent}'s client`, agent: k.agent, at: atOf(k.iso), row: k,
    })
  })
  s.tasks.filter(t => t.iso && isMine(t) && isCallKind(t.kind)).map(t => taskRow(s, t)).forEach(t => {
    const done = t.status === 'done'
    const ct = callType(t.type)
    items.push({
      ref: t.id, id: t.id, kind: 'task', type: t.type, day: t.day, time: t.time, iso: t.iso, tz: t.tz, when: t.when, status: t.status, done,
      state: done ? 'done' : t.tries > 1 ? 'no_answer' : 'open', tone: done ? 'mute' : ct.tone, word: KIND_WORD[t.kind] || ct.label,
      name: t.name, label: t.kind === 'callback' ? (CALLBACK_WHY[t.why] || ct.label) : ct.sub, sub: t.client.lead ? `${t.client.city}, ${t.client.state}` : `${t.agent}'s client`,
      agent: t.agent, at: atOf(t.iso), row: t,
    })
  })
  return items.sort((a, b) => a.iso.localeCompare(b.iso))
}
function useFulScheduleSample() { const s = useStore(); return ok(scheduleOf(s)) }
// P847: who an agent's exact-time booking would go to right now (the same pick agentBooksCall makes).
function useVaForSample(day, time) { const s = useStore(); return time ? pickVa(day, time, s.calls, s.others) : null }
// P854: what a VA-call picker needs for lib/callSlots vaSlots: the rota at an instant (with days off), every VA's
// call starts (calls, the ones passed to others, booked servicing calls), the load order, the viewer's zone and "me".
export function bookingTeam(s) {
  const booked = (s.tasks || []).filter(t => t.iso && t.status !== 'done').map(t => ({ id: t.id, va_id: t.va_id || 'va-maya', iso: t.iso }))
  const busy = busyOf(s.calls, [...s.others, ...booked])
  return { team: iso => teamOn(iso, s.dayOffs.map(o => o.day), viewTz(s)), calls: busy, load: loadOf(busy), viewerTz: viewTz(s), me: 'va-maya' }
}
function useVaBookingSample() { const s = useStore(); return bookingTeam(s) }
// P854: an agent's appointments for lib/callSlots agentSlots: the ones the team booked on their calendar.
function useAgentApptsSample(agentId) { const s = useStore(); return s.booked.filter(b => b.agent_id === agentId).map(b => ({ id: b.id, iso: b.iso })) }
function useFulBookedSample() { const s = useStore(); const vt = viewTz(s); return ok(s.booked.map(b => ({ ...b, ...placed(b.iso, vt), when: blockTime(b.iso, vt, b.tz), agent: agentName(b.agent_id) }))) }
export const useFulLive = () => { const s = useStore(); return s.live }

// This week's pay: each cancel with its call, the totals, by day, and the payouts so far.
function useFulPaySample() {
  const s = useStore()
  const rows = s.cancels.map(p => { const k = s.calls.find(x => x.id === p.call); return { ...p, amount: RATE, call: callRow(s, k) } })
  const sum = st => rows.filter(r => st.includes(r.status)).reduce((t, r) => t + r.amount, 0)
  const byDay = [2, 3, 4, 5, 6].map(d => ({ day: d, name: DAY[d], verified: rows.filter(r => r.day === d && r.status === 'verified').length, checking: rows.filter(r => r.day === d && r.status !== 'verified').length, later: d > TODAY }))
  return ok({
    rate: RATE, rows, byDay, payouts: s.payouts, verified: sum(['verified']), checking: sum(['checking']), listen: rows.filter(r => r.status === 'needs_listen').length,
    earned: sum(['verified', 'checking']), payday: 'Mon, Nov 9', account: s.settings.payDetails, lastWeek: s.payouts[0].amount,
  })
}

// The page head and the Overview read these: the day in one place. P907: today = every booked call on today's
// Schedule (any type); next = the first one still to do from now; no queue (kept empty for old readers).
function useFulDaySample() {
  const s = useStore()
  const items = scheduleOf(s)
  const today = items.filter(k => k.day === TODAY)
  const ahead = today.filter(k => !k.done && k.iso >= SAMPLE_CLOCK_ISO)
  const next = ahead[0] || null
  const tasks = s.tasks.map(t => taskRow(s, t))
  return ok({
    today, next, later: ahead.slice(1), done: today.filter(k => k.done),
    tomorrow: items.filter(k => k.day === TODAY + 1),
    week: s.calls.map(k => callRow(s, k)),
    queue: { callback_due: [], new: [], not_reached: [] },
    tasks: { overdue: tasks.filter(t => t.due === 'overdue'), today: tasks.filter(t => t.due === 'today'), later: tasks.filter(t => t.due === 'later'), none: tasks.filter(t => t.due === 'none'), done: tasks.filter(t => t.due === 'done') },
    unread: s.threads.reduce((n, t) => n + t.unread, 0),
  })
}

const stamp = () => new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
const feedAdd = (s, who, text, kind) => ({ feed: [{ id: `f${Date.now()}`, who, text, at: stamp(), kind }, ...s.feed] })
// P907: a moved booking sends the client the usual confirmation text (P902's rules); the sample keeps a log.
const textMoved = (s, to, ref, iso, tz) => ({ texts: [...(s.texts || []), { at: stamp(), to, what: 'moved', ref, iso, text: `Your call with Deedstone is now ${bookedText(iso, tz).replace(' (their time)', '')}. Reply C to change it.` }] })

function useFulActionsSample() {
  return {
    // Calls
    markCall: (id, status, extra = {}) => set(s => {
      const k = s.calls.find(x => x.id === id)
      const out = { calls: s.calls.map(x => (x.id === id ? { ...x, status, ...extra } : x)) }
      // P854: Pass on hands it to a VA the 30-minute rule says is free then (extra.passed_to).
      if (status === 'passed' && extra.passed_to) out.others = [...s.others, { id: `${id}-p`, va_id: extra.passed_to, iso: k.iso }]
      if (status === 'cancelled') out.cancels = [...s.cancels, { id: `pc-${Date.now()}`, call: id, day: k.day, status: 'checking' }]
      return out
    }),
    saveCallNotes: (id, notes) => set(s => ({ calls: s.calls.map(x => (x.id === id ? { ...x, notes } : x)) })),
    // P854: Move to an instant. When the 30-minute rule gave it to another VA, it leaves this Schedule (passed to them).
    // P907: the client gets the confirmation text with the new time.
    moveCall: (id, iso, vaId = 'va-maya') => set(s => {
      const mine = vaId === 'va-maya'
      const k = s.calls.find(x => x.id === id)
      const c = clientOf(s, k.client_id)
      const calls = s.calls.map(x => (x.id === id ? { ...x, ...placed(iso, VA_TZ), iso, at: null, status: mine ? 'booked' : 'passed', passed_to: mine ? null : vaId } : x))
      const sent = textMoved(s, c.client_phone, id, iso, k.tz || zoneOf(c.state, c.city) || VA_TZ)
      return mine ? { calls, ...sent } : { calls, ...sent, others: [...s.others, { id: `${id}-m`, va_id: vaId, iso }] }
    }),
    // P907: move any booked servicing call (the same rule: another VA may end up with it, then it leaves this Schedule).
    moveTask: (id, iso, vaId = 'va-maya') => set(s => {
      const t = s.tasks.find(x => x.id === id)
      const c = whoOf(s, t)
      return { tasks: s.tasks.map(x => (x.id === id ? { ...x, iso, va_id: vaId, status: x.status === 'requested' ? 'scheduled' : x.status, inWindow: true } : x)),
        ...textMoved(s, c.client_phone, id, iso, t.tz || zoneOf(c.state, c.city) || VA_TZ) }
    }),
    // Servicing
    startTask: id => set(s => ({ tasks: s.tasks.map(t => (t.id === id ? { ...t, held: true, status: 'in_progress' } : { ...t, held: false })) })),
    putBack: id => set(s => ({ tasks: s.tasks.map(t => (t.id === id ? { ...t, held: false, status: t.status === 'in_progress' ? (t.iso ? 'scheduled' : 'requested') : t.status } : t)) })),
    // P888/P891/P907: a No answer on a call that retries books the next try by itself on the next business day, in
    // the same window (3 tries in all). Fixing it books a check-it-cleared call 3 days on.
    finishTask: (id, outcome) => set(s => {
      const t = s.tasks.find(x => x.id === id)
      const tries = (t.tries || 1) + 1
      if (RETRY_KINDS.includes(t.kind) && outcome === 'no_answer' && tries <= 3) {
        const again = bookTask(s, { ...t, held: false, status: 'scheduled', tries }, { from: nextDayFrom(t.iso) })
        return { tasks: s.tasks.map(x => (x.id === id ? again : x)) }
      }
      const done = s.tasks.map(x => (x.id === id ? { ...x, held: false, status: 'done', due: 'done', due_text: `Done ${stamp()}`, outcome } : x))
      if (t.kind === 'lapse_save' && outcome === 'fixing') {
        const check = bookTask({ ...s, tasks: done }, mkTask(`st-${Date.now()}`, 'lapse_save', t.client_id, { missed: t.missed && { ...t.missed, check: true },
          note: 'Check the fixed payment cleared. Call the client if it didn’t.' }), { from: nextDayFrom(t.iso, 3) })
        return { tasks: [...done, check] }
      }
      // P891: Problem → the agent is told (the VA's note says what). P907: the same for a hand-off call.
      if ((t.kind === 'welcome_call' || t.kind === 'handoff_call') && outcome === 'problem') {
        const c = clientOf(s, t.client_id)
        return { tasks: done, ...feedAdd(s, agentName(c.agent_id), `${t.kind === 'handoff_call' ? 'Hand-off' : 'Welcome'} call found a problem for ${fullName(c)}`, 'servicing') }
      }
      return { tasks: done }
    }),
    // P891: the text-updates question on a welcome call. Only a yes is logged as consent (p891 va_welcome_text_consent).
    textConsent: (id, yes) => set(s => {
      const t = s.tasks.find(x => x.id === id)
      return { tasks: s.tasks.map(x => (x.id === id ? { ...x, texts: yes ? 'yes' : 'no' } : x)), clients: s.clients.map(c => (c.id === t.client_id ? { ...c, sms_consent: !!yes } : c)), log: yes ? [...s.log, { at: stamp(), what: 'text_consent', task: id, client: t.client_id }] : s.log }
    }),
    sendToAgent: (id, reason) => set(s => {
      const t = s.tasks.find(x => x.id === id)
      const c = whoOf(s, t)
      return { tasks: s.tasks.filter(x => x.id !== id), ...feedAdd(s, agentName(c.agent_id || t.agent_id), `Sent back: ${reason} for ${fullName(c).trim()}`, 'servicing') }
    }),
    // P907: a missed incoming call (or a reply that needs a person) becomes a booked callback, never a queue.
    bookCallback: ({ name, phone = '', city = '', state = '', why = 'missed_call', agentId = null, clientId = null, note = '' }) => set(s => {
      const t = bookTask(s, mkTask(`cb-${Date.now()}`, 'callback', clientId, { why, agent_id: agentId, who: clientId ? null : { name, phone, city, state }, note }))
      return { tasks: [...s.tasks, t], ...feedAdd(s, name || 'Caller', `Callback booked: ${(CALLBACK_WHY[why] || 'call back').toLowerCase()}`, 'call') }
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
// P907: the sample store as it is now (tests read the bookings and the confirmation texts; nothing leaves the browser).
export const sampleState = () => state
export const sampleActions = useFulActionsSample

// P847 — an agent asks for a cancellation or service call (the agent shell calls this). P907: every call is booked by
// the system. Exact time: that time, with the VA the picker showed. A window (or "let the team set it"): the next open
// slot in that window on the client's clock. When it lands on Maya it's on her Schedule; another VA's goes to them.
// kind 'cancellation' = cancel the old policy; anything else is a booked servicing call (request = its kind, default a
// change request). Returns the VA it went to (null when nothing could be booked).
export function agentBooksCall({ who, state = 'TX', city = '', oldCarrier = 'Globe Life', kind, mode, day, time, iso = null, tz = null, vaId = null, window: win, agent = 'ag-dana', request = null }) {
  const [first, ...rest] = String(who || 'Client').split(' ')
  let va = null
  set(s => {
    const have = s.clients.find(c => fullName(c) === who && c.agent_id === agent)
    const id = have?.id || `fc-${Date.now()}`
    const client = have || mkClient(id, first, rest.join(' ') || '', agent, { state, city, stage: 'setting_up', next_step: kind === 'cancellation' ? 'Cancellation call' : 'Service call', best_window: mode === 'window' ? win : undefined })
    const s2 = have ? s : { ...s, clients: [...s.clients, client] }
    const ctz = tz || zoneOf(state, city) || VA_TZ
    let at
    if (mode === 'exact' && (iso || (day && time))) {
      // P854: the instant the picker made on the client's clock, and the VA it showed (the 30-minute rule's pick).
      at = iso || atVa(day, time)
      const t = bookingTeam(s2)
      const fit = vaId || freeVa({ iso: at, team: t.team, calls: t.calls, load: t.load })?.id
      va = fit ? VAS.find(v => v.id === fit) : pickVa(day, time, s.calls, s.others)
    } else {
      const hit = slotFor(s2, { client, tz: ctz, window: mode === 'window' ? win : null })
      if (!hit) return { ...feedAdd(s, agentName(agent), `Asked for a call with ${who}; no open time in the next two weeks`, 'servicing') }
      at = hit.iso
      va = VAS.find(v => v.id === hit.va.id)
    }
    const words = kind === 'cancellation' ? 'cancellation' : 'service'
    const out = { clients: s2.clients, ...feedAdd(s, agentName(agent), `Booked a ${words} call with ${who}: ${bookedText(at, ctz)}`, kind === 'cancellation' ? 'call' : 'servicing') }
    if (kind === 'cancellation') {
      if (!va.me) return { ...out, others: [...s.others, { id: `ot-${Date.now()}`, va_id: va.id, iso: at }] }
      const p = placed(at, VA_TZ)
      out.calls = [...s.calls, mkCall(`cl-${Date.now()}`, id, p.day, p.time, { iso: at, tz: ctz, old_carrier: oldCarrier, va_id: va.id })]
    } else {
      out.tasks = [...s.tasks, mkTask(`st-${Date.now()}`, request || 'change_request', id, { iso: at, tz: ctz, va_id: va.id, status: 'scheduled', window: windowOfMinute(minuteOf(at, ctz)), note: 'Asked for by the agent with the client on the phone.' })]
    }
    return out
  })
  return va
}

// P907 — after a sale (Submit a policy): the system books the hand-off call (always, even with no replacement:
// welcome, check the details, explain who to call) in the window the agent picked, or at the exact time they picked
// with the client. Replacing a policy also books the cancel-the-old-policy call: a day after the hand-off at the
// earliest, before the old policy's next draft when that fits (P899's gate holds the call until the new one is
// issued). Returns { handoff: { iso, tz, va }, cancel: { iso, tz, va, beforeDraft } | null }.
export function bookAfterSale({ who, phone = '', state = 'TX', city = '', carrier = '', agent = 'ag-dana', window: win = null, exact = null, replaces = null }) {
  const [first, ...rest] = String(who || 'Client').split(' ')
  const out = { handoff: null, cancel: null }
  set(s => {
    const id = `fc-${Date.now()}`
    const client = mkClient(id, first, rest.join(' ') || '', agent, { client_phone: phone, state, city, carrier_name: carrier, product_name: '', policy_number: '', monthly_premium: 0,
      stage: 'setting_up', next_step: 'Hand-off call', submitted: 'Nov 5', best_window: exact ? undefined : win })
    let s2 = { ...s, clients: [...s.clients, client] }
    const tz = exact?.tz || zoneOf(state, city) || VA_TZ
    let ho = mkTask(`ho-${Date.now()}`, 'handoff_call', id, { tz, note: `Sold by ${agentName(agent)} today. Welcome ${first}, check the details, explain who to call.${replaces ? ` Replacing ${replaces.carrier}: the cancel call is booked too.` : ''}` })
    ho = exact?.iso ? { ...ho, iso: exact.iso, va_id: exact.vaId || 'va-maya', status: 'scheduled', window: windowOfMinute(minuteOf(exact.iso, tz)) } : bookTask(s2, ho, { window: win })
    s2 = { ...s2, tasks: [...s2.tasks, ho] }
    out.handoff = ho.iso ? { iso: ho.iso, tz, va: VAS.find(v => v.id === ho.va_id), inWindow: ho.inWindow !== false } : null
    let { others, calls } = s
    if (replaces) {
      const before = replaces.draftDay ? nextDraftIso(replaces.draftDay, tz) : null
      const from = ho.iso ? new Date(Date.parse(ho.iso) + 86400000).toISOString() : NOW_ISO
      const w = ho.window || win
      const hit = slotFor(s2, { client, tz, window: w, from, before }) || slotFor(s2, { client, tz, window: w, from })
      if (hit) {
        out.cancel = { iso: hit.iso, tz, va: VAS.find(v => v.id === hit.va.id), beforeDraft: !before || hit.iso < before }
        if (hit.va.id === 'va-maya') { const p = placed(hit.iso, VA_TZ); calls = [...calls, mkCall(`cl-${Date.now()}`, id, p.day, p.time, { iso: hit.iso, tz, old_carrier: replaces.carrier, va_id: hit.va.id })] }
        else others = [...others, { id: `ot-${Date.now()}`, va_id: hit.va.id, iso: hit.iso }]
      }
    }
    return { clients: s2.clients, tasks: s2.tasks, calls, others, ...feedAdd(s, agentName(agent), `Sold a policy to ${who}. Hand-off call booked`, 'call') }
  })
  return out
}
// P910 — the agent marked a lead No show: the system books a VA re-engage call (a callback, why no_show) at the next
// open slot in the lead's best window on their clock (else afternoon), with a free VA on shift. If the lead rebooks
// from the text link first, cancelNoShowCall takes it off the Schedule. Returns { id, iso, tz, va } or null.
export function bookNoShowCall({ leadId, who, phone = '', state = 'TX', city = '', agent = 'ag-dana', window: win = null }) {
  let out = null
  set(s => {
    const t0 = mkTask(`ns-${leadId}-${Date.now()}`, 'callback', null, { why: 'no_show', lead_id: leadId, agent_id: agent, who: { name: who, phone, city, state },
      note: `Missed the booked call with ${agentName(agent)}. Book them again on ${agentName(agent).split(' ')[0]}'s calendar.` })
    const t = bookTask(s, t0, { window: win })
    out = t.iso ? { id: t.id, iso: t.iso, tz: t.tz, va: VAS.find(v => v.id === t.va_id) || null } : null
    return { tasks: [...s.tasks, t], ...feedAdd(s, who || 'Lead', `Re-engage call booked: ${CALLBACK_WHY.no_show.toLowerCase()}`, 'call') }
  })
  return out
}
export const cancelNoShowCall = leadId => set(s => ({ tasks: s.tasks.filter(t => !(t.why === 'no_show' && t.lead_id === leadId && t.status !== 'done')) }))

// P907: what Submit a policy shows before it's sent: the hand-off call the system would book for this window.
export function useAfterSalePreview({ state, city, window: win }) {
  const s = useStore()
  const tz = zoneOf(state, city)
  if (!tz) return null
  const hit = slotFor(s, { client: null, tz, window: win })
  return hit ? { ...hit, tz, text: bookedText(hit.iso, tz), vaName: VAS.find(v => v.id === hit.va.id)?.name } : null
}

// P899 — the agent said a policy is no longer on the books (the monthly check) or marked it Lapsed: the client goes
// to Working on the agent side and the VA gets a save call (lapse_save). P907: booked by the system, the next open
// slot in the client's window. Sample: the client is matched by name among this VA's clients, or added. Server: p899
// agent_books_check / agent_mark_lapsed insert the same servicing task.
export function agentOpensSaveCall({ who, why, draft = null, state = 'TX', city = '', agent = 'ag-dana' }) {
  const [first, ...rest] = String(who || 'Client').split(' ')
  set(s => {
    const have = s.clients.find(c => `${c.client_first_name} ${c.client_last_name}` === who && c.agent_id === agent)
    const id = have?.id || `fc-${Date.now()}`
    const client = have || mkClient(id, first, rest.join(' ') || '', agent, { state, city, stage: 'needs_attention', next_step: 'Save call' })
    const note = why === 'lapsed'
      ? `${agentName(agent)} marked ${first}’s policy lapsed. Call ${first} and get it back on.`
      : `${agentName(agent)} says ${first}’s policy is no longer on the books${draft ? ` (the ${shortDate(draft)} draft)` : ''}. Call ${first} and save it.`
    const clients = have ? s.clients.map(c => (c.id === id ? { ...c, stage: 'needs_attention', next_step: 'Save call' } : c)) : [...s.clients, client]
    const task = bookTask({ ...s, clients }, mkTask(`st-${Date.now()}-${id}`, 'lapse_save', id, { note, fromCheck: why }))
    return { clients, tasks: [...s.tasks, task], ...feedAdd(s, agentName(agent), why === 'lapsed' ? `Marked ${who} lapsed` : `Said ${who} is no longer on the books`, 'servicing') }
  })
}

// P852 — the switch between sample and real, like ../data (P848). Screens keep calling the hooks above; inside the VA
// portal, when the viewer's data mode is real (lib/dataMode.js), FulDataProvider hands them the real ones
// (hooks/fulRealData.js). The provider is keyed on the mode by its caller, so a page never swaps hooks mid-mount.
// Outside a provider (the /template previews, the agent shell's call pickers) everything stays sample.
const SAMPLE_STATUS = { loading: false, error: null, retry: () => {} }
// The sample calendar: Thursday, Nov 5, its two weeks (Nov 2 to 13) and the days a VA can book on.
export const SAMPLE_CLOCK = {
  real: false, tz: VA_TZ, today: TODAY, weeks: WEEKS, nowIso: NOW_ISO, bookDays: [['Thu', 5], ['Fri', 6], ['Mon', 9], ['Tue', 10], ['Wed', 11]],
  dayName, dateText: d => `Nov ${d}`, dayNum: d => d, isoOf: novDate,
}
const SAMPLE = {
  source: 'sample', useStatus: () => SAMPLE_STATUS, useClock: () => SAMPLE_CLOCK,
  useClients: useFulClientsSample, useCalls: useFulCallsSample, useQueue: useFulQueueSample, useTasks: useFulTasksSample, useThreads: useFulThreadsSample,
  useFeed: useFulFeedSample, useSettings: useFulSettingsSample, useAgents: useFulAgentsSample, useShift: useFulShiftSample, useSchedule: useFulScheduleSample,
  useBooked: useFulBookedSample, usePay: useFulPaySample, useDay: useFulDaySample, useActions: useFulActionsSample,
  useVaFor: useVaForSample, useVaBooking: useVaBookingSample, useAgentAppts: useAgentApptsSample,
}
const ImplCtx = createContext(SAMPLE)
export function FulDataProvider({ impl, children }) { return createElement(ImplCtx.Provider, { value: impl || SAMPLE }, children) }
const useImpl = () => useContext(ImplCtx)
// 'sample' or 'real': screens use it only to pick the right empty-state words and to hide the sample tags.
export const useFulSource = () => useImpl().source
export const useFulStatus = () => useImpl().useStatus()
export const useFulClock = () => useImpl().useClock()
export function useFulClients(...a) { return useImpl().useClients(...a) }
export function useFulCalls(...a) { return useImpl().useCalls(...a) }
export function useFulQueue(...a) { return useImpl().useQueue(...a) }
export function useFulTasks(...a) { return useImpl().useTasks(...a) }
export function useFulThreads(...a) { return useImpl().useThreads(...a) }
export function useFulFeed(...a) { return useImpl().useFeed(...a) }
export function useFulSettings(...a) { return useImpl().useSettings(...a) }
export function useFulAgents(...a) { return useImpl().useAgents(...a) }
export function useFulShift(...a) { return useImpl().useShift(...a) }
export function useFulSchedule(...a) { return useImpl().useSchedule(...a) }
export function useFulBooked(...a) { return useImpl().useBooked(...a) }
export function useFulPay(...a) { return useImpl().usePay(...a) }
export function useFulDay(...a) { return useImpl().useDay(...a) }
export function useFulActions(...a) { return useImpl().useActions(...a) }
export function useVaFor(...a) { return useImpl().useVaFor(...a) }
export function useVaBooking(...a) { return useImpl().useVaBooking(...a) }
export function useAgentAppts(...a) { return useImpl().useAgentAppts(...a) }
// Call tasks from incoming texts (va_lead_replies). null in sample mode: the strip keeps its own sample rows.
export const useFulCallTasks = () => { const i = useImpl(); return i.useCallTasks ? i.useCallTasks() : null }
// The live-call overlay and the real checklist drafts are screen state, not data: both modes keep them here.
const LIVE_UI = { showLive: id => set(() => ({ live: id })), hideLive: () => set(() => ({ live: null })), bump: () => set(s => ({ uiTick: (s.uiTick || 0) + 1 })) }
export const useFulSampleLive = () => LIVE_UI
export const useFulSampleUi = () => useStore().uiTick || 0
