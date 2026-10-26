import {
  Users, Home, Settings, CalendarPlus, MessageSquare, ListFilter, Wallet, History, CreditCard, Phone,
} from 'lucide-react'

// Each role's sidebar, grouped. Moved out of Sidebar.jsx by Prompt 722 so the
// page header (group / page name / icon) and the header search's "Go to" read
// the same list. Items and routes are unchanged.
export const NAV = {
  // Prompt 665 — agent portal rebuilt around booking Fulfillment calls.
  // Prompt 676 — grouped the way Restorix Portal's Layout.jsx is instead of
  // one flat list. Prompt 678 — Training and Performance removed, Team folded
  // into Work, so no group is empty or single-item (bar Today / Account).
  agent: [
    { group: 'Today', items: [
      { to: '/agent', label: 'Overview', icon: Home },
    ] },
    { group: 'Work', items: [
      { to: '/agent/book', label: 'Book a call', icon: CalendarPlus },
      { to: '/agent/clients', label: 'My Pipeline', icon: Users },
      // Prompt 690 — chronological log of what happened, next to My Pipeline.
      { to: '/agent/activity', label: 'Activity', icon: History },
      // P808: Leads hidden until its migration is live and the page is approved.
    ] },
    // Prompt 680 — Messages gets its own single-item group, as in Restorix.
    { group: 'Communications', items: [
      { to: '/messages', label: 'Messages', icon: MessageSquare },
    ] },
    // Prompt 693 — Billing is about the agent's own account standing, so it
    // sits with Settings; Team removed.
    { group: 'Account', items: [
      { to: '/agent/billing', label: 'Billing', icon: CreditCard },
      { to: '/settings', label: 'Settings', icon: Settings },
    ] },
  ],
  // Prompt 758 — the admin sidebar, grouped like the agent and Fulfillment
  // ones. Book a call is a header button for admin; Activity is reached from
  // Users (route kept); Carrier hours moved into Settings.
  admin: [
    { group: 'Today', items: [
      { to: '/admin', label: 'Overview', icon: Home },
    ] },
    { group: 'Work', items: [
      { to: '/admin/pipeline', label: 'Pipeline', icon: ListFilter },
      { to: '/admin/fulfillment', label: 'Fulfillment', icon: Phone },
      { to: '/admin/payouts', label: 'Payouts', icon: Wallet },
    ] },
    { group: 'Communications', items: [
      { to: '/messages', label: 'Messages', icon: MessageSquare },
    ] },
    { group: 'Account', items: [
      { to: '/admin/users', label: 'Users', icon: Users },
      { to: '/settings', label: 'Settings', icon: Settings },
    ] },
  ],
  // Prompt 681 — same shape as the agent side: Overview landing page, the
  // desk + a team-wide Pipeline under Work, Messages in its own group.
  fulfillment: [
    { group: 'Today', items: [
      { to: '/fulfillment', label: 'Overview', icon: Home },
    ] },
    { group: 'Work', items: [
      // Prompt 748 — the role and the tab shared a name; the tab is "My calls".
      { to: '/fulfillment/desk', label: 'My calls', icon: Phone },
      { to: '/fulfillment/pipeline', label: 'Pipeline', icon: ListFilter },
      // Prompt 753 — Getting Paid → My pay.
      { to: '/fulfillment/pay', label: 'My pay', icon: Wallet },
    ] },
    { group: 'Communications', items: [
      { to: '/messages', label: 'Messages', icon: MessageSquare },
    ] },
    { group: 'Account', items: [
      { to: '/settings', label: 'Settings', icon: Settings },
    ] },
  ],
}

// The nav item (+ its group) a route belongs to, or null.
export function navEntry(role, pathname) {
  for (const g of NAV[role] || []) {
    const item = g.items.find(i => i.to === pathname)
    if (item) return { group: g.group, ...item }
  }
  return null
}

// Prompt 722 — the page header's colour (a key of the .ov-tone-* classes).
// Pages not listed are blue.
export const PAGE_TONE = {
  '/agent/book': 'teal',
  '/agent/activity': 'violet',
  '/agent/leads': 'teal',
  '/agent/billing': 'amber',
  '/settings': 'slate',
}
