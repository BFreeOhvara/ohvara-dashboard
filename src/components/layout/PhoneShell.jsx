import { Link, useLocation, useNavigate } from 'react-router-dom'
import { House, Users, Plus, MessageSquare, Menu, ChevronLeft } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { useUnreadMessageCount, useMessagesRealtime } from '../../hooks/usePolicyMessages'
import { PhoneLayoutContext } from '../../hooks/usePhoneLayout'
import { BillingGate } from './BillingGate'
import { ErrorBoundary } from '../shared/ErrorBoundary'

// Prompt 772 — the agent's phone shell (under 768px): no sidebar, no top bar,
// a bottom tab bar (Home, Clients, a raised + for Book a call, Messages, More)
// that sits above the iPhone home indicator. Book a call and an open chat hide
// the tab bar (they have their own back arrow and bottom bar). Pages reached
// from More get a back-arrow header. Mockups: media/mobile-agent/ in the vault.

const TABS = [
  { to: '/agent', label: 'Home', icon: House, on: p => p === '/agent' },
  { to: '/agent/clients', label: 'Clients', icon: Users, on: p => p === '/agent/clients' },
  { to: '/agent/book', label: 'Book a call', icon: Plus, plus: true, on: () => false },
  { to: '/messages', label: 'Messages', icon: MessageSquare, on: p => p === '/messages', badge: true },
  { to: '/agent/more', label: 'More', icon: Menu, on: p => ['/agent/more', '/agent/activity', '/agent/billing', '/settings'].includes(p) },
]

// Pages opened from More: a header with a back arrow to More.
const SUB_PAGES = {
  '/agent/activity': 'Activity',
  '/agent/billing': 'Billing',
  '/settings': 'Settings',
}

function TabBar({ pathname }) {
  const { profile } = useAuth()
  useMessagesRealtime(profile?.id)
  const unread = useUnreadMessageCount(!!profile?.id)
  return (
    <nav className="ph-tabbar" aria-label="Main">
      {TABS.map(({ to, label, icon: Icon, plus, on, badge }) => {
        const active = on(pathname)
        const count = badge && unread > 0 ? unread : 0
        return (
          <Link key={to} to={to} className={`ph-tab${active ? ' is-on' : ''}`} aria-current={active ? 'page' : undefined}
            aria-label={count ? `${label}, ${count} unread` : label}>
            {plus ? (
              <span className="ph-plus"><Icon size={26} strokeWidth={2.6} aria-hidden="true" /></span>
            ) : (
              <>
                <span className="ph-tab-icon">
                  <Icon size={22} strokeWidth={active ? 2.2 : 1.9} aria-hidden="true" />
                  {count > 0 && <span className="ph-tab-badge" aria-hidden="true">{count > 99 ? '99+' : count}</span>}
                </span>
                <span aria-hidden="true">{label}</span>
              </>
            )}
          </Link>
        )
      })}
    </nav>
  )
}

// A screen header with a back arrow. `right` sits at the end (e.g. the
// bookings pill on Book a call).
export function PhoneSubHead({ title, onBack, right }) {
  const navigate = useNavigate()
  return (
    <header className="ph-subhead">
      <button type="button" className="ph-back" onClick={onBack || (() => navigate(-1))} aria-label="Back">
        <ChevronLeft size={24} strokeWidth={2.2} />
      </button>
      <h1>{title}</h1>
      {right}
    </header>
  )
}

export function PhoneShell({ children }) {
  const { pathname, search } = useLocation()
  const navigate = useNavigate()
  const params = new URLSearchParams(search)
  const inChat = pathname === '/messages' && (params.has('dm') || params.has('thread'))
  const tabs = pathname !== '/agent/book' && !inChat
  const sub = SUB_PAGES[pathname]
  const cls = ['ph-app', tabs && 'has-tabs', pathname === '/messages' && 'is-bleed', sub && 'has-sub'].filter(Boolean).join(' ')
  return (
    <PhoneLayoutContext.Provider value>
      <div className={cls}>
        {sub && <PhoneSubHead title={sub} onBack={() => navigate('/agent/more')} />}
        <main className="ph-main">
          <div key={pathname} style={{ animation: 'fadeUp 160ms ease-out' }}>
            <ErrorBoundary resetKey={pathname}><BillingGate>{children}</BillingGate></ErrorBoundary>
          </div>
        </main>
        {tabs && <TabBar pathname={pathname} />}
      </div>
    </PhoneLayoutContext.Provider>
  )
}
