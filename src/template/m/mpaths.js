import { paths, layoutOf } from '../paths'

// P908 — the phone build's links: the same addresses as the desktop (paths.js), so a link works at /template and at
// the real agent URLs, and a phone and a desktop share every address.
export const mp = {
  home: () => paths.home(),
  leads: lane => `${paths.leads()}${lane ? `?lane=${lane}` : ''}`,
  lead: (id, outcome) => `${paths.lead(id)}${outcome ? '?outcome=1' : ''}`,
  clients: () => paths.clients(),
  client: id => paths.client(id),
  calendar: () => paths.calendar(),
  more: () => paths.more(),
  billing: () => paths.billing(),
  activity: () => paths.activity(),
  settings: () => paths.settings(),
}

const TITLE = {
  overview: 'Overview', leads: 'Leads', clients: 'Clients', calendar: 'Calendar', more: 'More', billing: 'Billing', activity: 'Activity',
  settings: 'Settings', messages: 'Messages', submit: 'Submit a policy', 'request-service': 'Request a service',
}
// The page title for the top bar.
export const titleOf = pathname => TITLE[layoutOf(pathname)] || 'Overview'
// Pages with no tab of their own: the top bar shows a back arrow, and the More tab stays lit.
const SUB = ['billing', 'activity', 'settings', 'messages', 'submit', 'request-service']
export const isSub = pathname => SUB.includes(layoutOf(pathname))
