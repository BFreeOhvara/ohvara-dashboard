import { GetInboundsPanel } from '../../components/agent/billing/GetInboundsPanel'

// /agent/inbounds: the title (from DashboardLayout / PhoneShell) and the Get inbounds panel, nothing else.
// BillingGate leaves it open while billing is locked.
export default function BillingInbounds() {
  return <GetInboundsPanel />
}
