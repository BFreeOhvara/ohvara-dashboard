// P868 — the US phone mask behind PhoneInput. Only digits count; "(555) 123-4567" builds itself as they type, a
// leading +1 / 1 is dropped (no US area code starts with 1), and it stops at 10 digits. Stored as E.164 (+15551234567).
export const MAX_DIGITS = 10

export function phoneDigits(raw) {
  let d = String(raw ?? '').replace(/\D/g, '')
  while (d.startsWith('1')) d = d.slice(1)
  return d.slice(0, MAX_DIGITS)
}

// No trailing bracket, space or dash, so Backspace always takes a digit.
export function formatPhone(raw) {
  const d = phoneDigits(raw)
  if (!d) return ''
  if (d.length <= 3) return `(${d}`
  if (d.length <= 6) return `(${d.slice(0, 3)}) ${d.slice(3)}`
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`
}

export const toE164 = raw => { const d = phoneDigits(raw); return d.length === MAX_DIGITS ? `+1${d}` : '' }
export const phoneComplete = raw => phoneDigits(raw).length === MAX_DIGITS

// Where the caret goes in the formatted text so it stays after the same number of digits it was after in the raw text.
export function caretAfterDigits(formatted, n) {
  if (n <= 0) return formatted.startsWith('(') && formatted.length > 1 ? 1 : 0
  let seen = 0
  for (let i = 0; i < formatted.length; i++) {
    if (/\d/.test(formatted[i]) && ++seen === n) return i + 1
  }
  return formatted.length
}

// Digits before `caret` in `raw`, counting a leading 1 that phoneDigits drops as not there.
export function digitsBefore(raw, caret) {
  const all = String(raw).replace(/\D/g, '')
  const lead = all.length - all.replace(/^1+/, '').length
  const before = String(raw).slice(0, caret).replace(/\D/g, '').length
  return Math.min(MAX_DIGITS, Math.max(0, before - lead))
}

// P899: a tap-to-call link for a US number (CallOrCopy.jsx, the lead nudge).
export const telOf = phone => `tel:+1${String(phone || '').replace(/\D/g, '').slice(-10)}`
