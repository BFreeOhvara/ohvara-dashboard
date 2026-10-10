import { useCallback, useMemo, useRef, useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { clsx } from 'clsx'
import { ChevronLeft, ChevronRight, X, ChevronsUpDown } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { useUnreadMessageCount, useMessagesRealtime } from '../../hooks/usePolicyMessages'
import { useAgentBookings } from '../../hooks/useAgentBookings'
import { useWeeklyUsage } from '../../hooks/useBillingTiers'
import { tabOf } from '../../lib/agentBookings'
import { capState, formatReset } from '../../lib/billing'
import { roleLabel } from '../../lib/roleLabels'
import { NAV } from '../../lib/nav'
import { Avatar } from '../ui/Avatar'
import { OhvaraMark } from '../ui/OhvaraMark'
import { BugReportModal, BugReportInbox } from '../shared/BugReportButton'
import { MobileAppModal } from './MobileAppModal'
import { InviteAgentModal } from '../shared/InviteAgentModal'
import { AccountMenu } from './AccountMenu'

// Sidebar — Prompt 722 rebuilt the chrome on the v16 language (DESIGN.md v16
// "P722 — App chrome"). Kept from before: the titled groups, each role's items
// and routes (now in lib/nav.js), the navy / teal rail (--bg-sidebar), the
// desktop collapse (persisted) and the phone drawer.
//
// - Header: the bird without its box (OhvaraMark) and "Ohvara Portal" in one
//   outlined style, baseline-aligned so the text sits on the bird's bottom line.
// - Rows 40px / radius 12; the active row has a fill, a soft shadow and a 3px
//   glowing bar on the rail's left edge.
// - Badges: Messages unread; agents also get My Pipeline's "needs attention" count
//   (amber), from the same useAgentBookings rows My Pipeline reads.
// - Agents with a weekly cap get a "This week" bookings card.
// - The account card opens the animated AccountMenu (theme, phone app, invite
//   an agent [agents only, P731], report a problem / bug reports, sign out) —
//   the round bug and phone buttons and the slide-up Sign out panel are gone.
// - Collapsed (72px): icon rows with tooltips, dots for badges, a hairline
//   between groups, and the avatar opens the same menu to the right.

const COLLAPSE_KEY = 'ohvara-sidebar-collapsed'
// Keep in sync with DashboardLayout's --sb-w and index.css's fallbacks.
export const SIDEBAR_W = 256
export const SIDEBAR_W_COLLAPSED = 72
const DRAWER_W = 300

const badgeText = n => (n > 99 ? '99+' : n)

export function Sidebar({ open = false, onClose, collapsed, onToggleCollapse }) {
  const { profile, signOut } = useAuth()
  const navigate = useNavigate()
  const role = profile?.role
  const isAgent = role === 'agent'
  const isAdmin = role === 'admin'
  const groups = NAV[role] || []

  // Prompt 679 — unread Messages badge + the one live subscription that keeps
  // it (and an open thread) current.
  useMessagesRealtime(profile?.id)
  const unreadMessages = useUnreadMessageCount(!!profile?.id)

  // Agents only: "needs attention" on My Pipeline and this week's bookings card.
  // Same queries (and keys) My Pipeline and Book a call already use.
  const { data: bookings = [] } = useAgentBookings(isAgent ? profile.id : null, { enabled: isAgent })
  const needsYou = useMemo(() => (isAgent ? bookings.filter(p => tabOf(p) === 'needs').length : 0), [bookings, isAgent])
  const { data: usage } = useWeeklyUsage(isAgent ? profile.id : null)
  const cap = isAgent ? capState(usage) : null

  // The phone drawer is always full width — collapsing is a desktop thing.
  const expanded = !collapsed || open
  const width = open ? DRAWER_W : expanded ? SIDEBAR_W : SIDEBAR_W_COLLAPSED

  const [menu, setMenu] = useState(null) // { rect, placement } while open
  const [modal, setModal] = useState(null) // 'app' | 'report' | 'inbox'
  const cardRef = useRef(null)
  // Prompt 740 — Enter has no :active in browsers, so mirror it for the press-in.
  const [pressed, setPressed] = useState(false)
  const pressKeys = {
    onKeyDown: e => { if (e.key === 'Enter' || e.key === ' ') setPressed(true) },
    onKeyUp: () => setPressed(false),
    onBlur: () => setPressed(false),
  }
  const closeMenu = useCallback(() => setMenu(m => (m ? { ...m, open: false } : m)), [])
  const toggleMenu = placement => {
    if (menu?.open) return closeMenu()
    setMenu({ open: true, rect: cardRef.current.getBoundingClientRect(), placement })
  }

  async function handleSignOut() {
    await signOut()
    navigate('/login')
  }

  const badgeFor = to => {
    if (to === '/messages' && unreadMessages > 0) return { n: unreadMessages, tone: 'msg', label: `${unreadMessages} unread` }
    if (isAgent && to === '/agent/clients' && needsYou > 0) return { n: needsYou, tone: 'amber', label: `${needsYou} ${needsYou === 1 ? 'needs' : 'need'} attention` }
    return null
  }

  const plan = isAgent ? usage?.tier_name : null
  const subline = [roleLabel(role), plan].filter(Boolean).join(' · ')

  return (
    <>
      {open && <div className="md:hidden ov-sb-scrim" onClick={onClose} aria-hidden="true" />}
      <aside
        className={clsx('sidebar-glass ov-sb', !expanded && 'is-collapsed', 'md:translate-x-0', open ? 'translate-x-0' : '-translate-x-full')}
        style={{ width }}
      >
        <div className="ov-sb-head">
          {expanded ? (
            <>
              <span className="ov-sb-brand">
                <OhvaraMark height={40} back="var(--ov-mark-back)" front="var(--ov-mark-front)" />
                <span className="ov-wordmark">Ohvara</span>
                <span className="ov-wordmark" style={{ marginLeft: -3 }}>Portal</span>
              </span>
              {open ? (
                <button type="button" className="ov-sb-close ov-phone-only" onClick={onClose} aria-label="Close menu">
                  <X size={18} strokeWidth={1.9} />
                </button>
              ) : (
                <button type="button" className="ov-sb-toggle is-collapse ov-desk-only" onClick={onToggleCollapse} aria-label="Collapse sidebar" title="Collapse sidebar">
                  <ChevronLeft size={16} strokeWidth={2.2} />
                </button>
              )}
            </>
          ) : (
            <button type="button" className="ov-sb-toggle is-expand" onClick={onToggleCollapse} aria-label="Expand sidebar" title="Expand sidebar">
              <ChevronRight size={18} strokeWidth={2.2} />
            </button>
          )}
        </div>

        <nav className="ov-sb-nav scrollbar-thin" aria-label="Main">
          {groups.map((g, gi) => (
            <div key={g.group} role="group" aria-label={g.group}>
              {expanded
                ? <p className="ov-sb-group">{g.group}</p>
                : gi > 0 && <div className="ov-sb-rule" aria-hidden="true" />}
              <div className="ov-sb-items">
                {g.items.map(({ to, label, icon: Icon }) => {
                  const badge = badgeFor(to)
                  return (
                    <NavLink
                      key={to}
                      to={to}
                      end={to === '/agent' || to === '/fulfillment'}
                      onClick={onClose}
                      title={expanded ? undefined : label}
                      aria-label={expanded ? undefined : label}
                      className={({ isActive }) => clsx('ov-sb-row', isActive && 'is-active', !expanded && 'is-icon')}
                    >
                      <Icon size={18} strokeWidth={1.8} style={{ flexShrink: 0 }} />
                      {expanded && <span className="ov-sb-label">{label}</span>}
                      {badge && (expanded
                        ? <span className={`ov-sb-badge is-${badge.tone}`} aria-label={badge.label}>{badgeText(badge.n)}</span>
                        : <span className={`ov-sb-dot is-${badge.tone}`} aria-label={badge.label} />)}
                    </NavLink>
                  )
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="ov-sb-foot">
          {expanded && cap?.cap != null && (
            <div className="ov-sb-usage">
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
                <span className="ov-sb-usage-title">This week</span>
                <span className="ov-sb-usage-reset">Resets {formatReset(usage.week_end).slice(0, 3)}</span>
              </div>
              <div className="ov-sb-usage-line">
                <span className="ov-sb-usage-num">{cap.used}</span>
                {cap.atCap
                  ? <span> of {cap.cap} · <span className="ov-sb-usage-full">Limit reached</span></span>
                  : <span> of {cap.cap} bookings</span>}
              </div>
              <div className="ov-sb-track" role="progressbar" aria-label="Bookings this week" aria-valuemin={0} aria-valuemax={cap.cap} aria-valuenow={cap.used}>
                <div className={clsx('ov-sb-fill', cap.atCap && 'is-full')} style={{ width: `${Math.min(100, cap.cap ? (cap.used / cap.cap) * 100 : 100)}%` }} />
              </div>
            </div>
          )}

          {expanded ? (
            <button
              ref={cardRef} type="button" className={clsx('ov-sb-account', menu?.open && 'is-open', pressed && 'is-pressed')}
              aria-haspopup="menu" aria-expanded={!!menu?.open} onClick={() => toggleMenu('above')} {...pressKeys}
            >
              <Avatar profile={profile} size={36} />
              <span style={{ flex: 1, minWidth: 0 }}>
                <span className="ov-sb-account-name">{profile?.full_name}</span>
                <span className="ov-sb-account-sub">{subline}</span>
              </span>
              <ChevronsUpDown size={16} strokeWidth={2} className="ov-sb-account-chev" aria-hidden="true" />
            </button>
          ) : (
            <button
              ref={cardRef} type="button" className={clsx('ov-sb-avatar', menu?.open && 'is-open', pressed && 'is-pressed')} title={profile?.full_name || 'Account'}
              aria-label="Account menu" aria-haspopup="menu" aria-expanded={!!menu?.open} onClick={() => toggleMenu('right')} {...pressKeys}
            >
              <Avatar profile={profile} size={44} />
            </button>
          )}
        </div>
      </aside>

      <AccountMenu
        open={!!menu?.open} anchor={menu?.rect} placement={menu?.placement} onClose={closeMenu} triggerRef={cardRef}
        isAdmin={isAdmin}
        onPhoneApp={() => setModal('app')}
        onInvite={isAgent ? () => setModal('invite') : undefined}
        onReport={() => setModal(isAdmin ? 'inbox' : 'report')}
        onSignOut={handleSignOut}
      />
      {modal === 'app' && <MobileAppModal onClose={() => setModal(null)} />}
      {modal === 'invite' && <InviteAgentModal onClose={() => setModal(null)} />}
      {modal === 'report' && <BugReportModal onClose={() => setModal(null)} />}
      {modal === 'inbox' && <BugReportInbox anchorLeft={(open ? 0 : width) + 12} onClose={() => setModal(null)} />}
    </>
  )
}

export { COLLAPSE_KEY }
