import { PhoneIncoming, PhoneOff, ArrowRight, MessageSquare, Phone } from 'lucide-react'
import { Avatar } from '../kit'

// P846 — the live-call screen. P857: it rings inside the VA's phone panel (./Phone), so a live call and the phone
// are one experience. It pops up when a call comes in (sample: about 20 seconds after you land, once per visit), from
// the + menu's Live call, and the Overview. Calling from the portal stays off (voice_live): Answer keeps the time and
// the notes here while the VA dials from a phone, and it says so with the numbers to dial.
export const SERVICE_LINE = '(800) 555-0110'

export default function LiveCall({ k, theirTime, onAnswer, onLater, onOpen }) {
  const first = k.name.split(' ')[0]
  return (
    <div className="fs-live fs-ph-ring">
      <div className="fs-live-top">
        <span className="fs-ring" aria-hidden="true"><PhoneIncoming size={22} /></span>
        <span className="tp-grow"><b>{k.name}</b><small>{k.agent}'s client · {k.client.city}, {k.client.state}</small><small>{theirTime}</small></span>
        <Avatar name={k.name} tone="blue" />
      </div>
      <div className="fs-swap is-hero"><span><small>Closing</small><b>{k.old_carrier}</b></span><ArrowRight size={16} aria-hidden="true" /><span><small>Keeping</small><b>{k.carrier}</b></span></div>
      <p className="fx-calm fs-off"><PhoneOff size={16} aria-hidden="true" />Calling is off right now. Answer to keep the time and notes here, and dial from your phone.</p>
      <dl className="fx-facts">{[[`${first}'s phone`, k.client.client_phone], [`${k.old_carrier} service line`, SERVICE_LINE]].map(([a, b]) => <div key={a}><dt>{a}</dt><dd className="tp-num">{b}</dd></div>)}</dl>
      <p className="tp-sub fs-live-note"><MessageSquare size={13} aria-hidden="true" />Coverage questions go to {k.agent.split(' ')[0]}, not on this call.</p>
      <div className="fs-ph-acts">
        <button type="button" className="tp-primary fx-accent" data-first onClick={onAnswer}><Phone size={16} />Answer</button>
        <button type="button" className="tp-btn ov-ghost" onClick={onOpen}><ArrowRight size={16} />Open the call</button>
        <button type="button" className="tp-btn ov-ghost" onClick={onLater}>Not now</button>
      </div>
    </div>
  )
}
