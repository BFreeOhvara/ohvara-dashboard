import { CalendarClock } from 'lucide-react'
import { useNote } from '../../template/kit'
import { Dropdown } from '../kit'
import { useAdmSettings, useAdmActions } from '../data'

// P906 — Settings opened with tonight's launch switches. P934 kept a small "Go live" card. P950 (Brayden, Nov 10): no
// live switches anywhere in the portal. Going live is done by CC with Brayden's yes (brain/ohvara/Go Live Runbook.md);
// the admin Overview shows a read-only status line instead (adminshell/LiveStatus.jsx). What is left here is the
// booking gap, which is a setting, not a live switch.
function Row({ icon: Icon, title, sub, children }) {
  return (
    <li className="fx-form-row fx-form-sw">
      <div className="tp-grow"><b><Icon size={14} aria-hidden="true" /> {title}</b><p className="tp-sub">{sub}</p></div>
      {children}
    </li>
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
