import { supabase } from './supabase'

// Prompt 673 — agent retainer (weekly, agent pays Ohvara; tiers by weekly
// submission cap since Prompt 692). Migration 113
// holds the state on profiles; Stripe (Checkout + Customer Portal + webhook)
// writes it. Until the `agent-billing` edge function exists the Settings
// panel reads as "not connected", and nothing is gated until
// app_settings.agent_billing_enforced is switched on.
//
// Grace decision: a failed renewal doesn't lock anyone out on the spot. The
// webhook sets billing_grace_until = failure + GRACE_HOURS and the agent
// keeps full access (with a banner) while Stripe retries the card. After
// that they're locked out of every page except Settings, where Billing lives,
// so the way back in is always one click away. Fulfillment keeps working
// clients the agent already booked either way; the client shouldn't pay for
// the agent's card bouncing.

export const GRACE_HOURS = 48

export const BILLING_STATUS = {
  none:     { label: 'Not subscribed', tone: 'muted' },
  active:   { label: 'Current',        tone: 'success' },
  past_due: { label: 'Payment failed', tone: 'warning' },
  lapsed:   { label: 'Lapsed',         tone: 'danger' },
  canceled: { label: 'Cancelled',      tone: 'muted' },
  exempt:   { label: 'Exempt',         tone: 'muted' },
}

export const TONE_STYLE = {
  success: { background: 'var(--success-dim)', color: 'var(--success)', border: '1px solid var(--success-bd)' },
  warning: { background: 'var(--warning-dim)', color: 'var(--warning)', border: '1px solid var(--warning-bd)' },
  danger:  { background: 'var(--danger-dim)',  color: 'var(--danger)',  border: '1px solid var(--danger-bd)' },
  muted:   { background: 'var(--bg-elevated)', color: 'var(--text-secondary)', border: 'var(--border-w) solid var(--border)' },
}

const future = (iso, now) => !!iso && new Date(iso).getTime() > now

// Does this profile currently get into the portal?
//   { locked, grace } — grace = past_due but still inside the buffer.
// Only agents are ever billed; everyone else always has access.
export function billingAccess(profile, enforced, now = Date.now()) {
  if (!profile || profile.role !== 'agent' || !enforced) return { locked: false, grace: false }
  switch (profile.billing_status) {
    case 'active':
    case 'exempt':
      return { locked: false, grace: false }
    case 'past_due':
      return future(profile.billing_grace_until, now)
        ? { locked: false, grace: true }
        : { locked: true, grace: false }
    case 'canceled':
      // Cancelled at period end: the paid week still counts.
      return { locked: !future(profile.billing_current_period_end, now), grace: false }
    default:
      return { locked: true, grace: false }
  }
}

export function formatWeekly(cents) {
  const n = (cents ?? 35000) / 100
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: n % 1 ? 2 : 0 })}`
}

export function formatBillingDate(iso) {
  if (!iso) return null
  return new Date(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

// Whole days until an ISO timestamp (rounded up, floor 0), or null if unset.
export function daysUntil(iso, now = Date.now()) {
  if (!iso) return null
  return Math.max(0, Math.ceil((new Date(iso).getTime() - now) / 86400000))
}

// Prompt 692 — cap helpers. `usage` is a row from agent_weekly_usage.
// cap is null for uncapped / exempt agents. atCap only counts as blocking when
// enforcement is on; before go-live the number is shown but nothing is refused.
export function capState(usage) {
  if (!usage) return null
  const cap = usage.weekly_cap
  const used = usage.used ?? 0
  return {
    cap, used,
    left: cap == null ? null : Math.max(0, cap - used),
    atCap: cap != null && used >= cap,
    blocking: !!usage.enforced && cap != null && used >= cap,
    tierName: usage.tier_name,
  }
}

// The next plan up (by sort order) from the agent's current one, or null.
export function nextTier(tiers, currentKey) {
  const i = (tiers || []).findIndex(t => t.key === currentKey)
  return i >= 0 ? tiers[i + 1] || null : null
}

export const capLabel = cap => (cap == null ? 'No weekly cap' : `${cap} submissions a week`)

// "Monday" the cap comes back, from usage.week_end.
export function formatReset(iso) {
  if (!iso) return 'Monday'
  return new Date(iso).toLocaleDateString('en-US', { weekday: 'long' })
}

// supabase.functions.invoke hides a non-2xx body behind error.context; unwrap
// it like invokeCallerId does. `extra` rides along in the body ({ tier },
// { flow: 'change_plan' }).
export async function invokeBilling(action, extra = {}) {
  const { data, error } = await supabase.functions.invoke('agent-billing', {
    body: { action, return_url: `${window.location.origin}/agent/billing`, ...extra },
  })
  if (!error) return data
  let payload = null
  try { payload = await error.context?.json() } catch { /* not JSON */ }
  const err = new Error(payload?.error || error.message || 'Request failed')
  err.code = payload?.code
  throw err
}
