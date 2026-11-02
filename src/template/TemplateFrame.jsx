import { useMemo, useRef, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import {
  Home, Inbox, CalendarDays, Users, CalendarPlus, MessageSquare, History, CreditCard, Settings, Search, Bell, Menu, Plus,
  Sun, Moon, ShieldCheck, Ellipsis, ChevronRight,
} from 'lucide-react'
import { useTheme } from '../hooks/useTheme'
import { useStretchPill } from '../hooks/useStretchPill'
import { useSampleActivity, useSampleClients, useSampleLeads, useSampleThreads, useSampleBilling } from './data'
import { Drawer, Avatar } from './kit'

// The one layout: floating top pill bar with 7 tabs, a slim left rail, the header, and on phones the bottom bar.
const TABS = [
  { to: '/', key: 'overview', label: 'Overview', icon: Home },
  { to: '/leads', key: 'leads', label: 'Leads', icon: Inbox },
  { to: '/calendar', key: 'calendar', label: 'Calendar', icon: CalendarDays },
  { to: '/clients', key: 'clients', label: 'Clients', icon: Users },
  { to: '/submit', key: 'submit', label: 'Submit', icon: CalendarPlus },
  { to: '/messages', key: 'messages', label: 'Messages', icon: MessageSquare },
  { to: '/activity', key: 'activity', label: 'Activity', icon: History },
]
const BAR = [
  { to: '/', key: 'overview', label: 'Home', icon: Home },
  { to: '/clients', key: 'clients', label: 'Clients', icon: Users },
  { to: '/submit', key: 'submit', label: 'Submit', icon: Plus, plus: true },
  { to: '/messages', key: 'messages', label: 'Messages', icon: MessageSquare },
  { to: '/more', key: 'more', label: 'More', icon: Menu },
]
const TITLES = {
  '/': ['Today', 'Overview'], '/leads': ['Leads', 'Leads'], '/calendar': ['Leads', 'Calendar'], '/clients': ['Servicing', 'Clients'],
  '/submit': ['Servicing', 'Submit'], '/request-service': ['Servicing', 'Request a service'], '/messages': ['Communications', 'Messages'],
  '/activity': ['Today', 'Activity'], '/billing': ['Account', 'Billing'], '/settings': ['Account', 'Settings'], '/more': ['Account', 'More'],
}

function tabOf(path) {
  if (path === '/') return 'overview'
  if (path.startsWith('/leads')) return 'leads'
  if (path.startsWith('/clients')) return 'clients'
  if (path === '/request-service') return 'submit'
  if (path === '/more' || path === '/billing' || path === '/settings') return path === '/more' ? 'more' : null
  return path.slice(1)
}

function titleOf(path) {
  if (TITLES[path]) return TITLES[path]
  if (path.startsWith('/leads/')) return ['Leads', 'Lead']
  if (path.startsWith('/clients/')) return ['Servicing', 'Client']
  return ['Today', 'Overview']
}

function SearchDrawer({ open, onClose }) {
  const [q, setQ] = useState('')
  const { data: clients } = useSampleClients()
  const { data: leads } = useSampleLeads()
  const rows = useMemo(() => {
    const all = [
      ...clients.map(c => ({ to: `/clients/${c.id}`, name: `${c.client_first_name} ${c.client_last_name}`, sub: `Client, ${c.client_phone}` })),
      ...leads.map(l => ({ to: `/leads/${l.id}`, name: `${l.first_name} ${l.last_name}`, sub: `Lead, ${l.phone}` })),
      ...TABS.map(t => ({ to: t.to, name: t.label, sub: 'Page' })),
    ]
    const n = q.trim().toLowerCase()
    return (n ? all.filter(r => `${r.name} ${r.sub}`.toLowerCase().includes(n)) : all.slice(0, 8)).slice(0, 10)
  }, [q, clients, leads])
  return (
    <Drawer open={open} onClose={onClose} title="Search" sub="Clients, leads and pages">
      <input className="tp-input" autoFocus placeholder="Search clients, leads, pages…" aria-label="Search" value={q} onChange={e => setQ(e.target.value)} />
      <ul className="tp-list">
        {rows.map(r => (
          <li key={r.to + r.name}><Link className="tp-li" to={r.to} onClick={onClose}><Avatar name={r.name} /><span className="tp-grow"><b>{r.name}</b><small>{r.sub}</small></span><ChevronRight size={16} aria-hidden="true" /></Link></li>
        ))}
        {rows.length === 0 && <li className="tp-li"><span className="tp-sub">No match. Check the spelling, or search by phone number.</span></li>}
      </ul>
    </Drawer>
  )
}

function BellDrawer({ open, onClose }) {
  const { data: items } = useSampleActivity()
  return (
    <Drawer open={open} onClose={onClose} title="Notifications" sub="What happened lately" footer={<Link to="/activity" className="tp-btn ov-ghost" onClick={onClose}>See all activity</Link>}>
      <ul className="tp-list">
        {items.slice(0, 5).map(a => <li key={a.id} className="tp-li"><Avatar name={a.who} /><span className="tp-grow"><b>{a.who}</b><small>{a.text}</small></span><small>{a.at}</small></li>)}
      </ul>
    </Drawer>
  )
}

function MenuDrawer({ open, onClose, theme, setTheme }) {
  const links = [['/billing', 'Billing', CreditCard], ['/settings', 'Settings', Settings], ['/more', 'More', Ellipsis], ['/request-service', 'Request a service', CalendarPlus], ['/signup', 'Sign-up preview', ShieldCheck], ['/welcome', 'Welcome preview', Home]]
  return (
    <Drawer open={open} onClose={onClose} title="Menu" sub="Template with sample info">
      <ul className="tp-list">
        {links.map(([to, label, Icon]) => <li key={to}><Link className="tp-li" to={to} onClick={onClose}><Icon size={18} aria-hidden="true" /><b className="tp-grow">{label}</b><ChevronRight size={16} aria-hidden="true" /></Link></li>)}
        <li><button type="button" className="tp-li" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? <Sun size={18} aria-hidden="true" /> : <Moon size={18} aria-hidden="true" />}<b className="tp-grow">{theme === 'dark' ? 'Switch to light' : 'Switch to dark'}</b></button></li>
      </ul>
    </Drawer>
  )
}

export default function TemplateFrame() {
  const { pathname } = useLocation()
  const [theme, setTheme] = useTheme()
  const [panel, setPanel] = useState(null)
  const tabsRef = useRef(null)
  const active = tabOf(pathname)
  const [group, name] = titleOf(pathname)
  const { data: threads } = useSampleThreads()
  const { data: leads } = useSampleLeads()
  const { data: billing } = useSampleBilling()
  const unread = threads.reduce((n, t) => n + t.unread, 0)
  const needs = leads.filter(l => ['ringing', 'missed', 'no_show'].includes(l.stage)).length
  const close = () => setPanel(null)
  useStretchPill(tabsRef, { activeKey: active, selector: 'a.is-on', persistKey: 'tpl-tabs' })
  const { used, cap } = billing.submissions
  const NameIcon = (TABS.find(t => t.key === active) || { icon: Home }).icon

  return (
    <div className="tp tp-app">
      <aside className="tp-rail" aria-label="Account">
        <Link to="/" className="tp-logo" aria-label="Ohvara home">O</Link>
        <NavLink to="/billing" className="tp-ri"><CreditCard size={20} aria-hidden="true" />Billing</NavLink>
        <NavLink to="/settings" className="tp-ri"><Settings size={20} aria-hidden="true" />Settings</NavLink>
        <i className="tp-hair" />
        <button type="button" className="tp-ri" onClick={() => setPanel('search')}><Search size={20} aria-hidden="true" />Search</button>
        <Link to="/submit" className="tp-plus" aria-label="Submit a sale"><Plus size={22} /></Link>
        <Link to="/billing" className="tp-week" aria-label={`This week ${used} of ${cap} submissions`}>
          <small>This week</small><b>{used}</b><span>of {cap}</span>
          <em>{Array.from({ length: 5 }, (_, i) => <i key={i} className={i < Math.round((used / cap) * 5) ? 'on' : ''} />)}</em>
          <small>Resets Mon</small>
        </Link>
        <Link to="/settings" className="tp-me" aria-label="Your profile">DW</Link>
      </aside>

      <div className="tp-col">
        <div className="tp-top">
          <div className="tp-tabs ov-card" ref={tabsRef} role="navigation" aria-label="Pages">
            {TABS.map(t => (
              <Link key={t.key} to={t.to} className={`tp-tab${active === t.key ? ' is-on' : ''}`} aria-current={active === t.key ? 'page' : undefined}>
                <t.icon size={16} strokeWidth={2} aria-hidden="true" />{t.label}
                {t.key === 'leads' && needs > 0 && <span className="tp-tb">{needs}</span>}
                {t.key === 'messages' && unread > 0 && <span className="tp-tb is-msg">{unread}</span>}
              </Link>
            ))}
          </div>
          <button type="button" className="tp-search ov-card" onClick={() => setPanel('search')}><Search size={18} aria-hidden="true" /><span>Search clients, leads, pages…</span><kbd>Ctrl K</kbd></button>
          <button type="button" className="tp-ub ov-card" aria-label="Notifications" onClick={() => setPanel('bell')}><Bell size={20} /><span className="tp-count">3</span></button>
          <Link to="/messages" className="tp-ub ov-card" aria-label="Messages"><MessageSquare size={20} />{unread > 0 && <span className="tp-count">{unread}</span>}</Link>
          <button type="button" className="tp-ub ov-card" aria-label="Menu" onClick={() => setPanel('menu')}><Menu size={20} /></button>
        </div>

        <header className="tp-phone-top">
          <span className="tp-date"><i />Mon, Nov 2</span>
          <span className="tp-grow" />
          <button type="button" className="tp-icbtn" aria-label="Search" onClick={() => setPanel('search')}><Search size={20} /></button>
          <button type="button" className="tp-icbtn" aria-label="Notifications" onClick={() => setPanel('bell')}><Bell size={20} /><span className="tp-count">3</span></button>
          <button type="button" className="tp-icbtn" aria-label="Menu" onClick={() => setPanel('menu')}><Menu size={20} /></button>
        </header>

        <div className="tp-title">
          <span className="tp-tile"><NameIcon size={18} aria-hidden="true" /></span>
          <span className="tp-cg">{group}</span>
          <h1 className="tp-cn">{name}</h1>
          <button type="button" className="tp-theme" aria-label="Switch theme" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}</button>
        </div>

        <main className="tp-main page-enter" key={pathname}>
          <Outlet />
          <p className="tp-foot">Template with sample info. Changes reset when you reload.</p>
        </main>
      </div>

      <nav className="tp-bar" aria-label="Pages">
        {BAR.map(b => (
          <Link key={b.key} to={b.to} className={`tp-btab${active === b.key ? ' is-on' : ''}${b.plus ? ' is-plus' : ''}`} aria-current={active === b.key ? 'page' : undefined}>
            <span className={b.plus ? 'tp-bplus' : 'tp-bicon'}><b.icon size={b.plus ? 24 : 22} aria-hidden="true" />{b.key === 'messages' && unread > 0 && <span className="tp-tb is-msg">{unread}</span>}</span>
            {b.label}
          </Link>
        ))}
      </nav>

      <SearchDrawer open={panel === 'search'} onClose={close} />
      <BellDrawer open={panel === 'bell'} onClose={close} />
      <MenuDrawer open={panel === 'menu'} onClose={close} theme={theme} setTheme={setTheme} />
    </div>
  )
}
