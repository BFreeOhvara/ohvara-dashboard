import { Link } from 'react-router-dom'
import { PhoneIncoming } from 'lucide-react'
import { useBillingInbound } from '../../../hooks/useBillingInbound'
import { usePhoneLayout } from '../../../hooks/usePhoneLayout'
import { startCardKind } from '../../../lib/billingInbound'
import { isNativeApp } from '../../../lib/native'

// Overview and phone Home: one line and one button, only at zero active spend. Renders nothing while
// loading, on an error, for comped agents and in the phone app.

const WORDS = {
  start: ['Start getting inbounds', 'Set a weekly amount for Live Calls or Booked Appointments.', 'Start'],
  paused: ['Your inbounds are paused', 'Resume them when you’re ready.', 'Open'],
}

export function StartInboundsCard() {
  const phone = usePhoneLayout()
  const { data } = useBillingInbound()
  const kind = isNativeApp() ? null : startCardKind(data)
  if (!kind) return null
  const [title, line, button] = WORDS[kind]
  return (
    <section className="ov-card" style={{ display: 'flex', alignItems: 'center', gap: phone ? 12 : 14, padding: phone ? '12px 12px 12px 14px' : '14px 16px 14px 18px', minWidth: 0 }}>
      <span style={{ width: 40, height: 40, borderRadius: 12, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--ov-data-b-tint)', color: 'var(--ov-data-b)' }}>
        <PhoneIncoming size={19} strokeWidth={2} aria-hidden="true" />
      </span>
      <div style={{ flex: 1, minWidth: 0, fontSize: 14, color: 'var(--ov-mute)' }}>
        <b style={{ fontSize: 15, fontWeight: 700, color: 'var(--ov-hi)', marginRight: phone ? 0 : 6 }}>{title}</b>
        {!phone && <span>{line}</span>}
      </div>
      <Link to="/agent/leads" className="ov-ghost" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, height: 44, minWidth: 92, padding: '0 20px', borderRadius: 999, fontSize: 14, fontWeight: 600, textDecoration: 'none', whiteSpace: 'nowrap' }}>
        {button}
      </Link>
    </section>
  )
}
