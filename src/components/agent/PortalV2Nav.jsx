import { Link } from 'react-router-dom'
import { Sun, Inbox, Settings, CalendarDays, Users, CreditCard, CircleAlert } from 'lucide-react'
import { OhvaraMark } from '../ui/OhvaraMark'
import '../../pages/agent/v2/portalV2.css'

// Bits the v2 pages share. The v2 pages now render inside the old DashboardLayout (portal parity
// answer 0), so PortalV2Layout below is a pass-through. The v2 shell's own Sidebar and TabBar are
// kept, unused, until the v2 code is retired. Mockups:
// ohvara/mockups/build-v2-portal-shell-today-inbounds-inb.html and
// ohvara/mockups/build-calendar-clients-and-plan-billing-.html.
const initials = name => (name || '').trim().split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase()).join('') || 'A'

export const Ico = ({ icon: Icon, size = 18 }) => <Icon size={size} strokeWidth={2} className="pv-i" aria-hidden="true" />

// Unused since the v2 pages moved into DashboardLayout (kept until the v2 code is retired).
// eslint-disable-next-line no-unused-vars
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
      {link('inbounds', '/agent/inbounds', Inbox, 'Leads', count)}
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

// Unused since the v2 pages moved into DashboardLayout (kept until the v2 code is retired).
// eslint-disable-next-line no-unused-vars
function TabBar({ active, count }) {
  const tab = (key, to, icon, label, badge) => (
    <Link to={to} className={active === key ? 'on' : undefined} aria-current={active === key ? 'page' : undefined}>
      <Ico icon={icon} size={22} />{label}{badge > 0 && <span className="pv-tb-badge tab" aria-hidden="true">{badge}</span>}
    </Link>
  )
  return (
    <nav className="pv-tabbar" aria-label="Main menu">
      {tab('today', '/agent', Sun, 'Today')}
      {tab('inbounds', '/agent/inbounds', Inbox, 'Leads', count)}
      {tab('calendar', '/agent/calendar', CalendarDays, 'Calendar')}
      {tab('clients', '/agent/clients', Users, 'Clients')}
      {tab('plan', '/agent/plan', CreditCard, 'Plan')}
      {tab('settings', '/settings', Settings, 'Settings')}
    </nav>
  )
}

// Pass-through: the page renders inside DashboardLayout (sidebar or PhoneShell, header, bell, search,
// BillingGate, the transfer alert). The props the pages still pass are ignored. .pv scopes the v2
// type rules (portalV2.css) and .pv-flow spaces the page's sections.
export function PortalV2Layout({ children }) {
  return <div className="pv pv-flow">{children}</div>
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
