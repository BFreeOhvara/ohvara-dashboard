import { GetInboundsPanel } from '../../components/agent/billing/GetInboundsPanel'
import { usePhoneLayout } from '../../hooks/usePhoneLayout'
import { isNativeApp } from '../../lib/native'
import Inbounds from './v2/Inbounds'

// The Inbounds page (/agent/leads): the title (from DashboardLayout / PhoneShell), the Get inbounds panel and,
// under it, the v2 list. BillingGate leaves it open while billing is locked. The phone app shows the panel's
// note and nothing else.
export default function BillingInbounds() {
  const phone = usePhoneLayout()
  if (isNativeApp()) return <GetInboundsPanel />
  return (
    <div style={{ maxWidth: 1120, width: '100%', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: phone ? 14 : 20, minWidth: 0 }}>
      <GetInboundsPanel />
      <Inbounds />
    </div>
  )
}
