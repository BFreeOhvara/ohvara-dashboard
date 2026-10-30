import { Link, useLocation } from 'react-router-dom'
import { Sun, Inbox, Settings, CalendarDays, Users, CreditCard, CircleAlert } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { useInbounds } from '../../hooks/useInbounds'
import { OhvaraMark } from '../ui/OhvaraMark'
import { BillingGate } from '../layout/BillingGate'
import { ErrorBoundary } from '../shared/ErrorBoundary'
import { TransferAlert } from './TransferAlert'
import { isRecent } from '../../lib/portalV2'
import '../../pages/agent/v2/portalV2.css'

// The agent portal v2 shell (behind app_settings.agent_portal_v2): from 768px a 256px sidebar
// (Today, Inbounds with the new-inbound count, Calendar, Clients, Plan & billing, Settings) and a
// 72px page header; under 768px no sidebar or header, a 6-column bottom tab bar instead. Mockups:
// ohvara/mockups/build-v2-portal-shell-today-inbounds-inb.html and
// ohvara/mockups/build-calendar-clients-and-plan-billing-.html.
const initials = name => (name || '').trim().split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase()).join('') || 'A'

function useNewCount() {
  const { profile } = useAuth()
  const { data } = useInbounds()
  return (data || []).filter(l => isRecent(l, profile?.timezone)).length
}

export const Ico = ({ icon: Icon, size = 18 }) => <Icon size={size} strokeWidth={2} className="pv-i" aria-hidden="true" />

function Sidebar({ active, count, profile }) {
  const link = (key, to, icon, label, badge) => (
    <Link to={to} className={`pv-nav${active === key ? ' on' : ''}`} aria-current={active === key ? 'page' : undefined}>
      <Ico icon={icon} />{label}{badge > 0 && <span className="pv-count tab">{badge}</span>}
    </Link>
  )
  return (
    <aside className="pv-sb" aria-label="Main menu">
      <div className="pv-sb-head"><OhvaraMark height={30} /><span className="pv-wordmark">Ohvara Portal</span></div>
      <p className="pv-sb-grp">Your work</p>
      {link('today', '/agent', Sun, 'Today')}
      {link('inbounds', '/agent/inbounds', Inbox, 'Inbounds', count)}
      {link('calendar', '/agent/calendar', CalendarDays, 'Calendar')}
      {link('clients', '/agent/clients', Users, 'Clients')}
      <p className="pv-sb-grp">Account</p>
      {link('plan', '/agent/plan', CreditCard, 'Plan & billing')}
      {link('settings', '/settings', Settings, 'Settings')}
      <div className="pv-me">
        <span className="pv-av" aria-hidden="true">{initials(profile?.full_name)}</span>
        <div className="pv-grow"><b>{profile?.full_name || 'Agent'}</b><span>Agent</span></div>
      </div>
    </aside>
  )
}

function TabBar({ active, count }) {
  const tab = (key, to, icon, label, badge) => (
    <Link to={to} className={active === key ? 'on' : undefined} aria-current={active === key ? 'page' : undefined}>
      <Ico icon={icon} size={22} />{label}{badge > 0 && <span className="pv-tb-badge tab" aria-hidden="true">{badge}</span>}
    </Link>
  )
  return (
    <nav className="pv-tabbar" aria-label="Main menu">
      {tab('today', '/agent', Sun, 'Today')}
      {tab('inbounds', '/agent/inbounds', Inbox, 'Inbounds', count)}
      {tab('calendar', '/agent/calendar', CalendarDays, 'Calendar')}
      {tab('clients', '/agent/clients', Users, 'Clients')}
      {tab('plan', '/agent/plan', CreditCard, 'Plan')}
      {tab('settings', '/settings', Settings, 'Settings')}
    </nav>
  )
}

// `active` is today | inbounds | calendar | clients | plan. `crumb` / `title` / `icon` fill the page header.
// The live-transfer alert (TransferAlert) is mounted here once, so it rings on every v2 page.
export function PortalV2Layout({ active, crumb = 'Your work', title, icon = Sun, children }) {
  const { profile } = useAuth()
  const { pathname } = useLocation()
  const count = useNewCount()
  return (
    <div className="pv">
      <Sidebar active={active} count={count} profile={profile} />
      <div className="app-main pv-main" style={{ '--sb-w': '256px' }}>
        <div className="app-backdrop app-backdrop--v2" aria-hidden="true" />
        <header className="pv-hdr">
          <span className="pv-htile" aria-hidden="true"><Ico icon={icon} size={20} /></span>
          <div className="pv-grow"><p className="pv-crumb">{crumb}</p><h2>{title}</h2></div>
        </header>
        <main className="pv-content">
          <ErrorBoundary resetKey={pathname}><BillingGate>{children}</BillingGate></ErrorBoundary>
        </main>
      </div>
      <TabBar active={active} count={count} />
      <TransferAlert />
    </div>
  )
}

// Bits the three pages share.
export const Pill = ({ tone, children }) => <span className={`pv-pill pv-p-${tone}`}>{children}</span>

export const Skel = ({ w, h, style }) => <span className="pv-skel" style={{ width: w, height: h, ...style }} />

// A card that failed on its own: the others keep their data.
export function ErrorCard({ title, text, onRetry }) {
  return (
    <section className="ov-card pv-card pv-empty" role="alert">
      <span className="pv-tile err"><Ico icon={CircleAlert} size={20} /></span>
      <h3>{title}</h3>
      <p className="pv-sub">{text}</p>
      {onRetry && <button type="button" className="ov-ghost pv-btn" onClick={onRetry}>Try again</button>}
    </section>
  )
}
