// P852 — the Fulfillment (VA) portal on real data: pure mappers from the existing tables and RPCs to the record shapes
// of the sample door (src/template/ful/data.js), so the screens read real rows without knowing it. No network here
// (hooks/fulRealData.js fetches); every function is plain data in, plain data out, and node-tested.
import { clockOf, dateOf, zoneOf, blockTime } from './callSlots.js'

export const DEFAULT_TZ = 'America/Chicago'
const DAY = 864e5

// ── The clock ────────────────────────────────────────────────────────────────────────────────────────────────────
// The sample calendar names days by their November date (2..13). Real days are keyed yyyymmdd (20261107): unique,
// sortable and comparable with < and >, so the screens' "later than today" checks keep working across months.
export const keyOfDate = ymd => Number(String(ymd).replace(/-/g, ''))
export const keyOf = (iso, tz) => keyOfDate(dateOf(iso, tz))
export const dateOfKey = key => { const s = String(key); return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` }
const noon = key => new Date(`${dateOfKey(key)}T12:00:00Z`)
const addDays = (key, n) => keyOfDate(new Date(noon(key).getTime() + n * DAY).toISOString().slice(0, 10))
const fmtKey = (key, opts) => noon(key).toLocaleDateString('en-US', { timeZone: 'UTC', ...opts })
export const keyDayName = key => fmtKey(key, { weekday: 'short' })
export const keyDateText = key => fmtKey(key, { month: 'short', day: 'numeric' })
const dow = key => noon(key).getUTCDay()

// The clock the VA screens read: today, this week and next (Mon to Fri), the next five working days to book on.
export function realClock(nowMs, tz = DEFAULT_TZ) {
  const today = keyOf(nowMs, tz)
  const monday = addDays(today, -((dow(today) + 6) % 7))
  const week = start => [0, 1, 2, 3, 4].map(i => addDays(start, i))
  const bookDays = []
  for (let k = today; bookDays.length < 5; k = addDays(k, 1)) if (dow(k) >= 1 && dow(k) <= 5) bookDays.push([keyDayName(k), k])
  return {
    real: true, tz, today, weeks: [week(monday), week(addDays(monday, 7))], nowIso: new Date(nowMs).toISOString(), bookDays,
    dayName: keyDayName, dateText: keyDateText, dayNum: key => Number(String(key).slice(6)), isoOf: dateOfKey,
  }
}

// 'Today, 1:45 PM', 'Fri, 10:00 AM' (this week) or 'Nov 12, 10:00 AM': the sample's time words, on the viewer's clock.
export function whenText(iso, nowMs, tz = DEFAULT_TZ) {
  if (!iso) return ''
  const k = keyOf(iso, tz)
  const t = keyOf(nowMs, tz)
  const time = clockOf(iso, tz)
  if (k === t) return `Today, ${time}`
  if (k === addDays(t, -1)) return `Yesterday, ${time}`
  const gap = (noon(k) - noon(t)) / DAY
  return Math.abs(gap) < 7 ? `${keyDayName(k)}, ${time}` : `${keyDateText(k)}, ${time}`
}
const shortDate = (iso, tz) => (iso ? keyDateText(keyOf(iso, tz)) : '')
const ms = iso => (iso ? new Date(iso).getTime() : 0)

// ── Clients and cancellation calls (policies assigned to this VA) ─────────────────────────────────────────────────
// A policy's state on the VA side: still being set up (old policy to cancel) until fulfillment is Complete.
export function toClient(p, nowMs, tz = DEFAULT_TZ) {
  const done = p.fulfillment_stage === 'Complete'
  const at = p.scheduled_call_at
  return {
    id: p.id, client_first_name: p.client_first_name || '', client_last_name: p.client_last_name || '', agent_id: p.agent_id,
    agent: p.agent?.full_name || 'Agent', client_phone: p.client_phone || '', city: p.client_city || '', state: p.state || '',
    carrier_name: p.carrier_name || '', product_name: p.product_name || '', policy_number: p.policy_number || '', monthly_premium: Number(p.monthly_premium) || 0,
    stage: done ? 'protected' : 'setting_up', attention: null, note: p.notes || '', calls: [],
    next_step: done ? '' : at ? `Cancellation call ${whenText(at, nowMs, tz)}` : 'Cancellation call to book',
    submitted: shortDate(p.created_at, tz), sms_consent: null,
  }
}
export const fullName = c => `${c.client_first_name} ${c.client_last_name}`.trim() || 'Client'

// The call's status in the sample's words (template/ful/words.js CALL_WORD): booked, cancelled, no_answer.
export function callStatus(p) {
  if (p.fulfillment_stage === 'Complete') return 'cancelled'
  if (p.last_call_outcome === 'no_answer' && !(ms(p.scheduled_call_at) > ms(p.last_call_at))) return 'no_answer'
  return 'booked'
}
// One cancellation call per policy, at its booked time (or when it last happened).
export function toCall(p, nowMs, tz = DEFAULT_TZ) {
  const status = callStatus(p)
  const iso = (status === 'cancelled' ? p.fulfillment_completed_at : status === 'no_answer' ? p.last_call_at : p.scheduled_call_at) || p.scheduled_call_at || p.created_at
  const c = toClient(p, nowMs, tz)
  const clientTz = p.client_timezone || zoneOf(p.state, p.client_city) || null
  return {
    id: p.id, client_id: p.id, iso, tz: clientTz, status, old_carrier: p.current_carrier || 'Old carrier',
    confirmation: p.cancellation_confirmation || '', notes: p.cancellation_notes || '', at: status === 'booked' && ms(iso) > nowMs ? ms(iso) : null,
    live: !!p.call_live_since, tries: p.call_attempts || 0,
    day: keyOf(iso, tz), time: clockOf(iso, tz), when: blockTime(iso, tz, clientTz), name: fullName(c), client: c, agent: c.agent, carrier: c.carrier_name,
  }
}

// ── The queue (va_queue rows) ────────────────────────────────────────────────────────────────────────────────────
const TYPE = { mortgage_protection: 'Mortgage protection', policy_help: 'Policy help', final_expense: 'Final expense', term_life: 'Term life' }
export const typeOf = t => TYPE[t] || (t ? String(t).replace(/_/g, ' ').replace(/^./, c => c.toUpperCase()) : 'Policy help')
export function toQueueLead(r, nowMs, tz = DEFAULT_TZ, me = null) {
  const ck = r.va_checklist || {}
  return {
    id: r.lead_id, name: String(r.contact_name || '').trim() || 'Unnamed lead', phone: r.phone || '', city: r.city || '', state: r.state || '',
    type: typeOf(r.lead_type), bucket: r.bucket || 'new', came: whenText(r.created_at, nowMs, tz), came_at: r.created_at, tries: r.va_attempts || 0,
    callback: r.va_callback_at ? whenText(r.va_callback_at, nowMs, tz) : null, cb_iso: r.va_callback_at || null, cb_tz: zoneOf(r.state, r.city), va_id: me,
    note: '', checklist: { question_type: ck.question_type || '', carrier: ck.carrier || '', state: ck.state || '', urgency: ck.urgency || '' },
    held_until: r.claimed_by_me && ms(r.claim_expires_at) > nowMs ? ms(r.claim_expires_at) : null, source: r.lead_source || null, real: true,
  }
}

// ── Servicing (va_servicing_queue rows) ──────────────────────────────────────────────────────────────────────────
export function dueOf(r, nowMs, tz = DEFAULT_TZ) {
  if (r.status === 'done' || r.status === 'cancelled') return 'done'
  if (!r.due_at) return 'none'
  const k = keyOf(r.due_at, tz)
  const t = keyOf(nowMs, tz)
  return k < t ? 'overdue' : k === t ? 'today' : 'later'
}
export function toTask(r, nowMs, tz = DEFAULT_TZ) {
  const [first, ...rest] = String(r.client_name || 'Client').trim().split(/\s+/)
  const client = { id: r.policy_id || r.lead_id, client_first_name: first, client_last_name: rest.join(' '), client_phone: r.client_phone || '', state: r.client_state || '', city: '', carrier_name: r.carrier || '', agent_id: null }
  const due = dueOf(r, nowMs, tz)
  return {
    id: r.task_id, kind: r.kind, client_id: client.id, due, due_at: r.due_at || null,
    due_text: due === 'done' ? 'Done' : r.due_at ? whenText(r.due_at, nowMs, tz).replace(/^(\w+), /, (m, d) => (d === 'Today' ? 'Today, ' : m)) : (r.best_time ? `Best time: ${r.best_time}` : 'No date yet'),
    status: r.status, outcome: r.outcome || null, held: !!r.mine && ms(r.claim_expires_at) > nowMs, note: r.agent_reply_note ? `${r.note || ''}${r.note ? '\n' : ''}Agent: ${r.agent_reply_note}` : (r.note || ''),
    name: r.client_name || 'Client', client, agent: r.agent_name || 'Agent', carrier: r.carrier || '', requested_by: r.requested_by || null, real: true,
  }
}

// ── Messages (my_message_threads + policy_messages) ──────────────────────────────────────────────────────────────
export function toThreads(threads, messages, me, nowMs, tz = DEFAULT_TZ) {
  const by = new Map()
  for (const m of messages || []) { if (!by.has(m.policy_id)) by.set(m.policy_id, []); by.get(m.policy_id).push(m) }
  return (threads || []).map(t => ({
    id: t.policy_id, client_id: t.policy_id, agent_id: t.agent_id, agent: t.agent_name || 'Agent', unread: t.unread_count || 0,
    name: `${t.client_first_name || ''} ${t.client_last_name || ''}`.trim() || 'Client', last_at: t.last_at,
    messages: (by.get(t.policy_id) || []).slice().sort((a, b) => ms(a.created_at) - ms(b.created_at))
      .map(m => ({ id: m.id, from: m.sender_id === me ? 'me' : 'agent', text: m.body, at: whenText(m.created_at, nowMs, tz) })),
  })).sort((a, b) => ms(b.last_at) - ms(a.last_at))
}

// ── The bell (notifications) ────────────────────────────────────────────────────────────────────────────────────
const KIND = [[/queue|lead/, 'queue'], [/cancel|pay|payout/, 'pay'], [/servic|task/, 'servicing'], [/message/, 'message'], [/shift|day_off/, 'shift'], [/call/, 'call']]
export const feedKind = type => (KIND.find(([re]) => re.test(String(type || ''))) || [null, 'note'])[1]
export function toFeed(n, nowMs, tz = DEFAULT_TZ) {
  return { id: n.id, who: n.title || 'Ohvara', text: n.detail || n.message || '', at: whenText(n.created_at, nowMs, tz).replace(/^Today, /, ''), kind: feedKind(n.type), read: !!n.read, link: n.link || null }
}

// ── Pay (fulfillment_cancels, fulfillment_payouts, recovery_config, payout account) ──────────────────────────────
const CANCEL_STATUS = { verified: 'verified', paid: 'verified', checking: 'checking', pending: 'checking', needs_listen: 'needs_listen', rejected: 'rejected' }
export const cancelStatus = s => CANCEL_STATUS[s] || 'checking'
const range = (a, b, tz) => { const x = keyOf(`${a}T12:00:00Z`, tz); const y = keyOf(`${b}T12:00:00Z`, tz); return `${keyDateText(x)} to ${keyDateText(y)}` }
export function toPay({ cancels = [], payouts = [], rateCents = null, account = null, email = '' }, nowMs, tz = DEFAULT_TZ) {
  const clock = realClock(nowMs, tz)
  const week = clock.weeks[0]
  const rows = cancels.map(c => {
    const day = keyOf(c.logged_at || c.created_at, tz)
    return { id: c.id, day, status: cancelStatus(c.status), amount: (c.amount_cents ?? rateCents ?? 0) / 100, call: { name: c.client_name || 'Client', carrier: c.carrier_name || '', agent: c.agent_name || '', day, time: clockOf(c.logged_at || c.created_at, tz) } }
  }).filter(r => week.includes(r.day) || r.day > week[4])
  const sum = st => rows.filter(r => st.includes(r.status)).reduce((t, r) => t + r.amount, 0)
  const paid = payouts.filter(p => p.status === 'paid').sort((a, b) => String(b.period_start).localeCompare(String(a.period_start)))
  return {
    rate: rateCents == null ? null : rateCents / 100, rows,
    byDay: week.map(d => ({ day: d, name: keyDayName(d), verified: rows.filter(r => r.day === d && r.status === 'verified').length, checking: rows.filter(r => r.day === d && r.status !== 'verified').length, later: d > clock.today })),
    payouts: paid.map(p => ({ id: p.id, week: range(p.period_start, p.period_end, tz), paid: p.paid_at ? keyDateText(keyOf(p.paid_at, tz)) : '', amount: (p.amount_cents || 0) / 100, count: p.cancels || 0, hours: p.hours == null ? null : Number(p.hours), status: 'paid' })),
    pending: payouts.filter(p => p.status !== 'paid').map(p => ({ id: p.id, status: p.status, amount: (p.amount_cents || 0) / 100, week: range(p.period_start, p.period_end, tz) })),
    verified: sum(['verified']), checking: sum(['checking']), listen: rows.filter(r => r.status === 'needs_listen').length, earned: sum(['verified', 'checking']),
    payday: keyDateText(addDays(clock.weeks[1][0], 0)), lastWeek: paid[0] ? (paid[0].amount_cents || 0) / 100 : 0,
    account: account
      ? { bank: account.bank_name || 'Bank', last4: account.last4 || '••••', taxEmail: email, status: account.payouts_enabled ? 'Payouts on' : account.details_submitted ? 'Being checked' : 'Not finished' }
      : { bank: 'No bank yet', last4: '', taxEmail: email, status: 'Add your bank in Settings' },
    real: true,
  }
}

// ── Agents the VA serves (va_agent_roster) ──────────────────────────────────────────────────────────────────────
// The roster gives names only. Hours, zone, licence states and live-call duty aren't readable by a VA yet (a door:
// a VA-readable roster function), so states stay null and the licence check (template/ful/p879 licensedIn) says no:
// a VA can't book an agent whose licence we can't see.
export function toAgents(roster, clients = []) {
  return (roster || []).map(a => ({
    id: a.id, name: a.full_name || 'Agent', city: '', states: null, hours: 'Hours not connected yet', duty: false, tz: DEFAULT_TZ, open: 540, close: 1080, days: [1, 2, 3, 4, 5], appt: null,
    clients: clients.filter(c => c.agent_id === a.id).length, real: true,
  }))
}

// ── The day (page heads, Overview) ──────────────────────────────────────────────────────────────────────────────
export function dayOf({ calls = [], queue = [], tasks = [], threads = [] }, today) {
  const todays = calls.filter(k => k.day === today).sort((a, b) => ms(a.iso) - ms(b.iso))
  const next = todays.find(k => k.status === 'booked') || null
  return {
    today: todays, next, later: todays.filter(k => k.status === 'booked' && k.id !== next?.id), done: todays.filter(k => k.status !== 'booked'),
    tomorrow: calls.filter(k => k.day > today).sort((a, b) => a.day - b.day).filter((k, _, a) => k.day === a[0].day),
    week: calls,
    queue: { callback_due: queue.filter(l => l.bucket === 'callback_due'), new: queue.filter(l => l.bucket === 'new'), not_reached: queue.filter(l => l.bucket === 'not_reached') },
    tasks: { overdue: tasks.filter(t => t.due === 'overdue'), today: tasks.filter(t => t.due === 'today'), later: tasks.filter(t => t.due === 'later'), none: tasks.filter(t => t.due === 'none'), done: tasks.filter(t => t.due === 'done') },
    unread: threads.reduce((n, t) => n + (t.unread || 0), 0),
  }
}

// Everything at a time, one list (the Schedule): cancellation calls and callbacks due (people from the queue).
export function scheduleOf({ calls = [], queue = [] }, tz = DEFAULT_TZ) {
  const items = calls.map(k => ({
    ref: k.id, kind: 'call', day: k.day, time: k.time, iso: k.iso, tz: k.tz, when: k.when, status: k.status, name: k.name,
    label: `${k.old_carrier} to ${k.carrier}`, sub: `${k.agent}'s client`, done: k.status === 'cancelled' || k.status === 'passed',
  }))
  queue.filter(l => l.bucket === 'callback_due' && l.cb_iso).forEach(l => items.push({
    ref: l.id, kind: 'callback', day: keyOf(l.cb_iso, tz), time: clockOf(l.cb_iso, tz), iso: l.cb_iso, tz: l.cb_tz, when: blockTime(l.cb_iso, tz, l.cb_tz),
    tone: 'warn', status: 'callback', word: 'Callback', name: l.name, label: `${l.type} · call back`, sub: [l.city, l.state].filter(Boolean).join(', '), done: false,
  }))
  return items.sort((a, b) => ms(a.iso) - ms(b.iso))
}

// ── Writes: the sample action's arguments → the RPC's ───────────────────────────────────────────────────────────
// Servicing outcomes go through va_servicing_outcome; 'no_answer' is an attempt the server reschedules.
export const servicingArgs = (id, outcome) => ({ p_task: id, p_outcome: outcome })
// A cancellation call's result: Cancelled → fulfillment_mark_cancelled; No answer → fulfillment_end_call.
export function callResultRpc(id, status, extra = {}) {
  if (status === 'cancelled') return ['fulfillment_mark_cancelled', { p_policy: id, p_notes: extra.notes ?? null, p_set_notes: extra.notes != null, p_proof: !!extra.proof, p_confirmation: extra.confirmation || null, p_effective: extra.effective || null, p_drafts_stopped: extra.drafts_stopped ?? null }]
  if (status === 'no_answer') return ['fulfillment_end_call', { p_policy: id, p_outcome: 'no_answer', p_reason: extra.reason || null }]
  if (status === 'passed') return ['fulfillment_pass_on', { p_policy: id }]
  return null
}
