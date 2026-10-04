import { useAuth } from '../../hooks/useAuth'
import { BillingPanel } from '../../components/agent/BillingPanel'

// Billing (Prompt 691) — the agent's $350/week status, countdown and Stripe
// links, promoted from a Settings tab to its own Work nav item since agents
// check it every week. Content is unchanged from Prompt 673's BillingPanel.
export default function AgentBilling() {
  const { profile } = useAuth()
  if (!profile) return null
  return <div style={{ maxWidth: 880 }}><BillingPanel profile={profile} /></div>
}
