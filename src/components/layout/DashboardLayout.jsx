import { useState, useEffect } from 'react'
import { useLocation, Link } from 'react-router-dom'
import { Menu } from 'lucide-react'
import { Sidebar } from './Sidebar'
import { ActiveCallProvider } from '../../contexts/ActiveCallContext'
import { NotificationToast } from '../rep/NotificationToast'
import { NotificationBell } from '../admin/NotificationBell'
import { RepNotificationBell } from '../rep/RepNotificationBell'
import { CloserNotificationBell } from '../closer/CloserNotificationBell'
import { LiveClock } from '../ui/LiveClock'
import { useAuth } from '../../hooks/useAuth'

function ToastMount() {
  const { profile } = useAuth()
  if (!profile || !['rep', 'closer'].includes(profile.role)) return null
  return <NotificationToast profileId={profile.id} />
}

// Mobile top bar's right side (Prompt 322) — notification bell moved out of
// the hamburger drawer so it's reachable without opening it, plus the
// viewer's own local-time clock (moved up from My Leads' page-level header,
// same "Select Time Zone" fallback until they confirm one in Settings).
// Bell is role-gated the same way Sidebar's was; client role gets neither
// (no bell component exists for it there either).
function MobileHeaderRight({ profile }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      {profile?.timezone_confirmed_at ? (
        <LiveClock timezone={profile?.timezone} />
      ) : (
        <Link
          to="/settings#regional"
          style={{
            fontSize: 11, fontWeight: 500, color: 'var(--accent)',
            background: 'var(--accent-dim)', border: '0.5px solid var(--accent-border)',
            borderRadius: 20, padding: '4px 10px', textDecoration: 'none',
            whiteSpace: 'nowrap',
          }}
        >
          Set Time Zone
        </Link>
      )}
      {profile?.role === 'admin' && <NotificationBell />}
      {profile?.role === 'rep' && <RepNotificationBell profileId={profile.id} />}
      {profile?.role === 'closer' && <CloserNotificationBell profileId={profile.id} />}
    </div>
  )
}

export function DashboardLayout({ children }) {
  const { pathname } = useLocation()
  const { profile } = useAuth()
  const isFullWidth = pathname.includes('/messages')
  // Prompt 287 fix — sidebar is an off-canvas drawer below `md`, opened via
  // this bar's hamburger. Closes on every route change so navigating away
  // never leaves it stuck open over the new page.
  const [navOpen, setNavOpen] = useState(false)
  useEffect(() => { setNavOpen(false) }, [pathname])

  return (
    <ActiveCallProvider>
      <div className="min-h-screen bg-[var(--bg-base)]">
        <Sidebar open={navOpen} onClose={() => setNavOpen(false)} />

        {/* Mobile-only top bar — sidebar is off-canvas below `md`, so this
            is the only way to open it there. Fixed (not sticky) so it never
            fights with the full-width Messages layout's own scroll/height.
            Prompt 322: right side now carries the notification bell + clock
            (moved out of the hamburger drawer / My Leads' own header). */}
        <div
          className="md:hidden fixed top-0 inset-x-0 flex items-center justify-between gap-3"
          style={{ height: 52, padding: '0 16px', background: 'var(--bg-base)', borderBottom: '0.5px solid var(--border)', zIndex: 80 }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button
              onClick={() => setNavOpen(true)}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                width: 32, height: 32, borderRadius: 8,
                background: 'var(--bg-elevated)', border: 'none',
                color: 'var(--text-secondary)', cursor: 'pointer',
              }}
            >
              <Menu size={18} />
            </button>
            <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>Ohvara</span>
          </div>
          <MobileHeaderRight profile={profile} />
        </div>

        {/* ml matches the fixed sidebar width (240px) at md+; pt clears the mobile top bar below md */}
        <main
          className={`md:ml-[240px] pt-[52px] md:pt-0 scrollbar-thin ${isFullWidth ? 'h-screen overflow-hidden flex flex-col' : 'min-h-screen overflow-auto'}`}
        >
          <div
            key={pathname}
            className={isFullWidth ? 'page-enter flex-1 overflow-hidden flex flex-col' : 'max-w-6xl mx-auto p-6 page-enter'}
          >
            {children}
          </div>
        </main>
        <ToastMount />
      </div>
    </ActiveCallProvider>
  )
}
