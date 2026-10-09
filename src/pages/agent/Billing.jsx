import { useAuth } from '../../hooks/useAuth'
import { BillingPanel } from '../../components/agent/BillingPanel'

// Billing (Prompt 691) — the agent's weekly plan, next charge and Stripe
// links, promoted from a Settings tab to its own Work nav item since agents
// check it every week. Prompt 719 — the panel sets its own v16 width (1120px).
export default function AgentBilling() {
  const { profile } = useAuth()
  if (!profile) return null
  return <BillingPanel profile={profile} />
}
