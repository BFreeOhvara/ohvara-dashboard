import { useState, useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { Menu } from 'lucide-react'
import { Sidebar, COLLAPSE_KEY } from './Sidebar'
import { ActiveCallProvider } from '../../contexts/ActiveCallContext'
import { NotificationToast } from '../rep/NotificationToast'
import { NotificationBell } from '../admin/NotificationBell'
import { RepNotificationBell } from '../rep/RepNotificationBell'
import { CloserNotificationBell } from '../closer/CloserNotificationBell'
import { useAuth } from '../../hooks/useAuth'

// Shell — literal port of the export's right-hand column (lines 114-161):
// a 60px sticky header carrying the page title/subtitle, notification bell
// and account chip, over a 32/40/72 padded main capped at 1440px.
//
// Deliberately NOT ported: the export's "Viewing as Closer / Admin" switcher.
// That's a mockup affordance for demoing both roles in one file — real roles
// come from the signed-in profile.

// Export's TITLES map, keyed by route instead of by mockup page id.
const TITLES = {
  '/agent': ['Overview', 'Your day at a glance'],
  '/agent/live': ['Live Call', 'Duty status & incoming transfers'],
  '/agent/calls': ['My Calls', 'Schedule, activity, and graded calls'],
  '/agent/policies': ['My Policies', 'Your whole book of business'],
  '/agent/quoter': ['Quoter', 'InsuranceToolkits — multi-carrier instant quoting'],
  '/agent/underwriting': ['Underwriting', 'AI chat assistant for carrier placement based on client health'],
  '/agent/submissions': ['Submissions', 'Start a new business submission with a carrier'],
  '/agent/carriers': ['Carrier Portals', 'Every carrier login in one directory'],
  '/agent/stats': ['Stats', 'Production, persistency, and leaderboard — switch the view'],
  '/agent/hierarchy': ['Hierarchy', 'Your upline, your direct recruits, and your invite link'],
  '/agent/training': ['Training Center', 'Videos · scripts · knowledge checks · roleplay'],
  '/agent/commissions': ['Commissions', 'Balance & reserve — comp model is a placeholder'],
  '/admin': ['Overview', 'Live operations'],
  '/admin/call-pipeline': ['Call Pipeline', 'Inbound → AI → transfer → underwriting → cancellation'],
  '/admin/roster': ['Closer Roster', 'Who is on duty right now'],
  '/admin/leaderboard': ['Leaderboard', 'Ranked by submitted AP · daily & monthly'],
  '/admin/commissions': ['Commissions', 'Balances & reserves across all closers'],
  '/admin/lead-sources': ['Lead Sources', 'Google Ads & landing page performance'],
  '/admin/users': ['Users & Access', 'Accounts, roles and invites'],
  '/settings': ['Settings', 'Notifications, regional & appearance'],
  '/profile': ['Profile', 'Your name, contact info, and account details'],
}

function ToastMount() {
  const { profile } = useAuth()
  if (!profile || !['rep', 'closer'].includes(profile.role)) return null
  return <NotificationToast profileId={profile.id} />
}

function HeaderBell() {
  const { profile } = useAuth()
  if (profile?.role === 'admin')  return <NotificationBell />
  if (profile?.role === 'rep')    return <RepNotificationBell profileId={profile.id} />
  if (profile?.role === 'closer') return <CloserNotificationBell profileId={profile.id} />
  return null
}

// Display-only chip (avatar initials + name) next to the header bell —
// matches the bell+avatar+name pattern on Brayden's Eterna reference
// dashboard. Not a menu; the sidebar-footer account row still owns
// settings/sign-out.
function AccountChip() {
  const { profile } = useAuth()
  const initials = profile?.full_name
    ? profile.full_name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()
    : '?'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
      <span style={{
        width: 26, height: 26, borderRadius: '50%',
        background: 'var(--accent-dim)', border: '1px solid var(--accent-border)',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 10, fontWeight: 700, color: 'var(--accent)', flexShrink: 0,
      }}>
        {initials}
      </span>
      <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>
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
  const isFullWidth = pathname.includes('/messages') || pathname.includes('/quoter')

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
          style={{ height: 52, padding: '0 16px', background: 'var(--bg-base)', borderBottom: 'var(--border-w) solid var(--border)', zIndex: 80 }}
        >
          <button
            onClick={() => setNavOpen(true)}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: 32, height: 32, borderRadius: 8,
              background: 'var(--bg-elevated)', border: 'none',
              color: 'var(--text-secondary)',
            }}
          >
            <Menu size={18} />
          </button>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>{title || 'Ohvara'}</span>
        </div>

        {/* Sidebar is fixed, so the content column offsets by its width — but
            only at md+, where the sidebar isn't an off-canvas drawer. Width
            travels as a CSS var so the media query can own the margin. */}
        <div
          className="app-main flex-1 flex flex-col min-w-0 pt-[52px] md:pt-0"
          style={{ '--sb-w': collapsed ? '64px' : '260px' }}
        >
          <header
            className="hidden md:flex"
            style={{
              position: 'sticky', top: 0, zIndex: 90,
              alignItems: 'center', gap: 14, height: 60, padding: '0 28px',
              background: 'var(--bg-base)', borderBottom: 'var(--border-w) solid var(--border)',
            }}
          >
            <div style={{ flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.01em' }}>{title}</span>
              <span style={{ marginLeft: 10, fontSize: 11, color: 'var(--text-muted)' }}>{sub}</span>
            </div>
            <HeaderBell />
            <HeaderDivider />
            <AccountChip />
          </header>

          <main
            className={`scrollbar-thin ${isFullWidth ? 'h-screen overflow-hidden flex flex-col' : ''}`}
            style={isFullWidth ? undefined : { flex: 1, padding: '32px 40px 72px', maxWidth: 1440, width: '100%', margin: '0 auto' }}
          >
            <div
              key={pathname}
              className={isFullWidth ? 'flex-1 overflow-hidden flex flex-col' : ''}
              style={isFullWidth ? undefined : { animation: 'fadeUp 160ms ease-out' }}
            >
              {children}
            </div>
          </main>
        </div>
        <ToastMount />
      </div>
    </ActiveCallProvider>
  )
}
