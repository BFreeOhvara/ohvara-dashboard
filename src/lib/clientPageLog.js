// Pure rules for the client page's contact log, team thread and activity cards
// (src/components/agent/ClientPageLog.jsx, src/hooks/useClientContactLog.js). No React, no Supabase.
//
// Shapes follow migration 199_contact_log.sql: rpc contact_log(p_client_key, p_lead, p_before, p_limit),
// newest first, with id, subject, client_key, lead_id, policy_id, agent_id, occurred_at, channel
// (text | call), direction (out | in), body, call_result (a key), sender_type (va | system | agent |
// lead | client), sender_name, source, kind, attempts, label, text_status, has_recording, is_sample.

const DEFAULT_ZONE = 'America/Chicago'

// ── Failure modes ────────────────────────────────────────────────────────────
// Merging deploys the page before the door applies 199, so a missing function (or, for the
// client-key lookup, a missing view) is "not switched on yet", not an error. PGRST202 = PostgREST
// can't find the function, 42883 = undefined_function, PGRST205 / 42P01 = missing table or view.
const NOT_READY_CODES = ['PGRST202', '42883', 'PGRST205', '42P01']
export function isNotReadyError(error, status) {
  if (!error) return false
  if (NOT_READY_CODES.includes(error.code)) return true
  if (status === 404 || error.status === 404) return true
  return /could not find the function|function .* does not exist|could not find the table|relation .* does not exist/i
    .test(String(error.message || ''))
}

// ── Words ────────────────────────────────────────────────────────────────────
// The row's own `label` is the plain description ('Follow-up text sent', 'Call to client'). The page
// never builds sentences of its own from a kind or a source.
export function rowLabel(r) {
  const label = typeof r?.label === 'string' ? r.label.trim() : ''
  if (label) return label
  return r?.channel === 'call' ? 'Call attempt' : 'Text sent'
}

// The words as stored. A body that is null or only spaces counts as "no words kept".
export function rowBody(r) {
  return typeof r?.body === 'string' && r.body.trim() ? r.body : null
}

const CALL_RESULT = {
  answered: 'Answered', no_answer: 'Not answered', in_progress: 'Call started', cancelled: 'Old policy cancelled',
  interested: 'Interested', not_interested: 'Not interested', callback: 'Call back later', voicemail: 'Voicemail',
  not_reached: 'Not reached', booked: 'Booked', transferred: 'Transferred', completed: 'Completed',
  busy: 'Line busy', failed: 'Did not connect', canceled: 'Cancelled', 'no-answer': 'Not answered',
}
const humanize = s => {
  const t = String(s).replace(/[_-]+/g, ' ').trim().toLowerCase()
  return t ? t[0].toUpperCase() + t.slice(1) : ''
}
export function callResultText(key) {
  if (!key) return ''
  return CALL_RESULT[key] || humanize(key)
}

const SENDER = { va: 'Fulfillment', system: 'Automatic', agent: 'Agent', lead: 'The lead', client: 'The client' }
export function senderText(r) {
  const base = SENDER[r?.sender_type] || ''
  const name = (r?.sender_name || '').trim()
  if (name && (r?.sender_type === 'va' || r?.sender_type === 'agent')) return `${name} · ${base}`
  return name || base
}

export function directionText(r) {
  if (r?.channel === 'call') return r.direction === 'in' ? 'Call in' : 'Call out'
  return r?.direction === 'in' ? 'Text received' : 'Text sent'
}

// ── Rows ─────────────────────────────────────────────────────────────────────
export function normalizeContactRow(r) {
  const label = rowLabel(r)
  const result = r.channel === 'call' ? callResultText(r.call_result) : ''
  return {
    id: r.id,
    at: r.occurred_at,
    channel: r.channel === 'call' ? 'call' : 'text',
    direction: r.direction === 'in' ? 'in' : 'out',
    body: rowBody(r),
    label,
    result: result && !label.toLowerCase().includes(result.toLowerCase()) ? result : '',
    who: senderText(r),
    senderType: r.sender_type || 'system',
    direction_text: directionText(r),
    attempts: r.attempts ?? null,
    hasRecording: r.has_recording === true,
    isSample: r.is_sample === true,
    source: r.source || '',
  }
}

// Newest first, one row per id (a client and a lead call can both return the same row).
export function normalizeContactLog(rows) {
  const seen = new Set()
  const out = []
  for (const r of rows || []) {
    if (!r || !r.id || !r.occurred_at || seen.has(r.id)) continue
    seen.add(r.id)
    out.push(normalizeContactRow(r))
  }
  return out.sort((a, b) => new Date(b.at) - new Date(a.at) || (a.id < b.id ? 1 : -1))
}

// ── Loading ──────────────────────────────────────────────────────────────────
// contact_log takes one client_key or one lead, not policy ids, so the keys come from
// policy_servicing_status (policy_id -> client_key; one key for all of a client's policies).
// `rpc` and `lookupKeys` are injected (supabase.rpc / a policy_servicing_status read) so this runs
// without a database. Returns { rows, notReady }. notReady is a missing function or view: the quiet
// note, not an error. Anything else is thrown for the card's error state.
export async function fetchContactLog({ rpc, lookupKeys, policyIds = [], clientKey = null, leadId = null, limit = 200 }) {
  const keys = new Set(clientKey ? [clientKey] : [])
  const ids = [...new Set((policyIds || []).filter(Boolean))]
  if (!clientKey && ids.length) {
    const found = await lookupKeys(ids)
    if (found.error) {
      if (isNotReadyError(found.error, found.status)) return { rows: [], notReady: true }
      throw found.error
    }
    for (const r of found.data || []) if (r.client_key) keys.add(r.client_key)
  }
  const calls = []
  if (leadId) calls.push({ p_lead: leadId, p_limit: limit })
  for (const k of keys) calls.push({ p_client_key: k, p_limit: limit })
  if (!calls.length) return { rows: [], notReady: false }
  const results = await Promise.all(calls.map(args => rpc(args)))
  const failed = results.find(r => r.error)
  if (failed) {
    if (results.some(r => r.error && isNotReadyError(r.error, r.status))) return { rows: [], notReady: true }
    throw failed.error
  }
  return { rows: normalizeContactLog(results.flatMap(r => r.data || [])), notReady: false }
}

export const CONTACT_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'text', label: 'Texts' },
  { key: 'call', label: 'Calls' },
]
export const filterContactRows = (rows, key) => (key === 'text' || key === 'call' ? rows.filter(r => r.channel === key) : rows)
export const contactCounts = rows => ({
  all: rows.length, text: rows.filter(r => r.channel === 'text').length, call: rows.filter(r => r.channel === 'call').length,
})

// ── Time in two zones ────────────────────────────────────────────────────────
const clock = (iso, tz) => new Date(iso).toLocaleTimeString('en-US', { timeZone: tz || DEFAULT_ZONE, hour: 'numeric', minute: '2-digit' })
const day = (iso, tz) => new Date(iso).toLocaleDateString('en-US', { timeZone: tz || DEFAULT_ZONE, month: 'short', day: 'numeric' })

// '2:00 PM' in the agent's zone with the client's beside it. `client` is '' when the client's zone isn't known.
export function dualTime(iso, tz, clientTz) {
  if (!iso || Number.isNaN(new Date(iso).getTime())) return { date: '', mine: '', client: '' }
  return { date: day(iso, tz), mine: clock(iso, tz), client: clientTz ? clock(iso, clientTz) : '' }
}
export const dualTimeText = (iso, tz, clientTz) => {
  const t = dualTime(iso, tz, clientTz)
  return t.client ? `${t.mine} your time / ${t.client} client` : `${t.mine} your time`
}

// ── Activity (policy_events) ─────────────────────────────────────────────────
const EVENT_TITLE = {
  booked: 'Cancellation call booked', in_progress: 'Call started', no_answer: 'Call not answered',
  rescheduling: 'Needs another call', cancelled: 'Old policy cancelled', moved: 'Call time changed',
  lapsed: 'Policy lapsed',
}
export function normalizeEvent(e) {
  const reason = typeof e.detail?.reason === 'string' ? e.detail.reason.trim() : ''
  const who = (e.actor_name || '').trim()
  return {
    id: e.id,
    at: e.at,
    title: EVENT_TITLE[e.kind] || 'Update',
    sub: [who, reason].filter(Boolean).join(' · '),
  }
}
export const normalizeEvents = rows => (rows || []).filter(e => e?.id && e.at).map(normalizeEvent)
  .sort((a, b) => new Date(b.at) - new Date(a.at))

// ── Team thread ──────────────────────────────────────────────────────────────
// Policies come from the page newest first; the thread opens on the first. A short switcher label
// tells several apart ('Policy 1234' or the carrier), never an id.
export function policyChoice(p, i) {
  const num = String(p?.policy_number || '').trim()
  const carrier = String(p?.carrier_name || p?.new_carrier_name || '').trim()
  if (carrier && num) return `${carrier} ${num.slice(-4)}`
  if (carrier) return carrier
  return num ? `Policy ${num.slice(-4)}` : `Policy ${i + 1}`
}

// Consecutive messages from one sender within five minutes share a run; a new day starts a new run.
export function groupThread(messages, tz, gapMs = 5 * 60e3) {
  const out = []
  let cur = null
  let lastDay = ''
  for (const m of messages || []) {
    const d = day(m.created_at, tz)
    if (d !== lastDay) { out.push({ type: 'day', key: `d-${m.id}`, label: d }); lastDay = d; cur = null }
    const t = new Date(m.created_at).getTime()
    if (cur && cur.senderId === m.sender_id && t - cur.last <= gapMs) {
      cur.msgs.push(m); cur.last = t
    } else {
      cur = { type: 'run', key: `r-${m.id}`, senderId: m.sender_id, msgs: [m], last: t }
      out.push(cur)
    }
  }
  return out
}
