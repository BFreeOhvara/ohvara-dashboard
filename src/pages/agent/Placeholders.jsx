import { ComingSoon } from '../../components/agent/ComingSoon'

// Pages that stay in the nav but aren't wired to anything for launch
// (Round 33). Each is a real route so the sidebar never dead-ends.
//
// Underwriting was spec'd for a full polished non-functional UI (Round 39) —
// that build is UI-only work with no backend behind it, so it's deliberately
// deferred behind the real-wiring pages rather than shipped as invented
// sample data on launch day. It renders the placeholder for now. (Stats —
// same round — shipped for real in Prompt 348 as Performance.)

export function LiveCall() {
  return (
    <ComingSoon
      title="Live Call"
      description="Calls are handled outside the app today. Duty status and the live-transfer screen land here when call handling moves in."
    />
  )
}

export function CommissionsPlaceholder() {
  return (
    <ComingSoon
      title="Commissions"
      description="Carriers pay agents directly, so commissions are tracked here once the real comp-grid rates are loaded per carrier and product."
    />
  )
}

export function UnderwritingPlaceholder() {
  return (
    <ComingSoon
      title="Underwriting"
      description="Describe a client's health conditions and get a provisional carrier-placement ranking back. Lands here after launch."
    />
  )
}
