import { useNavigate } from 'react-router-dom'
import { PhoneIncoming, PhoneOff, ArrowRight, MessageSquare } from 'lucide-react'
import { useFulCalls, useFulActions, useFulLive } from './data'
import { Avatar, Drawer } from '../kit'
import { fp } from './paths'

// P846 — the live-call screen, now an overlay. It pops up when a call comes in (like the agent's transfer alert) and
// the rail's Live call button, a call's Start call and the Overview all open the same screen. Calling from the portal
// stays off (voice_live): it says so and shows the numbers to dial from a phone. Sample: the frame lets one pop up
// about 20 seconds after you land, once per visit, so the screen can be seen without a real call.
const SERVICE_LINE = '(800) 555-0110'

export default function LiveCall() {
  const id = useFulLive()
  const { data: calls } = useFulCalls()
  const { hideLive } = useFulActions()
  const navigate = useNavigate()
  const k = id ? calls.find(x => x.id === id) : null
  const first = k?.name.split(' ')[0]
  const openIt = () => { hideLive(); navigate(fp('schedule', k.id)) }
  return (
    <Drawer open={!!k} center onClose={hideLive} title="Live call" sub={k ? `${k.agent}'s client · ${k.client.city}, ${k.client.state}` : ''}
      footer={k ? <><button type="button" className="tp-primary fx-accent" onClick={openIt}><ArrowRight size={16} />Open the call</button><button type="button" className="tp-btn ov-ghost" onClick={hideLive}>Not now</button></> : null}>
      {k && <div className="fs-live">
        <div className="fs-live-top">
          <span className="fs-ring" aria-hidden="true"><PhoneIncoming size={22} /></span>
          <span className="tp-grow"><b>{k.name}</b><small>Call due {k.time} · closing {k.old_carrier}</small></span>
          <Avatar name={k.name} tone="blue" />
        </div>
        <div className="fs-swap is-hero"><span><small>Closing</small><b>{k.old_carrier}</b></span><ArrowRight size={16} aria-hidden="true" /><span><small>Keeping</small><b>{k.carrier}</b></span></div>
        <p className="fx-calm fs-off"><PhoneOff size={16} aria-hidden="true" />Calling from the portal is switched off for now. Dial from your phone, then mark the result on the call.</p>
        <dl className="fx-facts">{[[`${first}'s phone`, k.client.client_phone], [`${k.old_carrier} service line`, SERVICE_LINE]].map(([a, b]) => <div key={a}><dt>{a}</dt><dd className="tp-num">{b}</dd></div>)}</dl>
        <p className="tp-sub fs-live-note"><MessageSquare size={13} aria-hidden="true" />Coverage questions go to {k.agent.split(' ')[0]}, not on this call.</p>
      </div>}
    </Drawer>
  )
}
