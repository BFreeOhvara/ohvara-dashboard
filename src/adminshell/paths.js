// P849 — the Admin side's addresses, for both mounts: the real admin URLs (/admin/...) and the sample preview at
// /preview/admin/... (the same pages, nobody signed in, nothing leaves the browser). ShellSwap reads the gate below.
// No imports on purpose: it stays tiny and runs under node --test. The address is read at call time.

export const PREVIEW_BASE = '/preview'

export const ADM = {
  overview: '/admin',
  agents: '/admin/agents',
  setup: '/admin/setup',
  team: '/admin/fulfillment',
  leads: '/admin/inbounds',
  clients: '/admin/pipeline',
  billing: '/admin/billing',
  messages: '/admin/messages',
  settings: '/admin/settings',
  connect: '/admin/connect',
}
// Old admin addresses that now land on a page of the shell (Users is a Settings section, Payouts a Billing tab).
export const ADM_OLD = { users: '/admin/users', payouts: '/admin/payouts', more: '/admin/more' }

// Pages whose records open in a drawer at their own address (/admin/agents/:id, /admin/setup/:id ...).
const RECORD_PAGES = ['agents', 'setup', 'team', 'leads', 'clients']

const noSlash = p => (p.length > 1 && p.endsWith('/') ? p.slice(0, -1) : p)

export function isAdminPreviewPath(pathname) {
  const p = noSlash(String(pathname || ''))
  return p === `${PREVIEW_BASE}/admin` || p.startsWith(`${PREVIEW_BASE}/admin/`)
}
const inPreview = () => isAdminPreviewPath(globalThis.window?.location?.pathname)

// The address of a page, or of one record's drawer on it. `preview` defaults to wherever the browser is now.
export function ap(key, id, preview = inPreview()) {
  const base = ADM[key] || ADM_OLD[key] || ADM.overview
  return `${preview ? PREVIEW_BASE : ''}${base}${id ? `/${encodeURIComponent(id)}` : ''}`
}

const strip = pathname => {
  const p = noSlash(String(pathname || ''))
  return isAdminPreviewPath(p) ? p.slice(PREVIEW_BASE.length) : p
}

// Which page a location shows ('overview', 'agents', ...). A record's drawer keeps its list's page.
export function admPageOf(pathname) {
  const p = strip(pathname)
  if (p === ADM.overview) return 'overview'
  if (p === ADM_OLD.users || p === ADM_OLD.more) return 'settings'
  if (p === ADM_OLD.payouts) return 'billing'
  for (const [key, base] of Object.entries(ADM)) {
    if (key === 'overview') continue
    if (p === base) return key
    if (RECORD_PAGES.includes(key) && new RegExp(`^${base}/[^/]+$`).test(p)) return key
  }
  return null
}

// Every address the shell owns. Anything else under /admin keeps today's routes.
export const isAdminShellPath = pathname => admPageOf(strip(pathname)) !== null && String(pathname || '').startsWith('/admin')

// An admin on the web gets the shell, unless they asked for the old pages this session (?classic=1, cleared by
// ?classic=0). The phone app keeps today's pages, the same rule as the agent and Fulfillment shells.
export function showAdminShell({ role, pathname, native, classic = false }) {
  return role === 'admin' && !native && !classic && isAdminShellPath(pathname)
}

// The classic flag from the address and what this tab remembered: ?classic=1 turns it on, ?classic=0 off.
export function classicFrom(search, stored) {
  const v = new URLSearchParams(String(search || '')).get('classic')
  if (v === '1') return true
  if (v === '0') return false
  return stored === '1'
}

// Routes inside the router: [page key, path]. `preview` puts them under /preview.
export function admRoutes(preview) {
  const b = preview ? PREVIEW_BASE : ''
  const out = Object.entries(ADM).map(([k, p]) => [k, b + p])
  for (const k of RECORD_PAGES) out.push([k, `${b}${ADM[k]}/:id`])
  return out
}

// The top tabs, in order (P866: Setup is a top tab; Billing reads Revenue). Messages, Connect (P864) and Settings live on the rail and the top right, as on the other two sides.
// The inbounds page reads "Leads" on screen: the word guard (scripts/check-wording.mjs) bans the word inbound in
// rendered text anywhere in src. Code names and the /admin/inbounds address keep it.
export const ADM_TABS = [
  ['overview', 'Overview'], ['agents', 'Agents'], ['setup', 'Setup'], ['team', 'Fulfillment'], ['leads', 'Leads'], ['clients', 'Clients'], ['billing', 'Revenue'],
]
// Every page's short name (tabs, the phone bar, search), including the rail-only pages.
export const ADM_LABELS = { ...Object.fromEntries(ADM_TABS), messages: 'Messages', settings: 'Settings', connect: 'Connect' }

const TITLES = {
  overview: ['The business', 'Overview'], agents: ['Who sells', 'Agents'], setup: ['New clients to live', 'Setup'], team: ['Who serves', 'Fulfillment team'],
  leads: ['Every agent', 'Leads'], clients: ['Every book', 'Clients'], billing: ['In, out and split', 'Revenue'],
  messages: ['Admin lines', 'Messages'], settings: ['Run the portal', 'Settings'], connect: ['Plug it in', 'Connect'],
}
export const admTitleOf = page => TITLES[page] || TITLES.overview
