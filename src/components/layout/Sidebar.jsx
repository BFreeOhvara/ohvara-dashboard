import { NavLink, useNavigate } from 'react-router-dom'
import { clsx } from 'clsx'
import {
  Users, Phone, BarChart2, Target, Bell,
  Calendar, DollarSign, TrendingUp, BookOpen,
  LayoutDashboard, List, Columns, RefreshCw, Database, LogOut,
  Zap, Search, PhoneCall, GitBranch, MessageSquare
} from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { NotificationBell } from '../admin/NotificationBell'

const NAV = {
  rep: [
    { to: '/rep',             label: 'My Leads',       icon: Phone },
    { to: '/rep/training',    label: 'Training',       icon: BookOpen },
    { to: '/rep/stats',       label: 'My Stats',       icon: BarChart2 },
    { to: '/rep/goals',       label: 'My Goals',       icon: Target },
    { to: '/rep/commissions', label: 'My Commissions', icon: DollarSign },
    { to: '/rep/feed',        label: 'Activity',       icon: Bell },
    { to: '/rep/messages',    label: 'Messages',       icon: MessageSquare },
  ],
  closer: [
    { to: '/closer',                   label: 'Appointments',  icon: Calendar },
    { to: '/closer/scraper',           label: 'Lead Scraper',  icon: Search },
    { to: '/closer/call-leads',        label: 'Call Leads',    icon: PhoneCall },
    { to: '/closer/pipeline',          label: 'Pipeline',      icon: GitBranch },
    { to: '/closer/reps',              label: 'Rep Activity',  icon: BarChart2 },
    { to: '/closer/revenue',           label: 'Revenue',       icon: TrendingUp },
    { to: '/closer/deals',             label: 'Past Deals',    icon: DollarSign },
    { to: '/closer/commissions',       label: 'Commissions',   icon: DollarSign },
    { to: '/closer/messages',          label: 'Messages',      icon: MessageSquare },
  ],
  admin: [
    { to: '/admin',              label: 'Overview',        icon: LayoutDashboard },
    { to: '/admin/reps',         label: 'Rep Performance', icon: BarChart2 },
    { to: '/admin/pipeline',     label: 'Pipeline',        icon: Columns },
    { to: '/admin/sources',      label: 'Lead Sources',    icon: Database },
    { to: '/admin/scraper',      label: 'Lead Scraper',    icon: Search },
    { to: '/admin/users',        label: 'Users',           icon: Users },
    { to: '/admin/commissions',  label: 'Commissions',     icon: DollarSign },
    { to: '/admin/messages',     label: 'Messages',        icon: MessageSquare },
  ],
}

const ROLE_LABELS = { rep: 'Rep Portal', closer: 'Closer Portal', admin: 'Admin' }

export function Sidebar() {
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
    <aside
      className="sidebar-glass"
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
      }}
    >
      {/* Brand */}
      <div style={{ padding: '20px 16px 16px', borderBottom: '0.5px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 28, height: 28,
            borderRadius: 6,
            background: 'var(--accent)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}>
            <Zap size={14} color="white" fill="white" />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)', lineHeight: 1, margin: 0 }}>
              Ohvara
            </p>
            <p style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2, lineHeight: 1 }}>
              {ROLE_LABELS[profile?.role] || ''}
            </p>
          </div>
          {profile?.role === 'admin' && <NotificationBell />}
        </div>
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, padding: '10px 10px', overflowY: 'auto' }} className="scrollbar-thin">
        {links.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/rep' || to === '/closer' || to === '/admin'}
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
  )
}
