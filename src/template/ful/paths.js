// P845 — the Fulfillment (VA) side's addresses, for both mounts: the preview at /template/fulfillment (the template
// router's basename adds /template, so the strings are the same) and the real VA URLs (src/fulshell/paths.js gates
// who gets there). Only Messages and Settings differ: at /template those addresses are the agent's pages.
// No imports on purpose: it stays tiny and runs under node --test.

const isPreview = () => {
  const p = globalThis.window?.location?.pathname || ''
  return p === '/template' || p.startsWith('/template/')
}

export const FUL = {
  overview: '/fulfillment',
  calendar: '/fulfillment/calendar', // P918: every booked call (it was the Schedule page)
  clients: '/fulfillment/pipeline',
  schedule: '/fulfillment/schedule', // P918: the VA's own hours: shifts, clock in and out, time off, cover
  pay: '/fulfillment/pay',
  more: '/fulfillment/more',
  training: '/fulfillment/training', // P872: the rail's Training (one lesson per job)
  messages: '/messages',
  settings: '/settings',
}
// P846: Calls became Schedule. The old Calls address (and a call's drawer under it) redirects to the Schedule.
export const OLD_CALLS = '/fulfillment/desk'
// P907: there is no Queue (VAs never see new leads; every call is a booking). Its old address redirects to the Calendar.
export const OLD_QUEUE = '/fulfillment/leads'
// P918: no Servicing page (its calls are on the Calendar, its client work in each client's stage checklist). Its old
// address, and a step under it, open on the Calendar; so does an old booked call under /fulfillment/schedule/<id>.
export const OLD_SERVICING = '/fulfillment/servicing'
const PREVIEW = { messages: '/fulfillment/messages', settings: '/fulfillment/settings' }

// Messages and Settings at a mount (the router path, no /template prefix).
export const mountPath = (key, preview) => (preview && PREVIEW[key]) || FUL[key]

// The address of a page, or of one record's drawer on it (calendar and clients take an id).
export const fp = (key, id) => {
  const base = (isPreview() && PREVIEW[key]) || FUL[key]
  return id ? `${base}/${id}` : base
}

// Routes inside the router (both mounts): [page key, path, takes an id].
export const FUL_ROUTES = [
  ['overview', FUL.overview], ['calendar', FUL.calendar], ['calendar', `${FUL.calendar}/:id`],
  ['clients', FUL.clients], ['clients', `${FUL.clients}/:id`], ['schedule', FUL.schedule],
  ['pay', FUL.pay], ['more', FUL.more], ['training', FUL.training], ['training', `${FUL.training}/:id`],
]

// P918: the tabs, in order (Brayden: "I don't want tabs for no reason"). Messages and Settings live on the rail
// and the top right, as on the agent side. P931: Training is back on the left rail only, not a tab.
export const FUL_TABS = [
  ['overview', 'Overview'], ['calendar', 'Calendar'], ['clients', 'Clients'], ['schedule', 'Schedule'], ['pay', 'Pay'],
]

const TITLES = {
  overview: ['Today', 'Overview'], calendar: ['Your booked calls', 'Calendar'], clients: ['Every agent', 'Clients'], schedule: ['Your hours', 'Schedule'],
  pay: ['What you earned', 'Pay'], messages: ['Your agents', 'Messages'], settings: ['Account', 'Settings'],
  more: ['Account', 'More'], training: ['Know the job', 'Training'],
}
export const fulTitleOf = page => TITLES[page] || TITLES.overview

const noSlash = p => (p.length > 1 && p.endsWith('/') ? p.slice(0, -1) : p)

// Which page a location shows ('overview', 'schedule', ...), from a router pathname (no /template prefix). A record's
// drawer keeps its list's page, so the page does not change under the drawer.
export function fulPageOf(pathname) {
  const p = noSlash(String(pathname || ''))
  if (p === PREVIEW.messages || p === FUL.messages) return 'messages'
  if (p === PREVIEW.settings || p === FUL.settings) return 'settings'
  if ([OLD_CALLS, OLD_QUEUE, OLD_SERVICING].some(o => p === o || p.startsWith(`${o}/`))) return 'calendar'
  if (p.startsWith(`${FUL.schedule}/`)) return 'calendar' // an old booked call's address, on its way to the Calendar
  const hit = Object.entries(FUL).find(([, base]) => base !== FUL.overview && (p === base || p.startsWith(`${base}/`)))
  if (hit) return hit[0]
  return p === FUL.overview ? 'overview' : null
}
