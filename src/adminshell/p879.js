// P879 — the admin pieces the hole check found missing, as plain sample data and small pure rules (no React, so
// node --test runs them). Screens: Fulfillment team (Live desk, Time off, Hours & pay, Quality, Records, Holidays),
// the agent drawer (Pilot, Campaign), Revenue (Pilot results), Leads (consent proof, Unassigned), Settings
// (Compliance), Overview (ad alerts). Sample only: nothing here is read from or written to the backend yet (858/852
// wire it). GoHighLevel-powered pieces carry the engine-slot pill.

// ---------- VA statuses and the live desk (N-F-04, N-J-01, N-B-28, N-F-32) ----------
export const VA_STATUS = {
  available: ['Available', 'green'], on_call: ['On call', 'teal'], wrap: ['Wrap-up', 'blue'], break: ['Break', 'warn'],
  lunch: ['Lunch', 'warn'], training: ['Training', 'blue'], away: ['Away', 'mute'], offline: ['Offline', 'mute'],
}
export const ROUTED = ['available'] // only Available VAs are rung
export const isRouted = s => ROUTED.includes(s)
export const WRAP_LONG_S = 120 // admin sees wrap-ups longer than two minutes

export const DESK_VAS = [
  { id: 'va-maya', name: 'Maya Brooks', status: 'on_call', since: 260, party: 'Gloria Santos + Americo service line', callType: 'Cancel the old policy' },
  { id: 'va-keisha', name: 'Keisha Grant', status: 'wrap', since: 170, party: 'Tom Alvarez (lead)', callType: 'Speed to lead' },
  { id: 'va-andre', name: 'Andre Lewis', status: 'available', since: 45 },
  { id: 'va-omar', name: 'Omar Haddad', status: 'break', since: 840, breakLeft: -60 },
  { id: 'va-lily', name: 'Lily Chen', status: 'offline', since: 0 },
]
// The queue by priority: new leads beat servicing work with no one on the line.
export const DESK_QUEUE = [
  { tier: 1, label: 'New leads', n: 2, oldestS: 48 },
  { tier: 2, label: 'Call tasks from texts', n: 3, oldestS: 410 },
  { tier: 3, label: 'Callbacks due', n: 1, oldestS: 95 },
  { tier: 4, label: 'Servicing', n: 6, oldestS: 3600 },
]
export const SPEED_TODAY = [22, 31, 18, 44, 27, 63, 19] // seconds from a lead coming in to the first call
export function median(xs) {
  const s = [...xs].sort((a, b) => a - b)
  if (!s.length) return 0
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2)
}
export const clockS = s => { const a = Math.abs(Math.round(s)); if (a >= 3600) return `${s < 0 ? '+' : ''}${Math.floor(a / 3600)} h ${Math.floor((a % 3600) / 60)} min`; return `${s < 0 ? '+' : ''}${Math.floor(a / 60)}:${String(a % 60).padStart(2, '0')}` }
export const longWraps = vas => vas.filter(v => v.status === 'wrap' && v.since > WRAP_LONG_S)
// Understaffed: fewer VAs Available or on a call than the forecast needs right now.
export const FORECAST_NOW = 3
export function staffing(vas, forecast = FORECAST_NOW) {
  const working = vas.filter(v => ['available', 'on_call', 'wrap'].includes(v.status)).length
  const short = Math.max(0, forecast - working)
  return { working, forecast, short, under: short > 0, deferred: short > 0 ? ['Annual reviews', 'Packet checks due after today'] : [] }
}
export function deskAlerts(vas, queue) {
  const out = []
  for (const v of longWraps(vas)) out.push({ id: `wrap-${v.id}`, tone: 'warn', text: `${v.name} has been in wrap-up ${clockS(v.since)}` })
  for (const v of vas) if (['break', 'lunch'].includes(v.status) && v.breakLeft < 0) out.push({ id: `brk-${v.id}`, tone: 'warn', text: `${v.name}'s ${v.status} ran ${clockS(-v.breakLeft).replace('+', '')} over` })
  const lead = queue.find(q => q.tier === 1)
  if (lead && lead.n && lead.oldestS >= 60) out.push({ id: 'lead-wait', tone: 'warn', text: `A new lead has waited ${clockS(lead.oldestS)}` })
  return out
}

// ---------- Per-VA metrics and QA (N-F-20, N-F-21, N-F-22) ----------
export const VA_METRICS = [
  { id: 'va-maya', name: 'Maya Brooks', ringS: 4, firstCallS: 21, missedRings: 0, handleM: 7.5, wrapS: 48, adherence: 0.97, tasks: 31, transfers: 4, bookings: 9, showRate: 0.67 },
  { id: 'va-keisha', name: 'Keisha Grant', ringS: 6, firstCallS: 29, missedRings: 1, handleM: 6.1, wrapS: 95, adherence: 0.92, tasks: 26, transfers: 3, bookings: 7, showRate: 0.57 },
  { id: 'va-andre', name: 'Andre Lewis', ringS: 5, firstCallS: 34, missedRings: 2, handleM: 8.2, wrapS: 62, adherence: 0.88, tasks: 22, transfers: 2, bookings: 6, showRate: 0.5 },
  { id: 'va-omar', name: 'Omar Haddad', ringS: 9, firstCallS: 41, missedRings: 3, handleM: 9.4, wrapS: 131, adherence: 0.81, tasks: 18, transfers: 1, bookings: 4, showRate: 0.5 },
]
export const QA_RUBRIC = ['Greeting and Deedstone name', 'Consent line read where needed', 'Stayed inside the unlicensed line', 'Required lines for the call type', 'Clear next step and outcome saved']
export const QA_MIN_PER_WEEK = 5
export const QA_REVIEWS = [
  { id: 'qa-1', va: 'va-maya', call: 'Gloria Santos · cancel the old policy', when: 'Thu 2:10 PM', scores: [2, 2, 2, 2, 1], by: 'Brayden', flagged: false, dispute: null },
  { id: 'qa-2', va: 'va-keisha', call: 'Tom Alvarez · speed to lead', when: 'Thu 11:42 AM', scores: [2, 1, 2, 1, 2], by: 'Jordan', flagged: true, dispute: { at: 'Fri 9:05 AM', text: 'The consent line was read at 0:41, before the booking.', status: 'open', reviewer: null } },
  { id: 'qa-3', va: 'va-andre', call: 'Rita Moss · no-show rebook', when: 'Wed 4:30 PM', scores: [2, 2, 1, 2, 2], by: 'Brayden', flagged: false, dispute: null },
]
export const qaScore = r => Math.round((r.scores.reduce((t, x) => t + x, 0) / (r.scores.length * 2)) * 100)
export const qaDone = (reviews, vaId) => reviews.filter(r => r.va === vaId).length
// Another admin re-reviews a dispute: never the one who scored it.
export const reReviewerFor = (r, admins = ['Brayden', 'Jordan']) => admins.find(a => a !== r.by) || null

// ---------- Timesheets and hourly pay (N-F-23, N-G-24; Q75/Q76: clock in/out, hourly only) ----------
export const HOURLY = { 'va-maya': 8, 'va-andre': 8, 'va-keisha': 8, 'va-omar': 8, 'va-lily': 8 }
export const TIMESHEET = [
  { va: 'va-maya', name: 'Maya Brooks', days: [{ d: 'Mon', in: '7:58 AM', out: '6:02 PM', breakM: 45 }, { d: 'Tue', in: '8:01 AM', out: '6:00 PM', breakM: 45 }, { d: 'Wed', in: '7:55 AM', out: '6:10 PM', breakM: 30 }, { d: 'Thu', in: '8:03 AM', out: '6:00 PM', breakM: 45 }] },
  { va: 'va-keisha', name: 'Keisha Grant', days: [{ d: 'Mon', in: '8:00 AM', out: '4:00 PM', breakM: 30 }, { d: 'Tue', in: '8:22 AM', out: '4:00 PM', breakM: 30, flag: 'Late 22 min' }, { d: 'Thu', in: '8:00 AM', out: '4:05 PM', breakM: 45 }] },
  { va: 'va-andre', name: 'Andre Lewis', days: [{ d: 'Mon', in: '10:00 AM', out: '6:00 PM', breakM: 30 }, { d: 'Wed', in: '9:58 AM', out: '5:12 PM', breakM: 30, flag: 'Auto clock-out at last activity' }] },
  { va: 'va-omar', name: 'Omar Haddad', days: [{ d: 'Tue', in: '12:00 PM', out: '8:00 PM', breakM: 50, flag: 'Break ran 20 min over' }, { d: 'Thu', in: '12:04 PM', out: '8:00 PM', breakM: 30 }] },
]
export const CORRECTIONS = [
  { id: 'cr-1', va: 'Andre Lewis', day: 'Wed', ask: 'Clock out 6:00 PM, not 5:12 PM', why: 'The app closed during a carrier hold.', status: 'pending' },
]
const toMin = t => { const m = /^(\d{1,2}):(\d{2}) (AM|PM)$/.exec(t); if (!m) return 0; let h = Number(m[1]) % 12; if (m[3] === 'PM') h += 12; return h * 60 + Number(m[2]) }
export const dayHours = d => Math.max(0, (toMin(d.out) - toMin(d.in) - (d.breakM || 0)) / 60)
export const WEEK_OT_H = 40
export function sheetTotals(row, rate = HOURLY[row.va] || 8) {
  const hours = Math.round(row.days.reduce((t, d) => t + dayHours(d), 0) * 100) / 100
  const ot = Math.max(0, hours - WEEK_OT_H)
  const pay = Math.round(((hours - ot) * rate + ot * rate * 1.5) * 100) / 100
  return { hours, ot, pay, rate, flags: row.days.filter(d => d.flag).length }
}

// ---------- Time off, swaps and open shifts (N-F-07) ----------
export const SWAPS = [
  { id: 'sw-1', from: 'Keisha Grant', to: 'Andre Lewis', day: 'Tue, Nov 10', status: 'pending' },
]
export const OPEN_SHIFTS = [
  { id: 'os-1', day: 'Wed, Nov 11', hours: '8:00 AM to 6:00 PM', why: 'Lily asked off', accepted: 'Omar Haddad', status: 'accepted' },
  { id: 'os-2', day: 'Fri, Nov 13', hours: '12:00 PM to 6:00 PM', why: 'Short of the forecast', accepted: null, status: 'open' },
]

// ---------- Holidays (N-F-31) ----------
export const HOLIDAYS = [
  { id: 'h-1', date: 'Wed, Nov 11', name: 'Veterans Day', kind: 'carrier', note: 'Some carrier lines closed; packet checks move to Thu' },
  { id: 'h-2', date: 'Thu, Nov 26', name: 'Thanksgiving', kind: 'closed', note: 'Desk closed; after-hours path all day' },
  { id: 'h-3', date: 'Fri, Nov 27', name: 'Day after Thanksgiving', kind: 'reduced', note: 'Two VAs, 9:00 AM to 3:00 PM' },
]
export const HOLIDAY_WORD = { closed: ['Desk closed', 'warn'], reduced: ['Reduced hours', 'blue'], carrier: ['Carrier holiday', 'teal'] }

// ---------- VA onboarding and records (N-F-34, N-F-41) ----------
export const ONBOARD_STEPS = ['Contractor agreement', 'Confidentiality and data rules', 'ID and background check', 'Tax form', 'Invite and two-step sign-in', 'Device check', 'Training lessons', 'Certification call', 'First rota shift']
export const ONBOARDING = [
  { va: 'va-omar', name: 'Omar Haddad', done: 9 },
  { va: 'va-lily', name: 'Lily Chen', done: 6 },
  { va: 'va-new', name: 'Rosa Vega (invited)', done: 2 },
]
export const canWork = o => o.done >= ONBOARD_STEPS.length
export const RECORDS = [
  { va: 'va-maya', name: 'Maya Brooks', lates: 0, noShows: 0, overruns: 0, gaps: 0, qa: [92, 95, 90], coaching: 'None open', goal: 'Lead booking rate over 40%' },
  { va: 'va-keisha', name: 'Keisha Grant', lates: 1, noShows: 0, overruns: 1, gaps: 0, qa: [80, 84, 80], coaching: 'Consent line timing (Nov 6)', goal: 'Wrap-up under 90 s' },
  { va: 'va-andre', name: 'Andre Lewis', lates: 0, noShows: 0, overruns: 0, gaps: 1, qa: [88, 90, 90], coaching: 'None open', goal: 'Answer rings in 5 s' },
  { va: 'va-omar', name: 'Omar Haddad', lates: 0, noShows: 1, overruns: 2, gaps: 0, qa: [75, 78, 82], coaching: 'Break timing (Nov 3)', goal: 'Breaks on time' },
]
export const trend = xs => (xs.length < 2 ? 0 : xs.at(-1) - xs[0])

// ---------- Pilot per agent, VA cost line, pilot to paid (N-G-01, N-G-08, Q64) ----------
export const PILOT = {
  'ag-dana': { on: true, start: 'Oct 26', note: 'First pilot agent. Both lead types.', vaCost: true, toPaid: null },
  'ag-priya': { on: true, start: 'Nov 2', note: 'Florida and Georgia.', vaCost: false, toPaid: { plan: 'Growth', date: 'Mon, Nov 30', accepted: false, reminders: ['7 days', '3 days', '1 day'] } },
  'ag-james': { on: true, start: 'Nov 2', note: '', vaCost: true, toPaid: null },
}
export const pilotOf = id => PILOT[id] || { on: false, start: '', note: '', vaCost: false, toPaid: null }
export const PAID_PLANS = [{ value: 'Starter', label: 'Starter · up to $50 a day' }, { value: 'Growth', label: 'Growth · $51 to $100 a day' }, { value: 'Pro', label: 'Pro · $101 to $200 a day' }, { value: 'Scale', label: 'Scale · over $200 a day, custom' }]
// The log line for any pilot change, kept with before and after.
export const pilotLog = (who, field, before, after, at = 'Today') => ({ at, who, field, before: String(before), after: String(after) })

// ---------- Campaign status and ad alerts, engine slots (N-A-02, N-A-04) ----------
export const CAMPAIGN = {
  'ag-dana': { status: 'live', at: 'Oct 27, 9:14 AM', reason: '' },
  'ag-priya': { status: 'in_review', at: 'Nov 5, 9:40 AM', reason: '' },
  'ag-james': { status: 'rejected', at: 'Nov 6, 10:02 AM', reason: 'Landing page wording: "guaranteed approval"' },
  'ag-elena': { status: 'paused', at: 'Nov 5, 6:00 PM', reason: 'Lead spend ran out for the week' },
  'ag-ben': { status: 'stopped', at: 'Nov 4, 9:00 AM', reason: 'Payment failed' },
}
export const CAMPAIGN_STATE = { in_review: ['In review', 'blue'], live: ['Live', 'green'], rejected: ['Rejected', 'warn'], paused: ['Paused', 'warn'], stopped: ['Stopped', 'mute'], none: ['Not started', 'mute'] }
export const campaignOf = id => CAMPAIGN[id] || { status: 'none', at: '', reason: '' }
// Hours between two sample times on Nov dates ("Nov 5, 4:40 PM") and the sample now (Fri Nov 6, 1:30 PM).
const NOW_H = 6 * 24 + 13.5
const hoursOf = at => { const m = /^Nov (\d+), (\d{1,2}):(\d{2}) (AM|PM)$/.exec(at || ''); if (!m) return null; let h = Number(m[2]) % 12; if (m[4] === 'PM') h += 12; return Number(m[1]) * 24 + h + Number(m[3]) / 60 }
export const reviewHours = c => { const h = hoursOf(c.at); return h == null ? 0 : Math.max(0, NOW_H - h) }
export function adAlerts(campaigns = CAMPAIGN) {
  return Object.entries(campaigns).flatMap(([agent, c]) => {
    if (c.status === 'rejected') return [{ agent, kind: 'rejected', text: `Ad rejected: ${c.reason}` }]
    if (c.status === 'in_review' && reviewHours(c) > 24) return [{ agent, kind: 'review', text: `In review ${Math.floor(reviewHours(c))} h` }]
    return []
  })
}

// ---------- Pilot results and the owner rule (N-G-30, N-J-44, owner rule) ----------
// Sample pilot numbers per agent and lead type. Sample leads (not from a real ad) are excluded from every total.
export const PILOT_ROWS = [
  { agent: 'Dana Walker', state: 'TX', week: 'Nov 2', type: 'appointment', spend: 700, leads: 28, reached: 21, booked: 10, transfers: 0, offered: 0, shows: 6, sales: 3, vaMin: 610, revenue: 0, sample: false },
  { agent: 'Dana Walker', state: 'TX', week: 'Nov 2', type: 'live', spend: 385, leads: 7, reached: 7, booked: 1, transfers: 5, offered: 6, shows: 5, sales: 2, vaMin: 140, revenue: 0, sample: false },
  { agent: 'Priya Shah', state: 'FL', week: 'Nov 2', type: 'appointment', spend: 525, leads: 21, reached: 15, booked: 7, transfers: 0, offered: 0, shows: 4, sales: 1, vaMin: 470, revenue: 0, sample: false },
  { agent: 'Priya Shah', state: 'GA', week: 'Nov 2', type: 'live', spend: 220, leads: 4, reached: 4, booked: 1, transfers: 2, offered: 3, shows: 2, sales: 1, vaMin: 80, revenue: 0, sample: false },
  { agent: 'James Okafor', state: 'GA', week: 'Nov 2', type: 'appointment', spend: 350, leads: 14, reached: 9, booked: 4, transfers: 0, offered: 0, shows: 3, sales: 1, vaMin: 330, revenue: 0, sample: false },
  { agent: 'Test lead', state: 'TX', week: 'Nov 2', type: 'appointment', spend: 0, leads: 3, reached: 3, booked: 3, transfers: 0, offered: 0, shows: 0, sales: 0, vaMin: 20, revenue: 0, sample: true },
]
export const VA_RATE = 8 // $ an hour (Q44)
export const per = (a, b) => (b ? Math.round((a / b) * 100) / 100 : null)
export function pilotTotals(rows, { type = 'all', rate = VA_RATE, membership = 0 } = {}) {
  const r = rows.filter(x => !x.sample && (type === 'all' || x.type === type))
  const sum = k => r.reduce((t, x) => t + x[k], 0)
  const spend = sum('spend'); const leads = sum('leads'); const booked = sum('booked'); const transfers = sum('transfers'); const sales = sum('sales')
  const vaMin = sum('vaMin'); const vaCost = Math.round((vaMin / 60) * rate * 100) / 100
  // In the pilot agents pay lead spend only (all to their ads); revenue is membership once paid plans start.
  const revenue = membership + sum('revenue')
  const ownerTake = Math.round((revenue - vaCost) * 100) / 100
  return {
    spend, leads, reached: sum('reached'), booked, transfers, offered: sum('offered'), shows: sum('shows'), sales, vaMin, vaHours: Math.round((vaMin / 60) * 10) / 10, vaCost,
    perLead: per(spend, leads), perBooked: per(spend, booked), perTransfer: per(spend, transfers), perShow: per(spend, sum('shows')), perSale: per(spend, sales),
    pickup: per(transfers, sum('offered')), revenue, ownerTake, vaPct: revenue ? Math.round((vaCost / revenue) * 1000) / 10 : null,
  }
}
export const OWNER_LIMIT = 1 / 3 // VA cost at or under a third of revenue
export const ownerOk = t => t.revenue > 0 && t.vaCost / t.revenue <= OWNER_LIMIT
// The optional VA cost line per agent: VA hours on that agent's leads and clients × the hourly rate, at cost.
export const vaCostLine = (vaMin, rate = VA_RATE) => Math.round((vaMin / 60) * rate * 100) / 100

// ---------- Consent proof and Unassigned (N-A-19, N-B-02, N-A-11, N-B-21, N-J-12) ----------
export function consentOf(lead) {
  const n = String(lead.id || '').replace(/\D/g, '').padStart(4, '0').slice(-4)
  return {
    at: `${lead.came}`, wording: 'Deedstone consent v3 (Oct 20)', landing: 'Mortgage protection page v5', page: 'https://deedstone.com/protect',
    ip: `72.14.${Number(n.slice(0, 2)) || 18}.${Number(n.slice(2)) || 40}`, cert: `TF-${n}-8C1E-41D2`, keepUntil: 'Nov 2031 (5 years)',
  }
}
export const SOURCE_AD = { campaign: 'Deedstone · Mortgage protection', adset: 'TX broad 30-65', ad: 'Napkin math v2', agentId: 'missing' }
// Who can take an Unassigned lead: licensed in its state with that lead type switched on. None → "No agent for state".
export function assignable(agents, lead) {
  return agents.filter(a => a.access && a.states.includes(lead.state) && (lead.kind !== 'live' || a.active))
}

// ---------- Compliance records (N-J-15, N-J-27, N-J-34, N-J-35, N-J-36) ----------
export const DNC = [
  { id: 'dnc-1', phone: '(214) 555-0199', name: 'Carl Benton', by: 'Keisha Grant', how: 'One tap on a call', at: 'Nov 5, 3:12 PM', keepUntil: 'Nov 2031' },
  { id: 'dnc-2', phone: '(512) 555-0177', name: 'Unknown caller', by: 'Automatic (STOP)', how: 'Text reply', at: 'Nov 4, 9:40 AM', keepUntil: 'Nov 2031' },
]
export const INCIDENTS = [
  { id: 'inc-1', when: 'Nov 4, 2:20 PM', va: 'Omar Haddad', call: 'Rita Moss · review call', said: 'Told the client the policy "covers everything"', fix: 'Coached on the unlicensed line', callback: true },
]
export const COMPLAINTS = [
  { id: 'cmp-1', who: 'Linda Park', channel: 'Call', summary: 'Called three times in one day', owner: 'Jordan', due: 'Mon, Nov 9', status: 'open', cause: 'Retry calls not spaced' },
  { id: 'cmp-2', who: 'Agent: Ben Carter', channel: 'App', summary: 'Booked outside his hours', owner: 'Brayden', due: 'Fri, Nov 6', status: 'resolved', cause: 'Hours not saved', resolution: 'Hours fixed, lead rebooked' },
]
export const LEGAL = [
  { id: 'lg-1', who: 'Re: Martin Price', what: 'Attorney letter asking for records', hold: true, opened: 'Nov 3', items: 14 },
]
export const DATA_REQUESTS = [
  { id: 'dr-1', who: 'Sandra Lee', kind: 'delete', asked: 'Nov 2', due: 'Dec 2', verified: true, outcome: null },
  { id: 'dr-2', who: 'Paul Rivera', kind: 'access', asked: 'Oct 20', due: 'Nov 19', verified: false, outcome: null },
]
export const DR_KEPT = ['Consent proof', 'Do-not-call entry', 'Legal hold items']
// Deadline left in days from the sample today (Nov 6).
export const daysLeft = due => { const m = /(Nov|Dec) (\d+)/.exec(due || ''); if (!m) return null; return (m[1] === 'Dec' ? 30 : 0) + Number(m[2]) - 6 }
