// Prompt 728 — the carrier the client is leaving. The Fulfillment call is a
// 3-way call with that carrier, so a call can only be booked while its
// policyholder line is open. Rows live in `carriers` (migrations 132/133):
// names + aliases for the type-ahead, and hours in the carrier's own zone:
//   hours:    { mon: { open: '08:30', close: '16:30' } | null, ... sun }
//   hours_tz: IANA zone (US only)
//   hours_status: verified | ai | fallback | pending | null

export const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
const DAY_LABEL = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' }

// Cached hours are trusted this long (a saved fallback only a week, so it
// gets looked up again).
export const CACHE_DAYS = 180
export const FALLBACK_DAYS = 7

// Booking is never blocked: when a carrier's hours can't be found, Mon–Fri
// 9:00 AM–5:00 PM Eastern stands in and Fulfillment confirms.
const NINE_FIVE = { open: '09:00', close: '17:00' }
export const FALLBACK_HOURS = {
  hours: { mon: NINE_FIVE, tue: NINE_FIVE, wed: NINE_FIVE, thu: NINE_FIVE, fri: NINE_FIVE, sat: null, sun: null },
  hours_tz: 'America/New_York',
}

export function hoursFresh(c, now = Date.now()) {
  if (!c?.hours || !c.hours_tz || !c.hours_checked_at) return false
  const days = c.hours_status === 'fallback' ? FALLBACK_DAYS : CACHE_DAYS
  return now - new Date(c.hours_checked_at).getTime() < days * 864e5
}

// ── Type-ahead ────────────────────────────────────────────────────────────

// "Mutual of O." → "mutual of o"; "A&G" → "a g". Case and punctuation don't matter.
export const normalizeName = s => String(s || '').toLowerCase().replace(/&/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim()

// Where `q` matches `name` (both normalized): 0 = the name starts with it,
// 1 = a later word starts with it, -1 = no match.
function matchAt(name, q) {
  if (name.startsWith(q)) return 0
  return name.includes(` ${q}`) ? 1 : -1
}

// Up to `limit` carriers for what's typed, best first: name starts with it >
// a word in the name starts with it > an alias does; then the more common
// carrier (sort_rank), then A–Z. Each result: { carrier, alias } where alias
// is the alias that matched (for "also called …"), else null.
export function rankCarriers(carriers, text, limit = 6) {
  const q = normalizeName(text)
  if (!q) return []
  const hits = []
  for (const c of carriers || []) {
    if (c.is_active === false) continue
    const at = matchAt(normalizeName(c.name), q)
    if (at >= 0) { hits.push({ carrier: c, alias: null, score: at }); continue }
    const alias = (c.aliases || []).find(a => matchAt(normalizeName(a), q) >= 0)
    if (alias) hits.push({ carrier: c, alias, score: 2 })
  }
  hits.sort((a, b) =>
    a.score - b.score
    || (a.carrier.sort_rank ?? 1e6) - (b.carrier.sort_rank ?? 1e6)
    || a.carrier.name.localeCompare(b.carrier.name))
  return hits.slice(0, limit)
}

// The carrier whose name or an alias is exactly `text` (ignoring case and
// punctuation), else null.
export function exactCarrier(carriers, text) {
  const q = normalizeName(text)
  if (!q) return null
  return (carriers || []).find(c => normalizeName(c.name) === q)
    || (carriers || []).find(c => (c.aliases || []).some(a => normalizeName(a) === q))
    || null
}

// A booking's carrier row: by policies.carrier_id, else by its saved name.
export function bookingCarrier(carriers, p) {
  if (!p) return null
  if (p.carrier_id) {
    const byId = (carriers || []).find(c => c.id === p.carrier_id)
    if (byId) return byId
  }
  return exactCarrier(carriers, p.carrier_name || p.current_carrier)
}

// ── Hours ─────────────────────────────────────────────────────────────────

export const toMin = hhmm => { const [h, m] = String(hhmm).split(':').map(Number); return h * 60 + m }

// 510 → "8:30 AM"; 720 → "12:00 PM" (same shape as the slot labels).
export function minLabel(min) {
  const h = Math.floor(min / 60) % 24, m = min % 60
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`
}

const ZONE_ABBR = {
  'America/New_York': 'ET', 'America/Detroit': 'ET', 'America/Indiana/Indianapolis': 'ET', 'America/Kentucky/Louisville': 'ET',
  'America/Chicago': 'CT', 'America/Denver': 'MT', 'America/Boise': 'MT', 'America/Phoenix': 'MST',
  'America/Los_Angeles': 'PT', 'America/Anchorage': 'AKT', 'Pacific/Honolulu': 'HT', 'America/Puerto_Rico': 'AT',
}
export const zoneAbbr = tz => ZONE_ABBR[tz] || tz || ''

// "Mon–Fri 8:30 AM–4:30 PM CT", "Mon–Thu 7:30 AM–5:00 PM, Fri 7:30 AM–12:30 PM CT".
// Consecutive days with the same hours are grouped.
export function hoursSummary(hours, tz) {
  if (!hours) return ''
  const runs = []
  for (const d of DAYS) {
    const h = hours[d]
    const key = h ? `${h.open}-${h.close}` : null
    const last = runs[runs.length - 1]
    if (key && last && last.key === key && DAYS.indexOf(last.to) === DAYS.indexOf(d) - 1) last.to = d
    else if (key) runs.push({ key, from: d, to: d, h })
  }
  if (!runs.length) return ''
  const text = runs.map(r => {
    const days = r.from === r.to ? DAY_LABEL[r.from] : `${DAY_LABEL[r.from]}–${DAY_LABEL[r.to]}`
    return `${days} ${minLabel(toMin(r.h.open))}–${minLabel(toMin(r.h.close))}`
  }).join(', ')
  return `${text} ${zoneAbbr(tz)}`.trim()
}

export const HOURS_STATUS = {
  verified: { label: 'Verified', tone: 'up' },
  ai: { label: 'Found by AI', tone: 'info' },
  fallback: { label: 'Fallback', tone: 'warn' },
  pending: { label: 'Checking', tone: 'mute' },
}
