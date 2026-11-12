// P837 — the Fulfillment (VA) shell's addresses (P845: the gate ShellSwap uses; the pages live in src/template/ful). The agent shell's look (src/template), at today's
// Fulfillment URLs, on real data. Lives outside src/template because it reads the backend.
// No imports on purpose: it stays tiny and runs under node --test.

export const FUL = {
  today: '/fulfillment',
  queue: '/fulfillment/leads', // P907: no Queue page; kept so an old link reaches the shell and lands on the Schedule
  calls: '/fulfillment/desk',
  schedule: '/fulfillment/schedule', // P846: Calls became Schedule; the old Calls address stays in the gate and redirects there
  clients: '/fulfillment/pipeline',
  servicing: '/fulfillment/servicing', // P918: no Servicing page; an old link reaches the shell and lands on the Calendar
  calendar: '/fulfillment/calendar', // P918: the booked calls (Schedule is the VA's own hours now)
  pay: '/fulfillment/pay',
  more: '/fulfillment/more',
  training: '/fulfillment/training', // P872
  messages: '/messages',
  settings: '/settings',
}

const noSlash = p => (p.length > 1 && p.endsWith('/') ? p.slice(0, -1) : p)
const PATHS = Object.values(FUL)

// P845 (P846 adds schedule): one record's drawer has its own address under Queue, Calls, Clients and Servicing.
const RECORD = /^\/fulfillment\/(leads|desk|schedule|calendar|pipeline|servicing|training)\/[^/]+$/
export function isFulShellPath(pathname) {
  const p = noSlash(String(pathname || ''))
  return PATHS.includes(p) || RECORD.test(p)
}

// A Fulfillment rep gets the shell, on the web and in the phone app alike (P956). Admin keeps today's pages (they
// redirect to /admin).
export function showFulShell({ role, pathname }) {
  return role === 'fulfillment' && isFulShellPath(pathname)
}

// The top tabs, in order. Messages and Settings live on the rail and the top right, as on the agent side.
export const FUL_TABS = [
  ['today', 'Today'], ['calls', 'Calls'], ['clients', 'Clients'], ['servicing', 'Servicing'], ['pay', 'Pay'],
]

const TITLES = {
  today: ['Your day', 'Today'], calls: ['Cancellations', 'Calls'], clients: ['Your book', 'Clients'],
  servicing: ['Client care', 'Servicing'], pay: ['What you earned', 'Pay'], messages: ['Team', 'Messages'], settings: ['Account', 'Settings'],
  more: ['Account', 'More'],
}

// Which page a location is ('today', 'queue', ...), or null for an address outside the shell.
export function fulPageOf(pathname) {
  const p = noSlash(String(pathname || ''))
  return Object.keys(FUL).find(k => FUL[k] === p) || null
}

export const fulTitleOf = page => TITLES[page] || TITLES.today
