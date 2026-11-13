// P879 — the VA pieces the hole check found missing, as plain sample data and small pure rules (no React, so
// node --test runs them). Used by Clock879 (clock in/out, status, breaks), LeadDesk879 (the lead drawer), and the
// Pay, Schedule, Queue, Clients and Overview screens. Sample only: 852 wires the real calls, clocks and texts.

import { freshLeadRoute, DAYS, DEFAULT_LIVE_HOURS } from '../../lib/leadSplit.js'

// ---------- Clock in/out, statuses, breaks (N-F-02, N-F-04, N-F-05) ----------
export const CLOCK_WINDOW_MIN = 15 // clock in only within 15 minutes of the shift start (else an admin approves)
export function clockInCheck(nowMin, shiftStartMin) {
  const off = nowMin - shiftStartMin
  if (Math.abs(off) <= CLOCK_WINDOW_MIN) return { ok: true, needsApproval: false, late: off > 0 ? off : 0 }
  return { ok: false, needsApproval: true, late: off > 0 ? off : 0, why: off < 0 ? 'More than 15 minutes before your shift' : 'More than 15 minutes after your shift started' }
}
export const DEVICE_CHECKS = [['mic', 'Microphone'], ['speaker', 'Speaker'], ['push', 'App notifications'], ['network', 'Network']]
// Routing is blocked while any check fails.
export const deviceOk = res => DEVICE_CHECKS.every(([k]) => res[k] === true)
export const STATUSES = [
  ['available', 'Available', 'green'], ['on_call', 'On call', 'teal'], ['wrap', 'Wrap-up', 'blue'], ['break', 'Break', 'warn'],
  ['lunch', 'Lunch', 'warn'], ['training', 'Training', 'blue'], ['away', 'Away', 'mute'], ['offline', 'Offline', 'mute'],
]
export const statusOf = k => STATUSES.find(s => s[0] === k) || STATUSES[7]
export const PICKABLE = ['available', 'break', 'lunch', 'training', 'away'] // on call and wrap-up are set by the call
export const BREAKS = { break: { min: 15, paid: true }, lunch: { min: 30, paid: false } }
export const OVERRUN_ALERT_MIN = 5 // admin is alerted when a break runs 5 minutes over
export function breakState(kind, startedMs, nowMs) {
  const b = BREAKS[kind]
  if (!b) return null
  const leftS = Math.round(b.min * 60 - (nowMs - startedMs) / 1000)
  return { leftS, over: leftS < 0, alert: leftS <= -OVERRUN_ALERT_MIN * 60, paid: b.paid }
}
export const mmss = s => { const a = Math.abs(s); return `${Math.floor(a / 60)}:${String(a % 60).padStart(2, '0')}` }

// ---------- Hours and hourly pay (N-F-23, N-G-24; Q75/Q76) ----------
// P945 (Brayden, Nov 10): pay is the VA's set scheduled hours minus days off, so there is nothing to correct. Each
// row is a scheduled shift (the rota's hours); today's counts up to now.
export const MY_RATE = 8
export const MY_SHEET = [
  { day: 2, d: 'Mon', in: '8:00 AM', out: '6:00 PM', breakM: 0 },
  { day: 3, d: 'Tue', in: '8:00 AM', out: '6:00 PM', breakM: 0 },
  { day: 4, d: 'Wed', in: '8:00 AM', out: '6:00 PM', breakM: 0 },
  { day: 5, d: 'Thu', in: '8:00 AM', out: '6:00 PM', breakM: 0 },
  { day: 6, d: 'Fri', in: '8:00 AM', out: null, breakM: 0, live: true },
]
const toMin = t => { const m = /^(\d{1,2}):(\d{2}) (AM|PM)$/.exec(t || ''); if (!m) return null; let h = Number(m[1]) % 12; if (m[3] === 'PM') h += 12; return h * 60 + Number(m[2]) }
export const minOf = toMin
export function hoursOf(row, nowMin = 14 * 60) {
  const a = toMin(row.in); const b = row.out ? toMin(row.out) : nowMin
  return a == null ? 0 : Math.max(0, Math.round(((b - a - (row.breakM || 0)) / 60) * 100) / 100)
}
export function weekPay(sheet = MY_SHEET, rate = MY_RATE) {
  const hours = Math.round(sheet.reduce((t, r) => t + hoursOf(r), 0) * 100) / 100
  const ot = Math.max(0, hours - 40)
  return { hours, ot, rate, pay: Math.round(((hours - ot) * rate + ot * rate * 1.5) * 100) / 100 }
}

// ---------- Swaps, open shifts, holidays (N-F-07, N-F-31) ----------
export const MY_SWAPS = [{ id: 'sw-me', day: 'Thu, Nov 12', with: 'Leo Grant', status: 'waiting on Leo' }]
export const OPEN_FOR_ME = [{ id: 'os-2', day: 'Fri, Nov 13', hours: '12:00 PM to 6:00 PM', why: 'Short of the forecast' }]
export const HOLIDAYS = [
  { id: 'h-1', date: 'Wed, Nov 11', name: 'Veterans Day', what: 'Some carrier lines are closed. Packet checks move to Thursday.' },
  { id: 'h-2', date: 'Thu, Nov 26', name: 'Thanksgiving', what: 'Desk closed. New leads get the after-hours text.' },
  { id: 'h-3', date: 'Fri, Nov 27', name: 'Day after Thanksgiving', what: 'Reduced: two VAs, 9:00 AM to 3:00 PM.' },
]

// ---------- My call quality (N-F-20 VA view, N-F-21) ----------
export const MY_QA = [
  { id: 'qa-1', call: 'Gloria Santos · cancel the old policy', when: 'Thu 2:10 PM', score: 90, by: 'Ohvara Support', notes: 'Great hold hand-off. Say the confirmation number back.', dispute: null },
  { id: 'qa-4', call: 'Tom Alvarez · speed to lead', when: 'Wed 10:20 AM', score: 70, by: 'Ohvara Support', notes: 'Consent line was missed.', dispute: null },
]
export const canDispute = r => !r.dispute // once per score

// ---------- The lead drawer (op B and C rows) ----------
// N-B-02, N-B-50: how we got your number, from the consent proof.
export function sourceOf(l) {
  const n = String(l.id || '').replace(/\D/g, '').slice(-2) || '18'
  return { said: `You asked about ${String(l.type || 'mortgage protection').toLowerCase()} on our Deedstone page`, at: l.came, page: 'deedstone.com/protect', cert: `TF-00${n}-8C1E` }
}
// Lead states that change what the VA may do (N-B-17, N-B-42).
export const LEAD_FLAGS = {
  'vq-3': { callIn: true }, // called in: the VA reads the verbal consent line before any text
  'vq-4': { optedOut: true, callIn: true }, // opted out, then called in: answer, but no texts and no outbound calls
}
export const flagsOf = l => ({ optedOut: !!l.opted_out, closed: !!l.closed, callIn: false, ...(LEAD_FLAGS[l.id] || {}) })
export const CONSENT_LINE = 'Is it OK if Deedstone texts you about your request and your appointment? You can reply STOP at any time.'

// N-C-01, N-C-22: Check agent is on only when every rule passes; the first failing rule is shown.
// P889: "takes live transfers" and "inside their live-call hours" come from the agent's How you take leads setting
// (mode + live-call hours in their time zone), worked out at the moment of the call (liveRulesOf).
export const AGENT_RULES = [
  ['liveCalls', 'Appointments only: book them'], ['app', "Can't be reached in the app"], ['hours', 'Outside their live-call hours: book them'],
  ['free', 'On another call'], ['notChecking', 'Already being checked'], ['licensed', 'Not licensed in this state'], ['notPaused', 'Paused'],
]
export const liveRulesOf = (agent, nowMs = Date.now()) => {
  const r = freshLeadRoute(agent, nowMs)
  return { liveCalls: agent.mode === 'both', hours: r.key !== 'out_of_hours', route: r }
}
export function agentCheck(agent, state, nowMs = Date.now()) {
  const live = agent.mode ? liveRulesOf(agent, nowMs) : {}
  const a = { ...agent, liveCalls: live.liveCalls ?? agent.liveCalls, hours: live.hours ?? agent.hours, licensed: licensedIn(agent, state) }
  const fail = AGENT_RULES.find(([k]) => !a[k])
  const why = fail ? (fail[0] === 'licensed' && !state ? "Confirm the lead's state first" : fail[1]) : null
  return { ok: !fail, why, bookOk: a.licensed, ...(live.route ? { route: live.route } : {}) }
}
// P881 (N-C-22, Q61): the server gate is licence_allows(); this is the same rule on sample data. No state = no.
export const licensedIn = (agent, state) => !!state && state !== 'NY' && (agent?.states || []).includes(state)
// P889: mode + live-call hours (their own zone). Dana takes transfers every day 7 AM-9 PM her time, Priya weekdays
// 9-5, Marcus is Appointments only.
const EVERY_DAY = Object.fromEntries(DAYS.map(d => [d, { on: true, start: '7:00 AM', end: '9:00 PM' }]))
export const SAMPLE_AGENTS = [
  { id: 'ag-dana', name: 'Dana Walker', states: ['TX', 'OK'], mode: 'both', hours: EVERY_DAY, tz: 'America/Chicago', app: true, free: true, notChecking: true, notPaused: true },
  { id: 'ag-priya', name: 'Priya Shah', states: ['FL', 'GA'], mode: 'both', hours: DEFAULT_LIVE_HOURS, tz: 'America/New_York', app: true, free: false, notChecking: true, notPaused: true },
  { id: 'ag-marcus', name: 'Marcus Reed', states: ['AZ', 'NV'], mode: 'appts', hours: DEFAULT_LIVE_HOURS, tz: 'America/Phoenix', app: true, free: true, notChecking: true, notPaused: true },
]
export const agentForState = state => SAMPLE_AGENTS.find(a => a.states.includes(state)) || SAMPLE_AGENTS[0]
// N-C-03: Sent → Seen → Yes / No / No answer, on a 30 s timer the server keeps (sample: this browser).
export const CHECK_STEPS = ['sent', 'seen', 'answer']
export const CHECK_WORD = { sent: 'Sent', seen: 'Seen', yes: 'Yes: transferring', no: 'No: book them', none: 'No answer: book them', fail: "Couldn't reach agent", bounced: 'Agent missed it: back to you' }
export function checkStep(ms, answer = null) {
  if (answer) return answer
  if (ms >= 30000) return 'none'
  return ms >= 4000 ? 'seen' : 'sent'
}

// N-B-28, N-B-47, N-B-48: every outcome; one must be saved before Available; a reminder at 60 s of wrap-up.
export const OUTCOMES = [
  ['booked', 'Booked'], ['transferred', 'Live transfer'], ['callback', 'Callback set'], ['no_answer', 'No answer'], ['voicemail', 'Left a voicemail'],
  ['someone_else', 'Spoke to someone else'], ['not_interested', 'Not interested'], ['wrong_number', 'Wrong number'], ['do_not_call', 'Do not call'], ['not_eligible', 'Not eligible'], ['upset_legal', 'Upset or legal threat'],
]
// N-B-50: an upset or legal outcome alerts the admins with the lead's timeline (no recording at launch, Q51).
export const ALERTS_ADMIN = ['upset_legal']
export const WRAP_REMIND_S = 60
export const AGE_LIMIT = 80 // the agents' oldest age (Brayden's rule; sample)
export function ageRule(age) {
  const n = Number(age)
  if (!age || Number.isNaN(n)) return { ok: null }
  if (n < 18) return { ok: false, close: 'not_eligible', why: 'Under 18: closes as Not eligible' }
  if (n > AGE_LIMIT) return { ok: false, close: 'not_eligible', why: `Over ${AGE_LIMIT}: past the agents' age limit` }
  return { ok: true }
}
// "Spoke to someone else": a spouse can set a callback, but never book or give consent for the person.
export const SOMEONE_ELSE = { canCallback: true, canBook: false, canConsent: false }

// N-F-19, N-B-51, N-C-53: the script per call type with its required lines (ticked and saved on the call), the
// unlicensed line, and the coverage cue (transfer or book).
export const SCRIPTS = {
  lead: { title: 'Speed to lead', lines: [
    ['hello', 'Hi, this is {me} with Deedstone. You asked about mortgage protection a moment ago.', true],
    ['consent', 'Read the consent line if they called in.', false],
    ['age', 'Ask their age and state.', true],
    ['need', 'Ask what they want to protect (mortgage, family, final costs).', true],
    ['next', 'Check the agent, or book them on the agent\'s calendar.', true],
  ] },
}
export const BOUNDARY = "I'm not licensed to talk about coverage, price or whether you qualify. Your licensed agent will go through all of that with you."
export const COVERAGE_CUE = 'Coverage, price or "do I qualify"? Check the agent to transfer now, or book them.'
export const requiredLeft = (lines, ticked) => lines.filter(([k, , req]) => req && !ticked[k]).length

// N-B-27: one tap leaves the approved Deedstone voicemail with the callback number; it counts as a try.
export const VOICEMAIL = { name: 'Deedstone callback v2', text: 'Hi, this is Deedstone returning your request about mortgage protection. Call us back at (800) 555-0110. Thank you.', approved: 'Oct 28' }

// N-C-55: a best number, formatted, checked against other leads, used by the reminders.
export const formatPhone = raw => { const d = String(raw || '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, ''); return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : null }
export const KNOWN_NUMBERS = ['(512) 555-0199', '(214) 555-0199']
export const bestNumberCheck = (raw, known = KNOWN_NUMBERS) => { const f = formatPhone(raw); if (!f) return { ok: false, why: 'Ten digits, like (512) 555-0123' }; if (known.includes(f)) return { ok: false, why: 'Another lead has this number. Check with the team.' }; return { ok: true, value: f } }

// N-C-39: booking notes the agent sees on the appointment card.
export const NOTE_CHIPS = ['Spouse joining', 'Use the best number', 'Hard of hearing: speak slowly', 'Prefers Spanish']

// Call tasks the automatic replier makes from incoming texts (N-B-34, N-B-71, N-E-64): the VA before booking or for
// servicing; coverage questions go to the agent. No reply box: the VA calls.
export const CALL_TASKS = [
  { id: 'ct-1', who: 'Linda Park', text: 'Can you call me after 3?', reply: "Thanks, we'll call you shortly.", kind: 'Call me', at: '1:52 PM', for: 'va', lead: null },
  { id: 'ct-2', who: 'Hector Ruiz', text: 'yes still interested', reply: "Great, we'll call you shortly.", kind: 'Check-in reply', at: '1:40 PM', for: 'va', lead: null },
  { id: 'ct-3', who: 'Gloria Santos', text: 'Did my old policy get cancelled?', reply: "Thanks, we'll call you shortly.", kind: 'Servicing question', at: '12:58 PM', for: 'va', lead: null },
  { id: 'ct-4', who: 'Robert Chen', text: 'Does my policy cover my wife too?', reply: 'Your agent will call you shortly.', kind: 'Coverage question', at: '12:30 PM', for: 'agent', lead: null },
]
export const myCallTasks = (tasks = CALL_TASKS) => tasks.filter(t => t.for === 'va')

// N-E-61: verify the caller (name and date of birth) before any policy detail; an unknown number gets matched first.
export const verifyOk = (v, client) => !!client && v.name.trim().toLowerCase() === String(client.name || '').toLowerCase() && !!v.dob && v.dob === client.dob
