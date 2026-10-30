import { Navigate } from 'react-router-dom'

// Plan & billing (v2) lives on Billing now (portal parity T6): its membership plans, How it works,
// After a sale and payment note are components/agent/PlanV2Parts.jsx, drawn under the old Billing
// page when v2 is on. App.jsx already sends /agent/plan to /agent/billing; this page does the same
// for anything that still renders it.
export default function Plan() {
  return <Navigate to="/agent/billing" replace />
}
