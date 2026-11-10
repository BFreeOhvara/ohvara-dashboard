import { MessageSquare, Phone, Bot, CalendarClock, Landmark } from 'lucide-react'
import { Switch, SampleTag, useNote } from '../../template/kit'
import { Dropdown } from '../kit'
import { useAdmSettings, useAdmActions, useAdmSource } from '../data'
import SampleSwitch from '../SampleSwitch'
import { LiveChargingRow } from './Billing933'

// P906 — Settings opened with tonight's launch switches. P934 (Brayden, Nov 10): only the go-live safety switches stay,
// in one small "Go live" card, each with a line on what it turns on: Texting (sms_live), Calling in the portal
// (voice_live), the AI caller (ai_caller_live), Live charging (P933) and Show sample data. Everything else is set, not
// switched: the Google call ads switch and the form/call lead split are gone (Meta form ads only; splitStore keeps the constant),
// and the nightly charge, max daily spend and founding lock live on Settings › Pay, the booking gap on Servicing.
const GO = [
  { key: 'sms_live', icon: MessageSquare, title: 'Texting', sub: 'Turns on every text the portal sends. Off until the A2P campaign is approved.' },
  { key: 'voice_live', icon: Phone, title: 'Calling in the portal', sub: 'Turns on real calls from the portal phone. Off, it opens as a preview.' },
  { key: 'ai_caller_live', icon: Bot, title: 'AI caller', sub: 'Turns on the AI calling every new form lead to book it, transfer it or mark No answer.' },
  // P945: owners' 50% of the profit, paid in the Monday run to the bank each owner connected (Revenue › Payouts).
  { key: 'owner_payouts_live', icon: Landmark, title: 'Owner payouts', sub: 'Pays each owner their 50% of the profit in the Monday pay run, to the bank they connected. Off until you turn it on.' },
]

function Row({ icon: Icon, title, sub, children }) {
  return (
    <li className="fx-form-row fx-form-sw">
      <div className="tp-grow"><b><Icon size={14} aria-hidden="true" /> {title}</b><p className="tp-sub">{sub}</p></div>
      {children}
    </li>
  )
}

export function GoLive({ live }) {
  const { data: s } = useAdmSettings()
  const { setSwitch } = useAdmActions()
  const src = useAdmSource()
  const note = useNote()
  return (
    <div className="adm-swgroup adm-launch adm-golive">
      <h3 className="fx-h3">Go live {src !== 'real' && <SampleTag>Sample</SampleTag>}</h3>
      <ul className="tp-list">
        {GO.map(g => (
          <Row key={g.key} icon={g.icon} title={g.title} sub={g.sub}>
            <Switch on={!!s.switches[g.key]} label={g.title} onChange={v => { setSwitch(g.key, v); note(`${g.title} ${v ? 'on' : 'off'}${src === 'real' ? '' : ' (sample)'}`) }} />
          </Row>
        ))}
        <LiveChargingRow />
        <SampleSwitch live={live} bare />
      </ul>
    </div>
  )
}

// Settings › Servicing: the gap kept free around every booked call (lib/callSlots.js AGENT_GAP_MIN; p894_booking_gap.sql).
const GAPS = [30, 45, 60, 90].map(m => ({ value: m, label: `${m} minutes` }))
export function BookingGap() {
  const { data: s } = useAdmSettings()
  const { setBookingGap } = useAdmActions()
  const note = useNote()
  return (
    <ul className="tp-list">
      <Row icon={CalendarClock} title="Booking gap" sub="Kept free around every booked call, for agents and VAs. The server refuses a booking inside it.">
        <Dropdown className="adm-dd-sm" label="Booking gap" value={s.bookingGap ?? 30} options={GAPS} onChange={v => { if (!setBookingGap) { note('Saved once the booking backend reads it'); return } setBookingGap(v); note(`Booking gap ${v} minutes (sample)`) }} />
      </Row>
    </ul>
  )
}
