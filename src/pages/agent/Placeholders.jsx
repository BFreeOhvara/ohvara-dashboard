import { ComingSoon } from '../../components/agent/ComingSoon'

// Pages that stay in the nav but aren't wired to anything for launch
// (Round 33). Each is a real route so the sidebar never dead-ends.
//
// Underwriting and Stats were spec'd for a full polished non-functional UI
// (Round 39) — that build is UI-only work with no backend behind it, so it's
// deliberately deferred behind the real-wiring pages rather than shipped as
// invented sample data on launch day. They render the placeholder for now.

export function Quoter() {
  return (
    <ComingSoon
      title="Quoter"
      description="Pulling live carrier quotes needs an account with a real quoting toolkit. Once that's connected, quoting happens here."
    />
  )
}

export function LiveCall() {
  return (
    <ComingSoon
      title="Live Call"
      description="Calls are handled outside the app today. Duty status and the live-transfer screen land here when call handling moves in."
    />
  )
}

export function MyCallsPlaceholder() {
  return (
    <ComingSoon
      title="My Calls"
      description="Your call history and activity feed land here once calls run through the dashboard."
    />
  )
}

export function TrainingPlaceholder() {
  return (
    <ComingSoon
      title="Training Center"
      description="Onboarding videos, objection handling, and practice roleplay for closers land here."
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

export function StatsPlaceholder() {
  return (
    <ComingSoon
      title="Stats"
      description="Production drill-downs, persistency windows, and the leaderboard land here after launch."
    />
  )
}
