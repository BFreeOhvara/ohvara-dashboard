import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import { BillingPanel } from '../../components/agent/BillingPanel'
import { PlanV2Parts } from '../../components/agent/PlanV2Parts'
import { usePortalV2 } from '../../lib/portalV2'
import { isNativeApp } from '../../lib/native'
import { NativeBillingNote } from '../../components/native/NativeBillingNote'

// Billing (Prompt 691) — the agent's weekly plan, next charge and Stripe
// links, promoted from a Settings tab to its own Work nav item since agents
// check it every week. Prompt 719 — the panel sets its own v16 width (1120px).
// Portal parity T6 — with v2 on, v2 Plan's membership plans, How it works,
// After a sale and payment note sit under the panel (display only), on the
// main view only (not Manage billing or Subscribe). /agent/plan lands here.
export default function AgentBilling() {
  const { profile } = useAuth()
  const { on: v2 } = usePortalV2()
  const [params] = useSearchParams()
  if (!profile) return null
  // Prompt 775 — no payments in the phone app.
  if (isNativeApp()) return <div style={{ maxWidth: 560 }}><NativeBillingNote /></div>
  const mainView = params.get('manage') !== '1' && !params.get('subscribe')
  return (
    <>
      <BillingPanel profile={profile} />
      {v2 && mainView && <PlanV2Parts />}
    </>
  )
}
