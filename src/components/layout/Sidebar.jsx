import { NavLink, useNavigate } from 'react-router-dom'
import { clsx } from 'clsx'
import {
  Users, Phone, BarChart2, Target, Bell,
  Calendar, DollarSign, TrendingUp, BookOpen,
  LayoutDashboard, List, Columns, RefreshCw, Database, LogOut
} from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'

const NAV = {
  rep: [
    { to: '/rep',          label: 'My Leads',       icon: Phone },
    { to: '/rep/training', label: 'Training',        icon: BookOpen },
    { to: '/rep/stats',    label: 'My Stats',        icon: BarChart2 },
    { to: '/rep/goals',    label: 'My Goals',        icon: Target },
    { to: '/rep/feed',     label: 'Activity',        icon: Bell },
  ],
  closer: [
    { to: '/closer',          label: 'Appointments', icon: Calendar },
    { to: '/closer/deals',    label: 'Past Deals',   icon: DollarSign },
    { to: '/closer/revenue',  label: 'Revenue',      icon: TrendingUp },
    { to: '/closer/reps',     label: 'Rep Stats',    icon: Users },
  ],
  admin: [
    { to: '/admin',              label: 'Overview',      icon: LayoutDashboard },
    { to: '/admin/reps',         label: 'Rep Performance', icon: BarChart2 },
    { to: '/admin/leads',        label: 'All Leads',     icon: List },
    { to: '/admin/pipeline',     label: 'Pipeline',      icon: Columns },
    { to: '/admin/reengagement', label: 'Re-Engagement', icon: RefreshCw },
    { to: '/admin/sources',      label: 'Lead Sources',  icon: Database },
    { to: '/admin/users',        label: 'Users',         icon: Users },
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

  return (
    <aside className="w-52 flex-shrink-0 flex flex-col min-h-screen bg-[var(--bg-deep)] border-r border-[var(--border)]">
      {/* Brand */}
      <div className="px-4 py-5 border-b border-[var(--border)]">
        <p className="text-base font-bold text-[var(--text-primary)] tracking-tight leading-none">Ohvara</p>
        <p className="text-xs text-[var(--text-muted)] mt-1">{ROLE_LABELS[profile?.role] || ''}</p>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto scrollbar-thin">
        {links.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/rep' || to === '/closer' || to === '/admin'}
            className={({ isActive }) =>
              clsx(
                'flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors',
                isActive
                  ? 'bg-[var(--accent-subtle)] text-indigo-300 font-medium'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-1)]'
              )
            }
          >
            <Icon size={14} className="flex-shrink-0" />
            {label}
          </NavLink>
        ))}
      </nav>

      {/* User + sign out */}
      <div className="px-2 py-3 border-t border-[var(--border)]">
        <div className="px-3 mb-2">
          <p className="text-xs font-semibold text-[var(--text-secondary)] truncate">{profile?.full_name}</p>
          <p className="text-xs text-[var(--text-muted)] truncate mt-0.5">{profile?.email}</p>
        </div>
        <button
          onClick={handleSignOut}
          className="flex items-center gap-2.5 w-full px-3 py-2 rounded-md text-sm text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-1)] transition-colors"
        >
          <LogOut size={14} />
          Sign Out
        </button>
      </div>
    </aside>
  )
}
