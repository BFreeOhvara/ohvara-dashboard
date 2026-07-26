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

// Admin-side placeholders (Prompt 327). Every one of these is a page in the
// approved design whose data comes from call handling, which doesn't feed the
// app yet — so the nav entry is real and the page says why it's empty rather
// than showing invented numbers.

export function CallPipelinePlaceholder() {
  return (
    <ComingSoon
      title="Call Pipeline"
      description="Inbound → AI → transfer → underwriting → cancellation, as a live board. Needs the AI receptionist and call routing wired into the app first."
    />
  )
}

export function CloserRosterPlaceholder() {
  return (
    <ComingSoon
      title="Closer Roster"
      description="Who's on duty, who's on a call, who's idle. Lands here once duty status and live transfers run through the dashboard."
    />
  )
}

export function LeaderboardPlaceholder() {
  return (
    <ComingSoon
      title="Leaderboard"
      description="Daily and monthly rankings. The MTD ranking by submitted AP is already live on the Overview page."
    />
  )
}

export function AdminCommissionsPlaceholder() {
  return (
    <ComingSoon
      title="Commissions"
      description="Balances and reserves across all closers. Needs real comp-grid rates per carrier, product and contract tier — none of which exist yet."
    />
  )
}

export function LeadSourcesPlaceholder() {
  return (
    <ComingSoon
      title="Lead Sources"
      description="Google Ads spend, cost per call and cost per acquisition. Lands here once the ad account and landing page report into the app."
    />
  )
}
