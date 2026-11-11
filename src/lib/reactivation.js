// P952 — Reactivate old leads: the rules in one place. Plain JS, no imports, so the portal (agent import, admin view),
// the edge functions (Deno) and node --test run the same code. The database repeats the cleaning and the money
// (migration 267_reactivation.sql) and is the one that counts; this file is what the agent sees before they pay.
//
// How it works (brain/ohvara/Reactivation.md): an agent uploads or pastes an aged-lead list on Leads → we clean it
// (duplicates, people already theirs, states they aren't licensed in, bad numbers, our do-not-call list) → they tick
// the responsibility line and pay a flat price per callable lead → the national Do Not Call + litigator scrub runs →
// our AI calls each person (calls only, never texts) from the separate reactivation numbers, day 1, 2, 4, 7 and 14,
// 8 AM–8 PM their time → booked or live-transferred people land on the Leads board tagged Reactivated.

export const REACT_DEFAULTS = {
  priceCents: 200,          // per lead still callable after cleaning (admin setting)
  minLeads: 100,            // per list (admin setting)
  maxRows: 5000,            // per upload
  cadenceDays: [0, 1, 3, 6, 13], // day 1, 2, 4, 7, 14 (days after the list starts)
  maxAttempts: 5,           // admin setting, 1 to 5
  callStart: '08:00',       // in the lead's own time zone, every zone of their state
  callEnd: '20:00',
  pauseStopRate: 0.05,      // stop/complaint share of people reached that pauses a list
  pauseMinReached: 20,      // reached people before the rate counts
}

// The responsibility line the agent ticks before paying (wording is Brayden's; ship note).
export const REACT_ATTEST = 'These people asked to be contacted about life insurance, and I have the right to have them contacted by phone. I’m responsible for this list.'
export const REACT_ATTEST_VERSION = 'p952-v1'

// The AI's first words on a reactivation call (P940 script otherwise unchanged; {first} = first name).
export const REACT_OPENER = 'Hey {first}, this is Max with Deedstone Insurance. A while back you’d asked about mortgage protection, I’m just following up to see if that’s still something you’re looking into.'
export const reactOpener = first => REACT_OPENER.replace('{first}', String(first || '').trim() || 'there')

// ── CSV / paste ─────────────────────────────────────────────────────────────────────────────────────────────────
// Comma, tab or semicolon separated (a paste from a spreadsheet is tab separated); quotes, "" inside quotes, CRLF.
export function sniffDelimiter(text) {
  const first = String(text || '').split(/\r?\n/).find(l => l.trim()) || ''
  const count = ch => first.split(ch).length - 1
  const tabs = count('\t'), commas = count(','), semis = count(';')
  if (tabs >= commas && tabs >= semis && tabs > 0) return '\t'
  if (semis > commas) return ';'
  return ','
}

export function parseCsv(text, delim = sniffDelimiter(text)) {
  const s = String(text || '').replace(/^\uFEFF/, '')
  const rows = []
  let row = [], cell = '', q = false
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (q) {
      if (ch === '"') { if (s[i + 1] === '"') { cell += '"'; i++ } else q = false }
      else cell += ch
    } else if (ch === '"' && cell === '') q = true
    else if (ch === delim) { row.push(cell); cell = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++
      row.push(cell); cell = ''
      if (row.some(c => c.trim() !== '')) rows.push(row)
      row = []
    } else cell += ch
  }
  row.push(cell)
  if (row.some(c => c.trim() !== '')) rows.push(row)
  return rows.map(r => r.map(c => c.trim()))
}

// Columns an upload can map to. name OR first (+ last), phone and state are required.
export const REACT_FIELDS = [
  { key: 'name', label: 'Full name', hint: /^(full ?name|name|contact|lead ?name|client)$/i },
  { key: 'first', label: 'First name', hint: /^(first|first ?name|fname|given)/i },
  { key: 'last', label: 'Last name', hint: /^(last|last ?name|lname|surname|family)/i },
  { key: 'phone', label: 'Phone', hint: /(phone|mobile|cell|number|tel)/i },
  { key: 'state', label: 'State', hint: /^(state|st|province|region)$/i },
  { key: 'age', label: 'Age', hint: /^(age|dob|birth)/i },
  { key: 'mortgage', label: 'Mortgage amount', hint: /(mortgage|loan|balance)/i },
  { key: 'lead_date', label: 'Lead date', hint: /(lead ?date|date|created|submitted)/i },
  { key: 'source', label: 'Source', hint: /(source|vendor|company|campaign)/i },
]
export const REACT_REQUIRED = ['phone', 'state']

// Best guess of which column holds what, from the header row. { field: columnIndex }.
export function guessMapping(header = []) {
  const map = {}
  const used = new Set()
  for (const f of REACT_FIELDS) {
    const i = header.findIndex((h, j) => !used.has(j) && f.hint.test(String(h || '').trim()))
    if (i >= 0) { map[f.key] = i; used.add(i) }
  }
  if (map.name != null && map.first != null) delete map.name // first/last win over a single name column
  return map
}

// Is the first row a header? (no cell in it is a phone number)
export const looksLikeHeader = row => Array.isArray(row) && row.length > 0 && !row.some(c => normalizePhone(c))

export function mappingMissing(map = {}) {
  const miss = REACT_REQUIRED.filter(k => map[k] == null)
  if (map.name == null && map.first == null) miss.unshift('name')
  return miss
}

// ── Values ──────────────────────────────────────────────────────────────────────────────────────────────────────
// A dialable US number as +1XXXXXXXXXX, or null: 10 digits (or 11 with a leading 1), area code and exchange 2–9,
// not 555-01xx (fiction), not N11 area codes, not all one digit.
export function normalizePhone(raw) {
  let d = String(raw ?? '').replace(/\D/g, '')
  if (d.length === 11 && d[0] === '1') d = d.slice(1)
  if (d.length !== 10) return null
  if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(d)) return null
  if (/^(\d)\1{9}$/.test(d)) return null
  if (d[1] === '1' && d[2] === '1') return null               // 211, 311 … 911
  if (d.slice(3, 6) === '555' && d.slice(6, 8) === '01') return null
  return `+1${d}`
}

const STATE_NAMES = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA', colorado: 'CO', connecticut: 'CT', delaware: 'DE',
  'district of columbia': 'DC', florida: 'FL', georgia: 'GA', hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA',
  kansas: 'KS', kentucky: 'KY', louisiana: 'LA', maine: 'ME', maryland: 'MD', massachusetts: 'MA', michigan: 'MI', minnesota: 'MN',
  mississippi: 'MS', missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV', 'new hampshire': 'NH', 'new jersey': 'NJ',
  'new mexico': 'NM', 'new york': 'NY', 'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK', oregon: 'OR',
  pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC', 'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT',
  vermont: 'VT', virginia: 'VA', washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI', wyoming: 'WY',
}
const STATE_CODES = new Set(Object.values(STATE_NAMES))
export function normalizeState(raw) {
  const s = String(raw ?? '').trim()
  if (!s) return null
  const up = s.toUpperCase().replace(/\./g, '')
  if (up.length === 2 && STATE_CODES.has(up)) return up
  return STATE_NAMES[s.toLowerCase().replace(/\s+/g, ' ')] || null
}

const clip = (v, n) => { const s = String(v ?? '').trim(); return s ? s.slice(0, n) : null }

// One row → a contact, or null fields where the row didn't have them.
export function rowToContact(row, map) {
  const at = k => (map[k] == null ? '' : row[map[k]] ?? '')
  let first = clip(at('first'), 60), last = clip(at('last'), 60)
  if (!first && map.name != null) {
    const parts = String(at('name')).trim().split(/\s+/).filter(Boolean)
    first = clip(parts[0], 60); last = clip(parts.slice(1).join(' '), 60)
  }
  const ageN = Number(String(at('age')).replace(/[^\d.]/g, ''))
  const mort = Number(String(at('mortgage')).replace(/[^\d.]/g, ''))
  return {
    first, last,
    phone: normalizePhone(at('phone')), rawPhone: clip(at('phone'), 40),
    state: normalizeState(at('state')), rawState: clip(at('state'), 40),
    age: ageN >= 18 && ageN <= 110 ? Math.round(ageN) : null,
    mortgage_cents: mort > 0 && mort < 100000000 ? Math.round(mort * 100) : null,
    lead_date: clip(at('lead_date'), 40),
    source: clip(at('source'), 80),
  }
}

// ── Cleaning ────────────────────────────────────────────────────────────────────────────────────────────────────
// The reasons a row is taken off, in the order they're checked. Removed rows are never charged.
export const REMOVED_ORDER = ['bad_number', 'duplicate', 'existing', 'unlicensed', 'dnc']
export const REMOVED_LABEL = {
  bad_number: 'Bad or missing numbers',
  duplicate: 'Duplicates in the list',
  existing: 'Already your leads or clients',
  unlicensed: 'States you’re not licensed in',
  dnc: 'On our do-not-call list',
  national_dnc: 'On the national Do Not Call list',
  litigator: 'Known TCPA litigators',
}

// rows: parsed rows WITHOUT the header. ctx: { licensed: ['TX', …], existing: Set|array of +1 phones,
// dnc: Set|array of +1 phones (our internal list + people who opted out) }.
export function cleanList(rows, map, ctx = {}) {
  const licensed = new Set((ctx.licensed || []).map(s => String(s).toUpperCase()))
  const existing = ctx.existing instanceof Set ? ctx.existing : new Set(ctx.existing || [])
  const dnc = ctx.dnc instanceof Set ? ctx.dnc : new Set(ctx.dnc || [])
  const seen = new Set()
  const kept = [], removed = []
  const counts = Object.fromEntries(REMOVED_ORDER.map(k => [k, 0]))
  for (const row of rows) {
    const c = rowToContact(row, map)
    let why = null
    if (!c.phone) why = 'bad_number'
    else if (seen.has(c.phone)) why = 'duplicate'
    else if (existing.has(c.phone)) why = 'existing'
    else if (!c.state || !licensed.has(c.state)) why = 'unlicensed'
    else if (dnc.has(c.phone)) why = 'dnc'
    if (c.phone) seen.add(c.phone)
    if (why) { counts[why]++; removed.push({ ...c, why }) } else kept.push(c)
  }
  return { total: rows.length, kept, removed, counts, callable: kept.length }
}

// ── Money ───────────────────────────────────────────────────────────────────────────────────────────────────────
export function priceFor(callable, s = REACT_DEFAULTS) {
  const each = s.priceCents ?? REACT_DEFAULTS.priceCents
  const min = s.minLeads ?? REACT_DEFAULTS.minLeads
  const n = Math.max(0, Math.floor(callable || 0))
  return { each, n, min, cents: n * each, belowMin: n < min, short: Math.max(0, min - n) }
}
export const usd0 = c => `$${(Math.round(c) / 100).toLocaleString('en-US', { minimumFractionDigits: (c % 100) ? 2 : 0, maximumFractionDigits: 2 })}`
// The Billing line: "Reactivation · 480 leads · $960" (+ "· $24 back" when the scrub took some off).
export const billingLine = l => `Reactivation · ${l.callable ?? l.n} leads · ${usd0(l.amount_cents ?? l.cents)}${l.refunded_cents ? ` · ${usd0(l.refunded_cents)} back` : ''}`

// ── Calling ─────────────────────────────────────────────────────────────────────────────────────────────────────
// When attempt k (1-based) is due, from the list's start. Past the last attempt → null (stop).
export function attemptDueAt(startIso, k, s = REACT_DEFAULTS) {
  const days = s.cadenceDays || REACT_DEFAULTS.cadenceDays
  const max = Math.min(s.maxAttempts ?? REACT_DEFAULTS.maxAttempts, days.length)
  if (k < 1 || k > max) return null
  return new Date(new Date(startIso).getTime() + days[k - 1] * 86400000).toISOString()
}

// What a call's result does to the person (the database's reactivation_after_call does the same).
//   done: no more calls · dnc: on our do-not-call list for good · board: lands on the agent's Leads board
export function afterCall(outcome, attempt, s = REACT_DEFAULTS) {
  const max = Math.min(s.maxAttempts ?? REACT_DEFAULTS.maxAttempts, (s.cadenceDays || REACT_DEFAULTS.cadenceDays).length)
  switch (outcome) {
    case 'booked': return { status: 'booked', done: true, board: true }
    case 'transferred': return { status: 'transferred', done: true, board: true }
    case 'hard_no': return { status: 'not_interested', done: true, dnc: true }
    case 'opt_out': return { status: 'stop', done: true, dnc: true }
    case 'wrong_number': return { status: 'wrong_number', done: true }
    case 'not_now': return attempt >= max ? { status: 'not_now', done: true, reached: true } : { status: 'queued', reached: true }
    default: return attempt >= max ? { status: 'no_answer', done: true } : { status: 'queued' }
  }
}

// Inside 8 AM–8 PM (and the state's own stricter hours) in the given zone? hours = { start:'08:00', end:'20:00' }.
export function inWindow(localHHMM, hours = { start: REACT_DEFAULTS.callStart, end: REACT_DEFAULTS.callEnd }) {
  return localHHMM >= hours.start && localHHMM < hours.end
}

// ── Progress and quality ────────────────────────────────────────────────────────────────────────────────────────
// people: [{ status, attempts }]. worked = called at least once; reached = someone answered (booked, transferred,
// not now, not interested, stop); remaining = still to be called.
export function listProgress(people = []) {
  const p = { total: people.length, worked: 0, reached: 0, booked: 0, transferred: 0, stop: 0, wrong: 0, remaining: 0 }
  for (const x of people) {
    if ((x.attempts || 0) > 0) p.worked++
    if (['booked', 'transferred', 'not_now', 'not_interested', 'stop'].includes(x.status) || x.reached) p.reached++
    if (x.status === 'booked') p.booked++
    if (x.status === 'transferred') p.transferred++
    if (x.status === 'stop' || x.complaint) p.stop++
    if (x.status === 'wrong_number') p.wrong++
    if (['queued', 'calling', 'waiting_scrub'].includes(x.status)) p.remaining++
  }
  return p
}

const pct = (a, b) => (b > 0 ? a / b : 0)
// Contact rate (reached ÷ worked), booked rate (booked + transferred ÷ reached), stop rate (stop ÷ reached).
// A list pauses itself once enough people were reached and the stop rate is over the limit.
export function listQuality(p, s = REACT_DEFAULTS) {
  const contact = pct(p.reached, p.worked)
  const booked = pct(p.booked + p.transferred, p.reached)
  const stop = pct(p.stop, p.reached)
  const minR = s.pauseMinReached ?? REACT_DEFAULTS.pauseMinReached
  const lim = s.pauseStopRate ?? REACT_DEFAULTS.pauseStopRate
  return { contact, booked, stop, pause: p.reached >= minR && stop > lim }
}
export const pctText = r => `${Math.round(r * 100)}%`

// List statuses in words (agent and admin).
export const LIST_STATUS = {
  draft: ['mute', 'Not paid'],
  waiting_payment: ['warn', 'Paying'],
  payment_failed: ['rose', 'Card declined'],
  waiting_scrub: ['blue', 'Checking the list'],
  working: ['green', 'Calling'],
  paused: ['warn', 'Paused'],
  done: ['mute', 'Finished'],
  cancelled: ['mute', 'Cancelled'],
}
