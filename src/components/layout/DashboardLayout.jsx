import { useState, useEffect, Fragment } from 'react'
import { useLocation, Link } from 'react-router-dom'
import { Menu, ChevronRight, Home } from 'lucide-react'
import { Sidebar, COLLAPSE_KEY, SIDEBAR_W, SIDEBAR_W_COLLAPSED } from './Sidebar'
import { GlobalSearch } from './GlobalSearch'
import { ActiveCallProvider } from '../../contexts/ActiveCallContext'
import { NotificationToast } from '../rep/NotificationToast'
import { NotificationBell } from '../admin/NotificationBell'
import { CloserNotificationBell } from '../closer/CloserNotificationBell'
import { useAuth } from '../../hooks/useAuth'
import { useAgentBookings } from '../../hooks/useAgentBookings'
import { useWeeklyUsage } from '../../hooks/useBillingTiers'
import { usePolicyEvents } from '../../hooks/useAgentActivity'
import { useStandingThreads, dmId } from '../../hooks/useDirectMessages'
import { tabOf, sameLocalDay } from '../../lib/agentBookings'
import { capState, formatReset, formatBillingDate } from '../../lib/billing'
import { navEntry, PAGE_TONE } from '../../lib/nav'
import { BillingGate } from './BillingGate'

// Shell — Prompt 669 restyle to Restorix Portal's Layout.jsx, a 32/24 padded
// main capped at 1280px. Prompt 722 rethought the header: a 72px sticky bar
// (translucent surface + blur) with a per-page title and live line on the
// left, then the header search and the bell; the account chip is gone (the
// sidebar's account card is the one place for the account).
// Prompt 675 dropped Restorix's dot-network background for Ohvara's own
// static two-glow backdrop (.app-backdrop in index.css).
//
// Deliberately NOT ported: the export's "Viewing as Closer / Admin" switcher.
// That's a mockup affordance for demoing both roles in one file — real roles
// come from the signed-in profile.

// Export's TITLES map, keyed by route instead of by mockup page id.
const TITLES = {
  '/agent': ['Overview', 'Your day at a glance'],
  '/agent/live': ['Live Call', 'Duty status & incoming transfers'],
  '/agent/calls': ['My Calls', 'Schedule, activity, and graded calls'],
  '/agent/quoter': ['Quoter', 'InsuranceToolkits — multi-carrier instant quoting'],
  '/agent/underwriting': ['Underwriting', 'AI chat assistant for carrier placement based on client health'],
  '/agent/book': ['Book a call', 'Get your client on the calendar with Fulfillment'],
  '/agent/clients': ['My Pipeline', 'Everyone booked with Fulfillment and where each cancellation stands'],
  '/agent/activity': ['Activity', 'What happened with your clients, newest first'],
  '/agent/billing': ['Billing', 'Your weekly subscription and next charge'],
  '/agent/carriers': ['Carrier Portals', 'Every carrier login in one directory'],
  '/agent/stats': ['Performance', 'Production, persistency, and leaderboard — switch the view'],
  '/agent/hierarchy': ['Team', 'Your hierarchy, team chat, and DMs'],
  '/agent/commissions': ['Commissions', 'Compensation grid & balance — switch the view'],
  '/admin': ['Overview', 'Your day at a glance'],
  '/admin/users': ['Users & Access', 'Accounts, roles and invites'],
  '/fulfillment': ['Overview', 'How the whole team is doing'],
  '/fulfillment/desk': ['Fulfillment', 'Call the client, cancel the old policy, then the next one'],
  '/fulfillment/pipeline': ['Pipeline', 'Every submission across every agent, and where it stands'],
  '/fulfillment/getting-paid': ['Getting Paid', 'Clock in and out, hours logged, and your estimated pay'],
  '/messages': ['Messages', 'Fulfillment and Admin, in one place'],
  '/settings': ['Settings', 'Your account, security and preferences'],
}

function ToastMount() {
  const { profile } = useAuth()
  if (!profile || !['agent'].includes(profile.role)) return null
  return <NotificationToast profileId={profile.id} />
}

function HeaderBell() {
  const { profile } = useAuth()
  if (profile?.role === 'admin')       return <NotificationBell profileId={profile.id} />
  // Prompt 424: fulfillment wasn't wired into any branch here at all — the
  // bell wasn't hidden by the header, HeaderBell just fell through to null
  // for this role. Reuses CloserNotificationBell (generic profile-id-keyed
  // notification list; its closer-specific trigger hooks filter on
  // closer_id/rep_id, which simply never match a fulfillment profile —
  // harmless no-ops, not errors) since it already has the fulfillment_complete
  // icon mapped (Prompt 418) and now team_message too now that Team is in
  // this role's nav.
  if (profile?.role === 'agent' || profile?.role === 'fulfillment') {
    return <CloserNotificationBell profileId={profile.id} />
  }
  return null
}

// ── Page header (Prompt 722) ─────────────────────────────────────────────────
// Every page gets its own: an icon tile in the page's colour, "Group / Page",
// and a live line about that page (agent pages), built from data the page
// already loads through the same react-query hooks and keys — no new fetches.
// Other roles' pages get the TITLES subtitle as plain text. See
// media/p722-sidebar-header/mockup-headers.html in the vault.

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const firstName = s => (s || '').trim().split(/\s+/)[0] || ''

// One item of the live line: a tinted pill, a link when `to`.
function Pill({ tone, to, children }) {
  const cls = `ov-hpill ov-tone-${tone}`
  const inner = <><span className="ov-hpill-dot" aria-hidden="true" />{children}</>
  return to
    ? <Link to={to} className={cls}>{inner}<ChevronRight size={11} strokeWidth={2.6} aria-hidden="true" /></Link>
    : <span className={cls}>{inner}</span>
}
const Plain = ({ children }) => <span className="ov-hplain">{children}</span>

// Separates the items with 3px dots; drops empty ones.
function LiveLine({ items }) {
  const shown = items.filter(Boolean)
  if (!shown.length) return null
  return (
    <div className="ov-hline">
      {shown.map((item, i) => (
        <Fragment key={i}>
          {i > 0 && <span className="ov-hsep" aria-hidden="true" />}
          {item}
        </Fragment>
      ))}
    </div>
  )
}

function OverviewLine({ profile }) {
  const { data: rows = [] } = useAgentBookings(profile.id)
  const now = new Date()
  const today = rows.filter(p => sameLocalDay(p.scheduled_call_at, now)).length
  const needs = rows.filter(p => tabOf(p) === 'needs').length
  return <LiveLine items={[
    <Plain>{now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</Plain>,
    today > 0 && <Pill tone="blue">{plural(today, 'call')} today</Pill>,
    needs > 0 && <Pill tone="amber" to="/agent/clients?stage=needs">{needs} need you</Pill>,
  ]} />
}

function BookLine({ profile }) {
  const { data: usage, isLoading } = useWeeklyUsage(profile.id)
  if (isLoading) return null
  const cap = capState(usage)
  if (cap?.cap == null) return <LiveLine items={[<Plain>No weekly limit</Plain>]} />
  return <LiveLine items={[
    <Pill tone="teal">{cap.used} of {cap.cap} bookings used this week</Pill>,
    <Plain>Resets {formatReset(usage.week_end)}</Plain>,
  ]} />
}

function PipelineLine({ profile }) {
  const { data: rows = [], isLoading } = useAgentBookings(profile.id)
  if (isLoading) return null
  const needs = rows.filter(p => tabOf(p) === 'needs').length
  const booked = rows.filter(p => tabOf(p) === 'booked').length
  return <LiveLine items={[
    <Plain>{plural(rows.length, 'client')}</Plain>,
    needs > 0 && <Pill tone="amber" to="/agent/clients?stage=needs">{needs} need you</Pill>,
    booked > 0 && <Pill tone="blue">{booked} booked</Pill>,
  ]} />
}

function ActivityLine({ profile }) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const { data: events, isLoading } = usePolicyEvents(today, profile.id)
  if (isLoading) return null
  if (!events?.length) return <LiveLine items={[<Plain>Nothing yet today</Plain>]} />
  const latest = new Date(events[0].at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  return <LiveLine items={[
    <Pill tone="violet">{plural(events.length, 'update')} today</Pill>,
    <Plain>Latest {latest}</Plain>,
  ]} />
}

function MessagesLine() {
  const { data: threads, isLoading } = useStandingThreads()
  if (isLoading) return null
  const unread = (threads || []).filter(t => t.unread_count > 0)
    .sort((a, b) => new Date(b.last_at || 0) - new Date(a.last_at || 0))
  if (!unread.length) return <LiveLine items={[<Plain>All caught up</Plain>]} />
  const n = unread.reduce((sum, t) => sum + t.unread_count, 0)
  const who = t => (t.peer_id ? firstName(t.peer_name) || 'Fulfillment' : 'Admin')
  const to = `/messages?dm=${dmId(unread[0].agent_id, unread[0].peer_key)}`
  return <LiveLine items={[
    <Pill tone="blue" to={to}>{n} unread from {unread.length === 1 ? who(unread[0]) : `${unread.length} people`}</Pill>,
  ]} />
}

function BillingLine({ profile }) {
  const { data: usage, isLoading } = useWeeklyUsage(profile.id)
  if (isLoading) return null
  const next = !profile.billing_exempt && profile.billing_status === 'active'
    ? formatBillingDate(profile.billing_current_period_end) : null
  return <LiveLine items={[
    <Pill tone="amber">{usage?.tier_name || 'No plan'}</Pill>,
    next && <Plain>Next charge {next}</Plain>,
  ]} />
}

function SettingsLine({ session }) {
  const user = session?.user
  if (!user) return null
  const twoStep = (user.factors || []).some(f => f.factor_type === 'totp' && f.status === 'verified')
  return <LiveLine items={[
    <Plain>{user.email}</Plain>,
    <Pill tone="slate" to="/settings#security">Two-step {twoStep ? 'on' : 'off'}</Pill>,
  ]} />
}

const AGENT_LINES = {
  '/agent': OverviewLine,
  '/agent/book': BookLine,
  '/agent/clients': PipelineLine,
  '/agent/activity': ActivityLine,
  '/messages': MessagesLine,
  '/agent/billing': BillingLine,
  '/settings': SettingsLine,
}

function PageTitle({ pathname }) {
  const { profile, session } = useAuth()
  const entry = navEntry(profile?.role, pathname)
  const [title, sub] = TITLES[pathname] || ['', '']
  const name = entry?.label || title
  const Icon = entry?.icon || Home
  const tone = PAGE_TONE[pathname] || 'blue'
  const Line = profile?.role === 'agent' ? AGENT_LINES[pathname] : null
  if (!name) return null
  return (
    <div className={`ov-htitle ov-tone-${tone}`}>
      <span className="ov-htile" aria-hidden="true"><Icon size={20} strokeWidth={2} /></span>
      <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div className="ov-hcrumb">
          {entry?.group && <><span className="ov-hgroup">{entry.group}</span><span className="ov-hgroup" aria-hidden="true">/</span></>}
          <h1 className="ov-hname">{name}</h1>
        </div>
        {Line ? <Line profile={profile} session={session} /> : sub && <div className="ov-hline"><Plain>{sub}</Plain></div>}
      </div>
    </div>
  )
}

export function DashboardLayout({ children }) {
  const { pathname } = useLocation()
  const isFullWidth = pathname.includes('/quoter')
  // Prompt 701: Messages fills the content area edge to edge (as Restorix's
  // does) instead of sitting in the padded, max-width page container.
  const isFullBleed = pathname === '/messages'

  const [navOpen, setNavOpen] = useState(false)
  useEffect(() => { setNavOpen(false) }, [pathname])

  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSE_KEY) === '1')
  useEffect(() => { localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0') }, [collapsed])

  const { profile } = useAuth()
  const [title] = TITLES[pathname] || ['']

  return (
    <ActiveCallProvider>
      <div style={{ display: 'flex', minHeight: '100vh', background: 'var(--bg-base)' }}>
        <Sidebar
          open={navOpen}
          onClose={() => setNavOpen(false)}
          collapsed={collapsed}
          onToggleCollapse={() => setCollapsed(c => !c)}
        />

        {/* Sidebar is fixed, so the content column offsets by its width — but
            only at md+, where the sidebar isn't an off-canvas drawer. Width
            travels as a CSS var so the media query can own the margin. */}
        <div
          className="app-main flex-1 flex flex-col min-w-0 pt-[60px] md:pt-0"
          style={{ '--sb-w': `${collapsed ? SIDEBAR_W_COLLAPSED : SIDEBAR_W}px`, position: 'relative' }}
        >
          <div className={`app-backdrop${['/agent', '/agent/book', '/agent/clients', '/agent/activity', '/agent/billing', '/settings'].includes(pathname) ? ' app-backdrop--v2' : ''}`} aria-hidden="true" />
          {/* Prompt 722 — one header for every size: a 60px fixed top bar on
              phones (menu, title, search, bell), the 72px sticky page header
              from md up. One instance, so the search hotkeys and the bell
              exist once. */}
          <header className="ov-header fixed left-0 right-0 top-0 md:sticky">
            <button type="button" className="ov-hbtn ov-phone-only" onClick={() => setNavOpen(true)} aria-label="Open menu">
              <Menu size={18} strokeWidth={1.9} />
            </button>
            <span className="ov-hphone-title md:hidden">{navEntry(profile?.role, pathname)?.label || title || 'Ohvara'}</span>
            <div className="hidden md:flex" style={{ flex: 1, minWidth: 0 }}>
              <PageTitle pathname={pathname} />
            </div>
            {(profile?.role === 'agent' || profile?.role === 'admin') && <GlobalSearch />}
            <HeaderBell />
          </header>

          <main
            className={`scrollbar-thin ${isFullWidth ? 'h-screen overflow-hidden flex flex-col' : isFullBleed ? '' : 'px-4 md:px-6'}`}
            style={isFullWidth ? { position: 'relative', zIndex: 1 } : isFullBleed ? { flex: 1, width: '100%', position: 'relative', zIndex: 1 } : { flex: 1, paddingTop: 32, paddingBottom: 64, maxWidth: 1280, width: '100%', margin: '0 auto', position: 'relative', zIndex: 1 }}
          >
            <div
              key={pathname}
              className={isFullWidth ? 'flex-1 overflow-hidden flex flex-col' : ''}
              style={isFullWidth ? undefined : { animation: 'fadeUp 160ms ease-out' }}
            >
              <BillingGate>{children}</BillingGate>
            </div>
          </main>
        </div>
        <ToastMount />
      </div>
    </ActiveCallProvider>
  )
}
