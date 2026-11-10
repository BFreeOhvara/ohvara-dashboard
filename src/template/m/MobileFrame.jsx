import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { Home, PhoneIncoming, Users, CalendarDays, Ellipsis, Bell, MessageSquare, Plus, ChevronLeft, FileUp, UserPlus, PhoneCall, StickyNote, Search, Info } from 'lucide-react'
import { useTheme } from '../../hooks/useTheme'
import { useIsTestAccount } from '../../hooks/useIsTestAccount'
import { useSampleLeads, useSampleNeeds, useSampleThreads, useDataSource, useDataStatus } from '../data'
import { useAccount, initials } from '../kit'
import { avatarHue } from '../avatarHue'
import { liveCalls } from '../agentView'
import { paths, layoutOf } from '../paths'
import { AddClients } from '../AddClients891'
import { BookCall, AddNote } from '../TemplateFrame'
import { DataLoading, DataError } from '../DataState'
import Palette from '../Palette'
import { OhvaraMark } from '../../components/ui/OhvaraMark'
import { ActionSheet, ActRow } from './Sheet'
import { NeedList } from './bits'
import { mp, titleOf, isSub } from './mpaths'
import '../glass.css'
import '../flow.css'
import '../palette.css'
import '../leads873.css'
import '../fit867.css'
import './m.css'
import '@fontsource/urbanist/500.css'
import '@fontsource/urbanist/600.css'
import '@fontsource/urbanist/700.css'

// P908 — the agent side on a phone (below 768 px): a top bar with the page title, search, Messages, the bell and
// you; the page; one + for everything you create, in thumb reach; and a bottom tab bar (Overview · Leads · Clients ·
// Calendar · More) clear of the notch and the home bar. Pages with no tab (Billing, Settings, …) get a back arrow.
const TABS = [
  { to: mp.home, label: 'Overview', icon: Home, end: true },
  { to: mp.leads, label: 'Leads', icon: PhoneIncoming, key: 'leads' },
  { to: mp.clients, label: 'Clients', icon: Users },
  { to: mp.calendar, label: 'Calendar', icon: CalendarDays },
  { to: mp.more, label: 'More', icon: Ellipsis, more: true },
]
const PAGES = [
  { to: paths.home, label: 'Overview' }, { to: paths.leads, label: 'Leads' }, { to: paths.clients, label: 'Clients' }, { to: paths.calendar, label: 'Calendar' },
  { to: paths.activity, label: 'Activity' }, { to: paths.billing, label: 'Billing' }, { to: paths.messages, label: 'Messages' }, { to: paths.submit, label: 'Submit a policy' },
  { to: paths.settings, label: 'Settings' }, { to: paths.more, label: 'More' },
]

export default function MobileFrame() {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  useTheme() // applies the saved theme
  const account = useAccount()
  const source = useDataSource()
  const isTest = useIsTestAccount() // P929: no sample line on test accounts
  const status = useDataStatus()
  const { data: threads } = useSampleThreads()
  const { data: needs } = useSampleNeeds()
  const { data: leads } = useSampleLeads()
  const [panel, setPanel] = useState(null)
  const [scrolled, setScrolled] = useState(false)
  const unread = threads.reduce((n, t) => n + t.unread, 0)
  const waiting = new Set([...needs.now.filter(n => n.kind === 'lead').map(n => n.ref), ...liveCalls(leads).map(l => l.id)]).size
  const bell = needs.now.length + (needs.notices?.length || 0)
  const layout = layoutOf(pathname)
  const title = titleOf(pathname)
  const sub = isSub(pathname)
  const close = () => setPanel(null)
  const pick = which => () => setPanel(which)
  const back = () => (window.history.state?.idx > 0 ? navigate(-1) : navigate(mp.more()))

  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 8)
    on()
    window.addEventListener('scroll', on, { passive: true })
    return () => window.removeEventListener('scroll', on)
  }, [])
  useEffect(() => { window.scrollTo(0, 0) }, [layout])

  return (
    <div className={`tp fx mx is-${layout}${sub ? ' is-sub' : ''}`}>
      <div className="tp-sky" aria-hidden="true" />
      <header className={`mx-top${scrolled ? ' is-scrolled' : ''}`}>
        {sub
          ? <button type="button" className="mx-ib mx-back" aria-label="Back" onClick={back}><ChevronLeft size={24} aria-hidden="true" /></button>
          : <Link to={mp.home()} className="mx-brand" aria-label="Ohvara home"><OhvaraMark height={26} back="var(--ov-mark-back)" front="var(--ov-mark-front)" /></Link>}
        <b className={`mx-top-t${scrolled || sub ? ' is-on' : ''}`}>{title}</b>
        <button type="button" className="mx-ib" aria-label="Search" onClick={pick('search')}><Search size={21} aria-hidden="true" /></button>
        <Link to={paths.messages()} className="mx-ib" aria-label={`Messages${unread ? `, ${unread} unread` : ''}`}><MessageSquare size={21} aria-hidden="true" />{unread > 0 && <span className="mx-badge">{unread}</span>}</Link>
        <button type="button" className="mx-ib" aria-label={`Your to-dos${bell ? `, ${bell}` : ''}`} onClick={pick('bell')}><Bell size={21} aria-hidden="true" />{bell > 0 && <span className="mx-badge">{bell}</span>}</button>
        <Link to={mp.more()} className={`mx-me av-${avatarHue(account.name)}`} aria-label={`Your account, ${account.name}`}>{initials(account.name).toUpperCase()}</Link>
      </header>
      {!sub && <h1 className="mx-title">{title}</h1>}

      <main className="mx-main">
        {status.error ? <DataError onRetry={status.retry} /> : status.loading ? <DataLoading /> : <Outlet />}
        {!isTest && source === 'sample' && <p className="mx-foot">Sample info. Changes reset when you reload.</p>}
      </main>

      <button type="button" className="mx-fab" aria-label="Create" aria-haspopup="dialog" onClick={pick('create')}><Plus size={26} aria-hidden="true" /></button>

      <nav className="mx-tabs" aria-label="Pages">
        {TABS.map(t => (
          <NavLink key={t.label} to={t.to()} end={t.end} className={({ isActive }) => `mx-tab${(isActive && !(t.end && sub)) || (t.more && sub) ? ' active' : ''}`}>
            <span className="mx-tab-ic"><t.icon size={22} aria-hidden="true" />{t.key === 'leads' && waiting > 0 && <span className="mx-badge" aria-label={`${waiting} waiting on you`}>{waiting}</span>}</span>
            {t.label}
          </NavLink>
        ))}
      </nav>

      <ActionSheet open={panel === 'create'} onClose={close} title="Create">
        <ActRow icon={FileUp} label="Submit a policy" sub="A sale for servicing. Our team takes it from there" onClick={() => { close(); navigate(paths.submit()) }} />
        <ActRow icon={UserPlus} label="Add clients" sub="Clients you already have" onClick={pick('add')} />
        <ActRow icon={PhoneCall} label="Book a call" sub="Puts it on your calendar" onClick={pick('book')} />
        <ActRow icon={StickyNote} label="Add a note to a client" sub="Shows on their page" onClick={pick('note')} />
      </ActionSheet>
      <ActionSheet open={panel === 'bell'} onClose={close} title="Your to-dos" sub={bell ? `${bell} waiting on you` : 'Nothing waiting on you'}>
        <NeedList items={[...needs.now, ...(needs.notices || [])]} onDone={close} />
        {needs.fyi?.length > 0 && <>
          <p className="mx-act-sec"><Info size={15} aria-hidden="true" />For your info</p>
          <ul className="mx-rows">{needs.fyi.map(f => <li key={f.id}><Link to={mp.lead(f.ref)} className="mx-row is-link" onClick={close}><span className="tp-grow"><b>{f.name}</b><small>{f.title}. {f.what}</small></span></Link></li>)}</ul>
        </>}
      </ActionSheet>
      {panel === 'search' && <Palette onClose={close} pages={PAGES} />}
      <AddClients open={panel === 'add'} onClose={close} />
      <BookCall open={panel === 'book'} onClose={close} />
      <AddNote open={panel === 'note'} onClose={close} />
    </div>
  )
}
