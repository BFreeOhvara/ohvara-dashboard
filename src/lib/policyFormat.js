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
