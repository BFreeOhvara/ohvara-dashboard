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
  queue: '/fulfillment/leads',
  calls: '/fulfillment/desk',
  clients: '/fulfillment/pipeline',
  servicing: '/fulfillment/servicing',
  pay: '/fulfillment/pay',
  more: '/fulfillment/more',
  messages: '/messages',
  settings: '/settings',
}
const PREVIEW = { messages: '/fulfillment/messages', settings: '/fulfillment/settings' }

// Messages and Settings at a mount (the router path, no /template prefix).
export const mountPath = (key, preview) => (preview && PREVIEW[key]) || FUL[key]

// The address of a page, or of one record's drawer on it (queue, calls, clients, servicing take an id).
export const fp = (key, id) => {
  const base = (isPreview() && PREVIEW[key]) || FUL[key]
  return id ? `${base}/${id}` : base
}

// Routes inside the router (both mounts): [page key, path, takes an id].
export const FUL_ROUTES = [
  ['overview', FUL.overview], ['queue', FUL.queue], ['queue', `${FUL.queue}/:id`], ['calls', FUL.calls], ['calls', `${FUL.calls}/:id`],
  ['clients', FUL.clients], ['clients', `${FUL.clients}/:id`], ['servicing', FUL.servicing], ['servicing', `${FUL.servicing}/:id`],
  ['pay', FUL.pay], ['more', FUL.more],
]

// The top tabs, in order. Messages and Settings live on the rail and the top right, as on the agent side.
export const FUL_TABS = [
  ['overview', 'Overview'], ['queue', 'Queue'], ['calls', 'Calls'], ['clients', 'Clients'], ['servicing', 'Servicing'], ['pay', 'Pay'],
]

const TITLES = {
  overview: ['Today', 'Overview'], queue: ['Call next', 'Queue'], calls: ['Cancellations', 'Calls'], clients: ['Every agent', 'Clients'],
  servicing: ['Client care', 'Servicing'], pay: ['What you earned', 'Pay'], messages: ['Your agents', 'Messages'], settings: ['Account', 'Settings'],
  more: ['Account', 'More'],
}
export const fulTitleOf = page => TITLES[page] || TITLES.overview

const noSlash = p => (p.length > 1 && p.endsWith('/') ? p.slice(0, -1) : p)

// Which page a location shows ('overview', 'queue', ...), from a router pathname (no /template prefix). A record's
// drawer keeps its list's page, so the page does not change under the drawer.
export function fulPageOf(pathname) {
  const p = noSlash(String(pathname || ''))
  if (p === PREVIEW.messages || p === FUL.messages) return 'messages'
  if (p === PREVIEW.settings || p === FUL.settings) return 'settings'
  const hit = Object.entries(FUL).find(([, base]) => base !== FUL.overview && (p === base || p.startsWith(`${base}/`)))
  if (hit) return hit[0]
  return p === FUL.overview ? 'overview' : null
}
