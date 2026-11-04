// Every link in src/template goes through here, so the same screens work at /template and at the real agent URLs.
// No imports on purpose: it stays tiny and runs under node --test. The address is read at call time.

export function isTemplateAddress() {
  const p = globalThis.window?.location?.pathname || ''
  return p === '/template' || p.startsWith('/template/')
}

// At /template the router's basename adds the prefix, so these are the plain shell paths there.
const both = (plain, real) => () => (isTemplateAddress() ? plain : real)

export const paths = {
  home: both('/', '/agent'),
  leads: both('/leads', '/agent/leads'),
  lead: id => (isTemplateAddress() ? `/leads/${id}` : `/agent/inbounds/${id}`),
  calendar: both('/calendar', '/agent/calendar'),
  clients: stage => {
    const q = stage ? `?stage=${stage}` : ''
    return (isTemplateAddress() ? '/clients' : '/agent/clients') + q
  },
  client: id => (isTemplateAddress() ? `/clients/${id}` : `/agent/clients/${id}`),
  submit: both('/submit', '/agent/submit'),
  requestService: both('/request-service', '/agent/request-service'),
  messages: () => '/messages',
  activity: both('/activity', '/agent/activity'),
  billing: both('/billing', '/agent/billing'),
  settings: () => '/settings',
  more: both('/more', '/agent/more'),
  signup: () => '/signup',
  welcome: () => '/welcome',
}

export const SHELL_ROUTES = {
  overview: '/agent',
  leads: '/agent/leads',
  lead: '/agent/inbounds/:id',
  calendar: '/agent/calendar',
  clients: '/agent/clients',
  client: '/agent/clients/:clientId',
  submit: '/agent/submit',
  requestService: '/agent/request-service',
  activity: '/agent/activity',
  billing: '/agent/billing',
  more: '/agent/more',
  settings: '/settings',
  messages: '/messages',
}

const PATTERNS = Object.values(SHELL_ROUTES).map(p => new RegExp(`^${p.replace(/:[A-Za-z]+/g, '[^/]+')}$`))

const noSlash = p => (p.length > 1 && p.endsWith('/') ? p.slice(0, -1) : p)

export function isShellPath(pathname) {
  const p = noSlash(String(pathname || ''))
  return PATTERNS.some(re => re.test(p))
}

// Phone app keeps today's pages while build 3 is in App Review (a master build reaches it over the air). Before removing: shell Billing must show NativeBillingNote (no payments in the app), .tp-phone-top and .tp-bar need safe-area padding, and any store text change goes to the door.
export function showShell({ role, pathname, native }) {
  return role === 'agent' && isShellPath(pathname) && !native
}

// A location from either address, as the plain shell path ('/agent/inbounds/abc' -> '/leads/abc', '/agent' -> '/').
function plain(pathname) {
  let p = noSlash(String(pathname || '/'))
  if (p === '/agent') return '/'
  if (p.startsWith('/agent/')) p = p.slice(6)
  return p.replace(/^\/inbounds(?=\/|$)/, '/leads')
}

const TITLES = {
  '/': ['Today', 'Overview'], '/leads': ['Leads', 'Leads'], '/calendar': ['Leads', 'Calendar'], '/clients': ['Servicing', 'Clients'],
  '/submit': ['Servicing', 'Submit'], '/request-service': ['Servicing', 'Request a service'], '/messages': ['Communications', 'Messages'],
  '/activity': ['Today', 'Activity'], '/billing': ['Account', 'Billing'], '/settings': ['Account', 'Settings'], '/more': ['Account', 'More'],
}

export function tabOf(pathname) {
  const p = plain(pathname)
  if (p === '/') return 'overview'
  if (p.startsWith('/leads')) return 'leads'
  if (p.startsWith('/clients')) return 'clients'
  if (p === '/request-service') return 'submit'
  if (p === '/more' || p === '/billing' || p === '/settings') return p === '/more' ? 'more' : null
  return p.slice(1)
}

// Which page layout a location gets (glass.css .tp-app.is-<layout>): 'lead' for one lead, 'client' for one client,
// otherwise the tab's own name. Leads, one lead, Messages and Settings hold still on a desktop and scroll inside panes.
export function layoutOf(pathname) {
  const p = plain(pathname)
  if (p.startsWith('/leads/')) return 'lead'
  if (p.startsWith('/clients/')) return 'client'
  if (p === '/') return 'overview'
  return p.slice(1)
}

export function titleOf(pathname) {
  const p = plain(pathname)
  if (TITLES[p]) return TITLES[p]
  if (p.startsWith('/leads/')) return ['Leads', 'Lead']
  if (p.startsWith('/clients/')) return ['Servicing', 'Client']
  return ['Today', 'Overview']
}
