import { useState } from 'react'
import { Info } from 'lucide-react'
import { DESK_NAME, deskWords } from '../../lib/bookingDesk'
import './deskInfo.css'

// P933 — "Booking desk" with its "i": one plain explanation, the same words everywhere on the agent side
// (sign-up checkout, plan picker, Billing). label = what to show next to the "i" (default: the name).
export function DeskInfo({ rate, label = DESK_NAME }) {
  const [open, setOpen] = useState(false)
  return (
    <span className="sc-desk">
      {label && <span>{label}</span>}
      <button type="button" className="sc-i" aria-label={`What is the ${DESK_NAME.toLowerCase()}?`} aria-expanded={open} onClick={() => setOpen(o => !o)}>
        <Info size={14} strokeWidth={2.2} aria-hidden="true" />
      </button>
      {open && <span className="sc-pop" role="note">{deskWords(rate)}</span>}
    </span>
  )
}
