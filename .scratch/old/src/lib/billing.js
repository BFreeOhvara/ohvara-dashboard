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
  // Gate applies only to role=agent with billing_exempt=false (P673).
  if (!profile || profile.role !== 'agent' || profile.billing_exempt || !enforced) return { locked: false, grace: false }
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

// Prompt 725 — a comped agent (billing_exempt) is shown to the agent exactly
// as an active subscriber on its tier: it never pays and is never locked, but
// it sees "Active", a next-charge date and its tier's weekly cap. With no
// Stripe period, its renewal date is the end of its booking week (usage.week_end).
// "Exempt" is admin-only wording.
export const isComped = profile => !!profile?.billing_exempt

export const shownStatus = profile => (isComped(profile) ? 'active' : profile?.billing_status || 'none')

export function renewsAt(profile, usage) {
  return isComped(profile) ? usage?.week_end ?? null : profile?.billing_current_period_end ?? null
}

export function formatWeekly(cents) {
  const n = (cents ?? 35000) / 100
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: n % 1 ? 2 : 0 })}`
}

// P743 QA-1 — optional `tz` (profiles.timezone): the booking week is counted in
// the agent's own zone, so its dates are read there too.
export function formatBillingDate(iso, tz) {
  if (!iso) return null
  return new Date(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', ...(tz ? { timeZone: tz } : null) })
}

// Whole days until an ISO timestamp (rounded up, floor 0), or null if unset.
export function daysUntil(iso, now = Date.now()) {
  if (!iso) return null
  return Math.max(0, Math.ceil((new Date(iso).getTime() - now) / 86400000))
}

// Prompt 692 — cap helpers. `usage` is a row from agent_weekly_usage.
// cap is null for uncapped agents and non-agents. atCap only counts as blocking when
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

export const capLabel = cap => (cap == null ? 'No weekly cap' : `max of ${cap} submissions a week`)

// "Monday" the cap comes back, from usage.week_end, read in the agent's own
// zone (`tz`) like the database's week (P743 QA-1).
export function formatReset(iso, tz) {
  if (!iso) return 'Monday'
  return new Date(iso).toLocaleDateString('en-US', { weekday: 'long', ...(tz ? { timeZone: tz } : null) })
}

// Prompt 734 — Stripe.js for the in-page card box and checkout. The script
// (js.stripe.com) is only fetched the first time a Billing view needs it, and
// once per publishable key. The key comes from agent-billing (secret
// STRIPE_PUBLISHABLE_KEY), so rotating it needs no frontend change.
let stripeLoad = null
let stripeKey = null
export function getStripe(publishableKey) {
  if (publishableKey !== stripeKey) {
    stripeKey = publishableKey
    stripeLoad = import('@stripe/stripe-js/pure').then(m => m.loadStripe(publishableKey))
  }
  return stripeLoad
}

// Stripe's fields live in an iframe and can't read our CSS variables, so the
// v16 tokens are repeated here as values (dark = --ov-* on :root, light =
// [data-theme="light"]). Keep in step with index.css.
export function stripeAppearance(theme) {
  const light = theme === 'light'
  return {
    theme: light ? 'stripe' : 'night',
    variables: {
      colorPrimary: light ? '#00806F' : '#7FA6F2',
      colorBackground: light ? '#FFFFFF' : '#10121A',
      colorText: light ? '#07332E' : '#FFFFFF',
      colorTextSecondary: light ? '#4F7F78' : '#8697B5',
      colorTextPlaceholder: light ? '#7FA59F' : '#5E7195',
      colorDanger: light ? '#B42318' : '#F87171',
      fontFamily: 'Manrope, system-ui, -apple-system, Segoe UI, sans-serif',
      fontSizeBase: '15px',
      borderRadius: '12px',
      spacingUnit: '4px',
    },
    rules: {
      '.Input': {
        backgroundColor: light ? '#F6FAF9' : 'rgba(0,0,0,0.28)',
        border: light ? '1px solid rgba(2,79,70,0.18)' : '1px solid rgba(255,255,255,0.10)',
        boxShadow: 'none',
        padding: '13px 14px',
      },
      '.Input:focus': {
        border: `1px solid ${light ? '#00806F' : '#7FA6F2'}`,
        boxShadow: `0 0 0 3px ${light ? 'rgba(0,128,111,0.16)' : 'rgba(127,166,242,0.18)'}`,
      },
      '.Label': { fontWeight: '600', color: light ? '#2C6159' : '#B4C3DE' },
      '.Tab': {
        backgroundColor: light ? '#F6FAF9' : 'rgba(0,0,0,0.28)',
        border: light ? '1px solid rgba(2,79,70,0.18)' : '1px solid rgba(255,255,255,0.10)',
      },
    },
  }
}

// supabase.functions.invoke hides a non-2xx body behind error.context; unwrap
// it like invokeCallerId does. `extra` rides along in the body ({ tier },
// { payment_method }, …).
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
