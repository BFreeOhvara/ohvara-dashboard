import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { Home, PhoneIncoming, Users, CalendarDays, Ellipsis, Bell, MessageSquare, Plus, ChevronLeft, FileUp, UserPlus, PhoneCall, LifeBuoy, StickyNote } from 'lucide-react'
import { useTheme } from '../../hooks/useTheme'
import { useSampleLeads, useSampleNeeds, useSampleThreads, useDataSource } from '../data'
import { useAccount, initials } from '../kit'
import { avatarHue } from '../avatarHue'
import { liveCalls } from '../agentView'
import { paths } from '../paths'
import { AddClients } from '../AddClients891'
import { OhvaraMark } from '../../components/ui/OhvaraMark'
import { ActionSheet, ActRow } from './Sheet'
import { NeedList } from './bits'
import { mp, titleOf, underMore } from './mpaths'
import '../glass.css'
import '../flow.css'
import '../palette.css'
import '../leads873.css'
import './m.css'
import '@fontsource/urbanist/500.css'
import '@fontsource/urbanist/600.css'
import '@fontsource/urbanist/700.css'

// P908 — the agent side rebuilt for a phone (mockup at /template/m, sample data). Not the desktop squeezed: a top bar
// with the page title, Messages, the bell and you; the page; one + for every "create" within thumb reach; and a
// bottom tab bar (Overview · Leads · Clients · Calendar · More) clear of the notch and the home bar.
const TABS = [
  { to: mp.home(), label: 'Overview', icon: Home, end: true },
  { to: mp.leads(), label: 'Leads', icon: PhoneIncoming, key: 'leads' },
  { to: mp.clients(), label: 'Clients', icon: Users },
  { to: mp.calendar(), label: 'Calendar', icon: CalendarDays },
  { to: mp.more(), label: 'More', icon: Ellipsis, more: true },
]

export default function MobileFrame() {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  useTheme() // applies the saved theme
  const account = useAccount()
  const source = useDataSource()
  const { data: threads } = useSampleThreads()
  const { data: needs } = useSampleNeeds()
  const { data: leads } = useSampleLeads()
  const [panel, setPanel] = useState(null)
  const [scrolled, setScrolled] = useState(false)
  const unread = threads.reduce((n, t) => n + t.unread, 0)
  const waiting = new Set([...needs.now.filter(n => n.kind === 'lead').map(n => n.ref), ...liveCalls(leads).map(l => l.id)]).size
  const bell = needs.now.length + (needs.notices?.length || 0)
  const title = titleOf(pathname)
  const back = underMore(pathname)
  const close = () => setPanel(null)

  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 8)
    on()
    window.addEventListener('scroll', on, { passive: true })
    return () => window.removeEventListener('scroll', on)
  }, [])
  useEffect(() => { window.scrollTo(0, 0) }, [title])

  return (
    <div className="tp fx mx">
      <div className="tp-sky" aria-hidden="true" />
      <header className={`mx-top${scrolled ? ' is-scrolled' : ''}`}>
        {back
          ? <Link to={mp.more()} className="mx-ib mx-back" aria-label="Back to More"><ChevronLeft size={24} aria-hidden="true" /></Link>
          : <Link to={mp.home()} className="mx-brand" aria-label="Ohvara home"><OhvaraMark height={26} back="var(--ov-mark-back)" front="var(--ov-mark-front)" /></Link>}
        <b className={`mx-top-t${scrolled || back ? ' is-on' : ''}`}>{title}</b>
        <Link to={paths.messages()} className="mx-ib" aria-label={`Messages${unread ? `, ${unread} unread` : ''}`}><MessageSquare size={21} aria-hidden="true" />{unread > 0 && <span className="mx-badge">{unread}</span>}</Link>
        <button type="button" className="mx-ib" aria-label={`Notifications${bell ? `, ${bell}` : ''}`} onClick={() => setPanel('bell')}><Bell size={21} aria-hidden="true" />{bell > 0 && <span className="mx-badge">{bell}</span>}</button>
        <Link to={mp.more()} className={`mx-me av-${avatarHue(account.name)}`} aria-label={`Your account, ${account.name}`}>{initials(account.name).toUpperCase()}</Link>
      </header>
      {!back && <h1 className="mx-title">{title}</h1>}

      <main className="mx-main">
        <Outlet />
        {source === 'sample' && <p className="mx-foot">Phone mockup · sample info. Changes reset when you reload.</p>}
      </main>

      <button type="button" className="mx-fab" aria-label="Create" aria-haspopup="dialog" onClick={() => setPanel('create')}><Plus size={26} aria-hidden="true" /></button>

      <nav className="mx-tabs" aria-label="Pages">
        {TABS.map(t => (
          <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => `mx-tab${isActive || (t.more && back) ? ' active' : ''}`}>
            <span className="mx-tab-ic"><t.icon size={22} aria-hidden="true" />{t.key === 'leads' && waiting > 0 && <span className="mx-badge" aria-label={`${waiting} waiting on you`}>{waiting}</span>}</span>
            {t.label}
          </NavLink>
        ))}
      </nav>

      <ActionSheet open={panel === 'create'} onClose={close} title="Create">
        <ActRow icon={FileUp} label="Submit a policy" sub="Our team takes it from there" onClick={() => { close(); navigate(paths.submit()) }} />
        <ActRow icon={UserPlus} label="Add clients" sub="Clients you already have" onClick={() => setPanel('add')} />
        <ActRow icon={PhoneCall} label="Book a call" sub="An appointment or a client call" onClick={() => { close(); navigate(mp.calendar()) }} />
        <ActRow icon={StickyNote} label="Add a note" sub="On a lead or a client" onClick={() => { close(); navigate(mp.leads()) }} />
        <ActRow icon={LifeBuoy} label="Request a service" sub="A change for one of your clients" onClick={() => { close(); navigate(paths.requestService()) }} />
      </ActionSheet>
      <ActionSheet open={panel === 'bell'} onClose={close} title="Your to-dos" sub={bell ? `${bell} waiting on you` : 'Nothing waiting on you'}>
        <NeedList items={[...needs.now, ...(needs.notices || [])]} onDone={close} />
      </ActionSheet>
      <AddClients open={panel === 'add'} onClose={close} />
    </div>
  )
}
