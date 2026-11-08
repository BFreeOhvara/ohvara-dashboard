// P891 — bringing an agent's existing clients into servicing (Add client / Import). No React, no network: the agent
// form and import, the sample store and the tests share these rules, and migration p891_book_import.sql
// (agent_add_clients) applies the same ones on the server (it is the one that counts).
//
// A row is read from a CSV file, a paste from a sheet (tabs), or the one-client form. Each row is checked before
// anything is saved: missing details and duplicates are flagged (duplicate = same policy number, then same phone,
// against the agent's book and the rows above it). Only rows marked ok are saved.

import { phoneDigits, formatPhone, toE164 } from '../template/phoneMask.js'
import { zoneOf } from './callSlots.js'

// Field order = the template's column order. need = must be there to save.
export const FIELDS = [
  { key: 'first_name', label: 'First name', need: true },
  { key: 'last_name', label: 'Last name', need: true },
  { key: 'phone', label: 'Phone', need: true },
  { key: 'email', label: 'Email' },
  { key: 'state', label: 'State', need: true },
  { key: 'time_zone', label: 'Time zone' },
  { key: 'carrier', label: 'Carrier', need: true },
  { key: 'policy_number', label: 'Policy number', need: true },
  { key: 'product', label: 'Product' },
  { key: 'face_amount', label: 'Face amount' },
  { key: 'monthly_premium', label: 'Monthly premium' },
  { key: 'draft_day', label: 'Draft day' },
  { key: 'effective_date', label: 'Effective date' },
  { key: 'notes', label: 'Notes' },
]
export const NEEDED = FIELDS.filter(f => f.need).map(f => f.key)
export const MAX_ROWS = 2000

// Header words a sheet might use, to our keys. Matched after lower-casing and dropping everything but letters.
const ALIAS = {
  firstname: 'first_name', first: 'first_name', fname: 'first_name', given: 'first_name',
  lastname: 'last_name', last: 'last_name', lname: 'last_name', surname: 'last_name',
  name: 'name', fullname: 'name', client: 'name', clientname: 'name', insured: 'name', insuredname: 'name',
  phone: 'phone', phonenumber: 'phone', cell: 'phone', mobile: 'phone', tel: 'phone',
  email: 'email', emailaddress: 'email',
  state: 'state', st: 'state',
  timezone: 'time_zone', tz: 'time_zone', zone: 'time_zone',
  carrier: 'carrier', carriername: 'carrier', company: 'carrier', insurer: 'carrier',
  policynumber: 'policy_number', policy: 'policy_number', policyno: 'policy_number', policynum: 'policy_number',
  product: 'product', productname: 'product', plan: 'product',
  faceamount: 'face_amount', face: 'face_amount', coverage: 'face_amount', deathbenefit: 'face_amount',
  monthlypremium: 'monthly_premium', premium: 'monthly_premium', monthly: 'monthly_premium',
  draftday: 'draft_day', draft: 'draft_day', draftdate: 'draft_day',
  effectivedate: 'effective_date', effective: 'effective_date', issuedate: 'effective_date', startdate: 'effective_date',
  notes: 'notes', note: 'notes', comments: 'notes',
}
export const fieldOfHeader = h => ALIAS[String(h || '').toLowerCase().replace(/[^a-z]/g, '')] || null

// The file the agent downloads: our headers and one made-up example row.
export const TEMPLATE_CSV = [
  FIELDS.map(f => f.label).join(','),
  'Maria,Lopez,(512) 555-0199,maria@example.com,TX,America/Chicago,Americo,AM-1234567,Mortgage Protection 25,250000,84.20,3,2025-06-01,Prefers evenings',
].join('\r\n') + '\r\n'

// Splits one CSV or tab line, honouring "quoted, cells" and "" inside quotes.
function cells(line, sep) {
  const out = []
  let cur = '', q = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (q) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++ } else if (ch === '"') q = false
      else cur += ch
    } else if (ch === '"' && cur.trim() === '') { q = true; cur = '' } else if (ch === sep) { out.push(cur.trim()); cur = '' } else cur += ch
  }
  out.push(cur.trim())
  return out
}

// Text (CSV, or tab-separated from a sheet) to raw rows keyed by our field keys. The first line must be headers.
// Columns we don't know are dropped and listed in `ignored`. A "Name" column is split into first and last.
const BOM = new RegExp('^' + String.fromCharCode(0xfeff)) // a byte-order mark Excel puts at the start of a CSV
export function parseRows(text) {
  const lines = String(text || '').replace(BOM, '').split(/\r?\n/).filter(l => l.trim() !== '')
  if (!lines.length) return { rows: [], ignored: [], error: 'Nothing to read.' }
  const sep = lines[0].includes('\t') ? '\t' : ','
  const head = cells(lines[0], sep)
  const keys = head.map(fieldOfHeader)
  if (!keys.some(Boolean)) return { rows: [], ignored: head, error: 'The first line needs column names, like the template.' }
  const ignored = head.filter((h, i) => h && !keys[i])
  const rows = lines.slice(1, MAX_ROWS + 1).map((l, n) => {
    const v = cells(l, sep)
    const r = { line: n + 2 }
    keys.forEach((k, i) => { if (k && v[i] != null && v[i] !== '' && r[k] == null) r[k] = v[i] })
    if (r.name && !r.first_name && !r.last_name) {
      const nm = r.name.includes(',') ? r.name.split(',').map(s => s.trim()).reverse() : r.name.trim().split(/\s+/)
      r.first_name = nm[0] || ''
      r.last_name = nm.slice(1).join(' ')
    }
    delete r.name
    return r
  })
  return { rows, ignored, error: null, cut: lines.length - 1 > MAX_ROWS ? lines.length - 1 - MAX_ROWS : 0 }
}

const STATES = new Set('AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY'.split(' '))
// Same as the server's payment_norm_policy: letters and digits only, upper case.
export const normPolicy = v => String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '') || null
const money = v => { const n = Number(String(v ?? '').replace(/[$,\s]/g, '')); return String(v ?? '').trim() === '' || !Number.isFinite(n) || n < 0 ? null : Math.round(n * 100) / 100 }
// 6/1/2025, 2025-06-01 or 06-01-2025 to 2025-06-01.
export function isoDate(v) {
  const s = String(v || '').trim()
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s)
  let y, mo, d
  if (m) [, y, mo, d] = m
  else if ((m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})$/.exec(s))) { [, mo, d, y] = m; if (y.length === 2) y = `20${y}` } else return null
  const dt = new Date(Date.UTC(+y, +mo - 1, +d))
  return dt.getUTCMonth() === +mo - 1 && dt.getUTCDate() === +d ? `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}` : null
}

// One raw row to the clean row the server takes, with what's wrong. book = the agent's clients ({ policy_number,
// client_phone }); seen = { policies:Set, phones:Set } of rows above this one (filled as rows are checked).
export function checkRow(raw, book = [], seen = { policies: new Set(), phones: new Set() }) {
  const st = String(raw.state || '').trim().toUpperCase()
  const row = {
    line: raw.line,
    first_name: String(raw.first_name || '').trim(), last_name: String(raw.last_name || '').trim(),
    phone: toE164(raw.phone), email: String(raw.email || '').trim().toLowerCase() || null,
    state: STATES.has(st) ? st : '', time_zone: String(raw.time_zone || '').trim() || null,
    carrier: String(raw.carrier || '').trim(), policy_number: String(raw.policy_number || '').trim(),
    product: String(raw.product || '').trim() || null, face_amount: money(raw.face_amount), monthly_premium: money(raw.monthly_premium),
    draft_day: null, effective_date: isoDate(raw.effective_date), notes: String(raw.notes || '').trim() || null,
  }
  const dd = parseInt(String(raw.draft_day || '').replace(/\D/g, ''), 10)
  if (dd >= 1 && dd <= 31) row.draft_day = dd
  if (!row.time_zone && row.state) row.time_zone = zoneOf(row.state) || null

  const missing = NEEDED.filter(k => !row[k])
  const odd = []
  if (raw.phone && !row.phone) odd.push('Phone needs 10 digits')
  if (raw.state && !row.state) odd.push('State needs its two letters')
  if (raw.email && row.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(row.email)) odd.push('Email looks wrong')
  if (raw.effective_date && !row.effective_date) odd.push('Effective date: use 6/1/2025')
  if (raw.draft_day && !row.draft_day) odd.push('Draft day: 1 to 31')
  if (raw.monthly_premium && row.monthly_premium == null) odd.push('Premium: a number')
  if (raw.face_amount && row.face_amount == null) odd.push('Face amount: a number')

  const pn = normPolicy(row.policy_number)
  const ph = phoneDigits(row.phone)
  let dup = null
  if (pn && (book.some(c => normPolicy(c.policy_number) === pn))) dup = 'Same policy number is already on your book'
  else if (pn && seen.policies.has(pn)) dup = 'Same policy number as a row above'
  else if (ph.length === 10 && book.some(c => phoneDigits(c.client_phone) === ph)) dup = 'Same phone as a client on your book'
  else if (ph.length === 10 && seen.phones.has(ph)) dup = 'Same phone as a row above'
  if (pn) seen.policies.add(pn)
  if (ph.length === 10) seen.phones.add(ph)

  const status = missing.length || odd.length ? 'missing' : dup ? 'duplicate' : 'ok'
  return { row, status, missing: missing.map(k => FIELDS.find(f => f.key === k).label), odd, dup }
}

export function checkRows(raws, book = []) {
  const seen = { policies: new Set(), phones: new Set() }
  const out = raws.map(r => checkRow(r, book, seen))
  return { checked: out, ok: out.filter(c => c.status === 'ok').length, missing: out.filter(c => c.status === 'missing').length, duplicate: out.filter(c => c.status === 'duplicate').length }
}

export const showPhone = e164 => formatPhone(e164)

// Big imports go out over days: welcome calls due on business days, at most perDay a day (the admin setting),
// counting the calls already waiting. Returns one day index per new client (0 = the first business day after today).
export function spreadWelcomes(n, perDay = 25, waiting = []) {
  const cap = Math.max(1, Math.floor(perDay))
  const load = [...waiting]
  const out = []
  for (let i = 0; i < n; i++) {
    let d = 0
    while ((load[d] || 0) >= cap) d++
    load[d] = (load[d] || 0) + 1
    out.push(d)
  }
  return out
}

// What the agent sees on an added client: Added (waiting for the welcome call), Welcomed, Serviced (a servicing
// step done after the welcome). Problem = the VA hit a problem, or three no-answers: the agent has a look.
export const BOOK_STATUS = {
  added: ['blue', 'Added', 'Welcome call coming'],
  welcomed: ['teal', 'Welcomed', 'Welcome call done'],
  serviced: ['green', 'Serviced', 'Looked after like any client'],
  problem: ['warn', 'Needs you', 'The welcome call found a problem'],
}
export const BOOK_STEPS = [{ key: 'added', label: 'Added' }, { key: 'welcomed', label: 'Welcomed' }, { key: 'serviced', label: 'Serviced' }]

// The one tick before saving. DRAFT wording for Brayden.
export const TEAM_CALL_ACK = 'These clients know my client care team may call them about their policy.'
// What the VA reads before asking about texts (logged with the yes). DRAFT wording for Brayden.
export const WELCOME_TEXT_ASK = 'Would you like text updates about your policy at this number, like payment reminders and your review call? Up to 4 a month. Msg & data rates may apply. Reply STOP to stop, HELP for help.'

// 1st, 2nd, 3rd, 11th, 22nd: a draft day as people say it.
const SUFFIX = { 1: 'st', 2: 'nd', 3: 'rd' }
export const ordinal = n => `${n}${(n % 100 > 10 && n % 100 < 14) ? 'th' : SUFFIX[n % 10] || 'th'}`
