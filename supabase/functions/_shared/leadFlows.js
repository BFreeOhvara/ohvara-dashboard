// P902 — after the speed-to-lead call: one outcome per first call, and the texts each outcome gets.
// Brayden's design: brain/ohvara/Lead Text Workflows.md (Nov 7 22:43, Nov 8 14:36). Plain JS with no imports, so the
// edge functions (Deno), the portal (src/lib/leadFlows.js re-exports it) and node --test all run the same rules.
// Migration p902_lead_outcomes.sql is the SQL side; src/p902.test.js checks the two agree.
//
// The rules:
//   * A new lead gets a CALL first (the AI within 10 s, or a VA when the AI is off), never a text.
//   * Every first call ends in exactly one outcome (FIRST_CALL_OUTCOMES). Ohvara stores it, shows it on the lead's
//     timeline and sends it to GoHighLevel as a `call_outcome` event.
//   * Only two outcomes start texts: no answer and booked ("not now" WITH a time is booked as a callback).
//     Transferred, hard no, wrong number, opt-out and "not now" without a time send no texts.
//   * GoHighLevel's workflows send the texts (engine slot). Until it's connected, the portal shows each planned text
//     as "Planned" (planFlow below), so Brayden can see the flow. Wording is DRAFT (Brayden's hard stop).
//   * Anything the lead does (answers, replies, books by link, opts out) stops the current flow and starts the
//     right one (onAction).

export const FIRST_CALL_OUTCOMES = ['no_answer', 'booked', 'transferred', 'not_now', 'hard_no', 'wrong_number', 'opt_out']
export const FLOWS = ['no_answer', 'booked']

// Staff words (admin, VA). Agent screens use AGENT_OUTCOME and never say "AI".
export const OUTCOME_LABEL = {
  no_answer: 'No answer', booked: 'Booked', transferred: 'Transferred', not_now: 'Not now', hard_no: 'Hard no',
  wrong_number: 'Wrong number', opt_out: 'Opted out',
}
export const AGENT_OUTCOME = {
  no_answer: 'No answer', booked: 'Reached them. Booked', transferred: 'Reached them. Live transfer to you',
  not_now: 'Reached them. Not a good time', not_now_time: 'Reached them. Booked a callback', hard_no: 'Reached them. Not interested',
  wrong_number: 'Wrong number', opt_out: 'Asked not to be called',
}
export const isOutcome = o => FIRST_CALL_OUTCOMES.includes(o)

// Which text flow an outcome starts (null = no texts).
export function flowFor(outcome, { callbackAt = null } = {}) {
  if (outcome === 'no_answer') return 'no_answer'
  if (outcome === 'booked') return 'booked'
  if (outcome === 'not_now' && callbackAt) return 'booked'
  return null
}

// Where the lead lands after the first call. stage: the agent's board stage (src/template/leadLifecycle.js STAGES);
// db: leads.inbound_stage (180); outcome/reason: leads.outcome / outcome_reason (215). bad: admin's lead-quality list.
export function landingFor(outcome, { callbackAt = null } = {}) {
  switch (outcome) {
    case 'no_answer': return { stage: 'calling', db: 'contacting', outcome: null, reason: null, bad: false }
    case 'booked': return { stage: 'booked', db: 'booked', outcome: null, reason: null, bad: false }
    case 'transferred': return { stage: 'ringing', db: 'contacting', outcome: null, reason: null, bad: false }
    case 'not_now':
      return callbackAt
        ? { stage: 'booked', db: 'booked', outcome: null, reason: null, bad: false }
        : { stage: 'follow_up', db: 'follow_up', outcome: 'follow_up', reason: 'Not a good time on the first call', bad: false }
    case 'hard_no': return { stage: 'not_interested', db: 'lost', outcome: 'not_interested', reason: 'Not interested on the first call', bad: false }
    case 'wrong_number': return { stage: 'not_interested', db: 'lost', outcome: 'not_interested', reason: 'Wrong number', bad: true }
    case 'opt_out': return { stage: 'opted_out', db: 'lost', outcome: null, reason: null, bad: false }
    default: return null
  }
}

// The VA desk's first-call result (leads.va_outcome, P882) → the same outcomes. A VA callback with a time is "not now
// with a time"; a VA "not interested" with the Wrong number reason is a wrong number.
export function fromVaOutcome(vaOutcome, { reason = null } = {}) {
  switch (vaOutcome) {
    case 'not_reached': return 'no_answer'
    case 'booked': return 'booked'
    case 'transferred': return 'transferred'
    case 'callback': return 'not_now'
    case 'not_interested': return /wrong number/i.test(String(reason || '')) ? 'wrong_number' : 'hard_no'
    default: return null
  }
}

// ── The flows, step by step (DRAFT words; {first} {agent} {day} {time} {zone} {number} {link}) ──────────────────────
// at: when, on the lead's own wall clock. { mins } from the flow's start; { day, time } a day after the start's date at a
// local time; for the booked flow { apptDay, time } (days before the appointment's date) or { apptMins } (before it).
// kind: text (GoHighLevel sends it) | call (a call task for our team) | close (the flow ends the lead).
export const FLOW_STEPS = {
  no_answer: [
    { key: 'na_text_now', kind: 'text', at: { mins: 0 }, label: 'Missed-call text',
      words: "Hi {first}, it's Deedstone. We just tried to call about the life insurance info you asked for. Pick a time that works for you: {link}" },
    { key: 'na_call_today', kind: 'call', at: { mins: 180 }, label: 'Calls again later today', sameDayBy: '19:30' },
    { key: 'na_call_d1', kind: 'call', at: { day: 1, time: '09:30' }, label: 'Calls again, next morning' },
    { key: 'na_text_d1', kind: 'text', at: { day: 1, time: '09:35' }, label: 'Text, next morning',
      words: 'Hi {first}, Deedstone again about your life insurance request. We just tried you. Pick a time that suits you: {link}' },
    { key: 'na_call_d3', kind: 'call', at: { day: 3, time: '10:00' }, label: 'Calls again, day 3' },
    { key: 'na_text_d3', kind: 'text', at: { day: 3, time: '10:05' }, label: 'Text, day 3',
      words: "Hi {first}, we're still happy to help with the life insurance info you asked for. Pick a day and time here: {link}" },
    { key: 'na_text_d7', kind: 'text', at: { day: 7, time: '12:00' }, label: 'Text, day 7',
      words: 'Hi {first}, one more check-in from Deedstone on your life insurance request. Book a time any time: {link}' },
    { key: 'na_checkin_30', kind: 'text', at: { day: 30, time: '11:00' }, label: 'Check-in, day 30',
      words: 'Hi {first}, checking in from Deedstone. Still want help with life insurance? Pick a time here: {link}' },
    { key: 'na_checkin_60', kind: 'text', at: { day: 60, time: '11:00' }, label: 'Check-in, day 60',
      words: 'Hi {first}, checking in from Deedstone. Still want help with life insurance? Pick a time here: {link}' },
    { key: 'na_checkin_90', kind: 'text', at: { day: 90, time: '11:00' }, label: 'Check-in, day 90',
      words: 'Hi {first}, a last check-in from Deedstone. If you still want help with life insurance, pick a time here: {link}' },
    { key: 'na_close', kind: 'close', at: { day: 97, time: '09:00' }, label: "Closed: couldn't reach" },
  ],
  booked: [
    { key: 'bk_confirm', kind: 'text', at: { mins: 0 }, label: 'Booking text',
      words: "You're set, {first}. {agent} will call you {day} at {time} ({zone}) from {number}. Reply C to confirm or change it here: {link}" },
    { key: 'bk_day_before', kind: 'text', at: { apptDay: 1, time: '18:30' }, label: 'Reminder, the evening before',
      words: 'Hi {first}, a reminder: {agent} calls you tomorrow at {time} ({zone}). Reply C to confirm or change it here: {link}' },
    { key: 'bk_morning', kind: 'text', at: { apptDay: 0, time: '08:30' }, label: 'Reminder, the morning of',
      words: 'Good morning {first}! {agent} calls you today at {time} ({zone}). Need a different time? {link}' },
    { key: 'bk_1h', kind: 'text', at: { apptMins: 60 }, label: 'Reminder, 1 hour before',
      words: '{agent} calls you in about an hour, at {time} ({zone}). Need a different time? {link}' },
  ],
}
export const TEXT_STEPS = Object.values(FLOW_STEPS).flat().filter(s => s.kind === 'text')
export const stepOf = key => Object.values(FLOW_STEPS).flat().find(s => s.key === key) || null

// ── Wall-clock helpers ('YYYY-MM-DDTHH:MM' on the lead's clock; no zones, so every runtime agrees) ──────────────────
const toMs = s => { const [d, t = '00:00'] = String(s).split('T'); const [y, m, dd] = d.split('-').map(Number); const [h, mi] = t.split(':').map(Number); return Date.UTC(y, m - 1, dd, h, mi) }
const fromMs = n => new Date(n).toISOString().slice(0, 16)
const addMins = (s, n) => fromMs(toMs(s) + n * 60000)
const atDay = (s, days, time) => `${fromMs(toMs(s.slice(0, 10)) + days * 86400000).slice(0, 10)}T${time}`
export const WINDOW = { start: '08:00', end: '21:00' } // texts and calls only inside the lead's window (P882 / smsWindow)

function inWindow(s) { const t = s.slice(11, 16); return t >= WINDOW.start && t < WINDOW.end }
// The first wall-clock time at or after s that is inside the window.
export function nextInWindow(s) {
  if (inWindow(s)) return s
  const t = s.slice(11, 16)
  return t >= WINDOW.end ? atDay(s, 1, WINDOW.start) : `${s.slice(0, 10)}T${WINDOW.start}`
}

// The flow's steps with their times. start: when the flow starts (the first call's end). appt: the booked time (booked
// flow). now: to mark each step done (in the past) or planned. stoppedAt: anything the lead did stops later steps.
// Returns [{ key, kind, label, at, state: 'done' | 'planned' | 'stopped', words }].
export function planFlow(flow, { start, appt = null, now = start, stoppedAt = null } = {}) {
  const steps = FLOW_STEPS[flow]
  if (!steps || !start) return []
  const out = []
  for (const st of steps) {
    let at = null
    const a = st.at
    if (a.mins != null) at = addMins(start, a.mins)
    else if (a.day != null) at = atDay(start, a.day, a.time)
    else if (!appt) continue
    else if (a.apptDay != null) at = atDay(appt, -a.apptDay, a.time)
    else if (a.apptMins != null) at = addMins(appt, -a.apptMins)
    if (st.kind !== 'close') at = nextInWindow(at)
    // A same-day call that can't fit before the evening cut-off is skipped (the next-morning call follows).
    if (st.sameDayBy && (at.slice(0, 10) !== start.slice(0, 10) || at.slice(11, 16) > st.sameDayBy)) continue
    if (flow === 'booked' && st.key !== 'bk_confirm') {
      // Reminders only after the booking text and before the call; the morning text only when it isn't on top of
      // the 1-hour one; the evening one only when the booking was made before that evening.
      if (at <= start || at >= appt) continue
      if (st.key === 'bk_morning' && toMs(appt) - toMs(at) < 150 * 60000) continue
    }
    const state = stoppedAt && at > stoppedAt ? 'stopped' : at <= now ? 'done' : 'planned'
    out.push({ key: st.key, kind: st.kind, label: st.label, at, state, words: st.words || null })
  }
  return out
}

// Fill a step's words for a preview (or a GoHighLevel custom-value check). Missing values read plainly.
export function fillWords(words, v = {}) {
  if (!words) return ''
  const vals = { first: v.first || 'there', agent: v.agent || 'your agent', day: v.day || 'at your time', time: v.time || '',
    zone: v.zone || 'your time', number: v.number || 'your agent’s number', link: v.link || 'deedstone.com/b/sample' }
  return words.replace(/\{(\w+)\}/g, (m, k) => (k in vals ? vals[k] : m)).replace(/\s{2,}/g, ' ')
}

// ── Anything the lead does stops the current flow and starts the right one ─────────────────────────────────────────
// action: answered (picked up a later call, or called us back) | replied (any text back) | confirmed ("C") |
//         booked_link (picked a time from the link) | booked (our team booked them) | opted_out (STOP, "don't call").
// Returns { stop: bool, start: flow | null, task: 'va_call' | null, note }.
export const ACTIONS = ['answered', 'replied', 'confirmed', 'booked_link', 'booked', 'opted_out']
export function onAction(flow, action) {
  if (action === 'opted_out') return { stop: !!flow, start: null, task: null, note: 'Opted out: every call and text stopped' }
  if (action === 'booked_link' || action === 'booked') {
    // A new booking restarts the booked texts for the new time.
    return { stop: !!flow, start: 'booked', task: null, note: 'Booked: booking texts started' }
  }
  if (flow === 'no_answer') {
    if (action === 'answered') return { stop: true, start: null, task: null, note: 'They answered: no-answer texts stopped' }
    if (action === 'replied' || action === 'confirmed') return { stop: true, start: null, task: 'va_call', note: 'They replied: no-answer texts stopped, our team calls them' }
  }
  if (flow === 'booked') {
    // A confirm or a question keeps the reminders going; the replier answers (P878) and C marks it Confirmed.
    if (action === 'confirmed') return { stop: false, start: null, task: null, note: 'Confirmed by text' }
    return { stop: false, start: null, task: null, note: null }
  }
  return { stop: false, start: null, task: null, note: null }
}

// ── The GoHighLevel event (P850 bridge: ghl_outbox event `call_outcome`, detail = these fields) ──────────────────────
// Jordan's workflows key off `flow` (no_answer / booked / none) and read the rest as custom fields on the contact.
export const GHL_OUTCOME_FIELDS = [
  ['ohvara_lead_id', 'Ohvara lead id'],
  ['first_call_outcome', 'no_answer · booked · transferred · not_now · hard_no · wrong_number · opt_out'],
  ['text_flow', 'no_answer · booked · none (which workflow to start)'],
  ['called_by', 'ai · va'],
  ['called_in_secs', 'Seconds from the lead arriving to the first dial'],
  ['call_at', 'When the first call ended (ISO, UTC)'],
  ['appointment_at', 'Booked time or callback time (ISO, UTC), booked flow only'],
  ['appointment_local', 'The same time in the lead’s words, e.g. "Thu at 2:30 PM"'],
  ['lead_tz', 'The lead’s time zone (IANA), e.g. America/Chicago'],
  ['agent_name', 'The agent’s first name'],
  ['agent_phone', 'The number the agent calls from (E.164)'],
  ['booking_link', 'The lead’s own book / change-time link'],
]
export function ghlOutcomeDetail(o = {}) {
  const flow = flowFor(o.outcome, { callbackAt: o.appointmentAt })
  return {
    ohvara_lead_id: o.leadId ?? null, first_call_outcome: o.outcome, text_flow: flow || 'none', called_by: o.by || 'ai',
    called_in_secs: o.secs ?? null, call_at: o.at ?? null, appointment_at: flow === 'booked' ? o.appointmentAt ?? null : null,
    appointment_local: flow === 'booked' ? o.appointmentLocal ?? null : null, lead_tz: o.tz ?? null,
    agent_name: o.agentFirst ?? null, agent_phone: o.agentPhone ?? null, booking_link: o.link ?? null,
  }
}
// The tag each outcome puts on the GoHighLevel contact (one at a time).
export const outcomeTag = o => `ohvara-call-${String(o).replace(/_/g, '-')}`
export const OUTCOME_TAGS = FIRST_CALL_OUTCOMES.map(outcomeTag)
