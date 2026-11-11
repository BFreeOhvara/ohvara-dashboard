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
  // P873: submit(leadId) opens Submit filled in from that lead.
  submit: leadId => (isTemplateAddress() ? '/submit' : '/agent/submit') + (leadId ? `?lead=${leadId}` : ''),
  requestService: both('/request-service', '/agent/request-service'),
  messages: () => '/messages',
  activity: both('/activity', '/agent/activity'),
  billing: both('/billing', '/agent/billing'),
  settings: () => '/settings',
  more: both('/more', '/agent/more'),
  signup: () => '/signup',
  welcome: () => '/welcome',
  // P878: the pages a lead sees (Deedstone). Template only: the real ones live on Deedstone's own address.
  deedstone: (page = 'book') => `/d/${page}`,
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

// P956: the phone app gets the same shell as the website (it used to keep the old pages, which is why TestFlight
// build 4 showed a long-gone Home). In the app, shell Billing shows NativeBillingNote (AgentShell) and the phone bars
// pad for the notch and home bar (flow.css). `native` is still accepted so old callers don't break; it no longer matters.
export function showShell({ role, pathname }) {
  return role === 'agent' && isShellPath(pathname)
}

// A location from either address, as the plain shell path ('/agent/inbounds/abc' -> '/leads/abc', '/agent' -> '/').
function plain(pathname) {
  let p = noSlash(String(pathname || '/'))
  if (p === '/agent') return '/'
  if (p.startsWith('/agent/')) p = p.slice(6)
  return p.replace(/^\/inbounds(?=\/|$)/, '/leads')
}

// Page titles, two lines (the frame rolls them in letter by letter). A record drawer keeps its list's title.
const TITLES = {
  '/': ['Today', 'Overview'], '/leads': ['Your', 'Leads'], '/calendar': ['This week', 'Calendar'], '/clients': ['Your book', 'Clients'],
  '/submit': ['New sale', 'Submit'], '/request-service': ['Servicing', 'Request a service'], '/messages': ['Team', 'Messages'],
  '/activity': ['What happened', 'Activity'], '/billing': ['Your plan', 'Billing'], '/settings': ['Account', 'Settings'], '/more': ['Account', 'More'],
}

// Which top tab is lit. Pages reached from the rail or the account menu light none.
const TAB_PAGES = ['/calendar', '/activity', '/billing']
export function tabOf(pathname) {
  const p = plain(pathname)
  if (p === '/') return 'overview'
  if (p === '/leads' || p.startsWith('/leads/')) return 'leads'
  if (p === '/clients' || p.startsWith('/clients/')) return 'clients'
  return TAB_PAGES.includes(p) ? p.slice(1) : null
}

// Which page a location shows (flow.css .tp-app.is-<layout>). One lead opens as a drawer over Inbounds and one
// client over Clients, so they share the list's layout (and the page does not change under the drawer).
export function layoutOf(pathname) {
  const p = plain(pathname)
  if (p.startsWith('/leads/')) return 'leads'
  if (p.startsWith('/clients/')) return 'clients'
  if (p === '/') return 'overview'
  return p.slice(1)
}

// The title for a page key from layoutOf ('overview', 'leads', ...).
export const titleOfLayout = layout => titleOf(layout === 'overview' ? '/' : `/${layout}`)

export function titleOf(pathname) {
  const p = plain(pathname)
  if (TITLES[p]) return TITLES[p]
  if (p.startsWith('/leads/')) return TITLES['/leads']
  if (p.startsWith('/clients/')) return TITLES['/clients']
  return ['Today', 'Overview']
}
