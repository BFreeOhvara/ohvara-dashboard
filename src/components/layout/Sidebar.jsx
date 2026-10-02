import { useState, useEffect, useRef } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { clsx } from 'clsx'
import {
  Users, BarChart2, LogOut, Home, Settings, Award,
  ChevronLeft, ClipboardList, CalendarPlus, GraduationCap, Trophy,
} from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { Avatar } from '../ui/Avatar'
import { eyebrow } from '../../lib/exportStyles'
import ohvaraLogo from '../../assets/ohvara-logo.png'

// Sidebar — Prompt 669 restyle to Restorix Portal's Layout.jsx: a 240px rail,
// the logo + wordmark in a 64px header that lines up with the page header's
// bottom border, eyebrow group labels, rounded nav rows with an accent active
// state, and the account card pinned to the bottom.
//
// Prompt 674 — the rail is back on Ohvara's own navy (teal in light) via
// --bg-sidebar. The account card is now exactly Restorix's AccountPopover:
// clicking it slides a panel up out of the card (the card grows upward from
// the bottom edge) with a Settings shortcut and Sign out. The agent duty
// toggle is gone (agents have no shifts; nothing server-side ever read it),
// Profile moved into Settings, and the divider line that sat above the card
// — which rode up as the card expanded — is removed.
//
// Prompt 675 — the panel is just Settings + Sign out (the "Profile &
// settings" label read as two items; Settings already opens on the Profile
// tab), the card's outline is white instead of grey, and the chevron on the
// card's right edge is gone.
//
// Kept: collapsible to 64px on desktop, off-canvas drawer on phones.

function AccountCard({ profile, expanded, onNavigate, onSignOut, onExpand }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  // Collapsed rail: the avatar alone, which opens the rail back up.
  if (!expanded) {
    return (
      <div style={{ padding: 12, display: 'flex', justifyContent: 'center' }}>
        <button onClick={onExpand} title={profile?.full_name || 'Account'}
          style={{ border: 'none', background: 'transparent', padding: 0, borderRadius: '50%' }}>
          <Avatar profile={profile} size={32} />
        </button>
      </div>
    )
  }

  return (
    <div ref={ref} style={{ padding: 12 }}>
      <div style={{ overflow: 'hidden', borderRadius: 10, border: 'var(--border-w) solid var(--sidebar-card-border)', background: 'var(--bg-elevated)' }}>
        <button onClick={() => setOpen(v => !v)} aria-expanded={open} className="menu-row" style={{ padding: '9px 10px' }}>
          <Avatar profile={profile} size={30} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {profile?.full_name}
            </p>
            <p style={{ ...eyebrow, marginTop: 2, color: 'var(--text-muted)', fontSize: 10 }}>{profile?.role}</p>
          </div>
        </button>

        <div style={{ display: 'grid', gridTemplateRows: open ? '1fr' : '0fr', transition: 'grid-template-rows 200ms ease-out' }}>
          <div style={{ overflow: 'hidden' }}>
            <div style={{ borderTop: 'var(--border-w) solid var(--border)' }}>
              <button onClick={() => { setOpen(false); onNavigate('/settings') }} className="menu-row">
                <Settings size={15} style={{ color: 'var(--text-muted)' }} /> Settings
              </button>
              <button onClick={() => { setOpen(false); onSignOut() }} className="menu-row" style={{ color: 'var(--danger)' }}>
                <LogOut size={15} /> Sign out
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// Same groups and order as before Prompt 669 — only the look changed.
const NAV = {
  // Prompt 665 — agent portal rebuilt around booking Fulfillment calls.
  agent: [
    { group: 'Work', items: [
      { to: '/agent', label: 'Overview', icon: Home },
      { to: '/agent/book', label: 'Book a call', icon: CalendarPlus },
      { to: '/agent/clients', label: 'My Clients', icon: Users },
      { to: '/agent/performance', label: 'Performance', icon: BarChart2 },
      { to: '/agent/team', label: 'Team', icon: Trophy },
      { to: '/agent/training', label: 'Training', icon: GraduationCap },
    ] },
    { group: 'Account', items: [
      { to: '/settings', label: 'Settings', icon: Settings },
    ] },
  ],
  admin: [
    // Prompt 665 — admin follows the agent portal's pages (company-wide
    // Clients + Performance), minus the agent's personal Overview.
    { group: 'Agents', items: [
      { to: '/agent/book', label: 'Book a call', icon: CalendarPlus },
      { to: '/agent/clients', label: 'Clients', icon: Users },
      { to: '/agent/performance', label: 'Performance', icon: BarChart2 },
      { to: '/agent/team', label: 'Team', icon: Trophy },
      { to: '/agent/training', label: 'Training', icon: GraduationCap },
    ] },
    { group: 'Account', items: [
      { to: '/admin/users', label: 'Users & Access', icon: Award },
      { to: '/fulfillment', label: 'Fulfillment', icon: ClipboardList },
      { to: '/settings', label: 'Settings', icon: Settings },
    ] },
  ],
  fulfillment: [
    { group: 'Work', items: [
      { to: '/fulfillment', label: 'Fulfillment', icon: ClipboardList },
    ] },
    { group: 'Account', items: [
      { to: '/settings', label: 'Settings', icon: Settings },
    ] },
  ],
}

const PORTAL_LABELS = { agent: 'Agent Portal', admin: 'Admin', fulfillment: 'Fulfillment' }

const COLLAPSE_KEY = 'ohvara-sidebar-collapsed'
// Keep in sync with DashboardLayout's --sb-w and index.css's fallbacks.
export const SIDEBAR_W = 240
export const SIDEBAR_W_COLLAPSED = 64

export function Sidebar({ open = false, onClose, collapsed, onToggleCollapse }) {
  const { profile, signOut } = useAuth()
  const navigate = useNavigate()
  const groups = NAV[profile?.role] || []

  // The phone drawer is always full width — collapsing is a desktop thing.
  const expanded = !collapsed || open

  async function handleSignOut() {
    await signOut()
    navigate('/login')
  }

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
          position: 'fixed', top: 0, left: 0, bottom: 0,
          width: expanded ? SIDEBAR_W : SIDEBAR_W_COLLAPSED,
          display: 'flex', flexDirection: 'column',
          overflow: 'hidden', zIndex: 100,
          transition: 'transform 200ms ease, width 150ms',
        }}
      >
        <div style={{
          height: 64, flexShrink: 0, padding: expanded ? '0 14px 0 18px' : 0,
          borderBottom: 'var(--border-w) solid var(--sidebar-border)',
          display: 'flex', alignItems: 'center', gap: 10,
          justifyContent: expanded ? 'flex-start' : 'center',
        }}>
          <img src={ohvaraLogo} alt="Ohvara" style={{ width: 32, height: 32, borderRadius: 8, objectFit: 'cover', flexShrink: 0, display: expanded ? 'block' : 'none' }} />
          {expanded && (
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 600, letterSpacing: '-0.01em', color: 'var(--text-primary)', lineHeight: 1.1 }}>Ohvara</p>
              <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.1 }}>
                {PORTAL_LABELS[profile?.role] || ''}
              </p>
            </div>
          )}
          <button
            onClick={onToggleCollapse}
            title={expanded ? 'Collapse sidebar' : 'Expand sidebar'}
            className="icon-btn hidden md:inline-flex"
            style={{ width: 28, height: 28, flexShrink: 0 }}
          >
            <ChevronLeft size={16} style={{ transform: expanded ? 'none' : 'rotate(180deg)' }} />
          </button>
        </div>

        <nav style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '14px 12px 8px', display: 'flex', flexDirection: 'column', gap: 18 }} className="scrollbar-thin">
          {groups.map(g => (
            <div key={g.group}>
              {expanded && (
                <p style={{ ...eyebrow, color: 'var(--text-muted)', padding: '0 12px 6px' }}>{g.group}</p>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {g.items.map(({ to, label, icon: Icon }) => (
                  <NavLink
                    key={to}
                    to={to}
                    end={to === '/agent' || to === '/fulfillment'}
                    onClick={onClose}
                    title={expanded ? undefined : label}
                    className={({ isActive }) => clsx('nav-item', isActive && 'is-active', !expanded && 'is-collapsed')}
                  >
                    <Icon size={17} style={{ flexShrink: 0 }} />
                    {expanded && <span style={{ flex: 1, whiteSpace: 'nowrap' }}>{label}</span>}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>

        <div style={{ flexShrink: 0 }}>
          <AccountCard
            profile={profile}
            expanded={expanded}
            onNavigate={path => { onClose?.(); navigate(path) }}
            onSignOut={handleSignOut}
            onExpand={onToggleCollapse}
          />
        </div>
      </aside>
    </>
  )
}

export { COLLAPSE_KEY }
