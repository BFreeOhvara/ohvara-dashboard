// P908 — the phone mockup's addresses (inside /template). Phase 2 swaps these for the real agent paths.
export const mp = {
  home: () => '/m',
  leads: lane => `/m/leads${lane ? `?lane=${lane}` : ''}`,
  lead: (id, outcome) => `/m/leads/${id}${outcome ? '?outcome=1' : ''}`,
  clients: () => '/m/clients',
  client: id => `/m/clients/${id}`,
  calendar: () => '/m/calendar',
  more: () => '/m/more',
  billing: () => '/m/billing',
  activity: () => '/m/activity',
  settings: () => '/m/settings',
}

// The page title for the top bar, from the address.
export const titleOf = pathname => {
  const seg = pathname.replace(/^\/m\/?/, '').split('/')[0]
  return { '': 'Overview', leads: 'Leads', clients: 'Clients', calendar: 'Calendar', more: 'More', billing: 'Billing', activity: 'Activity', settings: 'Settings' }[seg] || 'Overview'
}
// Billing, Activity and Settings sit under More: their top bar shows a back arrow to More.
export const underMore = pathname => /^\/m\/(billing|activity|settings)/.test(pathname)
