import { useSyncExternalStore, useMemo, createContext, useContext, createElement } from 'react'
import { instantOf, clockOf, dateOf, zoneOf } from '../../lib/callSlots.js'
import { checkLists, CHECK_DEFAULTS } from '../../lib/clientCheck.js'
import { seedEvents, applyMove, rebookLead, closeCallTask, whenLabel, needsYouNow, forYourInfo, addMin, STAGES, SAMPLE_NOW, aiRebookAt } from '../leadLifecycle.js'
import { canMove, clientCards, unsubmittedSales, followUpPick, agentStatusOf } from '../agentView.js'
import { wallOf } from '../../lib/agentReal.js'
import { leadText, SENDER } from '../leadTexts.js'
import { nightly as nightlyOf, expected, startsText, TIERS, SETUP_FEE } from '../spendPlan.js'
import { planChange, upgradeLabel, shortDate } from '../../lib/planChange.js'

// P901: sample invoices use the price book's Growth price, never a number of their own.
const GROWTH = TIERS.find(t => t.key === 'growth').monthly
import { DEFAULT_LIVE_HOURS } from '../../lib/leadSplit.js'
import { formatPhone } from '../phoneMask.js'
import { answerCheck, markLapsed } from '../../lib/clientCheck.js'
import { SUPPORT_THREAD } from '../support911.js'
import { SAMPLE_DEEDSTONE } from '../deedstone.js'

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
  mark: { first: 'Mark', last: 'Daniels', phone: '(727) 555-0114', city: 'Clearwater', state: 'FL' },
  nina: { first: 'Nina', last: 'Shah', phone: '(512) 555-0161', city: 'Round Rock', state: 'TX' },
  // P902: one lead per first-call outcome that the board didn't have yet.
  lena: { first: 'Lena', last: 'Fox', phone: '(470) 555-0124', city: 'Marietta', state: 'GA' },
  gloriap: { first: 'Gloria', last: 'Price', phone: '(214) 555-0172', city: 'Dallas', state: 'TX' },
  // P910: two live calls the agent took, one this afternoon (pinned) and one last Friday left unmarked (a to-do).
  wes: { first: 'Wes', last: 'Hart', phone: '(210) 555-0153', city: 'San Antonio', state: 'TX' },
  june: { first: 'June', last: 'Moss', phone: '(813) 555-0147', city: 'Tampa', state: 'FL' },
  ray: { first: 'Ray', last: 'Ortiz', phone: '(405) 555-0166', city: 'Norman', state: 'OK' },
  brian: { first: 'Brian', last: 'Cole', phone: '(614) 555-0139', city: 'Columbus', state: 'OH' },
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
  // P878: Dana asked a coverage question after booking: the automatic replier answered and made a call task for the agent.
  mkLead('sample-lead-1', people.dana, { stage: 'booked', fresh: true, came: '2026-11-02T10:52', apptAt: '2026-11-05T15:00', note: 'Wants coverage until the mortgage is paid off. Two kids, 9 and 12.', reply: { text: 'Does this cover my husband too? He wants to know before Thursday.', at: '2026-11-02T13:40' } }),
  mkLead('sample-lead-2', people.carla, { stage: 'missed', kind: 'live_call', came: '2026-11-02T09:08', best_time: 'Mornings' }),
  mkLead('sample-lead-3', people.harold, { stage: 'ringing', kind: 'live_call', came: '2026-11-02T14:11', age_band: '55 to 64', wants: 'Cover the mortgage so his wife keeps the house', note: 'Retiring in 4 years. Mortgage about $180,000.' }),
  mkLead('sample-lead-4', people.renee, { stage: 'no_show', came: '2026-10-29T17:40', apptAt: '2026-11-02T11:00' }),
  mkLead('sample-lead-5', people.denise, { stage: 'sold', status: 'closed', outcome: 'sold', submitted: true, came: '2026-10-24T16:05', apptAt: '2026-10-27T11:00' }),
  mkLead('sample-lead-6', people.robert, { stage: 'follow_up', status: 'contacted', outcome: 'follow_up', came: '2026-10-27T18:12', apptAt: '2026-10-30T15:00', follow: 'Mon, Nov 2', followAt: '2026-11-02T16:30' }),
  // P892: Owen was called seconds after his form came in (the agent sees the speed only).
  mkLead('sample-lead-7', people.owen, { stage: 'booked', came: '2026-10-30T12:20', apptAt: '2026-11-02T14:00', age_band: '35 to 44', speed: 9 }),
  mkLead('sample-lead-8', people.ellen, { stage: 'booked', came: '2026-10-31T09:15', apptAt: '2026-11-02T13:00', firstReply: 'Monday at 1 is good' }),
  mkLead('sample-lead-9', people.tanya, { stage: 'calling', tries: 2, came: '2026-11-01T10:30', reply: { text: 'Can you call after 6? I am at work until then.', at: '2026-11-02T13:52', seen: false } }),
  mkLead('sample-lead-10', people.paul, { stage: 'new', came: '2026-11-02T14:10', mortgage_balance_band: '$300,000 to $400,000' }),
  mkLead('sample-lead-11', people.grace, { stage: 'calling', tries: 3, came: '2026-10-29T08:40' }),
  mkLead('sample-lead-12', people.victor, { stage: 'unreachable', status: 'bad', came: '2026-07-28T19:05' }),
  mkLead('sample-lead-13', people.joan, { stage: 'opted_out', status: 'bad', came: '2026-10-28T11:00' }),
  mkLead('sample-lead-14', people.sam, { stage: 'not_interested', status: 'bad', outcome: 'not_interested', reason: 'Already covered', came: '2026-10-26T15:30', apptAt: '2026-10-29T10:00' }),
  // P878: Mark confirmed by text (the card says confirmed); Nina was sold but her servicing details aren't in yet.
  mkLead('sample-lead-15', people.mark, { stage: 'booked', came: '2026-10-31T16:20', apptAt: '2026-11-04T11:00', reply: { text: 'Yes, see you Wednesday', at: '2026-11-02T09:31' } }),
  mkLead('sample-lead-16', people.nina, { stage: 'sold', status: 'closed', outcome: 'sold', submitted: false, came: '2026-10-28T12:10', apptAt: '2026-10-30T13:00' }),
  // P902: the first call's other outcomes. Gloria said not now with a time (booked as a callback: the booking texts);
  // Lena said not now with no time (Follow up, no texts); Ray said no; Brian was a wrong number (Closed, admin's Lead
  // quality list). Only no answer and booked send texts.
  mkLead('sample-lead-17', people.gloriap, { stage: 'booked', firstCall: 'not_now', came: '2026-11-02T11:20', apptAt: '2026-11-03T17:30' }),
  mkLead('sample-lead-18', people.lena, { stage: 'follow_up', status: 'contacted', outcome: 'follow_up', firstCall: 'not_now', came: '2026-11-02T09:05', follow: 'Wed, Nov 4', followAt: '2026-11-04T16:00' }),
  mkLead('sample-lead-19', people.ray, { stage: 'not_interested', status: 'bad', outcome: 'not_interested', firstCall: 'hard_no', reason: 'Not interested on the first call', came: '2026-11-02T09:47' }),
  // P910: live calls the AI collected and the agent took. Wes: this afternoon, still to mark (pinned on Leads and the
  // Overview). June: last Friday, never marked (pinned, and a to-do since her day ended).
  mkLead('sample-lead-21', people.wes, { stage: 'showed', kind: 'live_call', came: '2026-11-02T13:41', age_band: '45 to 54', best_time: 'Evenings', wants: 'A policy that pays off the house if he dies', note: 'Married, two teens. $240,000 left on the mortgage, 22 years. Has a $50,000 policy through work.' }),
  mkLead('sample-lead-22', people.june, { stage: 'showed', kind: 'live_call', came: '2026-10-30T16:17', age_band: '55 to 64', best_time: 'Mornings', wants: 'Compare with the cover her bank offered', note: 'Widowed. Bank quoted her $96 a month. Wants it in writing.' }),
  mkLead('sample-lead-20', people.brian, { stage: 'not_interested', status: 'bad', outcome: 'not_interested', firstCall: 'wrong_number', reason: 'Wrong number', came: '2026-11-02T08:02' }),
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

// P891: a client the agent brought in (Add client / Import), not sold through Ohvara. book = added | welcomed |
// serviced | problem (lib/bookImport BOOK_STATUS). After the welcome call they're looked after like any client.
const ADDED_STAGE = { added: 'setting_up', welcomed: 'protected', serviced: 'protected', problem: 'needs_attention' }
export const welcomeSteps = (book, o = {}) => [
  { label: 'Added by you', at: o.addedAt || 'Tue, Nov 3', done: true },
  { label: 'Welcome call', at: book === 'added' ? (o.welcomeAt || 'Thu, Nov 5') : 'Wed, Nov 4', done: book !== 'added' },
  { label: 'Serviced like any client', at: book === 'serviced' ? 'Annual review set' : 'After the welcome', done: book === 'serviced' },
]
const mkAdded = (id, p, book, o) => mkClient(id, p, {
  added: true, book, stage: ADDED_STAGE[book], status: book === 'added' ? 'booked' : 'effective', submitted: 'Tue, Nov 3', annual_premium: Math.round((o.monthly_premium || 0) * 1200) / 100,
  note: book === 'added' ? 'Added by you. The team calls to welcome them and check the details.' : book === 'welcomed' ? `Welcomed Wed, Nov 4. ${o.texts ? 'Said yes to text updates.' : 'No text updates.'}` : 'Welcomed Wed, Nov 4. Serviced like any client since.',
  next_step: book === 'added' ? 'Welcome call Thu, Nov 5' : book === 'serviced' ? 'Annual review Sep 2027' : null,
  steps: welcomeSteps(book), calls: book === 'added' ? [] : [{ at: 'Wed, Nov 4, 10:40 AM', result: 'Welcomed', by: 'Fulfillment' }],
  ...o,
})

const seedClients = [
  mkClient('sample-client-1', people.gloria, { policy_number: 'SAMPLE-1001', carrier_name: 'Harborline Life', draft_day: 12, note: 'Setting up the new policy. Review call Fri, Nov 6.', next_step: 'Review call Fri, Nov 6, 4:15 PM',
    // P923: "Before our team calls": a replacement, and a note for the team.
    replacing: true, brief: { replaces: { carrier: 'Globe Life', premium: 54.2, draft_day: 3, cancel_by: 'Dec 3' }, note: 'Hard of hearing. Call her daughter Amy first.' },
    // P911: new policy, step 2 (the hand-off call is booked).
    track: { kind: 'new_policy', done: { sold: 'Oct 27' }, next: 'Fri, Nov 6, 4:15 PM' } }),
  mkClient('sample-client-2', people.luis, { policy_number: 'SAMPLE-1002', carrier_name: 'Pinecrest Assurance', stage: 'protected', status: 'effective', monthly_premium: 112, annual_premium: 1344, next_step: null, draft_day: 27, check_from: '2026-06-01', checked_through: '2026-09-27' }),
  mkClient('sample-client-3', people.robert, { policy_number: 'SAMPLE-1003', stage: 'setting_up', draft_day: 5, next_step: 'Waiting on the carrier', replacing: false, brief: { replaces: null, note: null },
    // P911: new policy, step 3 (hand-off done, waiting on the carrier's approval).
    track: { kind: 'new_policy', done: { sold: 'Oct 27', handoff: 'Oct 28' }, next: null } }),
  mkClient('sample-client-4', people.denise, { policy_number: 'SAMPLE-1004', carrier_name: 'Harborline Life', stage: 'setting_up', draft_day: 20, next_step: 'Cancel call Thu, Nov 5, 10:00 AM',
    replacing: true, brief: { replaces: { carrier: 'Colonial Penn', premium: null, draft_day: 8, cancel_by: 'Nov 8' }, note: null },
    // P911: new policy, step 4 (approved; the old policy is cancelled before its draft on the 8th).
    track: { kind: 'new_policy', done: { sold: 'Oct 26', handoff: 'Oct 27', approved: 'Oct 30' }, next: 'Thu, Nov 5, 10:00 AM · before the old draft on the 8th' } }),
  mkClient('sample-client-5', people.renee, { policy_number: 'SAMPLE-1005', carrier_name: 'Pinecrest Assurance', stage: 'requests', status: 'request_open', note: 'A change on the policy is open', next_step: 'Address change in progress', request: 'Address change in progress', draft_day: 15, check_from: '2026-04-01', checked_through: '2026-10-15',
    // P911: change request, step 2 (the call is booked). Working until it's confirmed, then back to Protected.
    track: { kind: 'change', done: { requested: 'Oct 29' }, next: 'Wed, Nov 4, 1:00 PM' } }),
  mkClient('sample-client-6', people.carla, { policy_number: 'SAMPLE-1006', stage: 'protected', status: 'effective', monthly_premium: 74.25, annual_premium: 891, next_step: null, draft_day: 27, check_from: '2026-08-03', checked_through: '2026-09-27' }),
  // P885: a missed payment in year one. The agent was warned at the first miss (Q42); the save call is the team's.
  mkClient('sample-client-7', { first: 'Ann', last: 'Lee', phone: '(512) 555-0164', city: 'Round Rock', state: 'TX' }, {
    policy_number: 'SAMPLE-1007', carrier_name: 'Harborline Life', stage: 'needs_attention', status: 'needs_attention', draft_day: 3, check_from: '2026-07-06', checked_through: '2026-10-03', monthly_premium: 64.1, annual_premium: 769.2,
    note: 'The payment due Nov 3 didn’t go through. The team is calling Ann to save it.', next_step: 'Save call by Tue 5 PM', submitted: 'Mon, Jul 6',
    missed: { due: 'Nov 3', how: 'from your forwarded carrier email', grace: 'about Dec 4', saveBy: 'Tue 5 PM Central', chargeback: true, month: 4, of: 12, repeat: false,
      progress: 'Save call opened, not reached yet', done: false, portalAction: 'The draft was returned. If Ann gives a new card, update it in the portal (the team can’t change it).' },
    steps: [
      { label: 'Sale submitted', at: 'Mon, Jul 6', done: true },
      { label: 'Packet check', at: 'Thu, Jul 9', done: true },
      { label: 'Review call', at: 'Thu, Jul 16', done: true },
      { label: 'Payment watch, month 4 of 12', at: 'Missed Nov 3', done: false },
    ],
    calls: [{ at: 'Thu, Jul 16, 11:20 AM', result: 'Answered', by: 'Fulfillment' }],
    // P911: saving the policy, step 3 (the save call is booked; the client isn't reached yet).
    track: { kind: 'save', done: { found: 'Oct 31', booked: 'Nov 1' }, next: 'Tue, Nov 3, 10:00 AM' },
  }),
  // P891: the sample import. Dana brought three of her own clients from a file on Tue, Nov 3: one waiting for the
  // welcome call, one welcomed (said yes to texts), one already serviced since.
  mkAdded('sample-client-8', { first: 'Maria', last: 'Lopez', phone: '(512) 555-0199', city: 'Austin', state: 'TX' }, 'added', { carrier_name: 'Americo', product_name: 'Mortgage Protection 25', policy_number: 'AM-1234567', monthly_premium: 84.2, face_amount: 250000, draft_day: 3, effective: 'Jun 1, 2025',
    // P911: client you added, step 2 (the welcome call is booked).
    track: { kind: 'added', done: { added: 'Nov 3' }, next: 'Thu, Nov 5, 11:00 AM' } }),
  mkAdded('sample-client-9', { first: 'Tom', last: 'Reyes', phone: '(512) 555-0122', city: 'Pflugerville', state: 'TX' }, 'welcomed', { carrier_name: 'Foresters', product_name: 'Strong Foundation', policy_number: 'FF-5521904', monthly_premium: 58.75, face_amount: 150000, draft_day: 15, effective: 'Mar 1, 2024', texts: true, check_from: '2024-03-01', checked_through: '2026-10-15' }),
  mkAdded('sample-client-10', { first: 'Lena', last: 'Brooks', phone: '(737) 555-0181', city: 'Georgetown', state: 'TX' }, 'serviced', { carrier_name: 'Mutual of Omaha', product_name: 'Term Life Express', policy_number: 'MO-3390217', monthly_premium: 41.3, face_amount: 100000, draft_day: 1, effective: 'Sep 1, 2023', texts: false, check_from: '2023-09-01', checked_through: '2026-10-01' }),
  // P899: a check due today (drafted Oct 30, asked 3 days later), and a closed client (hidden unless turned on).
  mkClient('sample-client-11', { first: 'Irene', last: 'Moss', phone: '(919) 555-0148', city: 'Cary', state: 'NC' }, { policy_number: 'SAMPLE-1011', carrier_name: 'Mutual of Omaha', stage: 'protected', status: 'effective', monthly_premium: 92.6, annual_premium: 1111.2, draft_day: 30, check_from: '2026-05-01', checked_through: '2026-09-30', submitted: 'Mon, Apr 27' }),
  mkClient('sample-client-12', { first: 'Frank', last: 'Dale', phone: '(615) 555-0177', city: 'Franklin', state: 'TN' }, { policy_number: 'SAMPLE-1012', carrier_name: 'Americo', stage: 'closed', status: 'cancelled', closed: true, monthly_premium: 0, draft_day: 9, note: 'Cancelled by the client in September. Gone for good.', submitted: 'Thu, Mar 12',
    // P911: a save that couldn't be saved ends Closed, with the reason.
    track: { kind: 'save', done: { found: 'Sep 9', booked: 'Sep 9', reached: 'Sep 10' }, closed: 'Couldn’t be saved: Frank cancelled with the carrier. He didn’t want the cover any more.' } }),
  // P911: an immediate-draft sale. Not a replacement (no old policy to cancel); the carrier approved it on the spot and
  // drafted the first payment that day. It stays Working until the hand-off call is done and that payment clears.
  mkClient('sample-client-13', { first: 'Owen', last: 'Price', phone: '(210) 555-0137', city: 'San Antonio', state: 'TX' }, { policy_number: 'SAMPLE-1013', carrier_name: 'Americo', stage: 'setting_up', draft_day: 30, monthly_premium: 0, annual_premium: 0, submitted: 'Fri, Oct 30',
    note: 'Immediate draft: the first payment came out the day of the sale.', next_step: 'Hand-off call Tue, Nov 3, 11:00 AM',
    track: { kind: 'new_policy', done: { sold: 'Oct 30', approved: 'Oct 30' }, skip: ['old_cancel'], next: 'Tue, Nov 3, 11:00 AM', immediate: true } }),
]

const seedThreads = [
  // P911: Ohvara Support, pinned at the top of Messages: the admin team (Brayden and Jordan) answers here as Ohvara
  // Support. It can't be deleted or hidden. Matches Dana's line in admin Messages.
  { id: SUPPORT_THREAD, support: true, client_id: null, name: 'Ohvara Support', unread: 1, messages: [
    { id: 's1', from: 'team', text: 'Welcome to Ohvara Support. Anything about your account, billing or leads, write here. Brayden or Jordan answers, usually the same day.', at: 'Mon, Oct 26, 9:00 AM' },
    { id: 's2', from: 'me', text: 'Can I take more live transfers next week? I have Tuesday and Thursday open.', at: 'Mon, Nov 2, 10:02 AM' },
    { id: 's3', from: 'team', text: 'Got it. We’ll look at your hours and come back to you today.', at: 'Mon, Nov 2, 10:20 AM' }] },
  { id: 'thread-1', client_id: 'sample-client-1', name: 'Gloria Santos', unread: 1, messages: [
    { id: 'm1', from: 'team', text: 'Gloria’s packet is in. Her review call is Fri, Nov 6 at 4:15 PM your time.', at: 'Fri, Oct 30, 5:44 PM' },
    { id: 'm2', from: 'me', text: 'Great, thank you.', at: 'Fri, Oct 30, 6:02 PM' },
    { id: 'm3', from: 'team', text: 'We texted her a reminder for Friday.', at: 'Mon, Nov 2, 9:15 AM' }] },
  { id: 'thread-2', client_id: 'sample-client-3', name: 'Robert Chen', unread: 0, messages: [
    { id: 'm4', from: 'team', text: 'Robert is booked for his review call on Thursday at 3:00 PM your time.', at: 'Wed, Oct 28, 3:00 PM' }] },
  { id: 'thread-3', client_id: 'sample-client-5', name: 'Renee Ortiz', unread: 2, messages: [
    { id: 'm5', from: 'team', text: 'Renee asked to change her mailing address. We are on it.', at: 'Mon, Nov 2, 11:20 AM' },
    { id: 'm6', from: 'team', text: 'The carrier needs a signed form. We will send it to her today.', at: 'Mon, Nov 2, 1:05 PM' }] },
]

const seedActivity = [
  { id: 'a0', at: 'Today, 9:40 AM', kind: 'client', who: 'Ann Lee', text: 'Chargeback risk: the Harborline payment due Nov 3 didn’t go through. Save call opened, due Tue 5 PM.' },
  { id: 'a1', at: 'Today, 2:06 PM', kind: 'text', who: 'Gloria Santos', text: 'The team texted Gloria a reminder for her review call.' },
  { id: 'a2', at: 'Today, 1:05 PM', kind: 'client', who: 'Renee Ortiz', text: 'Address change request sent to the carrier.' },
  { id: 'a3', at: 'Today, 11:30 AM', kind: 'lead', who: 'Dana Example', text: 'New lead assigned to you. Appointment booked for Thu, Nov 5.' },
  { id: 'a4', at: 'Today, 9:12 AM', kind: 'call', who: 'Carla Jones', text: 'Missed live call. The team is booking her a time right away.' },
  { id: 'a5', at: 'Fri, Oct 30', kind: 'moved', who: 'Robert Chen', text: 'Moved to Follow up for Mon, Nov 2.' },
  { id: 'a6', at: 'Yesterday, 11:02 AM', kind: 'client', who: 'Luis Ortega', text: 'Policy is now protected.' },
  { id: 'a7', at: 'Fri, Oct 30', kind: 'call', who: 'Gloria Santos', text: 'Packet check done. Review call set for Fri, Nov 6.' },
  { id: 'a8', at: 'Fri, Oct 30', kind: 'lead', who: 'Denise Walker', text: 'Sold. Ready to submit for servicing.' },
]

const seedAppointments = [
  { id: 'ap1', day: 'Mon', date: 2, time: '3:30 PM', who: 'Gloria Santos', label: 'Packet check call', kind: 'client', ref: 'sample-client-1' },
  { id: 'ap2', day: 'Mon', date: 2, time: '1:00 PM', who: 'Ellen Park', label: 'Appointment', kind: 'lead', ref: 'sample-lead-8' },
  { id: 'ap3', day: 'Mon', date: 2, time: '11:00 AM', who: 'Renee Ortiz', label: 'Appointment', kind: 'lead', ref: 'sample-lead-4' },
  { id: 'ap8', day: 'Mon', date: 2, time: '2:00 PM', who: 'Owen Price', label: 'Appointment', kind: 'lead', ref: 'sample-lead-7' },
  { id: 'ap4', day: 'Thu', date: 5, time: '3:00 PM', who: 'Dana Example', label: 'Appointment', kind: 'lead', ref: 'sample-lead-1' },
  { id: 'ap5', day: 'Thu', date: 5, time: '4:00 PM', who: 'Robert Chen', label: 'Review call', kind: 'client', ref: 'sample-client-3' },
  { id: 'ap6', day: 'Fri', date: 6, time: '2:00 PM', who: 'Luis Ortega', label: 'Check-in call', kind: 'client', ref: 'sample-client-2' },
  { id: 'ap7', day: 'Fri', date: 6, time: '4:15 PM', who: 'Gloria Santos', label: 'Review call', kind: 'client', ref: 'sample-client-1' },
  { id: 'ap9', day: 'Wed', date: 4, time: '10:00 AM', who: 'Mark Daniels', label: 'Appointment', kind: 'lead', ref: 'sample-lead-15' },
  // P910: a follow-up is the agent's own call, on their calendar.
  { id: 'ap10', day: 'Mon', date: 2, time: '4:30 PM', who: 'Robert Chen', label: 'Follow-up call', kind: 'lead', ref: 'sample-lead-6' },
  { id: 'ap11', day: 'Wed', date: 4, time: '4:00 PM', who: 'Lena Fox', label: 'Follow-up call', kind: 'lead', ref: 'sample-lead-18' },
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
// P923: each past week is [label, booked, live calls]; the chart shows delivered (booked + live).
const WEEKS_BEFORE = [['Aug 3', 5, 3], ['Aug 10', 6, 3], ['Aug 17', 5, 4], ['Aug 24', 7, 4], ['Aug 31', 6, 3], ['Sep 7', 5, 4], ['Sep 14', 8, 4], ['Sep 21', 7, 3], ['Sep 28', 8, 5], ['Oct 5', 7, 4], ['Oct 12', 6, 5], ['Oct 19', 8, 4], ['Oct 26', 8, 4]]
const SAMPLE_AGENTS = {
  established: { days: 98, weeks: WEEKS_BEFORE },
  new: { days: 21, weeks: [['Oct 12', 4, 2], ['Oct 19', 6, 3], ['Oct 26', 7, 4]] },
  first: { days: 5, weeks: [] },
  empty: { days: 0, weeks: [], none: true },
}
const sampleAgent = () => {
  const k = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('agent') : null
  return SAMPLE_AGENTS[k] || SAMPLE_AGENTS.established
}
// P878: preview the paid plan with ?plan=paid, no card with ?card=none (P909), a declined nightly charge with ?billing=failed.
const param = k => (typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get(k) : null)
const WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
export const DEFAULT_WEEK = Object.fromEntries(WEEK.map(d => [d, { on: !['Sat', 'Sun'].includes(d), start: '9:00 AM', end: d === 'Fri' ? '5:00 PM' : '6:00 PM' }]))
const seed = {
  leads: seedLeads, clients: seedClients, threads: seedThreads, activity: seedActivity, appointments: seedAppointments,
  tasks: { t1: false, t2: false, t3: false },
  // P878: Talk to someone requests (N-I-01), feedback on the team (N-F-43), blocked days (N-C-38), setup progress (N-H-05).
  talks: [], feedback: [], blocks: [], setup: null,
  settings: {
    profile: { name: 'Dana Whitfield', email: 'dana.whitfield@example.com', phone: '(214) 555-0100', plan: 'Growth plan' },
    hours: { start: '9:00 AM', end: '6:00 PM', days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'] },
    // P878: hours per weekday on the agent's confirmed zone; the calendar link (busy times both ways); the licence.
    week: DEFAULT_WEEK, zoneConfirmed: true,
    calendarSync: { provider: null, status: 'not_connected' },
    // P848: the states the agent picked (3 to 10, never NY) and the one tick, logged with its time and the states.
    licence: { states: ['AZ', 'FL', 'GA', 'TX'], licensed: { at: 'Oct 12, 9:14 AM', states: ['AZ', 'FL', 'GA', 'TX'] } },
    // P847: the Overview clock's zone (profiles.timezone values). P916: agents call through Deedstone (their phone
    // rings first, the client sees Deedstone Insurance); the phone for that lives in template/deedstone.js.
    timeZone: 'America/Chicago',
    // P885: the forwarding address for carrier missed-payment emails, and what happened to the last few.
    paymentIntake: {
      address: 'pay+k7m2q9xd4a@in.ohvara.com',
      // P890: the one-minute forwarding step. mail = gmail | outlook | other; tested = a test email arrived.
      forward: { mail: 'gmail', tested: false },
      recent: [
        { id: 'pe-1', subject: 'Fwd: Lapse pending notice', at: 'Today, 9:38 AM', client: 'Ann Lee', status: 'matched' },
        { id: 'pe-2', subject: 'Fwd: Returned EFT', at: 'Wed, Nov 4', client: null, status: 'unmatched' },
        { id: 'pe-3', subject: 'Fwd: Payment received, thank you', at: 'Mon, Nov 2', client: 'Luis Ortega', status: 'paid_notice' },
      ],
    },
    notifications: [
      { key: 'lead', label: 'New lead', push: true, email: true },
      { key: 'appt', label: 'Appointment reminders', push: true, email: false },
      { key: 'msg', label: 'Messages from the team', push: true, email: true },
      { key: 'client', label: 'Client needs you', push: true, email: true },
      { key: 'payment_missed', label: 'A client missed a payment (chargeback risk)', push: true, email: true },
      { key: 'portal_action_needed', label: 'Something to do in a carrier portal', push: true, email: true },
      { key: 'weekly', label: 'Your week, every Monday', push: true, email: true },
    ],
  },
  // cancellations: the old cancellation plan, shown only for an agent already on one (this sample agent is not).
  // P878/P914: one way to pay, from day one: a plan by daily spend + lead spend + 12% (no pilot). P909: prices are final
  // (price book v3) and lead spend is charged each night for the next day; nights = the last charges (spend charged,
  // what the ads spent; today's isn't in yet). ?billing=failed: last night's card was declined. P889: one daily spend + how they take leads (take); bought = what the spend
  // bought this week and this month, booked and transferred apart. ?take=appts previews Appointments only.
  billing: {
    plan: 'paid', products: 'both',
    spend: { daily: 100 }, pending: null,
    // P921: the plan is saved (it no longer follows the spend). planMonth = this billing month (Nov 1 to Dec 1; the
    // sample's today is Nov 2). planNext = a scheduled move down ({ key, on }); ?plan=down previews one to Starter.
    // upgradeFailed = the last upgrade was declined (nothing changed); ?upgrade=declined makes the next upgrade decline.
    tier: 'growth', planMonth: { today: '2026-11-02', start: '2026-11-01', next: '2026-12-01' },
    planNext: param('plan') === 'down' ? { key: 'starter', on: 'Tue, Dec 1' } : null, upgradeFailed: null,
    take: { mode: param('take') === 'appts' ? 'appts' : 'both', hours: DEFAULT_LIVE_HOURS, tz: 'America/Chicago' },
    // P923: live = live calls that reached the agent this week (bought.week.transferred); delivered = booked + live.
    booked: sampleAgent().none ? 0 : 4, live: sampleAgent().none ? 0 : 2, usual: 5,
    nightly: {
      // P910: one paid day ahead. Today (Mon) and tomorrow (Tue) are paid; tonight charges the day after tomorrow
      // (Wed). ?billing=failed: last night's charge for Tue was declined, so Tue runs no ads unless it's paid first.
      at: 'Tonight, 8 PM', today: 'Mon, Nov 2', tomorrow: 'Tue, Nov 3', forDay: 'Wed, Nov 4',
      nights: [
        { day: 'Sat, Oct 31', spend: 100, delivered: 100, status: 'paid' },
        { day: 'Sun, Nov 1', spend: 100, delivered: 96, status: 'paid' },
        { day: 'Mon, Nov 2', spend: 100, delivered: null, status: 'paid' },
        { day: 'Tue, Nov 3', spend: 100, delivered: null, status: param('billing') === 'failed' ? 'failed' : 'paid' },
      ],
    },
    card: { label: 'Visa ending 4242', brand: 'Visa', last4: '4242', exp: '08/28', onFile: param('card') !== 'none' },
    founding: { no: 7, until: 'Nov 8, 2027' }, setupPaid: 'Mon, Sep 28',
    // P917: past charges (Billing shows tonight's on top): nightly lead spend + 12%, the monthly plan, the setup fee.
    charges: [
      { id: 'ch1', at: 'Sun, Nov 1, 8 PM', label: 'Lead spend for Tue, Nov 3', kind: 'lead', amount: 112, spend: 100, fee: 12, status: param('billing') === 'failed' ? 'declined' : 'paid' },
      { id: 'ch2', at: 'Sun, Nov 1', label: 'Plan, Growth, November', kind: 'plan', amount: GROWTH, status: 'paid' },
      { id: 'ch3', at: 'Sat, Oct 31, 8 PM', label: 'Lead spend for Mon, Nov 2', kind: 'lead', amount: 112, spend: 100, fee: 12, status: 'paid' },
      { id: 'ch4', at: 'Fri, Oct 30, 8 PM', label: 'Lead spend for Sun, Nov 1', kind: 'lead', amount: 112, spend: 100, fee: 12, status: 'paid' },
      { id: 'ch5', at: 'Thu, Oct 29, 8 PM', label: 'Lead spend for Sat, Oct 31', kind: 'lead', amount: 107.52, spend: 96, fee: 11.52, status: 'paid' },
      { id: 'ch6', at: 'Thu, Oct 1', label: 'Plan, Growth, October', kind: 'plan', amount: GROWTH, status: 'paid' },
      { id: 'ch7', at: 'Mon, Sep 28', label: 'Setup fee, one time', kind: 'setup', amount: SETUP_FEE, status: 'paid' },
    ],
    clients: { total: 38, sold: 26, added: 12 },
    bought: {
      week: { spent: 500, leads: 16, reached: 13, booked: 4, offered: 3, transferred: 2, showed: 2, sold: 2, premium: 1927.8 },
      month: { spent: 2200, leads: 67, reached: 53, booked: 18, offered: 12, transferred: 9, showed: 11, sold: 7, premium: 7395 },
    },
    saved: [{ id: 's1', who: 'Luis Ortega', what: 'Card declined. The team updated the payment with the carrier', at: 'Oct 21', premium: 112 }, { id: 's2', who: 'Carla Jones', what: 'Asked to cancel. The team kept the policy', at: 'Oct 9', premium: 74.25 }],
    paused: null, cancel: null,
    payment: { card: 'Visa ending 4242', failed: param('billing') === 'failed' },
    next_charge: 'Tonight, 8 PM', nextBill: 'Tue, Dec 1',
    servicing: { status: 'active', next: 'Tue, Dec 1' }, cancellations: null,
    history: param('plan') === 'paid'
      ? [{ id: 'inv0', at: 'Sun, Nov 1, 8 PM', label: 'Lead spend for Tue, Nov 3', amount: 112 }, { id: 'inv1', at: 'Sun, Nov 1', label: 'Plan, Growth, November', amount: GROWTH }, { id: 'inv2', at: 'Sat, Oct 31, 8 PM', label: 'Lead spend for Mon, Nov 2', amount: 112 }, { id: 'inv3', at: 'Thu, Oct 1', label: 'Plan, Growth, October', amount: GROWTH }]
      : [{ id: 'inv1', at: 'Sun, Nov 1, 8 PM', label: 'Lead spend for Tue, Nov 3', amount: 100 }, { id: 'inv2', at: 'Sat, Oct 31, 8 PM', label: 'Lead spend for Mon, Nov 2', amount: 100 }, { id: 'inv3', at: 'Fri, Oct 30, 8 PM', label: 'Lead spend for Sun, Nov 1', amount: 100 }],
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

function useLeadsSample() { const s = useStore(); return ok(s.leads) }
function useLeadSample(id) { const s = useStore(); return ok(s.leads.find(l => l.id === id) || s.leads[0]) }
// P918: Clients shows clients with a draft date only (agentView.js clientCards), worked out once per store change.
let clientsMemo = { clients: null, leads: null, out: [] }
const clientsOf = s => {
  if (clientsMemo.clients !== s.clients || clientsMemo.leads !== s.leads) clientsMemo = { clients: s.clients, leads: s.leads, out: clientCards(s.clients) }
  return clientsMemo.out
}
function useClientsSample() { const s = useStore(); return ok(clientsOf(s)) }
function useClientSample(id) { const s = useStore(); const all = clientsOf(s); return ok(all.find(c => c.id === id) || all[0]) }
function useAppointmentsSample() { const s = useStore(); return ok(s.appointments) }
function useThreadsSample() { const s = useStore(); return ok(s.threads) }
function useActivitySample() { const s = useStore(); return ok(s.activity) }
// P924: one set of hours. The hours in Settings are when the agent takes booked calls AND live calls, so take follows them.
function useBillingSample() { const s = useStore(); return ok(useMemo(() => billingView({ ...s.billing, take: oneHours(s.settings) }, s.submitted), [s.billing, s.submitted, s.settings])) }
export const oneHours = st => ({ mode: 'both', hours: st.week, tz: st.timeZone || 'America/Chicago' })
// P878: the billing record plus what's worked out from it (P909: tonight's charge and the credit, the week's range).
function billingView(b, submitted) {
  const n = nightlyOf(b.nightly, b.spend, b.plan)
  return { ...b, submitted, nightNow: n, payment: { ...b.payment, failed: b.payment.failed || n.failed }, expected: expected(b.spend, b.take?.mode), servicing: { ...b.servicing, status: b.products === 'leads' ? 'off' : 'active' } }
}
// Billing items that need the agent (N-K-01): a declined card (tomorrow's leads are off), no card on file.
function billingNeeds(b) {
  const out = []
  if (b.payment.failed || nightlyOf(b.nightly, b.spend, b.plan).failed) out.push({ key: 'failed', title: 'Card declined', name: 'Fix your card', what: 'Tomorrow is paid and still runs. The day after brings no new leads unless it’s paid first. We try again at 8 AM.', when: 'Now' })
  if (b.card && !b.card.onFile && b.products !== 'servicing') out.push({ key: 'card', title: 'No card on file', name: 'Add a card', what: 'Your leads start once a card is on file. We charge your first two days, then one day ahead each night.', when: 'Now' })
  return out
}
function useTalksSample() { const s = useStore(); return ok(s.talks) }
function useFeedbackSample() { const s = useStore(); return ok(s.feedback) }
function useBlocksSample() { const s = useStore(); return ok(s.blocks) }
function useSetupSample() { const s = useStore(); return ok(s.setup) }
// P941: the agent's own launch checks (their setup progress; the Setup ticket's words). Sample: signed up Oct 26,
// every check passed, leads live since Nov 4.
const SAMPLE_LAUNCH = {
  agentRef: 'DS-SAMP', lead: 'live', states: ['LA', 'OK', 'TX'], launchState: 'on', paid: { on: 'Mon, Oct 26', short: 'Oct 26', days: 2 },
  signup: { tier: 'growth', dailyCents: 10000, paidCents: 202200, setupCents: 29900, planCents: 149900, leadCents: 22400, paidOn: 'Mon, Oct 26', paidShort: 'Oct 26',
    tz: 'America/Chicago', hours: [1, 2, 3, 4, 5].map(weekday => ({ weekday, start: '09:00', end: '17:00' })), live: true },
  launch: { linkRef: 'DS-SAMP', campaignId: '120210000880', campaignRef: 'DS-SAMP', testLead: { at: 'Tue, Nov 3, 2:10 PM', matchedRef: 'DS-SAMP', by: 'link' },
    licence: true, hours: '9:00 AM', tz: 'America/Chicago', card: 'Visa •••• 4242', app: { installed: true, pushAnswered: true }, testCall: { at: 'Tue, Nov 3, 2:14 PM', by: 'AI' } },
}
function useLaunchSample() { return ok(SAMPLE_LAUNCH) }
function useSettingsSample() { const s = useStore(); return ok(s.settings) }
// P910: Your to-dos (calls to mark, the monthly check) and, apart, billing notices (a declined card: Fix card).
function useNeedsSample() { const s = useStore(); return ok(useMemo(() => ({ now: needsYouNow({ leads: s.leads, checks: checkLists(clientsOf(s), SAMPLE_NOW.slice(0, 10), CHECK_DEFAULTS), toSubmit: unsubmittedSales(s.leads, s.clients) }, SAMPLE_NOW), fyi: forYourInfo(s), notices: billingNeeds(s.billing) }), [s])) }
function useSignupSample() {
  return useMemo(() => ok({
    covers: ['Booked appointments and live calls, at a daily spend you set', 'A team that calls every lead right away and books them on your calendar', 'Servicing that keeps your policies on the books', 'Your own portal and phone app'],
  }), [])
}
// The sample clock is fixed at Monday, November 2, 2:14 PM, like the frame.
const NOW = { label: 'Monday, November 2', time: '2:14', ampm: 'PM', min: 14 * 60 + 14, date: 2 }
const minutesOf = t => { const m = /(\d+):(\d+)\s*(AM|PM)/.exec(t); return ((Number(m[1]) % 12) + (m[3] === 'PM' ? 12 : 0)) * 60 + Number(m[2]) }
const untilText = t => { const d = minutesOf(t) - NOW.min; return d <= 0 ? 'now' : `in ${d >= 60 ? `${Math.floor(d / 60)} h ` : ''}${d % 60} min` }
const LEAD_NEW = ['booked', 'ringing', 'missed']

// First 2 weeks: day by day this week. 2 to 8 weeks: week by week since joining. 8+ weeks: the last 8 weeks.
// points: [label, value, upcoming]. prev: last week's total, or null when there was no last week.
// P923: the value is Delivered (booked appointments + live calls that reached the agent), not booked alone.
function bookedChart(thisWeek) {
  const a = sampleAgent()
  const delivered = a.none ? 0 : thisWeek
  if (a.days < 14) {
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
    return { mode: 'days', range: 'This week, day by day', empty: delivered === 0, prev: null,
      points: days.map((d, i) => [d, i === 0 ? delivered : 0, i > 0]) }
  }
  const all = [...a.weeks.map(([w, b, l]) => [w, b + (l || 0)]), ['Nov 2', delivered]]
  const weeks = a.days < 56 ? all : all.slice(-8)
  return { mode: 'weeks', range: a.days < 56 ? 'Since you joined' : 'Last 8 weeks', empty: false, prev: all.length > 1 ? all[all.length - 2][1] : null, points: weeks }
}

function useOverviewSample() {
  const s = useStore()
  const open = Object.values(s.tasks).filter(v => !v).length
  const by = st => clientsOf(s).filter(c => c.stage === st).length
  return ok({
    name: 'Dana', book: { protected: by('protected'), settingUp: by('setting_up'), needsAttention: by('needs_attention'), requestsOpen: by('requests') },
    stepsOpen: open,
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
    // P844: the "Delivered this week" chart (P923) picks its range from how long the agent has been on Ohvara
    bookedChart: bookedChart(s.billing.booked + (s.billing.live || 0)),
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

// P848: the week the Calendar and Overview draw (Mon to Fri): the sample week of Nov 2, or the real current week.
// days: [weekday, day of month, month]; today: today's day of month (null if outside the week); time: now on the clock.
const SAMPLE_WEEK = { days: [['Mon', 2, 'Nov'], ['Tue', 3, 'Nov'], ['Wed', 4, 'Nov'], ['Thu', 5, 'Nov'], ['Fri', 6, 'Nov']], today: 2, time: '2:14 PM', year: 2026, month: 11 }
export const weekTools = w => ({
  ...w, nums: w.days.map(d => d[1]),
  nameOf: n => w.days.find(d => d[1] === n)?.[0] || '',
  monOf: n => w.days.find(d => d[1] === n)?.[2] || '',
  isoOf: n => { const d = w.days.find(x => x[1] === n); return d ? d[3] || `${w.year}-${String(w.month).padStart(2, '0')}-${String(n).padStart(2, '0')}` : null },
})
function useWeekSample() { return SAMPLE_WEEK }

const stamp = 'Today, 2:14 PM'
const soldToClient = l => {
  const sold = l.stage === 'sold' ? l : applyMove(l, 'sold', {}, SAMPLE_NOW)
  return { ...sold, submitted: true, events: [...sold.events, { id: `${l.id}-c${sold.events.length + 1}`, kind: 'became_client', at: SAMPLE_NOW, label: 'Submitted for servicing. Now a client', state: 'done', by: 'You', role: 'you' }] }
}
const log = (s, who, text, kind) => [{ id: `a${s.activity.length + 1}-${text.length}`, at: stamp, kind, who, text }, ...s.activity]

// '2026-11-02T14:14' -> '2:14 PM'
const clockOfWall = w => { const [h, m] = w.slice(11, 16).split(':').map(Number); return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}` }
// P910: the agent's follow-up slot (agentView.js followUpPick) on the sample clock, hours and calendar.
const followUpFor = (s, lead, { date = null, time = null } = {}) => followUpPick(lead, { appts: s.appointments, settings: s.settings, date, time, now: SAMPLE_NOW })

function useActionsSample() {
  return useMemo(() => ({
    // P894: only the results the lead's status allows (agentView.js AGENT_RESULTS); anything else changes nothing.
    // P910: Follow up books the agent's call: the day and time they picked (extra.date + extra.time), or the system's
    // pick (the lead's best window, else afternoon, 30 minutes clear of other calls), on their calendar.
    moveLead: (id, stage, extra = {}) => set(s => {
      const lead = s.leads.find(l => l.id === id)
      if (!lead || !canMove(lead, stage)) return s
      if (stage === 'follow_up') {
        const slot = extra.slotIso ? { iso: extra.slotIso, picked: !extra.followAuto } : followUpFor(s, lead, extra)
        if (!slot) return s
        const tz = s.settings.timeZone || AGENT_TZ
        const followAt = wallOf(slot.iso, tz)
        const { day, date, time } = onAgentClock(slot.iso, tz)
        const moved = applyMove(lead, 'follow_up', { follow: whenLabel(followAt), followAt, followAuto: !slot.picked }, SAMPLE_NOW)
        const appt = { id: `fu-${id}-${Date.now()}`, day, date, time, iso: slot.iso, tz: zoneOf(lead.state, lead.city), who: `${lead.first_name} ${lead.last_name}`, label: 'Follow-up call', kind: 'lead', ref: id }
        return { ...s, leads: s.leads.map(l => (l.id === id ? moved : l)), appointments: [...s.appointments.filter(a => !(a.ref === id && a.label === 'Follow-up call')), appt],
          activity: log(s, appt.who, `Follow up${slot.picked ? '' : ' booked for you'}: ${whenLabel(followAt)}. They get a reminder the day before and that morning.`, 'moved') }
      }
      return { ...s, leads: s.leads.map(l => (l.id === id ? applyMove(l, stage, extra, SAMPLE_NOW) : l)), activity: log(s, `${lead.first_name} ${lead.last_name}`, `Moved to ${STAGES[stage].label}.`, 'moved') }
    }),
    // P878: nobody texts a lead by hand. A call task from the automatic replier closes when the agent calls back.
    callBack: id => set(s => ({ ...s, leads: s.leads.map(l => (l.id === id ? closeCallTask(l, SAMPLE_NOW) : l)) })),
    // "Ask our team to call": a call task for the team, on the timeline.
    askTeamToCall: (id, why) => set(s => {
      const lead = s.leads.find(l => l.id === id)
      const row = { id: `${id}-t${lead.events.length + 1}`, kind: 'call_task', at: SAMPLE_NOW, label: `You asked our team to call${why ? `: ${why.toLowerCase()}` : ''}`, state: 'done', by: 'You', role: 'you', task: 'team' }
      return { ...s, leads: s.leads.map(l => (l.id === id ? { ...l, events: [...l.events, row] } : l)), activity: log(s, `${lead.first_name} ${lead.last_name}`, 'You asked our team to call.', 'call') }
    }),
    // No-show with a short Undo (N-C-45): the lead keeps a copy of itself until the rebook text goes.
    // P931: a no-show is an unsold lead, so the AI caller (not a VA) calls to book them again, same rules as speed to
    // lead, right after the short Undo. Undo stops it; so does the lead rebooking from the link first.
    markNoShow: id => {
      const lead = state.leads.find(l => l.id === id)
      if (!lead || !canMove(lead, 'no_show')) return
      set(s => {
        const aiCall = { at: aiRebookAt(SAMPLE_NOW) }
        return { ...s, leads: s.leads.map(l => (l.id === id ? { ...applyMove(l, 'no_show', { aiCall }, SAMPLE_NOW), aiCall, undo: { ...l, undo: null } } : l)),
          activity: log(s, `${lead.first_name} ${lead.last_name}`, 'No show. Rebook link sent, and our AI caller calls to book them again.', 'moved') }
      })
    },
    // P894: they picked a new time from the one-tap link: back to Booked (the rebook page or the team does this, not the agent).
    // P910: back on the same agent's calendar; P931: the AI rebook call stops. apptAt = the agent's
    // clock; none = the next open time in the lead's window (the sample "they picked a time" button).
    rebookLead: (id, apptAt) => {
      const lead = state.leads.find(l => l.id === id)
      if (!lead || !['no_show', 'rebooking'].includes(lead.stage)) return
      const tz = state.settings.timeZone || AGENT_TZ
      const slot = apptAt ? { iso: instantOf(apptAt.slice(0, 10), clockOfWall(apptAt), tz) } : followUpFor(state, lead, {})
      if (!slot?.iso) return
      set(s => {
        const at = wallOf(slot.iso, tz)
        const { day, date, time } = onAgentClock(slot.iso, tz)
        const appt = { id: `rb-${id}-${Date.now()}`, day, date, time, iso: slot.iso, tz: zoneOf(lead.state, lead.city), who: `${lead.first_name} ${lead.last_name}`, label: 'Appointment', kind: 'lead', ref: id }
        return { ...s, leads: s.leads.map(l => (l.id === id ? { ...rebookLead(l, at, SAMPLE_NOW), aiCall: null } : l)), appointments: [...s.appointments.filter(a => !(a.ref === id && a.label === 'Appointment')), appt],
          activity: log(s, appt.who, `Picked a new time: ${whenLabel(at)}. Back on Booked.`, 'moved') }
      })
    },
    undoNoShow: id => { set(s => ({ ...s, leads: s.leads.map(l => (l.id === id && l.undo ? { ...l.undo, events: [...l.undo.events, { id: `${id}-u${l.events.length + 1}`, kind: 'outcome', at: SAMPLE_NOW, label: 'Undid the no-show. No text went out', state: 'done', by: 'You', role: 'you', audit: true }] } : l)) })) },
    sendNoShowText: id => set(s => ({ ...s, leads: s.leads.map(l => (l.id === id && l.undo ? { ...l, undo: null, events: l.events.map(e => (e.step === 'no_show_link' && e.state === 'scheduled' ? { ...e, label: 'Text', state: 'done' } : e)) } : l)) })),
    // Follow up: an automatic text with a link to book on the agent's calendar (N-D-22).
    sendBookingLink: id => set(s => {
      const lead = s.leads.find(l => l.id === id)
      const row = { id: `${id}-b${lead.events.length + 1}`, kind: 'text_sent', step: 'booking_link', at: SAMPLE_NOW, label: 'Booking link', state: 'done', text: leadText('booking_link', { lead: lead.first_name }), by: SENDER, role: 'auto' }
      return { ...s, leads: s.leads.map(l => (l.id === id ? { ...l, linkSent: true, events: [...l.events, row] } : l)), activity: log(s, `${lead.first_name} ${lead.last_name}`, 'Booking link sent. They pick a time on your calendar.', 'text') }
    }),
    // The agent can't make an appointment: an automatic apology and a rebook link; it comes off the calendar (N-C-36).
    cantMakeIt: apptId => set(s => {
      const a = s.appointments.find(x => x.id === apptId)
      const lead = s.leads.find(l => l.id === a?.ref)
      if (!a || !lead) return s
      const rows = [
        { id: `${lead.id}-x${lead.events.length + 1}`, kind: 'outcome', at: SAMPLE_NOW, label: `You can't make ${a.day} ${a.time}`, state: 'done', by: 'You', role: 'you' },
        { id: `${lead.id}-x${lead.events.length + 2}`, kind: 'text_sent', step: 'cant_make_it', at: SAMPLE_NOW, label: 'Text', state: 'done', text: leadText('cant_make_it', { lead: lead.first_name, appt: `${a.day} at ${a.time}` }), by: SENDER, role: 'auto' },
        { id: `${lead.id}-x${lead.events.length + 3}`, kind: 'va_call', at: addMin(SAMPLE_NOW, 120), label: 'Calls to rebook if they have not picked a time', state: 'scheduled', by: 'Maya, Fulfillment', role: 'team' },
      ]
      return { ...s, appointments: s.appointments.filter(x => x.id !== apptId), leads: s.leads.map(l => (l.id === lead.id ? { ...l, stage: 'rebooking', dbStage: STAGES.rebooking.db, appt: null, apptAt: null, events: [...l.events, ...rows] } : l)), activity: log(s, a.who, `You can't make ${a.day} ${a.time}. They got an apology and a link to pick a new time.`, 'moved') }
    }),
    // Hours or a blocked day that clash with booked appointments: Keep them, or Move them (rebook links go out).
    blockDay: (day, moves) => set(s => {
      const moved = s.appointments.filter(a => a.day === day && moves.includes(a.id))
      return { ...s, blocks: [...s.blocks.filter(b => b !== day), day], appointments: s.appointments.filter(a => !moved.some(m => m.id === a.id)), leads: s.leads.map(l => (moved.some(m => m.ref === l.id) ? { ...l, stage: 'rebooking', dbStage: STAGES.rebooking.db, appt: null, apptAt: null } : l)), activity: log(s, 'Your calendar', `${day} blocked${moved.length ? `. ${moved.length} moved: they got a link to pick a new time` : ''}.`, 'moved') }
    }),
    unblockDay: day => set(s => ({ ...s, blocks: s.blocks.filter(b => b !== day) })),
    moveAppts: ids => set(s => {
      const moved = s.appointments.filter(a => ids.includes(a.id))
      return { ...s, appointments: s.appointments.filter(a => !ids.includes(a.id)), leads: s.leads.map(l => (moved.some(m => m.ref === l.id) ? { ...l, stage: 'rebooking', dbStage: STAGES.rebooking.db, appt: null, apptAt: null } : l)), activity: moved.length ? log(s, 'Your calendar', `${moved.length} appointment${moved.length > 1 ? 's' : ''} moved. They got a link to pick a new time.`, 'moved') : s.activity }
    }),
    saveWeek: week => set(s => ({ ...s, settings: { ...s.settings, week, hours: { ...s.settings.hours, days: Object.keys(week).filter(d => week[d].on) } } })),
    connectCalendar: provider => set(s => ({ ...s, settings: { ...s.settings, calendarSync: provider ? { provider, status: 'sample' } : { provider: null, status: 'not_connected' } } })),
    saveLicence: licence => set(s => ({ ...s, settings: { ...s.settings, licence } })),
    // Talk to someone (N-I-01): a call request for admin, with a promised time the agent sees.
    talk: req => set(s => ({ ...s, talks: [{ id: `talk-${s.talks.length + 1}`, at: 'Today, 2:14 PM', status: 'Requested', promised: req.when === 'Now' ? 'We call you by 2:45 PM today' : `We call you ${req.when.toLowerCase()}`, ...req }, ...s.talks] })),
    // Feedback on the team (N-F-43), linked to the lead; admin answers in the app.
    // It opens a thread in Messages with Ohvara, so the answer lands where the agent already reads the team.
    sendFeedback: fb => set(s => ({
      ...s,
      feedback: [{ id: `fb-${s.feedback.length + 1}`, at: 'Today, 2:14 PM', status: 'Sent to Ohvara', reply: null, ...fb }, ...s.feedback],
      threads: [{ id: `thread-fb-${s.feedback.length + 1}`, client_id: null, lead_id: fb.leadId, name: `Ohvara · feedback on ${fb.who}`, unread: 0, messages: [{ id: `fbm-${s.feedback.length + 1}`, from: 'me', text: `${fb.mood === 'good' ? 'Praise' : 'To fix'} · ${fb.about}: ${fb.text}`, at: stamp }, { id: `fbm-${s.feedback.length + 1}-r`, from: 'team', text: 'Thanks, we got it. An admin answers here, usually the same day.', at: stamp }] }, ...s.threads],
    })),
    // Lead spend (N-A-23): a change starts at midnight; a tier change starts with the next bill.
    setSpend: spend => set(s => ({ ...s, billing: { ...s.billing, pending: { spend, starts: startsText('Wed, Nov 4') }, spend } })),
    // P921: Change plan. Up: the prorated difference is charged now (sample: paid, or declined with ?upgrade=declined:
    // nothing changes); the plan and band change once it's paid. Down: from the next bill. Back to the plan they're
    // on: Undo a scheduled move down. Returns what happened, for the note.
    changePlan: (toKey, daily) => {
      let out = null
      set(s => {
        const b = s.billing
        const m = b.planMonth
        const tiers = TIERS.map(t => ({ ...t, monthly_cents: Math.round(t.monthly * 100) }))
        const c = planChange({ tiers, fromKey: b.tier, toKey, today: m.today, nextBill: m.next, monthStart: m.start, pending: b.planNext })
        out = c
        if (c.direction === 'undo' || c.direction === 'same') return { ...s, billing: { ...b, planNext: null } }
        if (c.direction === 'down') return { ...s, billing: { ...b, planNext: { key: toKey, on: b.nextBill || shortDate(m.next) } } }
        if (c.direction !== 'up') return s
        const row = { id: `ch-up-${(b.charges || []).length + 1}`, at: 'Today', label: upgradeLabel(c.to.label, c.left), kind: 'plan', amount: c.chargeCents / 100 }
        if (param('upgrade') === 'declined') {
          out = { ...c, result: 'failed' }
          return { ...s, billing: { ...b, upgradeFailed: { to: c.to.label, amount: c.chargeCents / 100 }, charges: [{ ...row, status: 'declined' }, ...(b.charges || [])] } }
        }
        out = { ...c, result: 'paid' }
        return { ...s, billing: { ...b, tier: toKey, planNext: null, upgradeFailed: null, spend: { daily: daily ?? b.spend.daily }, charges: [{ ...row, status: 'paid' }, ...(b.charges || [])] } }
      })
      return out
    },
    undoPlanChange: () => set(s => ({ ...s, billing: { ...s.billing, planNext: null } })),
    // P889: how they take leads (mode + live-call hours). Starts at midnight like a spend change.
    setTake: take => set(s => ({ ...s, billing: { ...s.billing, take } })),
    addCard: () => set(s => ({ ...s, billing: { ...s.billing, card: { label: 'Visa ending 4242', brand: 'Visa', last4: '4242', exp: '08/28', onFile: true } } })),
    setProducts: products => set(s => ({ ...s, billing: { ...s.billing, products } })),
    pause: p => set(s => ({ ...s, billing: { ...s.billing, paused: p } })),
    resume: () => set(s => ({ ...s, billing: { ...s.billing, paused: null } })),
    cancelPlan: c => set(s => ({ ...s, billing: { ...s.billing, cancel: c } })),
    keepPlan: () => set(s => ({ ...s, billing: { ...s.billing, cancel: null } })),
    fixCard: () => set(s => ({ ...s, billing: { ...s.billing, upgradeFailed: null, payment: { ...s.billing.payment, failed: false }, charges: (s.billing.charges || []).map(c => (c.status === 'declined' ? { ...c, status: 'paid' } : c)),
      nightly: { ...s.billing.nightly, nights: s.billing.nightly.nights.map(x => (x.status === 'failed' ? { ...x, status: 'paid' } : x)) } } })),
    saveSetup: patch => set(s => ({ ...s, setup: { ...(s.setup || {}), ...patch } })),
    addLeadNote: (id, text) => set(s => ({ ...s, leads: s.leads.map(l => (l.id === id ? { ...l, note: l.note ? `${l.note}\n${text}` : text } : l)) })),
    doneTask: id => set(s => ({ ...s, tasks: { ...s.tasks, [id]: true } })),
    clientAction: (id, action) => set(s => {
      const c = s.clients.find(x => x.id === id)
      return { ...s, clients: s.clients.map(x => (x.id === id ? { ...x, note: action } : x)), activity: log(s, fullName(c), action, 'client') }
    }),
    // P899: the monthly "Still on the books?" check. yes/no = client ids, draft = the draft date asked about. No and
    // Lapsed go to Working (the screen opens the VA's save call, ful/data agentOpensSaveCall).
    answerChecks: ({ yes = [], no = [], draft }) => set(s => {
      const names = ids => ids.map(id => s.clients.find(c => c.id === id)).filter(Boolean).map(fullName)
      const said = [yes.length && `${names(yes).join(', ')}: still on the books`, no.length && `${names(no).join(', ')}: no longer on the books. Our team is calling to save ${no.length === 1 ? 'it' : 'them'}`].filter(Boolean).join('. ')
      return { ...s, clients: s.clients.map(c => (yes.includes(c.id) ? answerCheck(c, draft, true) : no.includes(c.id) ? answerCheck(c, draft, false) : c)), activity: log(s, yes.length + no.length === 1 ? names([...yes, ...no])[0] : `${yes.length + no.length} clients`, `${said}.`, 'client') }
    }),
    markLapsed: (id, today) => set(s => {
      const c = s.clients.find(x => x.id === id)
      return c ? { ...s, clients: s.clients.map(x => (x.id === id ? markLapsed(x, today) : x)), activity: log(s, fullName(c), 'Marked lapsed. Our team is calling to get it back on.', 'client') } : s
    }),
    sendMessage: (threadId, text) => set(s => ({ ...s, threads: s.threads.map(t => (t.id === threadId ? { ...t, unread: 0, messages: [...t.messages, { id: `m${t.messages.length + 10}-${text.length}`, from: 'me', text, at: stamp }] } : t)) })),
    readThread: threadId => set(s => ({ ...s, threads: s.threads.map(t => (t.id === threadId ? { ...t, unread: 0 } : t)) })),
    // P868: form is lib submitModel buildSubmission (phone in E.164; booking = the call booked with it, or null).
    // P873: a sale picked from one of the agent's leads (form.linked) moves that lead to Sold and makes it a client.
    submitSale: form => set(s => ({ ...s, submitted: s.submitted + 1, sales: [...(s.sales || []), form], leads: form.linked?.kind === 'lead' ? s.leads.map(l => (l.id === form.linked.id ? soldToClient(l) : l)) : s.leads, activity: log(s, form.name || 'New client', form.booking ? `Sale submitted for servicing. Call booked for ${form.booking.time} (their time)${form.booking.va ? ` with ${form.booking.va}` : ''}.` : 'Sale submitted for servicing.', 'client') })),
    // P891: clients the agent brought in (rows = lib/bookImport checkRow(...).row, only the ok ones). Each is Added
    // with a welcome call on the team's list; big imports spread over days (sample: 25 a day).
    addClients: rows => set(s => {
      const days = ['Thu, Nov 5', 'Fri, Nov 6', 'Mon, Nov 9', 'Tue, Nov 10', 'Wed, Nov 11']
      const made = rows.map((r, i) => {
        const welcomeAt = days[Math.min(days.length - 1, Math.floor(i / 25))]
        // P899: only name, phone, city, state, carrier, draft day (+ premium, notes) are asked for now.
        return mkAdded(`added-${Date.now()}-${i}`, { first: r.first_name, last: r.last_name, phone: formatPhone(r.phone), city: r.city || '', state: r.state }, 'added', {
          carrier_name: r.carrier, product_name: null, policy_number: null, monthly_premium: r.monthly_premium || 0,
          face_amount: null, draft_day: r.draft_day, effective: null, email: null, notes: r.notes,
          submitted: 'Today', next_step: `Welcome call ${welcomeAt}`, steps: welcomeSteps('added', { addedAt: 'Today', welcomeAt }),
        })
      })
      const who = rows.length === 1 ? `${rows[0].first_name} ${rows[0].last_name}` : `${rows.length} clients`
      return { ...s, clients: [...made, ...s.clients], billing: { ...s.billing, clients: { ...s.billing.clients, added: s.billing.clients.added + made.length, total: s.billing.clients.total + made.length } }, activity: log(s, who, `${rows.length === 1 ? 'Added' : `${rows.length} clients added`} by you. The team calls to welcome ${rows.length === 1 ? 'them' : 'each one'}${rows.length > 25 ? ', 25 a day' : ''}.`, 'client') }
    }),
    submitRequest: form => set(s => ({ ...s, activity: log(s, form.name || 'Client', `Service request sent: ${form.kind}.`, 'client') })),
    // P885 (sample): a new forwarding address; the old one stops (rotate_my_payment_intake_address).
    rotateIntake: () => set(s => ({ ...s, settings: { ...s.settings, paymentIntake: { ...s.settings.paymentIntake, address: `pay+${Math.random().toString(36).slice(2, 12).padEnd(10, '0')}@in.ohvara.com` } } })),
    setNotification: (key, field, on) => set(s => ({ ...s, settings: { ...s.settings, notifications: s.settings.notifications.map(n => (n.key === key ? { ...n, [field]: on } : n)) } })),

    // P854: iso = the instant picked on the client's clock, tz = the client's zone; day/date/time land on the agent's clock.
    bookCall: ({ ref, kind, who, iso, tz, label, clientText }) => set(s => {
      const { day, date, time } = onAgentClock(iso, s.settings.timeZone || AGENT_TZ)
      return { ...s, appointments: [...s.appointments, { id: `ap${s.appointments.length + 1}-${Date.now()}`, day, date, time, iso, tz, who, label, kind, ref }], activity: log(s, who, `${label} booked for ${day}, Nov ${date}, ${time}${clientText ? ` (${clientText})` : ''}.`, kind === 'lead' ? 'lead' : 'client') }
    }),

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

// P848 — the switch between sample and real. Screens keep calling useSample*; inside the agent portal, when the
// viewer's data mode is real (lib/dataMode.js), DataProvider hands them the real ones (hooks/agentRealData.js).
// The provider is keyed on the mode by its caller, so a page never swaps hooks mid-mount.
const SAMPLE_STATUS = { loading: false, error: null, retry: () => {} }
const SAMPLE = {
  source: 'sample', now: SAMPLE_NOW, useWeek: useWeekSample, useStatus: () => SAMPLE_STATUS,
  useLeads: useLeadsSample,
  useLead: useLeadSample,
  useClients: useClientsSample,
  useClient: useClientSample,
  useAppointments: useAppointmentsSample,
  useThreads: useThreadsSample,
  useActivity: useActivitySample,
  useBilling: useBillingSample,
  useTalks: useTalksSample,
  useFeedback: useFeedbackSample,
  useBlocks: useBlocksSample,
  useSetup: useSetupSample,
  useLaunch: useLaunchSample,
  useSettings: useSettingsSample,
  useNeeds: useNeedsSample,
  useSignup: useSignupSample,
  useOverview: useOverviewSample,
  useActions: useActionsSample,
  // P916: Call through Deedstone and Connect your phone (template/deedstone.js; real: hooks/deedstoneReal.js).
  deedstone: SAMPLE_DEEDSTONE,
}
const ImplCtx = createContext(SAMPLE)
// Loading and error for the page as a whole: never for sample data.
export const useDataStatus = () => useImpl().useStatus()
export function DataProvider({ impl, children }) { return createElement(ImplCtx.Provider, { value: impl || SAMPLE }, children) }
const useImpl = () => useContext(ImplCtx)
// 'sample' or 'real': screens use it only to pick the right empty-state words.
export const useDataSource = () => useImpl().source
export function useWeek() { const w = useImpl().useWeek(); return useMemo(() => weekTools(w), [w]) }
// The clock the lifecycle rules read: the sample clock (Mon, Nov 2, 2:14 PM) or the agent's real wall clock.
export const useNow = () => { const i = useImpl(); return i.useNow ? i.useNow() : i.now }
// P924: leads that never reached the agent (wrong number, couldn't reach, opted out) are never on the agent's side.
export function useSampleLeads(...a) {
  const r = useImpl().useLeads(...a)
  const data = useMemo(() => (r.data || []).filter(l => agentStatusOf(l) !== 'closed'), [r.data])
  return useMemo(() => ({ ...r, data }), [r, data])
}
export function useSampleLead(...a) { return useImpl().useLead(...a) }
export function useSampleClients(...a) { return useImpl().useClients(...a) }
export function useSampleClient(...a) { return useImpl().useClient(...a) }
export function useSampleAppointments(...a) { return useImpl().useAppointments(...a) }
export function useSampleThreads(...a) { return useImpl().useThreads(...a) }
export function useSampleActivity(...a) { return useImpl().useActivity(...a) }
export function useSampleBilling(...a) { return useImpl().useBilling(...a) }
export function useSampleTalks(...a) { return useImpl().useTalks(...a) }
export function useSampleFeedback(...a) { return useImpl().useFeedback(...a) }
export function useSampleBlocks(...a) { return useImpl().useBlocks(...a) }
export function useSampleSetup(...a) { return useImpl().useSetup(...a) }
export function useSampleLaunch() { const i = useImpl(); return (i.useLaunch || useLaunchSample)() }
export function useSampleSettings(...a) { return useImpl().useSettings(...a) }
export function useSampleNeeds(...a) { return useImpl().useNeeds(...a) }
export function useSampleSignup(...a) { return useImpl().useSignup(...a) }
export function useSampleOverview(...a) { return useImpl().useOverview(...a) }
export function useSampleActions(...a) { return useImpl().useActions(...a) }
// P916: the Deedstone calling side for this mode (sample or real).
export const useDeedstone = () => useImpl().deedstone || SAMPLE_DEEDSTONE

// P911: the sample clients, for the stage-checklist tests (each journey has one at a different step).
export { seedClients as SAMPLE_CLIENTS }
