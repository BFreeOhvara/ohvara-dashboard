import { useLayoutEffect, useRef } from 'react'
import { formatPhone, phoneDigits, toE164, caretAfterDigits, digitsBefore } from './phoneMask'

// P868 — the one phone field for all three portals. Digits only; the brackets, space and dash appear by themselves;
// it stops at 10 digits; a leading +1 or 1 and any pasted format are cleaned up. Phones get the number keypad.
// value: anything phone-like (digits, E.164, formatted). onChange(digits, e164, formatted) — e164 is '' until all 10
// are in. Save e164; sample-only profile fields keep `formatted` for display until the backend step.
export function PhoneInput({ value, onChange, className = '', placeholder = '(555) 123-4567', invalid = false, ...rest }) {
  const ref = useRef(null)
  const caret = useRef(null)
  const shown = formatPhone(value)
  const change = e => {
    const raw = e.target.value
    let d = phoneDigits(raw)
    let at = digitsBefore(raw, e.target.selectionStart ?? raw.length)
    // A bracket, space or dash was deleted (no digit gone): take the digit before it instead.
    if (d === phoneDigits(value) && raw.length < shown.length && at > 0 && e.nativeEvent?.inputType === 'deleteContentBackward') {
      d = d.slice(0, at - 1) + d.slice(at)
      at -= 1
    }
    caret.current = at
    onChange(d, toE164(d), formatPhone(d))
  }
  useLayoutEffect(() => {
    const el = ref.current
    if (caret.current == null || !el || document.activeElement !== el) return
    const pos = caretAfterDigits(el.value, caret.current)
    el.setSelectionRange(pos, pos)
    caret.current = null
  })
  return (
    <input ref={ref} type="tel" inputMode="tel" autoComplete="off" className={`${invalid ? 'tp-danger' : ''} ${className}`.trim()}
      value={shown} onChange={change} placeholder={placeholder} {...rest} />
  )
}
