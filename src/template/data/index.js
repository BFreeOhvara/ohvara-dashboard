import { useSyncExternalStore, useMemo } from 'react'

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
}

const mkLead = (id, p, o) => ({
  id, first_name: p.first, last_name: p.last, phone: p.phone, state: p.state, city: p.city,
  age_band: '45 to 54', mortgage_balance_band: '$200,000 to $300,000', homeowner: true, smoker: false,
  best_time: 'Evenings', status: 'assigned', outcome: null, kind: 'appointment', appt: null, note: '', created: 'Tue, Oct 27', assigned_at: 'Tue, Oct 27, 6:12 PM',
  ...o,
})

const seedLeads = [
  mkLead('sample-lead-1', people.dana, { stage: 'booked', appt: 'Thu, Nov 5, 3:00 PM', age_band: '45 to 54', note: 'Wants coverage until the mortgage is paid off. Two kids, 9 and 12.' }),
  mkLead('sample-lead-2', people.carla, { stage: 'missed', kind: 'live_call', state: 'GA', best_time: 'Mornings', appt: null }),
  mkLead('sample-lead-3', people.harold, { stage: 'ringing', kind: 'live_call', age_band: '55 to 64', appt: null }),
  mkLead('sample-lead-4', people.renee, { stage: 'no_show', appt: 'Wed, Nov 4, 1:00 PM' }),
  mkLead('sample-lead-5', people.denise, { stage: 'sold', status: 'closed', outcome: 'sold', appt: 'Tue, Nov 3, 11:00 AM' }),
  mkLead('sample-lead-6', people.robert, { stage: 'follow_up', status: 'contacted', outcome: 'follow_up', appt: null, follow: 'Fri, Nov 6' }),
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
  { id: 'a5', at: 'Yesterday, 4:40 PM', kind: 'moved', who: 'Robert Chen', text: 'Moved to Follow up for Fri, Nov 6.' },
  { id: 'a6', at: 'Yesterday, 11:02 AM', kind: 'client', who: 'Luis Ortega', text: 'Policy is now protected.' },
  { id: 'a7', at: 'Fri, Oct 30', kind: 'call', who: 'Gloria Santos', text: 'Fulfillment called. No answer, second try.' },
  { id: 'a8', at: 'Fri, Oct 30', kind: 'lead', who: 'Denise Walker', text: 'Sold. Ready to submit for servicing.' },
]

const seedAppointments = [
  { id: 'ap1', day: 'Mon', date: 2, time: '3:30 PM', who: 'Gloria Santos', label: 'Confirm number, call her', kind: 'client', ref: 'sample-client-1' },
  { id: 'ap2', day: 'Tue', date: 3, time: '11:00 AM', who: 'Denise Walker', label: 'Appointment', kind: 'lead', ref: 'sample-lead-5' },
  { id: 'ap3', day: 'Wed', date: 4, time: '1:00 PM', who: 'Renee Ortiz', label: 'Appointment', kind: 'lead', ref: 'sample-lead-4' },
  { id: 'ap4', day: 'Thu', date: 5, time: '3:00 PM', who: 'Dana Example', label: 'Appointment', kind: 'lead', ref: 'sample-lead-1' },
  { id: 'ap5', day: 'Thu', date: 5, time: '3:00 PM', who: 'Robert Chen', label: 'Review call', kind: 'client', ref: 'sample-client-3' },
  { id: 'ap6', day: 'Fri', date: 6, time: '2:00 PM', who: 'Luis Ortega', label: 'Check-in call', kind: 'client', ref: 'sample-client-2' },
  { id: 'ap7', day: 'Fri', date: 6, time: '4:15 PM', who: 'Gloria Santos', label: 'Review call', kind: 'client', ref: 'sample-client-1' },
]

const seed = {
  leads: seedLeads, clients: seedClients, threads: seedThreads, activity: seedActivity, appointments: seedAppointments,
  duty: true, tasks: { t1: false, t2: false, t3: false },
  settings: {
    profile: { name: 'Dana Whitfield', email: 'dana.whitfield@example.com', phone: '(214) 555-0100', plan: 'Servicing 16' },
    hours: { start: '9:00 AM', end: '6:00 PM', days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'] },
    notifications: [
      { key: 'lead', label: 'New lead', push: true, email: true },
      { key: 'appt', label: 'Appointment reminders', push: true, email: false },
      { key: 'msg', label: 'Messages from the team', push: true, email: true },
      { key: 'client', label: 'Client needs you', push: true, email: true },
    ],
  },
  billing: {
    plan: { name: 'Servicing', size: 16, weekly: 575, sample: true }, used: 11, resets: 'Mon, Nov 9', next_charge: 'Mon, Nov 9', paused: false,
    leadTypes: [{ key: 'appointments', label: 'Appointments', sub: 'On your calendar', weekly: 500, on: true }, { key: 'live', label: 'Live calls', sub: 'Ring your phone', weekly: 300, on: true }],
    history: [{ id: 'inv1', at: 'Mon, Nov 2', label: 'Servicing, 16 a week', amount: 575 }, { id: 'inv2', at: 'Mon, Oct 26', label: 'Servicing, 16 a week', amount: 575 }, { id: 'inv3', at: 'Mon, Oct 26', label: 'Leads spend', amount: 800 }],
  },
  submissions: { used: 11, cap: 16 },
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
export function useSampleBilling() { const s = useStore(); return ok({ ...s.billing, submissions: s.submissions }) }
export function useSampleSettings() { const s = useStore(); return ok({ ...s.settings, duty: s.duty }) }
export function useSampleSignup() {
  return useMemo(() => ok({
    plans: [{ key: 'servicing', label: 'Servicing', sub: 'Submit sales and we keep them on the books', weekly: 199, sample: true }, { key: 'leads', label: 'Servicing and Leads', sub: 'Plus leads booked on your calendar', weekly: 399, sample: true }],
    covers: ['Weekly submissions', 'A team that follows up with every client', 'Updates in your bell and by text'],
  }), [])
}
// The sample clock is fixed at Monday, November 2, 2:14 PM, like the frame.
const NOW = { label: 'Monday, November 2', time: '2:14', ampm: 'PM', min: 14 * 60 + 14, date: 2 }
const minutesOf = t => { const m = /(\d+):(\d+)\s*(AM|PM)/.exec(t); return ((Number(m[1]) % 12) + (m[3] === 'PM' ? 12 : 0)) * 60 + Number(m[2]) }
const untilText = t => { const d = minutesOf(t) - NOW.min; return d <= 0 ? 'now' : `in ${d >= 60 ? `${Math.floor(d / 60)} h ` : ''}${d % 60} min` }
const LEAD_NEW = ['booked', 'ringing', 'missed']

export function useSampleOverview() {
  const s = useStore()
  const open = Object.values(s.tasks).filter(v => !v).length
  const by = st => s.clients.filter(c => c.stage === st).length
  return ok({
    name: 'Dana', book: { protected: by('protected'), settingUp: by('setting_up'), needsAttention: by('needs_attention'), requestsOpen: by('requests') },
    submissions: { ...s.submissions, resetsAt: 'Mon, Nov 9' }, duty: s.duty, stepsOpen: open,
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
    upNext: s.appointments.slice(0, 3),
    leadsToday: s.leads.length,
    today: NOW.label, clock: { time: NOW.time, ampm: NOW.ampm },
    doneRange: 'Oct 26 to Nov 1',
    dutySince: '9:02 AM',
    nextAppt: (() => { const a = s.appointments.find(x => x.date === NOW.date && minutesOf(x.time) > NOW.min); return a ? { ...a, inText: untilText(a.time) } : null })(),
    apptsLeft: { left: 8, cap: 12, resets: 'Dec 1' },
    todayAppts: s.appointments.filter(a => a.date === NOW.date).map(a => ({ ...a, inText: untilText(a.time) })),
    newLeads: s.leads.filter(l => LEAD_NEW.includes(l.stage)).map(l => ({ id: l.id, name: `${l.first_name} ${l.last_name}`, kind: l.kind, stage: l.stage, appt: l.appt })),
  })
}

const stamp = 'Today, 2:14 PM'
const log = (s, who, text, kind) => [{ id: `a${s.activity.length + 1}-${text.length}`, at: stamp, kind, who, text }, ...s.activity]

export function useSampleActions() {
  return useMemo(() => ({
    moveLead: (id, stage, extra = {}) => set(s => {
      const lead = s.leads.find(l => l.id === id)
      const status = stage === 'sold' ? 'closed' : stage === 'not_interested' ? 'bad' : stage === 'follow_up' ? 'contacted' : lead.status
      return { ...s, leads: s.leads.map(l => (l.id === id ? { ...l, stage, status, outcome: stage, ...extra } : l)), activity: log(s, `${lead.first_name} ${lead.last_name}`, `Moved to ${stage.replace('_', ' ')}.`, 'moved') }
    }),
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
    submitSale: form => set(s => ({ ...s, submissions: { ...s.submissions, used: Math.min(s.submissions.cap, s.submissions.used + 1) }, activity: log(s, form.name || 'New client', 'Sale submitted for servicing.', 'client') })),
    submitRequest: form => set(s => ({ ...s, activity: log(s, form.name || 'Client', `Service request sent: ${form.kind}.`, 'client') })),
    setNotification: (key, field, on) => set(s => ({ ...s, settings: { ...s.settings, notifications: s.settings.notifications.map(n => (n.key === key ? { ...n, [field]: on } : n)) } })),
    setLeadType: (key, on) => set(s => ({ ...s, billing: { ...s.billing, leadTypes: s.billing.leadTypes.map(t => (t.key === key ? { ...t, on } : t)) } })),
    setPaused: paused => set(s => ({ ...s, billing: { ...s.billing, paused } })),
    setPlanSize: size => set(s => ({ ...s, billing: { ...s.billing, plan: { ...s.billing.plan, size, weekly: size === 7 ? 275 : 575 } }, submissions: { ...s.submissions, cap: size } })),
  }), [])
}
