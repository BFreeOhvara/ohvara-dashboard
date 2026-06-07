import { NavLink, useNavigate } from 'react-router-dom'
import { clsx } from 'clsx'
import {
  Users, Phone, BarChart2, Target, Bell,
  Calendar, DollarSign, TrendingUp, BookOpen,
  LayoutDashboard, List, Columns, RefreshCw, Database, LogOut,
  Zap
} from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'

const NAV = {
  rep: [
    { to: '/rep',          label: 'My Leads',    icon: Phone },
    { to: '/rep/training', label: 'Training',     icon: BookOpen },
    { to: '/rep/stats',    label: 'My Stats',     icon: BarChart2 },
    { to: '/rep/goals',    label: 'My Goals',     icon: Target },
    { to: '/rep/feed',     label: 'Activity',     icon: Bell },
  ],
  closer: [
    { to: '/closer',         label: 'Appointments', icon: Calendar },
    { to: '/closer/deals',   label: 'Past Deals',   icon: DollarSign },
    { to: '/closer/revenue', label: 'Revenue',      icon: TrendingUp },
    { to: '/closer/reps',    label: 'Rep Stats',    icon: Users },
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

  const initials = profile?.full_name
    ? profile.full_name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()
    : '?'

  return (
    <aside className="w-52 flex-shrink-0 flex flex-col min-h-screen bg-[var(--bg-1)] border-r border-[var(--border)]">
      {/* Brand */}
      <div className="px-4 pt-5 pb-4 border-b border-[var(--border)]">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-[var(--accent)] flex items-center justify-center flex-shrink-0">
            <Zap size={14} className="text-white" fill="white" />
          </div>
          <div>
            <p className="text-sm font-bold text-[var(--text-primary)] tracking-tight leading-none">Ohvara</p>
            <p className="text-[10px] text-[var(--text-muted)] mt-0.5 leading-none">{ROLE_LABELS[profile?.role] || ''}</p>
          </div>
        </div>
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
                'flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm tab-transition',
                isActive
                  ? 'bg-[var(--accent-subtle)] text-[var(--accent)] font-semibold'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-2)]'
              )
            }
          >
            {({ isActive }) => (
              <>
                <Icon size={14} className={clsx('flex-shrink-0', isActive ? 'text-[var(--accent)]' : '')} />
                {label}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {/* User + sign out */}
      <div className="px-2 py-3 border-t border-[var(--border)]">
        <div className="flex items-center gap-2.5 px-3 mb-2">
          <div className="w-7 h-7 rounded-full bg-[var(--accent-subtle)] border border-[var(--accent)]/20 flex items-center justify-center flex-shrink-0">
            <span className="text-xs font-bold text-[var(--accent)]">{initials}</span>
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-[var(--text-secondary)] truncate leading-tight">{profile?.full_name}</p>
            <p className="text-[10px] text-[var(--text-muted)] truncate leading-tight mt-0.5">{profile?.username || profile?.email}</p>
          </div>
        </div>
        <button
          onClick={handleSignOut}
          className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-sm text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-2)] tab-transition"
        >
          <LogOut size={14} />
          Sign Out
        </button>
      </div>
    </aside>
  )
}
