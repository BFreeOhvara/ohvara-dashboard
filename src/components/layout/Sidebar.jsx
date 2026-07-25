import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { NavLink, useNavigate } from 'react-router-dom'
import { clsx } from 'clsx'
import {
  Users, BarChart2, Bell, DollarSign, BookOpen, LayoutDashboard, Columns,
  LogOut, Zap, PhoneCall, GitBranch, MessageSquare, Home, Wallet, Settings,
  Smartphone, FileText, Headphones, Calculator, Globe, Shield, Award,
  Megaphone, GraduationCap, ChevronRight, Phone, Target, User,
} from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { MobileAppModal } from './MobileAppModal'
import { isStandalone } from '../../lib/platform'
import ohvaraLogo from '../../assets/ohvara-logo.png'

// Sidebar — a literal port of the approved Claude Design export's `<aside>`
// (vault: media/claude-design-export-ohvara-dashboard-v3.html, lines 57-112).
// Navy fill, collapsible to 64px, grouped nav with an accent rail on the
// active item, closer duty widget, profile row, sign out. Sizes/paddings are
// the export's, not re-derived — don't "clean them up" (Prompt 327).
//
// Icons: the export references an icon sprite (`sprite.svg`) that was never
// handed over, so each sprite name below is mapped to its lucide equivalent
// by name. Flagged in the session log — swap to the real sprite when it lands.

// Hidden once the app is already running installed (standalone display mode).
// Rep-only: it's a setter-era affordance and isn't in the approved design.
function MobileAppBox() {
  const [open, setOpen] = useState(false)
  if (isStandalone()) return null
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          width: 'calc(100% - 20px)', margin: '0 10px 10px',
          padding: '9px 11px',
          background: 'var(--bg-elevated)', border: 'var(--border-w) solid var(--border)',
          borderRadius: 8, cursor: 'pointer', textAlign: 'left',
          fontSize: 12, color: 'var(--text-secondary)',
        }}
      >
        <Smartphone size={13} style={{ flexShrink: 0 }} />
        Mobile App
      </button>
      {open && <MobileAppModal onClose={() => setOpen(false)} />}
    </>
  )
}

// Account footer row (Prompt 338, permanent highlight added Prompt 339) —
// always carries the same `--bg-elevated` treatment an active nav item gets,
// like a permanently-styled card rather than a hover/open-only state. Clicking
// it opens a popover anchored ABOVE it (the footer sits at the bottom of the
// sidebar) instead of navigating straight to Settings. Portaled to
// document.body like NotificationBell (components/admin/NotificationBell.jsx)
// — the sidebar `<aside>` is `position:fixed` with `overflow:hidden` for its
// own scroll containment, which would otherwise clip the popover to the
// sidebar's width no matter its z-index.
function AccountMenu({ profile, expanded, duty, setDuty, onNavigate, onSignOut }) {
  const [open, setOpen] = useState(false)
  const rowRef = useRef(null)
  const panelRef = useRef(null)
  const [coords, setCoords] = useState(null)

  useEffect(() => {
    if (open && rowRef.current) {
      const rect = rowRef.current.getBoundingClientRect()
      setCoords({ bottom: window.innerHeight - rect.top + 8, left: rect.left })
    }
  }, [open])

  useEffect(() => {
    function handleClick(e) {
      if (
        rowRef.current && !rowRef.current.contains(e.target) &&
        panelRef.current && !panelRef.current.contains(e.target)
      ) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const initials = profile?.full_name
    ? profile.full_name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()
    : '?'

  function go(path) {
    setOpen(false)
    onNavigate(path)
  }

  const menuItemStyle = {
    display: 'flex', alignItems: 'center', gap: 9, width: '100%',
    padding: '8px 14px', border: 'none', background: 'transparent',
    color: 'var(--text-primary)', fontSize: 12.5, fontWeight: 500,
    textAlign: 'left', cursor: 'pointer',
  }

  return (
    <div style={{ padding: 10 }}>
      <div
        ref={rowRef}
        onClick={() => setOpen(v => !v)}
        title={expanded ? undefined : (profile?.full_name || 'Account')}
        style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: 8,
          borderRadius: 6, cursor: 'pointer',
          background: 'var(--bg-elevated)',
        }}
      >
        <span style={{
          width: 26, height: 26, borderRadius: '50%',
          background: 'var(--accent-dim)', border: '1px solid var(--accent-border)',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 10, fontWeight: 700, color: 'var(--accent)', flexShrink: 0,
        }}>
          {initials}
        </span>
        {expanded && (
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {profile?.full_name}
            </p>
            <p style={{ margin: '1px 0 0', fontSize: 10, color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {profile?.username || profile?.email}
            </p>
          </div>
        )}
      </div>

      {open && coords && createPortal(
        <div
          ref={panelRef}
          style={{
            position: 'fixed', bottom: coords.bottom, left: coords.left, width: 220,
            background: 'var(--bg-surface)', border: 'var(--border-w) solid var(--border)',
            borderRadius: 8, overflow: 'hidden', zIndex: 9999, padding: '6px 0',
          }}
        >
          {/* Identity header — non-clickable, just display */}
          <div style={{ padding: '8px 14px 10px' }}>
            <p style={{ margin: 0, fontSize: 12.5, fontWeight: 700, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {profile?.full_name}
            </p>
            <p style={{ margin: '2px 0 0', fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {profile?.username || profile?.email}
            </p>
          </div>

          {/* Duty toggle — closers only, folded in from its old standalone
              row (export: showDutyWidget) */}
          {profile?.role === 'closer' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px' }}>
              <span style={{ flex: 1, fontSize: 12, color: 'var(--text-secondary)' }}>
                {duty ? 'Available for transfers' : 'Off duty'}
              </span>
              <div
                onClick={() => setDuty(d => !d)}
                style={{
                  width: 32, height: 18, borderRadius: 9,
                  background: duty ? 'var(--success)' : 'var(--bg-base)',
                  position: 'relative', cursor: 'pointer', transition: 'background 120ms', flexShrink: 0,
                }}
              >
                <span style={{
                  position: 'absolute', top: 2, left: duty ? 16 : 2,
                  width: 14, height: 14, borderRadius: '50%', background: '#fff', transition: 'left 120ms',
                }} />
              </div>
            </div>
          )}

          <div style={{ borderTop: 'var(--border-w) solid var(--border)', margin: '4px 0' }} />

          <button
            onClick={() => go('/profile')}
            style={menuItemStyle}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-elevated)' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
          >
            <User size={14} style={{ flexShrink: 0, color: 'var(--text-muted)' }} />
            Profile
          </button>

          <button
            onClick={() => { setOpen(false); onSignOut() }}
            style={menuItemStyle}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-elevated)' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
          >
            <LogOut size={14} style={{ flexShrink: 0, color: 'var(--text-muted)' }} />
            Sign out
          </button>
        </div>,
        document.body
      )}
    </div>
  )
}

// Groups and order are the export's NAVDEF verbatim (closer + admin).
const NAV = {
  rep: [
    { group: 'Today', items: [
      { to: '/setter', label: 'My Leads', icon: Phone },
      { to: '/setter/calls', label: 'My Calls', icon: PhoneCall },
    ] },
    { group: 'Growth', items: [
      { to: '/setter/stats', label: 'My Stats', icon: BarChart2 },
      { to: '/setter/goals', label: 'My Goals', icon: Target },
      { to: '/setter/commissions', label: 'My Commissions', icon: DollarSign },
      { to: '/setter/training', label: 'Training', icon: BookOpen },
    ] },
    { group: 'Account', items: [
      { to: '/setter/feed', label: 'Activity', icon: Bell },
      { to: '/setter/messages', label: 'Messages', icon: MessageSquare },
    ] },
  ],
  closer: [
    { group: 'Today', items: [
      { to: '/agent', label: 'Overview', icon: Home },
      { to: '/agent/live', label: 'Live Call', icon: Headphones },
    ] },
    { group: 'Sales', items: [
      { to: '/agent/policies', label: 'My Policies', icon: GitBranch },
      { to: '/agent/calls', label: 'My Calls', icon: PhoneCall },
    ] },
    { group: 'Tools', items: [
      { to: '/agent/quoter', label: 'Quoter', icon: Zap },
      { to: '/agent/underwriting', label: 'Underwriting', icon: Shield },
      { to: '/agent/submissions', label: 'Submissions', icon: FileText },
      { to: '/agent/carriers', label: 'Carrier Portals', icon: Globe },
    ] },
    { group: 'Growth', items: [
      { to: '/agent/stats', label: 'Stats', icon: BarChart2 },
      { to: '/agent/hierarchy', label: 'Hierarchy', icon: Users },
      { to: '/agent/training', label: 'Training Center', icon: GraduationCap },
      { to: '/agent/commissions', label: 'Commissions', icon: DollarSign },
    ] },
    { group: 'Account', items: [
      { to: '/settings', label: 'Settings', icon: Settings },
    ] },
  ],
  admin: [
    { group: 'Monitor', items: [
      { to: '/admin', label: 'Overview', icon: LayoutDashboard },
      { to: '/admin/call-pipeline', label: 'Call Pipeline', icon: Columns },
      { to: '/admin/roster', label: 'Closer Roster', icon: Users },
      { to: '/admin/leaderboard', label: 'Leaderboard', icon: Award },
      { to: '/agent/hierarchy', label: 'Hierarchy', icon: GitBranch },
    ] },
    { group: 'Revenue', items: [
      { to: '/admin/commissions', label: 'Commissions', icon: Wallet },
      { to: '/admin/lead-sources', label: 'Lead Sources', icon: Megaphone },
    ] },
    { group: 'Manage', items: [
      { to: '/admin/users', label: 'Users & Access', icon: Shield },
      { to: '/settings', label: 'Settings', icon: Settings },
    ] },
  ],
  client: [
    { group: 'Portal', items: [
      { to: '/client', label: 'Overview', icon: Home },
      { to: '/client/automations', label: 'Automations', icon: Zap },
      { to: '/client/messages', label: 'Messages', icon: MessageSquare },
    ] },
  ],
}

// Export's `portalLabel`: admin is bare "Admin", the agent role reads as a
// portal. rep/client keep their own wording from the pre-pivot app.
const PORTAL_LABELS = { rep: 'Setter Portal', closer: 'Agent Portal', admin: 'Admin', client: 'Client Portal' }

const COLLAPSE_KEY = 'ohvara-sidebar-collapsed'
const DUTY_KEY = 'ohvara-duty'

export function Sidebar({ open = false, onClose, collapsed, onToggleCollapse }) {
  const { profile, signOut } = useAuth()
  const navigate = useNavigate()
  const groups = NAV[profile?.role] || []

  // Duty toggle is part of the approved design and belongs to Live Call,
  // which has no backend yet — so it persists locally and drives nothing
  // server-side. Flagged; wire it to real transfer routing when Live Call
  // gets built.
  const [duty, setDuty] = useState(() => localStorage.getItem(DUTY_KEY) !== 'off')
  useEffect(() => { localStorage.setItem(DUTY_KEY, duty ? 'on' : 'off') }, [duty])

  const expanded = !collapsed

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
          width: expanded ? 224 : 64,
          display: 'flex', flexDirection: 'column',
          overflow: 'hidden', zIndex: 100,
          transition: 'transform 200ms ease, width 150ms',
        }}
      >
        {/* Brand + collapse toggle */}
        <div style={{
          height: 60, padding: '0 14px',
          borderBottom: 'var(--border-w) solid var(--sidebar-border)',
          display: 'flex', alignItems: 'center', gap: 10,
          justifyContent: expanded ? 'flex-start' : 'center',
        }}>
          {expanded && (
            <>
              <img src={ohvaraLogo} alt="Ohvara" style={{ width: 28, height: 28, borderRadius: 6, objectFit: 'cover', flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.1 }}>Ohvara</p>
                <p style={{ margin: '2px 0 0', fontSize: 10, color: 'var(--text-muted)', lineHeight: 1 }}>
                  {PORTAL_LABELS[profile?.role] || ''}
                </p>
              </div>
            </>
          )}
          <button
            onClick={onToggleCollapse}
            title={expanded ? 'Collapse sidebar' : 'Expand sidebar'}
            className="hidden md:inline-flex"
            style={{
              alignItems: 'center', justifyContent: 'center',
              width: 28, height: 28,
              border: '1px solid var(--border)', borderRadius: 7,
              background: 'var(--bg-elevated)', color: 'var(--text-primary)', flexShrink: 0,
            }}
          >
            <ChevronRight size={20} strokeWidth={2.75} style={{ transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)' }} />
          </button>
        </div>

        {/* Nav — minHeight:0 is required on a flex-column child with its own
            overflow:auto (Prompt 329): without it the child can't shrink
            below its intrinsic content height, so it either pushes past the
            aside's own overflow:hidden clip or renders a scrollbar sized off
            the wrong available height instead of the flex-allotted space.
            Prompt 330: minHeight:0 alone didn't fully kill the scrollbar —
            two real sources of a few extra pixels of content height were
            still there: (1) the aside had both `bottom:0` AND an explicit
            `height:'100vh'`, an over-constrained pair where 100vh can be a
            device-pixel or two off from the aside's true rendered height on
            Windows (DPI scaling / scrollbar-gutter rounding), so nav's
            allotted flex space and its actual content could disagree by a
            hair; (2) the last nav group carried a trailing `marginBottom:20`
            that served no visual purpose (nav's own bottom padding already
            separates it from the duty widget below) but did add to nav's
            scrollHeight. Fixed both — aside now sizes purely from
            top:0/bottom:0, and only non-last groups get the 20px gap. */}
        <nav style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '10px 10px 8px' }} className="scrollbar-thin">
          {groups.map((g, i) => (
            <div key={g.group} style={{ marginBottom: i === groups.length - 1 ? 0 : 20 }}>
              {expanded && (
                <p style={{
                  margin: '2px 0 5px', padding: '0 8px', fontSize: 10, fontWeight: 700,
                  letterSpacing: '0.09em', textTransform: 'uppercase', color: 'var(--text-muted)',
                }}>
                  {g.group}
                </p>
              )}
              {g.items.map(({ to, label, icon: Icon }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={to === '/agent' || to === '/admin' || to === '/setter' || to === '/client'}
                  onClick={onClose}
                  title={label}
                  style={{ display: 'block', textDecoration: 'none' }}
                >
                  {({ isActive }) => (
                    <span
                      style={{
                        display: 'flex', alignItems: 'center',
                        justifyContent: expanded ? 'flex-start' : 'center',
                        gap: 9, width: '100%', padding: '9px 10px', marginBottom: 2,
                        border: 'none', borderRadius: 6,
                        background: isActive ? 'var(--bg-elevated)' : 'transparent',
                        color: 'var(--text-primary)',
                        fontSize: 13, fontWeight: isActive ? 500 : 400,
                        textAlign: 'left', position: 'relative',
                      }}
                      onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-elevated)' }}
                      onMouseLeave={e => { e.currentTarget.style.background = isActive ? 'var(--bg-elevated)' : 'transparent' }}
                    >
                      <span style={{
                        position: 'absolute', left: -10, top: 6, bottom: 6, width: 2,
                        borderRadius: '0 2px 2px 0',
                        background: isActive ? 'var(--accent)' : 'transparent',
                      }} />
                      <Icon size={15} style={{ flexShrink: 0, color: isActive ? 'var(--accent)' : 'currentColor' }} />
                      {expanded && (
                        <>
                          <span style={{ flex: 1 }}>{label}</span>
                          {to === '/agent/live' && duty && (
                            <span style={{
                              width: 6, height: 6, borderRadius: '50%', background: 'var(--success)',
                              animation: 'pulseDot 2.4s ease-in-out infinite',
                            }} />
                          )}
                        </>
                      )}
                    </span>
                  )}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        {profile?.role === 'rep' && expanded && <MobileAppBox />}

        {/* Account footer (Prompt 338, permanent highlight Prompt 339) —
            always-highlighted row opens a popover anchored above it
            (name/username header, the duty toggle folded in for closers,
            Profile, Sign out) instead of navigating straight to Settings. */}
        <div style={{ borderTop: 'var(--border-w) solid var(--sidebar-border)' }}>
          <AccountMenu
            profile={profile}
            expanded={expanded}
            duty={duty}
            setDuty={setDuty}
            onNavigate={path => { onClose?.(); navigate(path) }}
            onSignOut={handleSignOut}
          />
        </div>
      </aside>
    </>
  )
}

export { COLLAPSE_KEY }
