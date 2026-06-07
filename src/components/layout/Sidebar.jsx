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
    { to: '/rep/training', label: 'Training Center', icon: BookOpen },
    { to: '/rep/stats',    label: 'My Stats',        icon: BarChart2 },
    { to: '/rep/goals',    label: 'My Goals',        icon: Target },
    { to: '/rep/feed',     label: 'Activity Feed',   icon: Bell },
  ],
  closer: [
    { to: '/closer',          label: 'My Appointments', icon: Calendar },
    { to: '/closer/deals',    label: 'Past Deals',       icon: DollarSign },
    { to: '/closer/revenue',  label: 'Revenue Tracker',  icon: TrendingUp },
    { to: '/closer/reps',     label: 'Rep Analytics',    icon: Users },
  ],
  admin: [
    { to: '/admin',            label: 'Overview',        icon: LayoutDashboard },
    { to: '/admin/reps',       label: 'Rep Performance', icon: BarChart2 },
    { to: '/admin/leads',      label: 'All Leads',       icon: List },
    { to: '/admin/pipeline',   label: 'Lead Pipeline',   icon: Columns },
    { to: '/admin/reengagement', label: 'Re-Engagement', icon: RefreshCw },
    { to: '/admin/sources',    label: 'Lead Sources',    icon: Database },
    { to: '/admin/users',      label: 'Users',           icon: Users },
  ],
}

export function Sidebar() {
  const { profile, signOut } = useAuth()
  const navigate = useNavigate()
  const links = NAV[profile?.role] || []

  async function handleSignOut() {
    await signOut()
    navigate('/login')
  }

  return (
    <aside className="w-56 flex-shrink-0 bg-[#0c0f16] border-r border-[#2a3347] flex flex-col min-h-screen">
      <div className="px-4 py-5 border-b border-[#2a3347]">
        <p className="text-lg font-bold text-slate-100 tracking-tight">Ohvara</p>
        <p className="text-xs text-slate-500 mt-0.5 capitalize">{profile?.role} Portal</p>
      </div>

      <nav className="flex-1 px-2 py-4 space-y-0.5">
        {links.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/rep' || to === '/closer' || to === '/admin'}
            className={({ isActive }) =>
              clsx(
                'flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors',
                isActive
                  ? 'bg-indigo-600/20 text-indigo-300 font-medium'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-[#161b24]'
              )
            }
          >
            <Icon size={16} />
            {label}
          </NavLink>
        ))}
      </nav>

      <div className="px-2 py-4 border-t border-[#2a3347]">
        <div className="px-3 mb-2">
          <p className="text-sm text-slate-300 font-medium truncate">{profile?.full_name}</p>
          <p className="text-xs text-slate-500 truncate">{profile?.email}</p>
        </div>
        <button
          onClick={handleSignOut}
          className="flex items-center gap-3 w-full px-3 py-2 rounded-lg text-sm text-slate-400 hover:text-slate-200 hover:bg-[#161b24] transition-colors"
        >
          <LogOut size={16} />
          Sign Out
        </button>
      </div>
    </aside>
  )
}
