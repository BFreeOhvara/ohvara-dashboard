import { useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { clsx } from 'clsx'
import {
  Users, Phone, BarChart2, Target, Bell,
  Calendar, DollarSign, TrendingUp, BookOpen,
  LayoutDashboard, List, Columns, RefreshCw, Database, LogOut,
  Zap, Search, PhoneCall, GitBranch, MessageSquare, Home, Wallet, Settings,
  Smartphone,
} from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { NotificationBell } from '../admin/NotificationBell'
import { RepNotificationBell } from '../rep/RepNotificationBell'
import { CloserNotificationBell } from '../closer/CloserNotificationBell'
import { MobileAppModal } from './MobileAppModal'
import { isStandalone } from '../../lib/platform'
import ohvaraLogo from '../../assets/ohvara-logo.png'

// Hidden once the app is already running installed (standalone display
// mode) — nothing left to offer at that point.
function MobileAppBox() {
  const [open, setOpen] = useState(false)
  if (isStandalone()) return null
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          width: 'calc(100% - 16px)', margin: '0 8px 8px',
          padding: '9px 10px',
          background: 'var(--bg-elevated)', border: '0.5px solid var(--border)',
          borderRadius: 8, cursor: 'pointer', textAlign: 'left',
          fontSize: 12, color: 'var(--text-secondary)',
          transition: 'border-color 100ms',
        }}
        onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--border-hover)' }}
        onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)' }}
      >
        <Smartphone size={13} color="var(--accent)" style={{ flexShrink: 0 }} />
        Mobile App
      </button>
      {open && <MobileAppModal onClose={() => setOpen(false)} />}
    </>
  )
}

const NAV = {
  rep: [
    { to: '/setter',             label: 'My Leads',       icon: Phone },
    { to: '/setter/training',    label: 'Training',       icon: BookOpen },
    { to: '/setter/calls',       label: 'My Calls',       icon: PhoneCall },
    { to: '/setter/stats',       label: 'My Stats',       icon: BarChart2 },
    { to: '/setter/goals',       label: 'My Goals',       icon: Target },
    { to: '/setter/commissions', label: 'My Commissions', icon: DollarSign },
    { to: '/setter/feed',        label: 'Activity',       icon: Bell },
    { to: '/setter/messages',    label: 'Messages',       icon: MessageSquare },
  ],
  closer: [
    { to: '/closer',                   label: 'Appointments',    icon: Calendar },
    { to: '/closer/call-leads',        label: 'My Leads',        icon: Phone },
    { to: '/closer/script',            label: 'Script',          icon: BookOpen },
    { to: '/closer/pipeline',          label: 'Pipeline',        icon: GitBranch },
    { to: '/closer/calls',             label: 'My Calls',        icon: PhoneCall },
    { to: '/closer/stats',             label: 'My Stats',        icon: Target },
    { to: '/closer/reps',              label: 'Setter Activity', icon: BarChart2 },
    { to: '/closer/revenue',           label: 'Revenue',         icon: TrendingUp },
    { to: '/closer/messages',          label: 'Messages',        icon: MessageSquare },
  ],
  admin: [
    { to: '/admin',              label: 'Overview',           icon: LayoutDashboard },
    { to: '/admin/reps',         label: 'Setter Performance', icon: BarChart2 },
    { to: '/admin/pipeline',     label: 'Pipeline',           icon: Columns },
    { to: '/admin/users',        label: 'Users',              icon: Users },
    { to: '/admin/commissions',  label: 'Commissions',        icon: DollarSign },
    { to: '/admin/payouts',      label: 'Payouts',            icon: Wallet },
    { to: '/admin/messages',     label: 'Messages',           icon: MessageSquare },
  ],
  client: [
    { to: '/client',             label: 'Overview',    icon: Home },
    { to: '/client/automations', label: 'Automations', icon: Zap },
    { to: '/client/messages',    label: 'Messages',    icon: MessageSquare },
  ],
}

// Sidebar-specific "X Portal" subtitle chrome — not the same as the shared
// bare role label (roleLabels.js), since admin deliberately doesn't get a
// "Portal" suffix here. Already said "Setter Portal" for rep correctly
// before Prompt 299 — kept as-is, just renamed from the old `ROLE_LABELS`
// to stop colliding in name (not value) with the shared module.
const PORTAL_LABELS = { rep: 'Setter Portal', closer: 'Closer Portal', admin: 'Admin', client: 'Client Portal' }

// Prompt 287 fix — the sidebar is fixed-width and was eating 64% of any
// phone-width viewport (240px of 375px) with no way to get it out of the
// way. Below `md` it's now an off-canvas drawer (translated fully offscreen
// unless `open`), toggled by DashboardLayout's mobile top bar; at `md` and
// up it behaves exactly as before (always visible, `open`/`onClose` inert).
export function Sidebar({ open = false, onClose }) {
  const { profile, signOut } = useAuth()
  const navigate = useNavigate()
  const links = NAV[profile?.role] || []

  async function handleSignOut() {
    await signOut()
    navigate('/login')
  }

  const initials = profile?.full_name
    ? profile.full_name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()
    : '?'

  return (
    <>
      {open && (
        <div
          className="md:hidden"
          onClick={onClose}
          style={{ position: 'fixed', inset: 0, zIndex: 90, background: 'rgba(0,0,0,0.5)' }}
        />
      )}
      <aside
        className={clsx('sidebar-glass', 'md:translate-x-0', open ? 'translate-x-0' : '-translate-x-full')}
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          bottom: 0,
          width: 240,
          display: 'flex',
          flexDirection: 'column',
          height: '100vh',
          overflow: 'hidden',
          zIndex: 100,
          transition: 'transform 200ms ease',
        }}
      >
      {/* Brand */}
      <div style={{ padding: '20px 16px 16px', borderBottom: '0.5px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <img
            src={ohvaraLogo}
            alt="Ohvara"
            style={{ width: 28, height: 28, borderRadius: 6, objectFit: 'cover', flexShrink: 0 }}
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)', lineHeight: 1, margin: 0 }}>
              Ohvara
            </p>
            <p style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2, lineHeight: 1 }}>
              {PORTAL_LABELS[profile?.role] || ''}
            </p>
          </div>
          {/* Prompt 322: bell moved to the mobile top bar (DashboardLayout)
              so it's reachable without opening the hamburger drawer —
              hidden here below md, unchanged at md+ where the sidebar is
              always visible anyway. */}
          <span className="hidden md:block">
            {profile?.role === 'admin' && <NotificationBell />}
            {profile?.role === 'rep' && <RepNotificationBell profileId={profile.id} />}
            {profile?.role === 'closer' && <CloserNotificationBell profileId={profile.id} />}
          </span>
        </div>
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, padding: '10px 10px', overflowY: 'auto' }} className="scrollbar-thin">
        {links.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/setter' || to === '/closer' || to === '/admin' || to === '/client'}
            onClick={onClose}
            className={({ isActive }) =>
              clsx(
                'nav-item tab-transition',
                isActive ? 'nav-active' : ''
              )
            }
            style={{ display: 'block', textDecoration: 'none', marginBottom: 3 }}
          >
            {({ isActive }) => (
              <span style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '12px 12px 12px 14px',
                borderRadius: 8,
                fontSize: 14,
                fontWeight: isActive ? 500 : 400,
                color: isActive ? 'var(--text-primary)' : 'var(--text-muted)',
                position: 'relative',
                background: isActive ? 'var(--bg-elevated)' : 'transparent',
                minHeight: 44,
              }}>
                {isActive && (
                  <span style={{
                    position: 'absolute',
                    left: 0, top: 8, bottom: 8,
                    width: 2,
                    background: 'var(--accent)',
                    borderRadius: '0 2px 2px 0',
                  }} />
                )}
                <Icon size={16} style={{ flexShrink: 0, color: isActive ? 'var(--accent)' : 'inherit' }} />
                <span style={{ flex: 1 }}>{label}</span>
                {isActive && <span className="nav-active-dot" />}
              </span>
            )}
          </NavLink>
        ))}
      </nav>

      <MobileAppBox />

      {/* User + sign out */}
      <div style={{ padding: '8px 8px', borderTop: '0.5px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px 10px' }}>
          <div style={{
            width: 26, height: 26,
            borderRadius: '50%',
            background: 'var(--accent-dim)',
            border: '0.5px solid var(--accent-border)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}>
            <span style={{ fontSize: 10, fontWeight: 500, color: 'var(--accent)' }}>{initials}</span>
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <p style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {profile?.full_name}
            </p>
            <p style={{ fontSize: 10, color: 'var(--text-muted)', margin: '1px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {profile?.username || profile?.email}
            </p>
          </div>
          <NavLink
            to="/settings"
            title="Settings"
            onClick={onClose}
            className={({ isActive }) => clsx(
              'tab-transition',
              isActive ? '' : ''
            )}
            style={({ isActive }) => ({
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: 26, height: 26, borderRadius: 6, flexShrink: 0,
              color: isActive ? 'var(--accent)' : 'var(--text-muted)',
              background: isActive ? 'var(--bg-elevated)' : 'transparent',
            })}
          >
            <Settings size={15} />
          </NavLink>
        </div>
        <button
          onClick={handleSignOut}
          style={{
            display: 'flex', alignItems: 'center', gap: 10,
            width: '100%', padding: '12px 12px',
            minHeight: 44,
            borderRadius: 8,
            fontSize: 14,
            color: 'var(--text-muted)',
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            transition: 'color 100ms, background-color 100ms',
          }}
          onMouseEnter={e => { e.currentTarget.style.color = 'var(--text-secondary)'; e.currentTarget.style.background = 'var(--bg-elevated)' }}
          onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.background = 'transparent' }}
        >
          <LogOut size={16} />
          Sign Out
        </button>
      </div>
      </aside>
    </>
  )
}
