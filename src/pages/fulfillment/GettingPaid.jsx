import { useAuth } from '../../hooks/useAuth'
import { GettingPaidPanel } from '../../components/fulfillment/GettingPaid'

// Getting Paid (Prompt 683) — the rep's clock + hours + pay estimate, promoted
// from a Settings tab to its own Work nav item since it's checked daily.
// Content is unchanged from Prompt 681's GettingPaidPanel.
export default function FulfillmentGettingPaid() {
  const { profile } = useAuth()
  if (!profile) return null
  return <div style={{ maxWidth: 880 }}><GettingPaidPanel profile={profile} /></div>
}
