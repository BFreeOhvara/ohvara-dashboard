import { Phone, Copy } from 'lucide-react'
import { useNote } from './kit'
import './leads873.css'

// P898/P899: the number with a copy button, in every lead and client pop-up. P916: Call goes through Deedstone at
// every width (it was tap-to-call on phones only): the agent's own phone rings first, then the client is dialed from
// the agent's Deedstone number (DeedstoneCall.jsx). target = lib/deedstoneCall targetOf('lead' | 'client', item).
import { DeedstoneCallButton } from './DeedstoneCall'
export function CallOrCopy({ phone, target, closed, onCall, label = 'Call' }) {
  const note = useNote()
  const copy = async () => {
    try { await navigator.clipboard.writeText(phone); note(`${phone} copied`) } catch { note(`Couldn’t copy. The number is ${phone}`) }
  }
  if (!phone) return null
  return (
    <>
      {!closed && target && <DeedstoneCallButton target={target} className="tp-primary fx-accent lc-call" onCall={onCall}><Phone size={16} aria-hidden="true" />{label}</DeedstoneCallButton>}
      <span className="lc-num"><Phone size={15} aria-hidden="true" /><b className="tp-num">{phone}</b><button type="button" className="tp-btn ov-ghost sm lc-copy" aria-label={`Copy ${phone}`} onClick={copy}><Copy size={14} aria-hidden="true" />Copy</button></span>
    </>
  )
}
