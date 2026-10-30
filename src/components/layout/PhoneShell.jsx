import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { House, Users, Plus, MessageSquare, Menu, ChevronLeft, Phone, Wallet } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { useUnreadMessageCount, useMessagesRealtime } from '../../hooks/usePolicyMessages'
import { PhoneLayoutContext } from '../../hooks/usePhoneLayout'
import { usePortalPhone } from '../../contexts/portalPhone'
import { BillingGate } from './BillingGate'
import { ErrorBoundary } from '../shared/ErrorBoundary'
import { PullToRefresh } from '../native/PullToRefresh'
import { AddSomeoneSheet } from '../admin/phone/AddSomeoneSheet'
import { PhoneToast } from '../admin/phone/PhoneToast'
import { useAdminPay } from '../admin/phone/useAdminPay'
import { ConfirmEmailBanner } from './ConfirmEmailBanner'
import { LEADS_PAGE } from '../../lib/leadsPage'
import { TransferAlert } from '../agent/TransferAlert'
import { useNewInboundCount } from '../../hooks/useInbounds'

// Prompt 772 — the agent's phone shell (under 768px): no sidebar, no top bar,
// a bottom tab bar (Home, Clients, a raised + for Book a call, Messages, More)
// that sits above the iPhone home indicator. Book a call and an open chat hide
// the tab bar (they have their own back arrow and bottom bar). Pages reached
// from More get a back-arrow header. Mockups: media/mobile-agent/ in the vault.
// Prompt 773 — Fulfillment gets the same shell: Today, Clients, a raised Call
// button, Pay, More (media/mobile-fulfillment/). The Call button never starts
// a call: it brings back a live one, or takes Today to the next-call card.
// Prompt 774 — Admin too: Home, Desk, a raised + (Add someone, a sheet), Pay
// (an amber dot when a cancel needs a listen or Monday's run won't pay), More
// (media/mobile-admin/). People, Pipeline and Settings open from More.

const AGENT_TABS = [
  { to: '/agent', label: 'Home', icon: House, on: p => p === '/agent' },
  { to: '/agent/clients', label: 'Clients', icon: Users, on: p => p === '/agent/clients' },
  { to: '/agent/book', label: 'Submit', icon: Plus, plus: true, on: () => false },
  { to: '/messages', label: 'Messages', icon: MessageSquare, on: p => p === '/messages', badge: true },
  // Inbounds and Calendar open from More (portal parity answer 1); More shows the new-inbounds count.
  { to: '/agent/more', label: 'More', icon: Menu, on: p => ['/agent/more', '/agent/activity', ...(LEADS_PAGE ? ['/agent/leads'] : []), '/agent/billing', '/settings', '/agent/calendar'].includes(p) || p.startsWith('/agent/inbounds'), inbounds: true },
]

const FULFILL_TABS = [
  { to: '/fulfillment', label: 'Today', icon: House, on: p => p === '/fulfillment' || p === '/fulfillment/desk' },
  { to: '/fulfillment/pipeline', label: 'Clients', icon: Users, on: p => p === '/fulfillment/pipeline' },
  { label: 'Call', icon: Phone, plus: true, call: true },
  { to: '/fulfillment/pay', label: 'Pay', icon: Wallet, on: p => p === '/fulfillment/pay' },
  { to: '/fulfillment/more', label: 'More', icon: Menu, on: p => ['/fulfillment/more', '/messages', '/settings'].includes(p), badge: true },
]

const ADMIN_TABS = [
  { to: '/admin', label: 'Home', icon: House, on: p => p === '/admin' },
  { to: '/admin/fulfillment', label: 'Desk', icon: Phone, on: p => p === '/admin/fulfillment' },
  { label: 'Add someone', icon: Plus, plus: true, add: true },
  { to: '/admin/payouts', label: 'Pay', icon: Wallet, on: p => p === '/admin/payouts', payDot: true },
  { to: '/admin/more', label: 'More', icon: Menu, on: p => ['/admin/more', '/admin/users', '/admin/pipeline', '/messages', '/settings'].includes(p), badge: true },
]
const TABS = { agent: AGENT_TABS, fulfillment: FULFILL_TABS, admin: ADMIN_TABS }

// Pages opened from More: a header with a back arrow to More.
const SUB_PAGES = {
  agent: { '/agent/inbounds': 'Inbounds', '/agent/calendar': 'Calendar', '/agent/activity': 'Activity', ...(LEADS_PAGE ? { '/agent/leads': 'Leads' } : {}), '/agent/billing': 'Billing', '/settings': 'Settings' },
  fulfillment: { '/fulfillment/leads': 'Leads', '/settings': 'Settings' },
  admin: { '/admin/users': 'People', '/admin/pipeline': 'Pipeline', '/settings': 'Settings' },
}
const MORE = { agent: '/agent/more', fulfillment: '/fulfillment/more', admin: '/admin/more' }

// The raised Call button: a live call comes back full screen; otherwise
// Today scrolls to the next-call card and highlights it (`focusNext`).
function CallTab({ tab }) {
  const navigate = useNavigate()
  const phone = usePortalPhone()
  const Icon = tab.icon
  const live = !!phone.activeId
  return (
    <button type="button" className="ph-tab" aria-label={live ? 'Back to the call' : 'Your next call'}
      onClick={() => (live ? phone.show() : navigate('/fulfillment', { state: { focusNext: Date.now() } }))}>
      <span className={`ph-plus${live ? ' is-live' : ''}`}><Icon size={24} strokeWidth={2.3} aria-hidden="true" /></span>
    </button>
  )
}

// The raised + on Admin: Add someone as a sheet, over whatever page is open.
function AddTab({ tab }) {
  const [open, setOpen] = useState(false)
  const [toast, setToast] = useState(null)
  const Icon = tab.icon
  return (
    <>
      <button type="button" className="ph-tab" aria-label="Add someone" onClick={() => setOpen(true)}>
        <span className="ph-plus"><Icon size={26} strokeWidth={2.6} aria-hidden="true" /></span>
      </button>
      {open && <AddSomeoneSheet onClose={() => setOpen(false)} onSent={msg => { setOpen(false); setToast(msg) }} />}
      <PhoneToast text={toast} onDone={() => setToast(null)} />
    </>
  )
}

function PayDot() {
  const { alert } = useAdminPay()
  return alert ? <span className="ph-tab-dot" aria-hidden="true" /> : null
}

// The agent's More tab: inbounds that came in today or yesterday.
function InboundsBadge() {
  const n = useNewInboundCount()
  return n > 0 ? <span className="ph-tab-badge" aria-hidden="true">{n > 99 ? '99+' : n}</span> : null
}

function TabBar({ pathname, tabs }) {
  const { profile } = useAuth()
  useMessagesRealtime(profile?.id)
  const unread = useUnreadMessageCount(!!profile?.id)
  return (
    <nav className="ph-tabbar" aria-label="Main">
      {tabs.map(tab => {
        if (tab.call) return <CallTab key="call" tab={tab} />
        if (tab.add) return <AddTab key="add" tab={tab} />
        const { to, label, icon: Icon, plus, on, badge, payDot, inbounds } = tab
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
                  {payDot && <PayDot />}
                  {inbounds && <InboundsBadge />}
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

const REFRESH = ['/agent', '/fulfillment', '/fulfillment/desk', '/admin']

export function PhoneShell({ children }) {
  const { pathname, search } = useLocation()
  const navigate = useNavigate()
  const { profile } = useAuth()
  const role = profile?.role === 'fulfillment' || profile?.role === 'admin' ? profile.role : 'agent'
  const params = new URLSearchParams(search)
  const inChat = pathname === '/messages' && (params.has('dm') || params.has('thread'))
  const tabs = pathname !== '/agent/book' && !inChat
  const sub = SUB_PAGES[role][pathname]
  const cls = ['ph-app', tabs && 'has-tabs', pathname === '/messages' && 'is-bleed', sub && 'has-sub'].filter(Boolean).join(' ')
  return (
    <PhoneLayoutContext.Provider value>
      <div className={cls}>
        {sub && <PhoneSubHead title={sub} onBack={() => navigate(MORE[role])} />}
        <main className="ph-main">
          <div key={pathname} style={{ animation: 'fadeUp 160ms ease-out' }}>
            <ConfirmEmailBanner />
            <ErrorBoundary resetKey={pathname}>
              {/* Prompt 775 — pull down to refresh Home / Today in the phone app. */}
              {REFRESH.includes(pathname)
                ? <PullToRefresh><BillingGate>{children}</BillingGate></PullToRefresh>
                : <BillingGate>{children}</BillingGate>}
            </ErrorBoundary>
          </div>
        </main>
        {tabs && <TabBar pathname={pathname} tabs={TABS[role]} />}
        {/* Live-transfer alert for every agent (portal parity answer 2): silent unless Active. The one
            mount on a phone; DashboardLayout's own mount is on its desktop branch only. */}
        {profile?.role === 'agent' && <TransferAlert />}
      </div>
    </PhoneLayoutContext.Provider>
  )
}
