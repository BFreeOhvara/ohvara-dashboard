// Shared formatting for the insurance pipeline (Prompt 326).
// One place so My Policies, Submissions, Overview and the detail modal can't
// drift on how a dollar figure or a date reads.

export function money(value) {
  const n = Number(value || 0)
  return n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

// Whole-dollar variant for headline KPIs, where cents are noise.
export function moneyShort(value) {
  const n = Number(value || 0)
  return n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })
}

export function fullName(policy) {
  return [policy?.client_first_name, policy?.client_last_name].filter(Boolean).join(' ') || '—'
}

// Date columns are plain `date` in Postgres — parsing them with `new Date()`
// treats them as UTC midnight and can render the previous day west of GMT.
// Split the string instead so a sold date always shows the date entered.
export function formatDate(value) {
  if (!value) return '—'
  const [y, m, d] = String(value).slice(0, 10).split('-')
  if (!y || !m || !d) return '—'
  return new Date(Number(y), Number(m) - 1, Number(d))
    .toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function todayISO() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function currentMonth() {
  return todayISO().slice(0, 7)
}

// Live phone-mask input (Prompt 401) — strips everything but digits from
// whatever's currently in the field (including the mask's own punctuation,
// so backspace/paste/mid-string edits all re-derive cleanly) and re-applies
// (xxx) xxx-xxxx as digits accumulate. The mask owns the punctuation; a
// non-digit typed anywhere just gets stripped back out on the next render.
export function formatPhoneInput(raw) {
  const d = String(raw || '').replace(/\D/g, '').slice(0, 10)
  if (!d) return ''
  if (d.length < 4) return `(${d}`
  if (d.length < 7) return `(${d.slice(0, 3)}) ${d.slice(3)}`
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`
}

// Title-cases a name on submit (Prompt 401) — not applied while typing, only
// as a normalization pass right before save. Idempotent, so already-correct
// input passes through unchanged.
export function titleCase(str) {
  return String(str || '').trim().toLowerCase().replace(/\b\w/g, c => c.toUpperCase())
}

// Prompt 419 — default display for sensitive Fulfillment intake fields
// (driver's license, routing/account numbers): last 4 characters visible,
// everything before it replaced with dots. Callers pair this with an
// explicit reveal toggle rather than ever defaulting to the real value.
export function maskLast4(value) {
  const s = String(value || '')
  if (s.length <= 4) return '•'.repeat(s.length)
  return '•'.repeat(s.length - 4) + s.slice(-4)
}
