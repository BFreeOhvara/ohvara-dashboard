// VA desk (/fulfillment/leads): the pure rules behind the queue and the
// 4-item checklist. No React, no network. The screen reads these so the
// counts, the sort and the "outcomes unlock at 4 of 4" rule live in one place.
//
// Rows come from va_queue() (migration 175): lead_id, lead_type, contact_name,
// phone, city, state, va_checklist, bucket ('new' | 'not_reached' |
// 'callback_due'), va_attempts, va_callback_at, claimed_by_me,
// claim_expires_at, created_at.

// The sections, in the order the screen shows them (Callback due first).
export const BUCKETS = ['callback_due', 'new', 'not_reached']

export const BUCKET_LABEL = {
  callback_due: 'Callback due',
  new: 'New',
  not_reached: 'Not reached',
}

export const BUCKET_EMPTY = {
  callback_due: 'No callbacks due.',
  new: 'No new leads.',
  not_reached: 'Everyone tried so far has been reached.',
}

const bucketKey = row => (BUCKETS.includes(row?.bucket) ? row.bucket : 'new')

// Callbacks: the one due first. New and Not reached: newest arrival first
// (the approved mockup's order).
const time = iso => new Date(iso).getTime() || 0
const dueAt = row => time(row.va_callback_at || row.created_at)

export function bucketRows(rows) {
  const out = { callback_due: [], new: [], not_reached: [] }
  for (const r of rows || []) out[bucketKey(r)].push(r)
  out.callback_due.sort((a, b) => dueAt(a) - dueAt(b))
  out.new.sort((a, b) => time(b.created_at) - time(a.created_at))
  out.not_reached.sort((a, b) => time(b.created_at) - time(a.created_at))
  return out
}

export function bucketCounts(rows) {
  const out = { callback_due: 0, new: 0, not_reached: 0 }
  for (const r of rows || []) out[bucketKey(r)] += 1
  return out
}

// The lead this VA already holds (a reload or a second tab comes back to it).
export function heldRow(rows, now = Date.now()) {
  return (rows || []).find(r => r.claimed_by_me && r.claim_expires_at && new Date(r.claim_expires_at).getTime() > now) || null
}

// ── Checklist ───────────────────────────────────────────────────────────────

export const QUESTION_TYPES = ['Billing or payment', 'Coverage question', 'Claim', 'Change beneficiary', 'Cancel or lapse', 'Other']
export const URGENCIES = ['Today', 'This week', 'Just asking']

// Stored in leads.va_checklist as { question_type, carrier, state, urgency }.
export const CHECKLIST_ITEMS = [
  { key: 'question_type', label: 'Question type' },
  { key: 'carrier', label: 'Carrier' },
  { key: 'state', label: 'State' },
  { key: 'urgency', label: 'Urgency' },
]

const filled = {
  question_type: v => QUESTION_TYPES.includes(v),
  carrier: v => typeof v === 'string' && v.trim() !== '',
  state: v => typeof v === 'string' && /^[A-Z]{2}$/.test(v),
  urgency: v => URGENCIES.includes(v),
}

export const itemDone = (checklist, key) => !!filled[key](checklist?.[key])

export function checklistProgress(checklist) {
  const done = CHECKLIST_ITEMS.filter(i => itemDone(checklist, i.key)).length
  return { done, total: CHECKLIST_ITEMS.length, complete: done === CHECKLIST_ITEMS.length }
}

export const isChecklistComplete = checklist => checklistProgress(checklist).complete

// What the VA starts with: the lead's state pre-filled, then what the server
// has, then an unsent draft kept on this device.
export function startingChecklist(row, draft) {
  const server = row?.va_checklist && typeof row.va_checklist === 'object' ? row.va_checklist : {}
  const state = typeof row?.state === 'string' ? row.state.trim().toUpperCase() : ''
  const base = { question_type: '', carrier: '', state: /^[A-Z]{2}$/.test(state) ? state : '', urgency: '' }
  const merged = { ...base, ...pick(server), ...pick(draft) }
  return merged
}

function pick(o) {
  const out = {}
  if (!o || typeof o !== 'object') return out
  for (const { key } of CHECKLIST_ITEMS) if (typeof o[key] === 'string' && o[key]) out[key] = o[key]
  return out
}

// ── Labels and times ────────────────────────────────────────────────────────

const TYPE_LABEL = { policy_help: 'Policy help', mortgage_protection: 'Mortgage protection' }

export function leadTypeLabel(type) {
  if (!type) return ''
  if (TYPE_LABEL[type]) return TYPE_LABEL[type]
  const s = String(type).replace(/_/g, ' ').trim()
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export const displayName = row => (row?.contact_name || '').trim() || 'Unnamed lead'

export function splitName(full) {
  const parts = String(full || '').trim().split(/\s+/).filter(Boolean)
  return { first: parts[0] || '', last: parts.slice(1).join(' ') }
}

export function timeSince(iso, now = Date.now()) {
  const ms = now - new Date(iso).getTime()
  if (!isFinite(ms)) return ''
  const min = Math.floor(ms / 60e3)
  if (min < 1) return 'Just now'
  if (min < 60) return `${min} min ago`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h} h ago`
  if (h < 48) return 'Yesterday'
  return `${Math.floor(h / 24)} days ago`
}

export const tries = n => (n > 0 ? `${n} ${n === 1 ? 'try' : 'tries'}` : '')

const timeOnly = d => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })

// "3:15 PM" today, "Thu 3:15 PM" on another day.
export function clockText(iso, now = Date.now()) {
  if (!iso) return ''
  const d = new Date(iso)
  if (d.toDateString() === new Date(now).toDateString()) return timeOnly(d)
  return `${d.toLocaleDateString('en-US', { weekday: 'short' })} ${timeOnly(d)}`
}

// "Texas · Policy help · 12 min ago" (+ " · 2 tries" in Not reached).
export function rowMeta(row, now = Date.now()) {
  return [
    row.state,
    leadTypeLabel(row.lead_type),
    timeSince(row.created_at, now),
    row.bucket === 'not_reached' ? tries(row.va_attempts) : '',
  ].filter(Boolean).join(' · ')
}

// ── The hold ────────────────────────────────────────────────────────────────

export const secondsLeft = (expiresAt, now = Date.now()) => (expiresAt ? Math.max(0, Math.ceil((new Date(expiresAt).getTime() - now) / 1000)) : 0)

export function countdown(sec) {
  const s = Math.max(0, Math.floor(sec))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

// va_claim errors (migration 175): 55006 = another VA holds it, 22023 = not in
// the queue any more, P0002 = no such lead.
export const lostRace = err => err?.code === '55006'
export const notInQueue = err => err?.code === '22023' || err?.code === 'P0002'
// va_set_lead_outcome says 55006 when the caller's hold has gone.
export const holdGone = err => err?.code === '55006'

// ── Callback presets (the viewer's local time) ──────────────────────────────

export function callbackPresets(now = Date.now()) {
  const n = new Date(now)
  const at = (addDays, h) => { const d = new Date(n); d.setDate(d.getDate() + addDays); d.setHours(h, 0, 0, 0); return d }
  const out = [{ key: 'hour', label: 'In 1 hour', at: new Date(now + 3600e3) }]
  const five = at(0, 17)
  if (five.getTime() > now + 3600e3 + 15 * 60e3) out.push({ key: 'five', label: 'Today 5:00 PM', at: five })
  out.push({ key: 'tomorrow', label: 'Tomorrow 10:00 AM', at: at(1, 10) })
  return out
}

// A callback has to be in the future and within 90 days (the database says so).
export const callbackOk = (date, now = Date.now()) => !!date && date.getTime() > now && date.getTime() <= now + 90 * 864e5

// Value for <input type="datetime-local"> in the viewer's zone.
export function toLocalInput(date) {
  const p = n => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}T${p(date.getHours())}:${p(date.getMinutes())}`
}
