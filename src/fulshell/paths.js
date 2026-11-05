// P837 — the Fulfillment (VA) shell's addresses. The agent shell's look (src/template), at today's
// Fulfillment URLs, on real data. Lives outside src/template because it reads the backend.
// No imports on purpose: it stays tiny and runs under node --test.

export const FUL = {
  today: '/fulfillment',
  queue: '/fulfillment/leads',
  calls: '/fulfillment/desk',
  clients: '/fulfillment/pipeline',
  servicing: '/fulfillment/servicing',
  pay: '/fulfillment/pay',
  more: '/fulfillment/more',
  messages: '/messages',
  settings: '/settings',
}

const noSlash = p => (p.length > 1 && p.endsWith('/') ? p.slice(0, -1) : p)
const PATHS = Object.values(FUL)

export function isFulShellPath(pathname) {
  return PATHS.includes(noSlash(String(pathname || '')))
}

// A Fulfillment rep on the web gets the shell. Admin keeps today's pages (they redirect to /admin),
// and the phone app keeps today's pages, the same rule as the agent shell.
export function showFulShell({ role, pathname, native }) {
  return role === 'fulfillment' && isFulShellPath(pathname) && !native
}

// The top tabs, in order. Messages and Settings live on the rail and the top right, as on the agent side.
export const FUL_TABS = [
  ['today', 'Today'], ['queue', 'Queue'], ['calls', 'Calls'], ['clients', 'Clients'], ['servicing', 'Servicing'], ['pay', 'Pay'],
]

const TITLES = {
  today: ['Your day', 'Today'], queue: ['Call next', 'Queue'], calls: ['Cancellations', 'Calls'], clients: ['Your book', 'Clients'],
  servicing: ['Client care', 'Servicing'], pay: ['What you earned', 'Pay'], messages: ['Team', 'Messages'], settings: ['Account', 'Settings'],
  more: ['Account', 'More'],
}

// Which page a location is ('today', 'queue', ...), or null for an address outside the shell.
export function fulPageOf(pathname) {
  const p = noSlash(String(pathname || ''))
  return Object.keys(FUL).find(k => FUL[k] === p) || null
}

export const fulTitleOf = page => TITLES[page] || TITLES.today
