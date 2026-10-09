import { useState, useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { Menu } from 'lucide-react'
import { Sidebar, COLLAPSE_KEY, SIDEBAR_W, SIDEBAR_W_COLLAPSED } from './Sidebar'
import { ActiveCallProvider } from '../../contexts/ActiveCallContext'
import { NotificationToast } from '../rep/NotificationToast'
import { NotificationBell } from '../admin/NotificationBell'
import { CloserNotificationBell } from '../closer/CloserNotificationBell'
import { useAuth } from '../../hooks/useAuth'
import { Avatar } from '../ui/Avatar'
import { BillingGate } from './BillingGate'

// Shell — Prompt 669 restyle to Restorix Portal's Layout.jsx: a 64px sticky
// header on the card surface (display-font title + subtitle on one line,
// bell, divider, account chip) and a 32/24 padded main capped at 1280px.
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
  '/messages': ['Messages', 'Fulfillment, Admin and your clients, all in one place'],
  '/settings': ['Settings', 'Profile, regional & appearance'],
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

// Display-only chip (avatar initials + name) next to the header bell —
// matches the bell+avatar+name pattern on Brayden's Eterna reference
// dashboard. Not a menu; the sidebar-footer account row still owns
// settings/sign-out.
function AccountChip() {
  const { profile } = useAuth()
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
      <Avatar profile={profile} size={28} />
      <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>
        {profile?.full_name || ''}
      </span>
    </div>
  )
}

// Short vertical rule between the bell and the account chip — decorative
// only, doesn't touch the header's top/bottom edges (matches Brayden's
// Eterna Insurance reference: bell | divider | avatar + name).
function HeaderDivider() {
  return <span aria-hidden="true" style={{ width: 1, height: 24, background: 'var(--border)', flexShrink: 0 }} />
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

  const [title, sub] = TITLES[pathname] || ['', '']

  return (
    <ActiveCallProvider>
      <div style={{ display: 'flex', minHeight: '100vh', background: 'var(--bg-base)' }}>
        <Sidebar
          open={navOpen}
          onClose={() => setNavOpen(false)}
          collapsed={collapsed}
          onToggleCollapse={() => setCollapsed(c => !c)}
        />

        {/* Mobile top bar — the sidebar is off-canvas below `md`, so this is
            the only way to open it there. */}
        <div
          className="md:hidden fixed top-0 inset-x-0 flex items-center gap-3"
          style={{ height: 56, padding: '0 16px', background: 'var(--bg-surface)', borderBottom: 'var(--border-w) solid var(--border)', zIndex: 80 }}
        >
          <button
            onClick={() => setNavOpen(true)}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: 36, height: 36, borderRadius: 999,
              background: 'var(--bg-surface)', border: 'var(--border-w) solid var(--border)',
              color: 'var(--text-secondary)',
            }}
          >
            <Menu size={18} />
          </button>
          <span style={{ fontFamily: 'var(--font-display)', fontSize: 17, fontWeight: 500, color: 'var(--text-primary)' }}>{title || 'Ohvara'}</span>
        </div>

        {/* Sidebar is fixed, so the content column offsets by its width — but
            only at md+, where the sidebar isn't an off-canvas drawer. Width
            travels as a CSS var so the media query can own the margin. */}
        <div
          className="app-main flex-1 flex flex-col min-w-0 pt-[56px] md:pt-0"
          style={{ '--sb-w': `${collapsed ? SIDEBAR_W_COLLAPSED : SIDEBAR_W}px`, position: 'relative' }}
        >
          <div className={`app-backdrop${['/agent', '/agent/book', '/agent/clients', '/agent/activity'].includes(pathname) ? ' app-backdrop--v2' : ''}`} aria-hidden="true" />
          <header
            className="hidden md:flex"
            style={{
              position: 'sticky', top: 0, zIndex: 90,
              alignItems: 'center', gap: 14, height: 64, padding: '0 24px',
              background: 'var(--bg-surface)', borderBottom: 'var(--border-w) solid var(--border)',
            }}
          >
            <div style={{ flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              <span style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 500, color: 'var(--text-primary)', letterSpacing: '-0.01em' }}>{title}</span>
              <span style={{ marginLeft: 10, fontSize: 14, color: 'var(--text-secondary)' }}>{sub}</span>
            </div>
            <HeaderBell />
            <HeaderDivider />
            <AccountChip />
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
