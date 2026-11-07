// P868 — every US life insurance carrier, preloaded. The list (list.js, versioned) is the one source every carrier
// picker reads: Submit, Book a call, Request service, VA servicing and admin. Rows use the `carriers` table's shape
// (lib/carriers.js): hours per weekday in the carrier's own zone (hours_tz), plus phone, source and check date.
// A carrier whose hours couldn't be read on its own site has hours: null and hours_status null ("Hours not
// verified"); booking then uses the median of every verified carrier's hours, in Central (MEDIAN_HOURS).
// No Carriers screen (Brayden, Nov 6): a name typed that isn't listed is kept as typed and logged to a backend review
// list (logUnknownCarrier; table carrier_review, migration 233, not applied yet).
import LIST from './list.js'
import { DAYS, normalizeName, toMin, minLabel } from '../carriers.js'
import { zonedTimeToUtcIso } from '../timezones.js'

export const CATALOG_VERSION = LIST.version
export const CENTRAL = 'America/Chicago'

const slug = s => normalizeName(s).replace(/ /g, '-')
export const CARRIER_CATALOG = LIST.carriers.map((c, i) => ({
  id: `cat-${slug(c.name)}`,
  name: c.name,
  aliases: c.aliases || [],
  service_phone: c.phone || null,
  agent_phone: c.agentPhone || null,
  hours: c.verified ? c.hours : null,
  hours_tz: c.verified ? c.tz : null,
  hours_source_url: c.sourceUrl || null,
  hours_checked_at: c.checked || null,
  hours_status: c.verified ? 'verified' : null,
  sort_rank: c.rank ?? 1000 + i,
}))

export const isVerified = c => c?.hours_status === 'verified' && !!c.hours && !!c.hours_tz

// ── Median default ("our hours") ──────────────────────────────────────────
// The minutes past midnight on Central's clock of `hhmm` in `tz` on the weekday `day`, in a fixed reference week
// (Mon Nov 9 2026, standard time) so the result doesn't shift with the date it runs on.
const REF_MON = Date.UTC(2026, 10, 9)
const centralFmt = new Intl.DateTimeFormat('en-US', { timeZone: CENTRAL, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
export function toCentralMin(hhmm, tz, day) {
  const date = new Date(REF_MON + DAYS.indexOf(day) * 864e5).toISOString().slice(0, 10)
  const p = Object.fromEntries(centralFmt.formatToParts(new Date(zonedTimeToUtcIso(`${date}T${hhmm}`, tz))).map(x => [x.type, x.value]))
  return (+p.hour % 24) * 60 + +p.minute
}

export function median(nums) {
  if (!nums.length) return null
  const s = [...nums].sort((a, b) => a - b)
  const mid = s.length >> 1
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}
const hhmmOf = min => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`
const to30 = min => Math.round(min / 30) * 30

// Per weekday: the median open and median close (Central, rounded to the half hour) of the verified carriers open
// that day. A day fewer than half of them are open on (Saturday, Sunday) is closed.
export function medianHours(carriers = CARRIER_CATALOG) {
  const ok = carriers.filter(isVerified)
  const hours = {}
  for (const d of DAYS) {
    const open = ok.filter(c => c.hours[d])
    if (!ok.length || open.length * 2 < ok.length) { hours[d] = null; continue }
    const o = to30(median(open.map(c => toCentralMin(c.hours[d].open, c.hours_tz, d))))
    const cl = to30(median(open.map(c => toCentralMin(c.hours[d].close, c.hours_tz, d))))
    hours[d] = { open: hhmmOf(o), close: hhmmOf(cl) }
  }
  return { hours, hours_tz: CENTRAL, count: ok.length }
}
export const MEDIAN_HOURS = medianHours()

// ── Lookup and type-ahead ─────────────────────────────────────────────────
// The listed carrier whose name or an alias is exactly `text` (case and punctuation don't matter), else null.
const byKey = new Map()
for (const c of CARRIER_CATALOG) {
  for (const k of [c.name, ...c.aliases]) { const n = normalizeName(k); if (n && !byKey.has(n)) byKey.set(n, c) }
}
export const findCarrier = text => byKey.get(normalizeName(text)) || null

// Up to `limit` carriers for what's typed: the name starts with it > a word in the name does > an alias (short name,
// parent or issuing company) does; then the more common carrier, then A–Z. Each: { carrier, alias }.
export function matchCarriers(text, limit = 50, list = CARRIER_CATALOG) {
  const q = normalizeName(text)
  if (!q) return []
  const at = (s, n) => (s.startsWith(n) ? 0 : s.includes(` ${n}`) ? 1 : -1)
  const hits = []
  for (const c of list) {
    const s = at(normalizeName(c.name), q)
    if (s >= 0) { hits.push({ carrier: c, alias: null, score: s }); continue }
    const alias = c.aliases.find(a => at(normalizeName(a), q) >= 0)
    if (alias) hits.push({ carrier: c, alias, score: 2 })
  }
  hits.sort((a, b) => a.score - b.score || a.carrier.sort_rank - b.carrier.sort_rank || a.carrier.name.localeCompare(b.carrier.name))
  return hits.slice(0, limit)
}

// The carrier booking uses for `name`: the listed row with its own hours, or (unverified, or typed and not listed)
// the same name on the median default. null only when nothing is picked.
export function bookingCarrierFor(name) {
  const t = String(name || '').trim()
  if (!t) return null
  const c = findCarrier(t)
  if (c && isVerified(c)) return c
  return { ...(c || { id: null, name: t, aliases: [] }), hours: MEDIAN_HOURS.hours, hours_tz: MEDIAN_HOURS.hours_tz, hours_status: 'median', listed: !!c }
}

// One line for under a booking picker.
const hhLabel = hhmm => minLabel(toMin(hhmm))
export function carrierHoursText(c) {
  const h = c.hours.mon || DAYS.map(d => c.hours[d]).find(Boolean)
  if (!h) return `${c.name} has no open hours this week.`
  return `${hhLabel(h.open)} to ${hhLabel(h.close)}`
}

// ── Typed-in carriers not on the list (backend review list, no UI) ────────
// Kept as typed so the agent is never blocked. Until migration 233 is applied the log lives in memory; P848 sends it
// to log_unknown_carrier().
const review = new Map()
export function logUnknownCarrier(text, by = null) {
  const t = String(text || '').trim()
  if (!t || findCarrier(t)) return false
  const k = normalizeName(t)
  const row = review.get(k) || { name: t, count: 0, by: [] }
  row.count += 1
  if (by && !row.by.includes(by)) row.by.push(by)
  review.set(k, row)
  return true
}
export const unknownCarriers = () => [...review.values()]
export const clearUnknownCarriers = () => review.clear()

export const CATALOG_COUNTS = {
  listed: CARRIER_CATALOG.length,
  verified: CARRIER_CATALOG.filter(isVerified).length,
  unverified: CARRIER_CATALOG.filter(c => !isVerified(c)).length,
}
