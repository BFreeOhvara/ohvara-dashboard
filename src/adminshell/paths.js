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
  // P934: the working pages that left Settings for the rail (screens/Work934.jsx).
  bugs: '/admin/bugs',
  numbers: '/admin/numbers',
  wording: '/admin/wording',
  training: '/admin/training',
  compliance: '/admin/compliance',
  playbook: '/admin/playbook',
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

// P919: an admin always gets the shell, on the web and in the phone app. The old admin pages are gone (no ?classic=1,
// no switch back); old admin addresses land on their new page through the shell's own routes (users, payouts, more).
export function showAdminShell({ role, pathname }) {
  return role === 'admin' && isAdminShellPath(pathname)
}

// P919: where an admin lands from an address of the old portal that the admin shell doesn't own (old bookmarks, links
// inside the agent and Fulfillment pages, notification links). null = not an old portal page: the page shows as is.
// /settings and /messages are the shared pages (real switches, App Review logins, carrier hours, the real inbox) the
// shell still links to, so they stay. Unknown old /admin, /agent and /fulfillment paths land on Overview.
const OLD_TO_NEW = [
  [/^\/agent\/(leads|inbounds)(\/|$)/, ADM.leads],
  [/^\/fulfillment\/leads(\/|$)/, ADM.leads],
  [/^\/agent\/(clients|submit|book|policies|submissions)(\/|$)/, ADM.clients],
  [/^\/fulfillment\/pipeline(\/|$)/, ADM.clients],
  [/^\/fulfillment\/(desk|schedule|calendar|servicing|pay|getting-paid|training)(\/|$)/, ADM.team],
  [/^\/admin\/carriers$/, '/settings#carriers'],
  [/^\/(admin|agent|fulfillment)(\/|$)/, ADM.overview],
]
export function adminOldTarget(pathname) {
  const p = noSlash(String(pathname || ''))
  if (isAdminPreviewPath(p) || isAdminShellPath(p)) return null
  for (const [re, to] of OLD_TO_NEW) if (re.test(p)) return to
  return null
}

// Routes inside the router: [page key, path]. `preview` puts them under /preview.
export function admRoutes(preview) {
  const b = preview ? PREVIEW_BASE : ''
  const out = Object.entries(ADM).map(([k, p]) => [k, b + p])
  for (const k of RECORD_PAGES) out.push([k, `${b}${ADM[k]}/:id`])
  return out
}

// The top tabs, in order (P866: Setup is a top tab; Billing reads Revenue; P906: Overview · Agents · Fulfillment ·
// Clients · Setup · Revenue, then Leads). Messages, Connect (P864) and Settings live on the rail and the top right, as on the other two sides.
// The inbounds page reads "Leads" on screen: the word guard (scripts/check-wording.mjs) bans the word inbound in
// rendered text anywhere in src. Code names and the /admin/inbounds address keep it.
export const ADM_TABS = [
  // P913: Overview · Agents · Fulfillment · Leads · Clients · Setup · Revenue (last).
  ['overview', 'Overview'], ['agents', 'Agents'], ['team', 'Fulfillment'], ['leads', 'Leads'], ['clients', 'Clients'], ['setup', 'Setup'], ['billing', 'Revenue'],
]
// Every page's short name (tabs, the phone bar, search), including the rail-only pages.
export const ADM_LABELS = { ...Object.fromEntries(ADM_TABS), messages: 'Messages', settings: 'Settings', connect: 'Connect', bugs: 'Bug reports', numbers: 'Deedstone numbers', wording: 'Wording to approve', training: 'Training', compliance: 'Compliance', playbook: 'Carrier playbook' }

const TITLES = {
  overview: ['The business', 'Overview'], agents: ['Who sells', 'Agents'], setup: ['Paid agents to live', 'Setup'], team: ['Who serves', 'Fulfillment team'],
  leads: ['Every agent', 'Leads'], clients: ['Every book', 'Clients'], billing: ['In, out and split', 'Revenue'],
  messages: ['Admin lines', 'Messages'], settings: ['Run the portal', 'Settings'], connect: ['Plug it in', 'Connect'],
  bugs: ['What people sent', 'Bug reports'], numbers: ['Lines and pods', 'Deedstone numbers'], wording: ['Before it goes out', 'Wording to approve'],
  training: ['What VAs learn', 'Training'], compliance: ['Kept on record', 'Compliance'], playbook: ['How each carrier works', 'Carrier playbook'],
}
export const admTitleOf = page => TITLES[page] || TITLES.overview
