import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, NavLink, useLocation, useOutlet } from 'react-router-dom'
import {
  Home, PhoneIncoming, CalendarDays, Users, History, CreditCard, Settings, Search, Bell, Plus, Sun, Moon, MessageSquare,
  PhoneCall, LifeBuoy, Radio, ChevronRight, LogOut, ShieldCheck, Ellipsis, FileUp, TriangleAlert, Wallet, CalendarCheck, Clock3, Send,
} from 'lucide-react'
import { useTheme } from '../hooks/useTheme'
import { useStretchPill } from '../hooks/useStretchPill'
import {
  useSampleActivity, useSampleClients, useSampleLeads, useSampleThreads, useSampleBilling, useSampleAppointments, useSampleSettings, useSampleActions,
} from './data'
import { Drawer, Avatar, Field, useAccount, useNote, initials } from './kit'
import { wig, CountUp, RollTitle, usePageSwap, usd } from './motion'
import { paths, tabOf, titleOfLayout, layoutOf, isTemplateAddress } from './paths'
import Palette from './Palette'
import { isSearchKey } from '../lib/searchKey'
import './glass.css'
import './flow.css'
import './palette.css'
import '@fontsource/urbanist/500.css'
import '@fontsource/urbanist/600.css'
import '@fontsource/urbanist/700.css'

// The shell: glass pill tabs for the pages up top, a floating rail of actions on the left, the big rolling title
// with three headline numbers, and the page. On a phone the rail is a bottom bar. Sample info only.
const TABS = [
  { to: paths.home, key: 'overview', label: 'Overview', icon: Home },
  { to: paths.leads, key: 'leads', label: 'Leads', icon: PhoneIncoming },
  { to: paths.clients, key: 'clients', label: 'Clients', icon: Users },
  { to: paths.calendar, key: 'calendar', label: 'Calendar', icon: CalendarDays },
  { to: paths.activity, key: 'activity', label: 'Activity', icon: History },
  { to: paths.billing, key: 'billing', label: 'Billing', icon: CreditCard },
]
const PAGES = [...TABS, { to: paths.messages, label: 'Messages' }, { to: paths.submit, label: 'Submit a policy' }, { to: paths.requestService, label: 'Request a service' }, { to: paths.settings, label: 'Settings' }, { to: paths.more, label: 'More' }]
const NEEDS = ['ringing', 'missed', 'no_show']

function BellDrawer({ open, onClose }) {
  const { data: items } = useSampleActivity()
  return (
    <Drawer open={open} onClose={onClose} title="Notifications" sub="What happened lately" footer={<Link to={paths.activity()} className="tp-btn ov-ghost" onClick={onClose}>See all activity</Link>}>
      <ul className="tp-list">
        {items.slice(0, 5).map(a => <li key={a.id} className="tp-li"><Avatar name={a.who} /><span className="tp-grow"><b>{a.who}</b><small>{a.text}</small></span><small>{a.at}</small></li>)}
      </ul>
    </Drawer>
  )
}

// Book a call: pick who, the day and the time. Lands on the calendar (sample only).
const DAYS = [['Mon', 2], ['Tue', 3], ['Wed', 4], ['Thu', 5], ['Fri', 6]]
const TIMES = ['9:30 AM', '11:00 AM', '1:00 PM', '2:30 PM', '4:00 PM', '5:30 PM']
function BookCall({ open, onClose }) {
  const { data: clients } = useSampleClients()
  const { data: leads } = useSampleLeads()
  const { bookCall } = useSampleActions()
  const note = useNote()
  const people = useMemo(() => [
    ...clients.map(c => ({ ref: c.id, kind: 'client', who: `${c.client_first_name} ${c.client_last_name}`, label: 'Check-in call' })),
    ...leads.filter(l => !['sold', 'not_interested'].includes(l.stage)).map(l => ({ ref: l.id, kind: 'lead', who: `${l.first_name} ${l.last_name}`, label: 'Appointment' })),
  ], [clients, leads])
  const [ref, setRef] = useState('')
  const [date, setDate] = useState(3)
  const [time, setTime] = useState(TIMES[1])
  if (!open) return null
  const who = people.find(p => p.ref === ref) || people[0]
  const save = () => {
    const day = DAYS.find(d => d[1] === date)[0]
    bookCall({ ...who, day, date, time })
    note(`${who.label} with ${who.who} booked for ${day} at ${time}`)
    onClose()
  }
  return (
    <Drawer open center onClose={onClose} title="Book a call" sub="It goes on your calendar. Times are your time."
      footer={<><button type="button" className="tp-primary fx-accent" onClick={save}><CalendarCheck size={16} />Book it</button><button type="button" className="tp-btn ov-ghost" onClick={onClose}>Cancel</button></>}>
      <Field label="Who"><select value={who.ref} onChange={e => setRef(e.target.value)}>{people.map(p => <option key={p.ref} value={p.ref}>{p.who} · {p.kind === 'lead' ? 'Lead' : 'Client'}</option>)}</select></Field>
      <div className="tp-field"><span>Day</span>
        <div className="fx-chips" role="radiogroup" aria-label="Day">{DAYS.map(([d, n]) => <button key={d} type="button" role="radio" aria-checked={date === n} className={`fx-chip${date === n ? ' is-on' : ''}`} onClick={() => setDate(n)}><small>{d}</small><b>{n}</b></button>)}</div>
      </div>
      <Field label="Time"><select value={time} onChange={e => setTime(e.target.value)}>{TIMES.map(t => <option key={t}>{t}</option>)}</select></Field>
    </Drawer>
  )
}

// The avatar menu: account pages, the Active switch, theme, sign out.
function AccountMenu({ open, onClose, theme, setTheme, duty, setDuty }) {
  const account = useAccount()
  const note = useNote()
  useEffect(() => {
    if (!open) return undefined
    const onKey = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open) return null
  const links = [[paths.billing, 'Billing', CreditCard], [paths.settings, 'Settings', Settings], [paths.requestService, 'Request a service', LifeBuoy], [paths.more, 'More', Ellipsis]]
  if (isTemplateAddress()) links.push([paths.signup, 'Sign-up preview', ShieldCheck], [paths.welcome, 'Welcome preview', Home])
  return (
    <div className="tp fx-layer fx-menu-layer" role="presentation">
      <button type="button" className="fx-scrim is-clear tp-bare" aria-label="Close menu" tabIndex={-1} onClick={onClose} />
      <section className="fx-menu" role="dialog" aria-label="Your account">
        <header className="fx-menu-h"><span className="fx-av">{initials(account.name).toUpperCase()}</span><span className="tp-grow"><b>{account.name}</b><small>Agent</small></span></header>
        <button type="button" className="fx-mrow" role="switch" aria-checked={duty} onClick={() => setDuty(!duty)}>
          <Radio size={17} aria-hidden="true" /><span className="tp-grow"><b>Active for live calls</b><small>{duty ? 'Calls ring your phone' : 'Off. We book callers instead'}</small></span><i className={`fx-sw${duty ? ' on' : ''}`} aria-hidden="true" />
        </button>
        <button type="button" className="fx-mrow" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? <Sun size={17} aria-hidden="true" /> : <Moon size={17} aria-hidden="true" />}<b className="tp-grow">{theme === 'dark' ? 'Light mode' : 'Dark mode'}</b></button>
        <i className="fx-mline" />
        {links.map(([to, label, Icon]) => <Link key={label} to={to()} className="fx-mrow" onClick={onClose}><Icon size={17} aria-hidden="true" /><b className="tp-grow">{label}</b><ChevronRight size={15} aria-hidden="true" /></Link>)}
        <i className="fx-mline" />
        <button type="button" className="fx-mrow" onClick={() => (account.live ? account.signOut() : note('Sign out works once you sign in for real'))}><LogOut size={17} aria-hidden="true" /><b className="tp-grow">Sign out</b></button>
      </section>
    </div>
  )
}

// Three headline numbers beside the title: what an agent checks first on that page.
function useHeadStats(page) {
  const { data: leads } = useSampleLeads()
  const { data: clients } = useSampleClients()
  const { data: billing } = useSampleBilling()
  const { data: threads } = useSampleThreads()
  const { data: events } = useSampleAppointments()
  const { data: activity } = useSampleActivity()
  const spend = billing.leadTypes.filter(t => t.on).reduce((n, t) => n + t.weekly, 0)
  const { used, cap } = billing.submissions
  const needs = leads.filter(l => NEEDS.includes(l.stage)).length
  const by = st => clients.filter(c => c.stage === st).length
  const money = usd()
  const S = (icon, n, label, extra = {}) => ({ icon, n, label, ...extra })
  return {
    overview: [S(Users, clients.length, 'clients in your book', { chip: [`${by('protected')} protected`, 'up'] }), S(PhoneIncoming, needs, 'leads need you', { chip: needs ? ['Act now', 'warn'] : null }), S(FileUp, used, 'submitted this week', { tail: ` / ${cap}`, chip: [`${cap - used} left`, 'blue'] })],
    leads: [S(TriangleAlert, needs, 'need you now', { chip: needs ? ['Act now', 'warn'] : null }), S(CalendarCheck, leads.filter(l => l.stage === 'booked').length, 'booked'), S(Wallet, spend, 'a week on leads', { fmt: money })],
    clients: [S(Users, clients.length, 'clients'), S(TriangleAlert, by('needs_attention'), 'need attention', { chip: by('needs_attention') ? ['See who', 'warn'] : null }), S(ShieldCheck, by('protected'), 'protected', { chip: ['On time', 'up'] })],
    calendar: [S(CalendarDays, events.length, 'this week'), S(Clock3, events.filter(e => e.date === 2).length, 'today'), S(PhoneCall, events.filter(e => /call/i.test(e.label)).length, 'client calls')],
    activity: [S(History, activity.filter(a => a.at.startsWith('Today')).length, 'today'), S(CalendarDays, activity.length, 'this week'), S(MessageSquare, activity.filter(a => a.kind === 'text').length, 'texts sent for you')],
    billing: [S(CreditCard, billing.plan.weekly + spend, 'a week in all', { fmt: money, chip: ['Sample', 'blue'] }), S(ShieldCheck, billing.plan.weekly, 'servicing', { fmt: money }), S(Wallet, spend, 'leads spend', { fmt: money })],
    submit: [S(FileUp, used, 'submitted this week', { tail: ` / ${cap}` }), S(Send, cap - used, 'left this week', { chip: ['Resets Mon', 'blue'] })],
    messages: [S(MessageSquare, threads.reduce((n, t) => n + t.unread, 0), 'unread'), S(Users, threads.length, 'threads')],
  }[page] || []
}

export default function TemplateFrame() {
  const { pathname } = useLocation()
  const outlet = useOutlet()
  const [theme, setTheme] = useTheme()
  const [panel, setPanel] = useState(null)
  const tabsRef = useRef(null)
  const account = useAccount()
  const note = useNote()
  const active = tabOf(pathname)
  const page = usePageSwap(layoutOf(pathname), outlet)
  // The head and the page class follow the page on screen, so they change once the old page has left.
  const layout = page.key
  const title = titleOfLayout(layout)
  const { data: threads } = useSampleThreads()
  const { data: leads } = useSampleLeads()
  const { data: settings } = useSampleSettings()
  const { setDuty } = useSampleActions()
  const stats = useHeadStats(layout)
  const unread = threads.reduce((n, t) => n + t.unread, 0)
  const needs = leads.filter(l => NEEDS.includes(l.stage)).length
  const close = useCallback(() => setPanel(null), [])
  useStretchPill(tabsRef, { activeKey: active, selector: 'a.is-on', persistKey: 'tpl-tabs' })
  const open = which => e => { wig.onClick(e); setPanel(which) }
  const flipTheme = e => { wig.onClick(e); setTheme(theme === 'dark' ? 'light' : 'dark') }
  const duty = settings.duty
  const flipDuty = e => { wig.onClick(e); setDuty(!duty); note(duty ? 'Off for live calls. We book callers on your calendar' : 'Active. Live calls ring your phone') }

  // Ctrl/⌘K opens search from anywhere.
  useEffect(() => {
    const onKey = e => { if (isSearchKey(e)) { e.preventDefault(); setPanel(p => (p === 'search' ? null : 'search')) } }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className={`tp tp-app fx is-${layout}`}>
      <div className="tp-sky" aria-hidden="true"><i /><i /><i /></div>

      <header className="tp-phone-top fx-ptop">
        <Link to={paths.home()} className="fx-brand" aria-label="Ohvara home"><span className="fx-logo">O</span></Link>
        <span className="tp-grow" />
        <Link to={paths.messages()} className="fx-ib tp-wig" aria-label="Messages" {...wig}><MessageSquare size={18} />{unread > 0 && <span className="fx-badge">{unread}</span>}</Link>
        <button type="button" className="fx-ib tp-wig is-bell" aria-label="Notifications" {...wig} onClick={open('bell')}><Bell size={18} /><span className="fx-badge">3</span></button>
        <button type="button" className="fx-me tp-wig" aria-label="Menu" {...wig} onClick={open('menu')}>{initials(account.name).toUpperCase()}</button>
      </header>

      <header className="tp-top fx-top">
        <Link to={paths.home()} className="fx-brand" aria-label="Ohvara home"><span className="fx-logo">O</span><b>ohvara</b></Link>
        <nav className="tp-tabs fx-tabs" ref={tabsRef} aria-label="Pages">
          {TABS.map(t => (
            <Link key={t.key} to={t.to()} className={`tp-tab fx-tab${active === t.key ? ' is-on' : ''}`} aria-current={active === t.key ? 'page' : undefined}>
              {t.label}
              {t.key === 'leads' && needs > 0 && <span className="fx-tb">{needs}</span>}
            </Link>
          ))}
        </nav>
        <div className="fx-tr">
          <Link to={paths.messages()} className="fx-ib tp-wig" aria-label="Messages" {...wig}><MessageSquare size={18} />{unread > 0 && <span className="fx-badge">{unread}</span>}</Link>
          <button type="button" className="fx-ib tp-wig is-bell" aria-label="Notifications" {...wig} onClick={open('bell')}><Bell size={18} /><span className="fx-badge">3</span></button>
          <button type="button" className="tp-me fx-me tp-wig" aria-label={`Your account, ${account.name}`} aria-expanded={panel === 'menu'} {...wig} onClick={open('menu')}>{initials(account.name).toUpperCase()}</button>
        </div>
      </header>

      <aside className="tp-rail fx-rail" aria-label="Actions">
        <button type="button" className="tp-ri fx-ri tp-wig" aria-label="Search (Ctrl K)" data-tip="Search  Ctrl K" {...wig} onClick={open('search')}><Search size={19} /></button>
        <Link to={paths.submit()} className="fx-ri fx-plus tp-wig" aria-label="Submit a policy" data-tip="Submit a policy" {...wig}><Plus size={20} /></Link>
        <button type="button" className="tp-ri fx-ri tp-wig" aria-label="Book a call" data-tip="Book a call" {...wig} onClick={open('book')}><PhoneCall size={18} /></button>
        <NavLink to={paths.requestService()} className="fx-ri tp-wig" aria-label="Request a service" data-tip="Request a service" {...wig}><LifeBuoy size={18} /></NavLink>
        <button type="button" role="switch" aria-checked={duty} className={`fx-ri fx-duty tp-wig${duty ? ' on' : ''}`} aria-label="Active for live calls" data-tip={duty ? 'Active: calls ring you' : 'Off: we book callers'} {...wig} onClick={flipDuty}><Radio size={18} /><i aria-hidden="true" /></button>
        <i className="fx-hair" />
        <NavLink to={paths.settings()} className="fx-ri tp-wig" aria-label="Settings" data-tip="Settings" {...wig}><Settings size={18} /></NavLink>
        <button type="button" className="fx-ri tp-wig" aria-label="Switch theme" data-tip={theme === 'dark' ? 'Light mode' : 'Dark mode'} {...wig} onClick={flipTheme}>{theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}</button>
      </aside>


      <div className="tp-col fx-col">
        <div className={`tp-head fx-head${page.leaving ? ' is-leaving' : ''}`} key={`h-${page.key}`}>
          <RollTitle lines={title} />
          {stats.length > 0 && (
            <ul className="fx-kpis" aria-label={`${title[1]} at a glance`}>
              {stats.map(s => (
                <li key={s.label}>
                  <span className="fx-kpi-ic"><s.icon size={17} aria-hidden="true" /></span>
                  <span className="fx-kpi-t">
                    <b className={s.fmt ? 'tp-money' : 'tp-num'}><CountUp value={s.n} format={s.fmt} />{s.tail && <em>{s.tail}</em>}</b>
                    <span>{s.label}{s.chip && <i className={`fx-delta is-${s.chip[1]}`}>{s.chip[0]}</i>}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <main className={`tp-main fx-main${page.leaving ? ' is-leaving' : ''}`} key={page.key}>
          {page.el}
          <p className="tp-foot">Sample info. Changes reset when you reload.</p>
        </main>
      </div>

      <nav className="tp-bar fx-bar" aria-label="Actions">
        <button type="button" className="fx-btab" aria-label="Search" onClick={open('search')}><Search size={21} aria-hidden="true" />Search</button>
        <button type="button" className="fx-btab" onClick={open('book')}><PhoneCall size={20} aria-hidden="true" />Book</button>
        <Link to={paths.submit()} className="fx-btab is-plus" aria-label="Submit a policy"><span className="fx-bplus"><Plus size={24} aria-hidden="true" /></span>Submit</Link>
        <Link to={paths.requestService()} className="fx-btab"><LifeBuoy size={20} aria-hidden="true" />Request</Link>
        <Link to={paths.settings()} className="fx-btab"><Settings size={20} aria-hidden="true" />Settings</Link>
      </nav>

      {panel === 'search' && <Palette onClose={close} pages={PAGES} />}
      <BellDrawer open={panel === 'bell'} onClose={close} />
      <BookCall open={panel === 'book'} onClose={close} />
      <AccountMenu open={panel === 'menu'} onClose={close} theme={theme} setTheme={setTheme} duty={duty} setDuty={setDuty} />
    </div>
  )
}
