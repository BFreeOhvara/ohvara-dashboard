// P848 — real rows into the record shapes the agent portal screens read (src/template/data/index.js names them).
// Pure functions only, so they can be tested without a database. Times become wall-clock strings on the agent's
// clock ('YYYY-MM-DDTHH:MM'), the same form the lifecycle rules (template/leadLifecycle.js) use for the sample.
import { whenLabel } from '../template/leadLifecycle.js'

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export const DEFAULT_TZ = 'America/Chicago'

// An instant (ISO string or ms) as the wall clock in tz: '2026-11-07T14:05'.
export function wallOf(at, tz = DEFAULT_TZ) {
  if (at == null || at === '') return null
  const d = new Date(at)
  if (Number.isNaN(d.getTime())) return null
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz || DEFAULT_TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(d).map(x => [x.type, x.value]))
  return `${p.year}-${p.month}-${p.day}T${p.hour === '24' ? '00' : p.hour}:${p.minute}`
}
const wallD = w => new Date(`${w.slice(0, 10)}T12:00:00Z`)
const time12 = w => { const h = Number(w.slice(11, 13)); return `${h % 12 || 12}:${w.slice(14, 16)} ${h < 12 ? 'AM' : 'PM'}` }

// The real Mon to Fri week around `nowWall` (the data useWeek shape): [weekday, day, month, iso].
export function weekOf(nowWall) {
  const d = wallD(nowWall)
  const back = (d.getUTCDay() + 6) % 7 // days since Monday
  const mon = new Date(d.getTime() - back * 86400000)
  const days = Array.from({ length: 5 }, (_, i) => {
    const x = new Date(mon.getTime() + i * 86400000)
    return [DOW[x.getUTCDay()], x.getUTCDate(), MON[x.getUTCMonth()], x.toISOString().slice(0, 10)]
  })
  const todayIso = nowWall.slice(0, 10)
  const today = days.find(x => x[3] === todayIso)?.[1] ?? null
  return { days, today, time: time12(nowWall), year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 }
}

const splitName = n => { const parts = String(n || '').trim().split(/\s+/).filter(Boolean); return parts.length ? [parts[0], parts.slice(1).join(' ')] : ['Unknown', 'caller'] }
export function phoneText(raw) {
  const d = String(raw || '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '')
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : raw || ''
}
const yesNo = v => (v === true || v === 'yes' || v === 'Yes' ? true : v === false || v === 'no' || v === 'No' ? false : null)

// P894: a no-show the lead hasn't rebooked yet: the newest no_show row (213's lead_mark_no_show) is after the newest
// booking. A later booking (the lead picked a time from the one-tap link, or the team booked) puts it back on Booked.
export function noShowOpen(events = []) {
  const last = k => Math.max(-Infinity, ...events.filter(e => e.kind === k && e.state !== 'skipped').map(e => new Date(e.created_at || e.at).getTime()))
  const ns = last('no_show')
  return Number.isFinite(ns) && ns > last('booked')
}

// leads.inbound_stage (+ outcome, live-call result, the no-show rows) to the portal's stage (template/leadLifecycle.js STAGES).
export function stageOfInbound(r, appt, events = []) {
  if (r.inbound_stage === 'sold' || r.outcome === 'sold') return 'sold'
  if (r.inbound_stage === 'follow_up' || r.outcome === 'follow_up') return 'follow_up'
  if (r.inbound_stage === 'lost') {
    if (r.outcome === 'not_interested') return 'not_interested'
    if (/opt/i.test(r.outcome_reason || '')) return 'opted_out'
    return 'unreachable'
  }
  if (r.inbound_stage === 'met') return 'showed'
  if (r.inbound_stage === 'booked') return 'booked'
  if (noShowOpen(events)) return 'no_show'
  if (r.inbound_product === 'live_call') {
    if (r.transfer_status === 'requested') return 'ringing'
    if (r.live_call_result === 'missed') return 'missed'
  }
  if (r.inbound_stage === 'contacting') return appt ? 'booked' : 'calling'
  return 'new'
}

// One inbound_events row to a timeline row (lead-events shape: kind, at, label, state, by, role, text).
const ROLE = { va: 'team', fulfillment: 'team', admin: 'team', agent: 'you', system: 'auto', lead: 'lead' }
export function eventRow(e, tz) {
  const d = e.detail || {}
  const role = e.kind === 'text_received' ? 'lead' : ROLE[e.actor_role] || (e.kind === 'text_sent' || e.kind === 'reminder' ? 'auto' : 'team')
  return {
    id: e.id, kind: e.kind === 'reminder' ? 'text_sent' : e.kind, step: d.step || (e.kind === 'reminder' ? 'reminder' : undefined),
    at: wallOf(e.at, tz), label: e.label || '', state: e.state === 'scheduled' ? 'scheduled' : 'done',
    text: d.text || d.body || undefined, by: e.actor_name || (role === 'auto' ? 'Automatic' : role === 'you' ? 'You' : 'Our team'), role,
    note: d.note || undefined, summary: d.summary || undefined,
  }
}

// The appointment instant from a lead's events (a "booked" row's detail, or a scheduled booked row).
export function apptInstant(events) {
  const booked = (events || []).filter(e => e.kind === 'booked' && e.state !== 'skipped').sort((a, b) => new Date(b.at) - new Date(a.at))
  for (const e of booked) { const at = e.detail?.appointment_at || e.detail?.at; if (at) return at; if (e.state === 'scheduled') return e.at }
  return null
}

// agent_inbounds() row (+ its inbound_events) to the portal's lead record (same fields as the sample mkLead).
export function toLead(r, events = [], tz = DEFAULT_TZ) {
  const qa = r.qualifier_answers || {}
  const [first, last] = splitName(r.contact_name)
  const apptIso = apptInstant(events)
  const stage = stageOfInbound(r, apptIso, events)
  const came = wallOf(r.delivered_at || r.created_at, tz)
  const apptAt = apptIso ? wallOf(apptIso, tz) : null
  const followAt = r.follow_up_at ? wallOf(r.follow_up_at, tz) : null
  const rows = (events || []).filter(e => e.kind !== 'note' && e.state !== 'skipped').map(e => eventRow(e, tz)).sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))
  const notes = (events || []).filter(e => e.kind === 'note').map(e => e.detail?.note || e.label).filter(Boolean)
  const lastReply = [...(events || [])].filter(e => e.kind === 'text_received').sort((a, b) => new Date(b.at) - new Date(a.at))[0]
  const tries = (events || []).filter(e => e.kind === 'va_call' && e.state === 'done').length
  return {
    id: r.lead_id, first_name: first, last_name: last, phone: phoneText(r.phone), rawPhone: r.phone || '', state: r.state || '', city: r.city || '',
    age_band: qa.age_band || qa.age_range || '', mortgage_balance_band: qa.mortgage_balance_band || qa.mortgage_range || '', homeowner: yesNo(qa.homeowner), smoker: yesNo(qa.smoker),
    best_time: qa.best_time || '', status: r.inbound_stage || 'new', outcome: r.outcome || null, reason: r.outcome_reason || null,
    kind: r.inbound_product === 'live_call' ? 'live_call' : 'appointment', stage, dbStage: r.inbound_stage || 'new',
    came, apptAt, appt: apptAt ? whenLabel(apptAt) : null, follow: followAt ? whenLabel(followAt).replace(/, \d+:\d+ [AP]M$/, '') : null, followAt,
    created: came ? whenLabel(came).replace(/, \d+:\d+ [AP]M$/, '') : '', assigned_at: came ? whenLabel(came) : '',
    note: notes.join('\n'), reply: lastReply ? { text: lastReply.detail?.text || lastReply.label, at: wallOf(lastReply.at, tz), seen: true } : null,
    tries, submitted: !!r.client_policy_id, clientId: r.client_policy_id || null, fresh: false, events: rows, real: true,
  }
}

// ── Clients ──────────────────────────────────────────────────────────────────────────────────────────────────────
const TASK_LABEL = { packet_check: 'Packet check', review_call: 'Review call', chargeback_watch: 'Payment watch', cancel_old: 'Old policy cancelled', cancellation: 'Old policy cancelled', lapse_save: 'Save call', change: 'Policy change', check_in: 'Check-in call', welcome_call: 'Welcome call' }
const shortDay = w => (w ? whenLabel(w).replace(/, \d+:\d+ [AP]M$/, '') : 'To be set')
// policy_servicing_status.stage to the Clients board stage (template/stages.js stageLabel).
export function clientStageOf(st) {
  if (!st) return 'setting_up'
  if (st.stage === 'needs_attention') return 'needs_attention'
  if (st.stage !== 'ended' && Number(st.open_requests) > 0) return 'requests'
  if (st.stage === 'protected' || st.stage === 'ongoing' || st.stage === 'ended') return 'protected'
  return 'setting_up'
}
// policies row + its policy_servicing_status row + its servicing_tasks rows to the portal's client record.
export function toClient(p, st, tasks = [], tz = DEFAULT_TZ) {
  const stage = clientStageOf(st)
  const sold = wallOf(p.created_at, tz)
  const own = (tasks || []).filter(t => t.policy_id === p.id && t.status !== 'cancelled').sort((a, b) => new Date(a.due_at || a.created_at) - new Date(b.due_at || b.created_at))
  const steps = [{ label: 'Sale submitted', at: shortDay(sold), done: true },
    ...own.map(t => ({ label: TASK_LABEL[t.kind] || 'Servicing step', at: t.done_at ? shortDay(wallOf(t.done_at, tz)) : t.due_at ? whenLabel(wallOf(t.due_at, tz)) : 'To be set', done: t.status === 'done' || !!t.done_at }))]
  const next = st?.next_step || null
  return {
    id: p.id, client_first_name: p.client_first_name || 'Client', client_last_name: p.client_last_name || '', client_phone: phoneText(p.client_phone), city: p.client_city || '', state: p.state || '',
    carrier_name: p.carrier_name || 'Carrier not set', product_name: p.product_name || 'Policy', product_type: p.product_type || null, policy_number: p.policy_number || 'Not set yet',
    monthly_premium: Number(p.monthly_premium) || 0, annual_premium: Number(p.annual_premium) || 0, status: p.status || '', stage, is_sample_price: false,
    note: stage === 'needs_attention' ? (next || 'The team needs you on this client') : next || 'Nothing needed from you', next_step: next, attention: stage === 'needs_attention' ? next : null,
    submitted: shortDay(sold), steps, calls: [], real: true,
    // P899: what the agent's status and the monthly check read (lib/clientCheck.js). The policies read doesn't ask
    // for these columns yet (p899_clients_simple.sql isn't applied): until it does they're null, and the client shows
    // Working / Protected from its servicing stage with no check.
    draft_day: p.draft_day ?? null, notes: p.notes || null, check_from: p.check_from || p.effective_date || null, checked_through: p.checked_through || null,
    fixing: p.fixing_reason ? { why: p.fixing_reason, since: p.fixing_since || null } : null, closed: !!p.closed_at,
  }
}

// ── Hours: the server's rows ({weekday 1=Mon, start 'HH:MM', end}) and the portal's week ({Mon: {on, start '9:00 AM', end}}) ─
const WD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const to12 = hm => { const [h, m] = String(hm).split(':').map(Number); const hh = h % 24; return `${hh % 12 || 12}:${String(m).padStart(2, '0')} ${hh < 12 ? 'AM' : 'PM'}` }
const to24 = t => { const x = /(\d+):(\d+)\s*(AM|PM)/.exec(t || ''); if (!x) return null; return `${String((Number(x[1]) % 12) + (x[3] === 'PM' ? 12 : 0)).padStart(2, '0')}:${x[2]}` }
// week: lib/agentSettings weekFromRows output ([{weekday, open, start, end}] Monday first).
export function weekToPortal(week) {
  return Object.fromEntries(WD.map((d, i) => { const r = (week || []).find(x => x.weekday === i + 1); return [d, { on: !!r?.open, start: to12(r?.start || '09:00'), end: to12(r?.end || '17:00') }] }))
}
export function portalToRows(week) {
  return WD.map((d, i) => ({ d, i, v: week?.[d] })).filter(x => x.v?.on).map(x => ({ weekday: x.i + 1, start: to24(x.v.start), end: to24(x.v.end) === '00:00' ? '24:00' : to24(x.v.end) })).filter(r => r.start && r.end)
}

// ── Activity: agent_activity_feed rows to the Activity list (kind folded onto lead / call / text / client / moved) ─
export function activityKind(k) {
  const s = String(k || '')
  if (/text|sms|reply/.test(s)) return 'text'
  if (/call|transfer|voice/.test(s)) return 'call'
  if (/lead|inbound|came_in|booked|no_show/.test(s)) return 'lead'
  if (/outcome|stage|moved|follow/.test(s)) return 'moved'
  return 'client'
}
const nameIn = m => (m && (m.name || m.client_name || m.lead_name || [m.client_first_name, m.client_last_name].filter(Boolean).join(' '))) || ''
export const toActivity = (r, label) => ({ id: String(r.id), at: label, kind: activityKind(r.kind), who: nameIn(r.meta) || 'Your book', text: r.title || 'Update', real: true })

// P848: "What your spend bought" from the agent's own leads (spend stays 0 until P884's spend feed is live).
const REACHED = ['booked', 'showed', 'no_show', 'sold', 'follow_up', 'not_interested']
const SHOWED = ['showed', 'sold', 'follow_up', 'not_interested']
export function boughtOf(leads, since) {
  // P889: one lead product, one line. Booked and transferred apart, then shows and sales.
  const rows = (leads || []).filter(l => (l.came || '') >= since)
  const live = rows.filter(l => l.kind === 'live_call')
  const appts = rows.filter(l => l.kind !== 'live_call')
  const n = (list, stages) => list.filter(l => stages.includes(l.stage)).length
  const sold = rows.filter(l => l.stage === 'sold')
  return {
    spent: 0, leads: rows.length, reached: n(appts, REACHED) + n(live, ['showed', 'sold', 'follow_up', 'not_interested', 'ringing']),
    booked: n(appts, ['booked', ...REACHED.slice(1)]), offered: live.filter(l => l.stage !== 'new').length, transferred: n(live, SHOWED),
    showed: n(appts, SHOWED), sold: sold.length, premium: sold.reduce((t, l) => t + (Number(l.submitted?.premium) || 0), 0),
  }
}
