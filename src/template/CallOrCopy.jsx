import { Phone, Copy } from 'lucide-react'
import { useNote } from './kit'
import './leads873.css'

// P898/P899: agents call from their own phone. On a phone, Call is a tap-to-call link; on desktop and tablet there's
// no Call button, just the number with a copy button (leads873.css .lc-tel / .lc-num swap at 768 px). Used in every
// lead and client pop-up.
import { telOf } from './phoneMask.js'
export function CallOrCopy({ phone, rawPhone, closed, onCall, label = 'Call' }) {
  const note = useNote()
  const copy = async () => {
    try { await navigator.clipboard.writeText(phone); note(`${phone} copied`) } catch { note(`Couldn’t copy. The number is ${phone}`) }
  }
  if (!phone) return null
  return (
    <>
      {!closed && <a href={telOf(rawPhone || phone)} className="tp-primary fx-accent lc-tel" onClick={onCall}><Phone size={16} aria-hidden="true" />{label}</a>}
      <span className="lc-num"><Phone size={15} aria-hidden="true" /><b className="tp-num">{phone}</b><button type="button" className="tp-btn ov-ghost sm lc-copy" aria-label={`Copy ${phone}`} onClick={copy}><Copy size={14} aria-hidden="true" />Copy</button></span>
    </>
  )
}
