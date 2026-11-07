import { LEAD_TEXTS, SENDER, leadText } from './leadTexts.js'
import { phoneDigits, formatPhone } from './phoneMask.js'

// P873 — a lead, start to finish (brain/ohvara/Lead Lifecycle.md is the written version). Pure functions only, so
// the sample store, the screens and the tests share one set of rules, and P848 swaps the sample rows for
// the real lead rows and lead events without touching the screens.

// ── The sample clock ───────────────────────────────────────────────────────────────────────────────────────────
// Times are "wall clock" strings, 'YYYY-MM-DDTHH:MM' on the agent's clock. The sample clock is Mon, Nov 2, 2:14 PM.
export const SAMPLE_NOW = '2026-11-02T14:14'
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const toD = s => { const [d, t = '00:00'] = s.split('T'); const [y, m, dd] = d.split('-').map(Number); const [h, mi] = t.split(':').map(Number); return new Date(Date.UTC(y, m - 1, dd, h, mi)) }
const fromD = D => D.toISOString().slice(0, 16)
export const addMin = (s, n) => fromD(new Date(toD(s).getTime() + n * 60000))
export const minutesFrom = (a, b) => Math.round((toD(b) - toD(a)) / 60000)
export const dayLabel = s => { const D = toD(s); return `${DOW[D.getUTCDay()]}, ${MON[D.getUTCMonth()]} ${D.getUTCDate()}` }
export const timeLabel = s => { const D = toD(s); const h = D.getUTCHours(); return `${h % 12 || 12}:${String(D.getUTCMinutes()).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}` }
export const whenLabel = s => `${dayLabel(s)}, ${timeLabel(s)}`
// "Today, 1:52 PM", "Yesterday, …", "Tomorrow, …", or the day and date.
export function atLabel(s, now = SAMPLE_NOW) {
  const days = Math.round((toD(s.slice(0, 10)) - toD(now.slice(0, 10))) / 86400000)
  const word = { 0: 'Today', [-1]: 'Yesterday', 1: 'Tomorrow' }[days]
  return `${word || dayLabel(s)}, ${timeLabel(s)}`
}

// ── Stages ─────────────────────────────────────────────────────────────────────────────────────────────────────
// key: the sample stage. db: the lead row stage column (migration 180: new/contacting/booked/met/sold/follow_up/lost);
// outcome: leads.outcome (migration 215). lane: the Leads board column. who: who acts next.
export const STAGES = {
  new: { label: 'New', chip: 'New lead', lane: 'calling', db: 'new', who: 'The team calls within 5 minutes' },
  calling: { label: 'Calling', chip: 'Calling', lane: 'calling', db: 'contacting', who: 'The team, then automatic texts' },
  ringing: { label: 'Live transfer', chip: 'Ringing now', lane: 'live', db: 'contacting', who: 'You' },
  missed: { label: 'Missed transfer', chip: 'Missed transfer', lane: 'calling', db: 'contacting', who: 'The team books a time' },
  booked: { label: 'Booked', chip: 'Appointment booked', lane: 'booked', db: 'booked', who: 'You, at the time' },
  showed: { label: 'Showed', chip: 'Mark how it went', lane: 'booked', db: 'met', who: 'You' },
  no_show: { label: 'No-show', chip: 'No-show', lane: 'no_show', db: 'booked', who: 'The team rebooks' },
  follow_up: { label: 'Follow up', chip: 'Follow up', lane: 'follow', db: 'follow_up', outcome: 'follow_up', who: 'You' },
  sold: { label: 'Sold', chip: 'Sold', lane: 'sold', db: 'sold', outcome: 'sold', who: 'You submit it' },
  not_interested: { label: 'Not interested', chip: 'Not interested', lane: 'closed', db: 'lost', outcome: 'not_interested', who: 'No one' },
  unreachable: { label: 'Unreachable', chip: 'Closed: unreachable', lane: 'closed', db: 'lost', who: 'No one' },
  opted_out: { label: 'Opted out', chip: 'Closed: opted out', lane: 'closed', db: 'lost', who: 'No one' },
}
export const STAGE_KEYS = Object.keys(STAGES)
export const MAX_TRIES = 3

// The Leads board, left to right (the lead's path). Each stage sits in one lane.
export const LEAD_LANES = [
  { key: 'calling', label: 'Calling', tone: 'violet', empty: 'No one in the call sequence.' },
  { key: 'live', label: 'Live transfer', tone: 'warn', empty: 'No live call ringing.' },
  { key: 'booked', label: 'Booked', tone: 'blue', empty: 'No appointments booked yet.' },
  { key: 'no_show', label: 'No-show', tone: 'warn', empty: 'No missed appointments.' },
  { key: 'follow', label: 'Follow up', tone: 'teal', empty: 'No callbacks set.' },
  { key: 'sold', label: 'Sold', tone: 'green', empty: 'Sales you mark show here.' },
  { key: 'closed', label: 'Closed', tone: 'mute', empty: 'Nothing closed out.' },
].map(l => ({ ...l, stages: STAGE_KEYS.filter(k => STAGES[k].lane === l.key) }))

export const stageChipOf = l => {
  const s = STAGES[l.stage] || STAGES.new
  return l.stage === 'calling' ? `Calling, try ${Math.min(l.tries || 1, MAX_TRIES)} of ${MAX_TRIES}` : s.chip
}

// ── The timeline ───────────────────────────────────────────────────────────────────────────────────────────────
// Rows shaped like the lead-events table (migration 180): kind, state done | scheduled, at, label, by, role, and the text
// body for a text. role: lead | auto | team | you.
export const TEAM = 'Maya, Fulfillment'
const fullName = l => `${l.first_name} ${l.last_name}`
const apptWords = s => `${dayLabel(s)} at ${timeLabel(s)}`

export function seedEvents(l, now = SAMPLE_NOW) {
  const ev = []
  const add = (kind, at, label, o = {}) => ev.push({ id: `${l.id}-e${ev.length + 1}`, kind, at, label, state: at > now ? 'scheduled' : 'done', ...o })
  const text = (step, at, o = {}) => add('text_sent', at, 'Text', { step, text: leadText(step, { lead: l.first_name, appt: l.apptAt ? apptWords(l.apptAt) : undefined }), by: SENDER, role: 'auto', ...o })
  const team = (at, label, o = {}) => add('va_call', at, label, { by: TEAM, role: 'team', ...o })
  const you = (kind, at, label, o = {}) => add(kind, at, label, { by: 'You', role: 'you', ...o })
  const c = l.came
  const live = l.kind === 'live_call'
  add('came_in', c, live ? 'Called the number on the page' : 'Filled in the mortgage protection form', { by: fullName(l), role: 'lead' })
  text('instant', addMin(c, 1))

  const tries = (n, from) => {
    const at = [from, addMin(from, 24 * 60 - 7), addMin(from, 3 * 24 * 60 - 12)]
    const steps = ['not_reached_d0', 'not_reached_d1', 'not_reached_d3']
    for (let i = 0; i < n; i++) { team(at[i], `Called, try ${i + 1} of ${MAX_TRIES}. No answer`); text(steps[i], addMin(at[i], 1)) }
  }
  const book = () => {
    tries(1, addMin(c, 3))
    add('text_received', addMin(c, 28), 'Replied', { text: l.firstReply || 'Tomorrow after 5 works', by: l.first_name, role: 'lead' })
    team(addMin(c, 35), 'Called. Reached them')
    add('booked', addMin(c, 36), `Booked for ${whenLabel(l.apptAt)}`, { by: TEAM, role: 'team' })
    text('confirm', addMin(c, 37))
    text('reminder_day_before', addMin(l.apptAt, -24 * 60))
    text('reminder_1h', addMin(l.apptAt, -60))
  }

  switch (l.stage) {
    case 'new': team(addMin(c, 5), 'Calls within 5 minutes'); break
    case 'calling': {
      tries(l.tries || 1, addMin(c, 3))
      if (l.reply) add('text_received', l.reply.at, 'Replied', { text: l.reply.text, by: l.first_name, role: 'lead' })
      else if ((l.tries || 1) < MAX_TRIES) team(addMin(c, (l.tries || 1) * 24 * 60 + 60), `Calls again, try ${(l.tries || 1) + 1} of ${MAX_TRIES}`)
      else text('not_reached_d7', addMin(c, 7 * 24 * 60))
      break
    }
    case 'ringing':
      team(addMin(c, 2), 'Called. Reached them')
      add('transferred', addMin(c, 3), 'Live transfer. Ringing you now', { by: TEAM, role: 'team' })
      break
    case 'missed':
      team(addMin(c, 2), 'Called. Reached them')
      add('transferred', addMin(c, 3), 'Live transfer to you', { by: TEAM, role: 'team' })
      add('missed', addMin(c, 4), 'You did not pick up. The team is booking a time', { by: 'Automatic', role: 'auto' })
      team(addMin(c, 20), 'Books a time with them')
      break
    case 'unreachable':
      tries(MAX_TRIES, addMin(c, 3))
      text('not_reached_d7', addMin(c, 7 * 24 * 60))
      ;[30, 60, 90].forEach(d => text('not_reached_monthly', addMin(c, d * 24 * 60), { label: `Check-in, day ${d}` }))
      add('outcome', addMin(c, 97 * 24 * 60), 'Closed: no reply after the day 90 check-in', { by: 'Automatic', role: 'auto' })
      break
    case 'opted_out':
      tries(1, addMin(c, 3))
      add('text_received', addMin(c, 50), 'Replied', { text: 'STOP', by: l.first_name, role: 'lead' })
      text('stop_confirm', addMin(c, 50))
      add('outcome', addMin(c, 50), 'Closed: opted out. All calls and texts stopped', { by: 'Automatic', role: 'auto' })
      break
    default: { // booked, showed, no_show, follow_up, sold, not_interested
      // An appointment lead goes through booking; a live call the agent answered skips straight to talking.
      if (l.apptAt) book()
      else {
        team(addMin(c, 2), 'Called. Reached them')
        add('transferred', addMin(c, 3), 'Live transfer. You answered', { by: TEAM, role: 'team' })
      }
      const end = l.apptAt ? addMin(l.apptAt, 30) : addMin(c, 30)
      if (l.stage === 'no_show') {
        you('no_show', end, 'Marked no-show')
        text('no_show_rebook', addMin(end, 1))
        team(addMin(end, 45), 'Calls to rebook')
      }
      if (l.stage === 'follow_up') {
        you('outcome', end, `Showed. Follow up ${l.follow}`)
        you('follow_up', l.followAt || addMin(end, 24 * 60), 'Call back')
      }
      if (l.stage === 'sold') {
        you('outcome', end, 'Showed. Sold')
        if (l.submitted) you('became_client', addMin(end, 20), 'Submitted for servicing. Now a client')
      }
      if (l.stage === 'not_interested') you('outcome', end, `Showed. Not interested: ${(l.reason || 'Not interested right now').toLowerCase()}`)
    }
  }
  return ev.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))
}

// ── Moves ──────────────────────────────────────────────────────────────────────────────────────────────────────
// What the agent can do to a lead, and the timeline row it leaves. Returns the new lead.
const MOVE_ROWS = {
  showed: ['outcome', 'Showed'], booked: ['booked', 'Moved to Booked'], no_show: ['no_show', 'Marked no-show'],
  sold: ['outcome', 'Sold'], follow_up: ['outcome', 'Follow up'], not_interested: ['outcome', 'Not interested'],
}
export const AGENT_MOVES = Object.keys(MOVE_ROWS)

export function applyMove(lead, stage, extra = {}, now = SAMPLE_NOW) {
  if (!AGENT_MOVES.includes(stage)) throw new Error(`An agent cannot move a lead to ${stage}`)
  const s = STAGES[stage]
  const [kind, word] = MOVE_ROWS[stage]
  const label = stage === 'follow_up' && extra.follow ? `Follow up ${extra.follow}` : stage === 'not_interested' && extra.reason ? `Not interested: ${extra.reason.toLowerCase()}` : word
  const rows = [{ id: `${lead.id}-m${(lead.events || []).length + 1}`, kind, at: now, label, state: 'done', by: 'You', role: 'you' }]
  if (stage === 'no_show') {
    rows.push({ id: `${lead.id}-m${(lead.events || []).length + 2}`, kind: 'text_sent', step: 'no_show_rebook', at: now, label: 'Text', state: 'scheduled', text: leadText('no_show_rebook', { lead: lead.first_name }), by: SENDER, role: 'auto' })
    rows.push({ id: `${lead.id}-m${(lead.events || []).length + 3}`, kind: 'va_call', at: addMin(now, 45), label: 'Calls to rebook', state: 'scheduled', by: TEAM, role: 'team' })
  }
  const status = stage === 'sold' ? 'closed' : stage === 'not_interested' ? 'bad' : stage === 'follow_up' ? 'contacted' : lead.status
  return { ...lead, ...extra, stage, status, dbStage: s.db, outcome: s.outcome || (stage === 'no_show' || stage === 'showed' ? null : lead.outcome), fresh: false, events: [...(lead.events || []), ...rows] }
}

// The agent's own text back (a reply to a lead). Saved now; it sends once texting is switched on.
export function addReply(lead, text, now = SAMPLE_NOW) {
  const row = { id: `${lead.id}-r${(lead.events || []).length + 1}`, kind: 'text_sent', at: now, label: 'Your text', state: 'scheduled', text, by: 'You', role: 'you' }
  return { ...lead, reply: lead.reply ? { ...lead.reply, seen: true } : null, events: [...(lead.events || []), row] }
}

// ── Needs you now ──────────────────────────────────────────────────────────────────────────────────────────────
// The six things that need the agent, most urgent first, each with its one action. FYI items are quiet: the team
// is already on them.
export const TRIGGERS = [
  { key: 'live', title: 'Live transfer ringing', action: 'Answer' },
  { key: 'starting', title: 'Appointment starting', action: 'Join call' },
  { key: 'outcome', title: 'How did it go?', action: 'Mark outcome' },
  { key: 'reply', title: 'Replied by text', action: 'Reply' },
  { key: 'follow', title: 'Follow-up due today', action: 'Call back' },
  { key: 'servicing', title: 'A client needs you', action: 'Open' },
].map((t, i) => ({ ...t, rank: i + 1 }))
const T = Object.fromEntries(TRIGGERS.map(t => [t.key, t]))
export const JOIN_BEFORE = 15 // minutes before an appointment it starts to need you
export const APPT_LENGTH = 30

export const needsOutcome = (l, now = SAMPLE_NOW) => l.stage === 'showed' || (l.stage === 'booked' && !!l.apptAt && minutesFrom(l.apptAt, now) >= APPT_LENGTH)
const starting = (l, now) => l.stage === 'booked' && !!l.apptAt && minutesFrom(now, l.apptAt) <= JOIN_BEFORE && minutesFrom(l.apptAt, now) < APPT_LENGTH

export function needsYouNow({ leads = [], clients = [] }, now = SAMPLE_NOW) {
  const out = []
  const push = (t, l, what, when) => out.push({ id: `${t.key}-${l.id}`, trigger: t.key, rank: t.rank, title: t.title, action: t.action, ref: l.id, kind: 'lead', name: fullName(l), phone: l.phone, what, when })
  leads.filter(l => l.stage === 'ringing').forEach(l => push(T.live, l, `${l.city}, ${l.state} · on the line with the team`, 'Now'))
  leads.filter(l => starting(l, now)).forEach(l => {
    const m = minutesFrom(now, l.apptAt)
    push(T.starting, l, `Appointment at ${timeLabel(l.apptAt)}`, m > 0 ? `In ${m} min` : 'Now')
  })
  leads.filter(l => needsOutcome(l, now)).forEach(l => push(T.outcome, l, l.stage === 'showed' ? 'You talked. Mark the outcome' : `Appointment at ${timeLabel(l.apptAt)} ended`, l.stage === 'showed' ? 'Now' : 'Ended'))
  leads.filter(l => l.reply && !l.reply.seen).forEach(l => push(T.reply, l, `“${l.reply.text}”`, l.reply.at.slice(0, 10) === now.slice(0, 10) ? timeLabel(l.reply.at) : atLabel(l.reply.at, now)))
  leads.filter(l => l.stage === 'follow_up' && l.follow === dayLabel(now)).forEach(l => push(T.follow, l, 'You set this callback', 'Today'))
  clients.filter(c => c.stage === 'needs_attention').forEach(c => out.push({ id: `servicing-${c.id}`, trigger: 'servicing', rank: T.servicing.rank, title: T.servicing.title, action: T.servicing.action, ref: c.id, kind: 'client', name: `${c.client_first_name} ${c.client_last_name}`, phone: c.client_phone, what: c.attention || 'Needs you', when: 'Today' }))
  return out.sort((a, b) => a.rank - b.rank)
}

export function forYourInfo({ leads = [] }) {
  const out = []
  leads.forEach(l => {
    if (l.stage === 'missed') out.push({ id: `fyi-missed-${l.id}`, ref: l.id, name: fullName(l), title: 'Missed transfer', what: 'The team is booking a time' })
    if (l.stage === 'no_show') out.push({ id: `fyi-noshow-${l.id}`, ref: l.id, name: fullName(l), title: 'No-show', what: 'The team is rebooking' })
    if (l.stage === 'booked' && l.fresh) out.push({ id: `fyi-booked-${l.id}`, ref: l.id, name: fullName(l), title: 'New booking', what: `Booked for ${whenLabel(l.apptAt)}` })
  })
  return out
}

// ── Submit knows your leads ────────────────────────────────────────────────────────────────────────────────────
// Matches for what the agent typed in the client name or phone: their leads and clients, best first.
export function matchPeople(q, leads = [], clients = [], max = 6) {
  const text = String(q || '').trim().toLowerCase()
  const digits = phoneDigits(text)
  const byPhone = /^[\d\s()+.-]+$/.test(text)
  if (byPhone ? digits.length < 3 : text.length < 2) return []
  const rows = [
    ...leads.map(l => ({ kind: 'lead', id: l.id, name: fullName(l), phone: l.phone, city: l.city, state: l.state, stage: stageChipOf(l), sold: l.stage === 'sold' })),
    ...clients.map(c => ({ kind: 'client', id: c.id, name: `${c.client_first_name} ${c.client_last_name}`, phone: c.client_phone, city: c.city, state: c.state, stage: 'Client' })),
  ]
  const score = r => {
    if (byPhone) return phoneDigits(r.phone).includes(digits) ? 1 : 0
    const n = r.name.toLowerCase()
    if (n.startsWith(text)) return 3
    if (n.split(' ').some(w => w.startsWith(text))) return 2
    return text.length >= 3 && n.includes(text) ? 1 : 0
  }
  return rows.map(r => ({ ...r, phone: formatPhone(r.phone), score: score(r) }))
    .filter(r => r.score > 0)
    .sort((a, b) => b.score - a.score || (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'lead' ? -1 : 1))
    .slice(0, max)
}

// The form values a picked match fills in (Submit's EMPTY_SUBMIT fields).
export const fillFromMatch = m => ({ name: m.name, phone: phoneDigits(m.phone), city: m.city || '', state: m.state || '', linked: { kind: m.kind, id: m.id, stage: m.stage } })

export { LEAD_TEXTS }
