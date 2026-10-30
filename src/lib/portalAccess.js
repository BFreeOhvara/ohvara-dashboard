// Who gets into the agent portal, and what each page shows them. No imports, so
// `node --test` can load it as is. billing.js re-exports what the app uses.
//
// This only decides what to render. The real boundary is in the database
// (migration 190's triggers and policies).
//
//   Not an agent, or comped:        open.
//   Invited (signup_source missing or 'invite'): billingAccess, exactly as before
//     self-signup existed: locked only when agent_billing_enforced is on.
//   Self-signup: open only when agent_portal_access says unlocked. A Leads-only
//     payer is open but can't submit (needsServicing). If the answer is unknown
//     (the RPC is missing or errored) it stays locked.

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

// access: the jsonb from agent_portal_access ({ self, servicing, leads, unlocked }),
// or anything else ('unknown', null) when it couldn't be read.
export function portalState(profile, access, settings, now = Date.now()) {
  const open = { locked: false, grace: false, servicing: true, leads: false, needsServicing: false, self: false, unknown: false }
  if (!profile || profile.role !== 'agent' || profile.billing_exempt) return open

  if (profile.signup_source !== 'self') {
    const { locked, grace } = billingAccess(profile, !!settings?.agent_billing_enforced, now)
    return { ...open, locked, grace, servicing: !locked }
  }

  if (!access || typeof access !== 'object' || typeof access.unlocked !== 'boolean') {
    return { ...open, locked: true, servicing: false, self: true, unknown: true }
  }
  const locked = !access.unlocked
  const servicing = !!access.servicing
  return {
    ...open,
    locked,
    // A self-signup's failed renewal gets the same banner while the grace lasts.
    grace: !locked && billingAccess(profile, true, now).grace,
    servicing,
    leads: !!access.leads,
    needsServicing: !locked && !servicing,
    self: true,
  }
}

// Billing and Settings stay reachable so paying is always one click away. More
// too for a self-signup: on a phone it's the way to Billing, Settings and Sign out.
const PAUSED_PASS = ['/settings', '/agent/billing', '/agent/leads']
const WELCOME_PASS = [...PAUSED_PASS, '/agent/more']
const SERVICING_PAGES = ['/agent/submit', '/agent/book', '/agent/clients']

// What a page shows for a portalState: 'open' | 'welcome' | 'paused' | 'servicing'.
export function gateView(state, pathname) {
  if (state.locked) {
    if (state.self) return WELCOME_PASS.includes(pathname) ? 'open' : 'welcome'
    return PAUSED_PASS.includes(pathname) ? 'open' : 'paused'
  }
  return state.needsServicing && SERVICING_PAGES.includes(pathname) ? 'servicing' : 'open'
}
