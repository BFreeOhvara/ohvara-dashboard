import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link, NavLink, useLocation, useNavigate, useOutlet } from 'react-router-dom'
import {
  Home, PhoneIncoming, PhoneCall, Users, LifeBuoy, Wallet, Settings, Search, Bell, Sun, Moon, MessageSquare, Radio,
  ChevronRight, LogOut, Ellipsis, CalendarCheck, Clock3, CircleHelp, PhoneOutgoing, Mail, Keyboard, TriangleAlert,
  ShieldCheck, CalendarPlus, CheckCircle2, Hourglass,
} from 'lucide-react'
import { useTheme } from '../../hooks/useTheme'
import { Drawer, Avatar, Field, PillTabs, useAccount, useNote, initials } from '../kit'
import { avatarHue } from '../avatarHue'
import { wig, CountUp, RollTitle, usePageSwap, usd, useExit } from '../motion'
import Palette from '../Palette'
import { OhvaraMark } from '../../components/ui/OhvaraMark'
import { isSearchKey } from '../../lib/searchKey'
import { SUPPORT_EMAIL } from '../../components/auth/authUtils'
import { useFulDay, useFulClients, useFulQueue, useFulFeed, useFulSettings, useFulPay, useFulTasks, useFulActions, useFulAgents } from './data'
import { CALL_WORD } from './words'
import { fp, FUL_TABS, fulPageOf, fulTitleOf } from './paths'
import '../glass.css'
import '../flow.css'
import '../palette.css'
import './ful.css'
import '@fontsource/urbanist/500.css'
import '@fontsource/urbanist/600.css'
import '@fontsource/urbanist/700.css'

// P845 — the Fulfillment (VA) frame, built from the agent shell (TemplateFrame): glass pill tabs up top, the floating
// rail of actions, the rolling title with three headline numbers, the photo backdrop, light and dark. Same pieces
// (kit, motion, Palette, flow.css); VA content. Sample info only (./data), at /template/fulfillment and the real VA URLs.
const ICONS = { overview: Home, queue: PhoneIncoming, calls: PhoneCall, clients: Users, servicing: LifeBuoy, pay: Wallet }
const PAGES = [...FUL_TABS.map(([k, label]) => ({ to: () => fp(k), label })), { to: () => fp('messages'), label: 'Messages' }, { to: () => fp('settings'), label: 'Settings' }]
const money = usd()

function BellDrawer({ open, onClose }) {
  const { data: items } = useFulFeed()
  return (
    <Drawer open={open} onClose={onClose} title="Notifications" sub="What happened lately">
      <ul className="tp-list">
        {items.slice(0, 6).map(a => <li key={a.id} className="tp-li"><Avatar name={a.who} /><span className="tp-grow"><b>{a.who}</b><small>{a.text}</small></span><small>{a.at}</small></li>)}
      </ul>
    </Drawer>
  )
}

// Log a call: the result of a call is saved on the call itself, so this picks one of today's calls and opens it.
function LogCall({ open, onClose }) {
  const { data: day } = useFulDay()
  const navigate = useNavigate()
  if (!open) return null
  const pick = id => { onClose(); navigate(fp('calls', id)) }
  return (
    <Drawer open center onClose={onClose} title="Log a call" sub="Pick the call. Its result is saved on the call.">
      <ul className="tp-list">
        {day.today.map(k => (
          <li key={k.id}>
            <button type="button" className="fx-mrow" onClick={() => pick(k.id)}>
              <Avatar name={k.name} /><span className="tp-grow"><b>{k.name}</b><small>{k.time} · {k.old_carrier}</small></span>
              <span className={`fs-st is-${k.status}`}>{CALL_WORD[k.status]}</span><ChevronRight size={15} aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
    </Drawer>
  )
}

// Book for an agent: someone from the queue, the agent, a day and a time. Lands on the agent's calendar (sample only).
const BOOK_DAYS = [['Thu', 5], ['Fri', 6], ['Mon', 9], ['Tue', 10]]
const BOOK_TIMES = ['10:00 AM', '11:30 AM', '1:00 PM', '2:30 PM', '4:00 PM', '5:30 PM']
export function BookForAgent({ open, onClose, leadId = null }) {
  const { data: queue } = useFulQueue()
  const { data: agents } = useFulAgents()
  const { bookLead } = useFulActions()
  const note = useNote()
  const [ref, setRef] = useState(leadId || '')
  const [agent, setAgent] = useState(agents[0].id)
  const [date, setDate] = useState(5)
  const [time, setTime] = useState(BOOK_TIMES[3])
  if (!open) return null
  const who = queue.find(l => l.id === (leadId || ref)) || queue[0]
  if (!who) {
    return <Drawer open center onClose={onClose} title="Book for an agent" sub="The queue is empty."><p className="fx-calm">No one is waiting to be booked.</p></Drawer>
  }
  const save = () => {
    const when = `${BOOK_DAYS.find(d => d[1] === date)[0]}, Nov ${date}, ${time}`
    const a = agents.find(x => x.id === agent)
    bookLead(who.id, agent, when)
    note(`${who.name} booked with ${a.name}, ${when}`)
    onClose()
  }
  return (
    <Drawer open center onClose={onClose} title="Book for an agent" sub="It goes on the agent's calendar inside their hours."
      footer={<><button type="button" className="tp-primary fx-accent" onClick={save}><CalendarCheck size={16} />Book it</button><button type="button" className="tp-btn ov-ghost" onClick={onClose}>Cancel</button></>}>
      {!leadId && <Field label="Who"><select value={who.id} onChange={e => setRef(e.target.value)}>{queue.map(l => <option key={l.id} value={l.id}>{l.name} · {l.city}, {l.state}</option>)}</select></Field>}
      <div className="tp-field"><span>Agent</span>
        <PillTabs role="radiogroup" label="Agent" className="fx-chips" itemClass="fx-chip fs-agent" value={agent} onChange={setAgent}
          items={agents.map(a => ({ key: a.id, label: <><Avatar name={a.name} /><b>{a.name.split(' ')[0]}</b></> }))} />
        <small className="tp-sub">{agents.find(a => a.id === agent).hours}</small>
      </div>
      <div className="tp-field"><span>Day</span>
        <PillTabs role="radiogroup" label="Day" className="fx-chips" itemClass="fx-chip" value={date} onChange={setDate} items={BOOK_DAYS.map(([d, n]) => ({ key: n, label: <><small>{d}</small><b>{n}</b></> }))} />
      </div>
      <Field label="Time (the agent's time)"><select value={time} onChange={e => setTime(e.target.value)}>{BOOK_TIMES.map(t => <option key={t}>{t}</option>)}</select></Field>
    </Drawer>
  )
}

function Help({ open, onClose }) {
  if (!open) return null
  return (
    <Drawer open center onClose={onClose} title="Help and support" sub="Ask an agent about a client, or the Ohvara team about anything else.">
      <ul className="tp-list">
        <li><Link to={fp('messages')} className="fx-mrow" onClick={onClose}><MessageSquare size={17} aria-hidden="true" /><span className="tp-grow"><b>Message an agent</b><small>About one of their clients</small></span><ChevronRight size={15} aria-hidden="true" /></Link></li>
        <li><a href={`mailto:${SUPPORT_EMAIL}`} className="fx-mrow"><Mail size={17} aria-hidden="true" /><span className="tp-grow"><b>Email support</b><small>{SUPPORT_EMAIL}</small></span><ChevronRight size={15} aria-hidden="true" /></a></li>
        <li className="fx-mrow"><ShieldCheck size={17} aria-hidden="true" /><span className="tp-grow"><b>Coverage or advice questions</b><small>Those go to the client's agent. Use Send to agent on the step.</small></span></li>
        <li className="fx-mrow"><Keyboard size={17} aria-hidden="true" /><span className="tp-grow"><b>Search anything</b><small>Press Ctrl K (Cmd K on a Mac)</small></span></li>
      </ul>
    </Drawer>
  )
}

// The avatar menu: Active or away, theme, account pages, sign out.
function AccountMenu({ open, onClose, theme, setTheme, away, flipAway }) {
  const account = useAccount()
  const note = useNote()
  useEffect(() => {
    if (!open) return undefined
    const onKey = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
  const [shown, leaving] = useExit(open, 200)
  if (!shown) return null
  const links = [['pay', 'Pay', Wallet], ['settings', 'Settings', Settings], ['messages', 'Messages', MessageSquare]]
  return (
    <div className={`tp fx-layer fx-menu-layer${leaving ? ' is-leaving' : ''}`} role="presentation">
      <button type="button" className="fx-scrim is-clear tp-bare" aria-label="Close menu" tabIndex={-1} onClick={onClose} />
      <section className="fx-menu" role="dialog" aria-label="Your account">
        <header className="fx-menu-h"><span className={`fx-av av-${avatarHue(account.name)}`}>{initials(account.name).toUpperCase()}</span><span className="tp-grow"><b>{account.name}</b><small>Fulfillment</small></span></header>
        <button type="button" className="fx-mrow" role="switch" aria-checked={!away} onClick={flipAway}>
          <Radio size={17} aria-hidden="true" /><span className="tp-grow"><b>{away ? 'Away' : 'Active'}</b><small>{away ? 'No new people come to you' : 'New people and callbacks come to you'}</small></span><i className={`fx-sw${away ? '' : ' on'}`} aria-hidden="true" />
        </button>
        <button type="button" className="fx-mrow" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? <Sun size={17} aria-hidden="true" /> : <Moon size={17} aria-hidden="true" />}<b className="tp-grow">{theme === 'dark' ? 'Light mode' : 'Dark mode'}</b></button>
        <i className="fx-mline" />
        {links.map(([k, label, Icon]) => <Link key={k} to={fp(k)} className="fx-mrow" onClick={onClose}><Icon size={17} aria-hidden="true" /><b className="tp-grow">{label}</b><ChevronRight size={15} aria-hidden="true" /></Link>)}
        <i className="fx-mline" />
        <button type="button" className="fx-mrow is-danger" onClick={() => (account.live ? account.signOut() : note('Sign out works once you sign in for real'))}><LogOut size={17} aria-hidden="true" /><b className="tp-grow">Sign out</b></button>
      </section>
    </div>
  )
}

// Three headline numbers beside the title: what a VA checks first on that page.
function useHeadStats(page) {
  const { data: day } = useFulDay()
  const { data: pay } = useFulPay()
  const { data: clients } = useFulClients()
  const { data: agents } = useFulAgents()
  const { data: settings } = useFulSettings()
  const S = (icon, n, label, extra = {}) => ({ icon, n, label, ...extra })
  const todayLeft = day.today.filter(k => k.status === 'booked').length
  const doneToday = day.today.length - todayLeft
  const cb = day.queue.callback_due.length
  const inQueue = cb + day.queue.new.length + day.queue.not_reached.length
  const weekCancelled = day.week.filter(k => k.status === 'cancelled').length
  const att = clients.filter(c => c.stage === 'needs_attention').length
  return {
    overview: [S(PhoneCall, day.today.length, 'calls today', { chip: [`${doneToday} done`, 'up'] }), S(PhoneIncoming, inQueue, 'in your queue', { chip: cb ? [`${cb} callbacks due`, 'warn'] : null }), S(Wallet, pay.earned, 'earned this week', { fmt: money })],
    queue: [S(Clock3, cb, 'callbacks due', { chip: cb ? ['Call first', 'warn'] : null }), S(PhoneIncoming, day.queue.new.length, 'new today'), S(Hourglass, day.queue.not_reached.length, 'not reached yet')],
    calls: [S(PhoneCall, todayLeft, 'left today', { chip: day.next ? [`next ${day.next.time}`, 'blue'] : null }), S(CalendarCheck, day.week.length, 'this week'), S(CheckCircle2, weekCancelled, 'cancelled this week', { chip: ['Confirmed', 'up'] })],
    clients: [S(Users, clients.length, 'clients'), S(ShieldCheck, agents.length, 'agents you serve'), S(TriangleAlert, att, 'need attention', { chip: att ? ['See who', 'warn'] : null })],
    servicing: [S(TriangleAlert, day.tasks.overdue.length, 'overdue', { chip: day.tasks.overdue.length ? ['Do first', 'warn'] : null }), S(LifeBuoy, day.tasks.today.length, 'due today'), S(CheckCircle2, day.tasks.done.length, 'done this week')],
    pay: [S(Wallet, pay.earned, 'earned this week', { fmt: money, chip: [`${money(pay.lastWeek)} last week`, 'blue'] }), S(CheckCircle2, pay.verified, 'verified', { fmt: money }), S(CalendarCheck, pay.rows.length, 'cancellations this week')],
    settings: [S(CalendarCheck, settings.hours.days.length, 'working days'), S(Users, agents.length, 'agents you serve'), S(Bell, settings.notifications.filter(n => n.push).length, 'alerts switched on')],
  }[page] || []
}

export default function FulFrame() {
  const { pathname } = useLocation()
  const outlet = useOutlet()
  const navigate = useNavigate()
  const [theme, setTheme] = useTheme()
  const [panel, setPanel] = useState(null)
  const account = useAccount()
  const note = useNote()
  const active = fulPageOf(pathname)
  const page = usePageSwap(active || 'overview', outlet)
  const layout = page.key
  const title = fulTitleOf(layout)
  const stats = useHeadStats(layout)
  const { data: day } = useFulDay()
  const { data: clients } = useFulClients()
  const { data: queue } = useFulQueue()
  const { data: tasks } = useFulTasks()
  const { setAway } = useFulActions()
  const away = day.away
  const close = useCallback(() => setPanel(null), [])
  const open = which => e => { wig.onClick(e); setPanel(which) }
  const flipTheme = e => { wig.onClick(e); setTheme(theme === 'dark' ? 'light' : 'dark') }
  const flipAway = e => { wig.onClick(e); setAway(!away); note(away ? 'Active. New people and callbacks come to you' : 'Away. No new people come to you') }
  const tabCount = { queue: day.queue.callback_due.length, servicing: day.tasks.overdue.length }
  const callNow = () => { if (day.next) navigate(fp('calls', day.next.id)); else { navigate(fp('calls')); note('No more calls today') } }

  // Search: clients across every agent, the people in the queue, servicing steps, and the pages.
  const rows = useMemo(() => ({
    clients: clients.map(c => ({ id: `c-${c.id}`, name: c.name, sub: `${c.agent}'s client · ${c.carrier_name}`, hay: `${c.name} ${c.client_phone} ${c.agent} ${c.policy_number}`, go: () => fp('clients', c.id) })),
    leads: queue.map(l => ({ id: `l-${l.id}`, name: l.name, sub: `In the queue · ${l.city}, ${l.state}`, hay: `${l.name} ${l.phone} ${l.city}`, go: () => fp('queue', l.id) })),
    policies: tasks.filter(t => t.due !== 'done').map(t => ({ id: `t-${t.id}`, name: t.name, sub: `Servicing · ${t.due_text}`, hay: `${t.name} ${t.kind.replace(/_/g, ' ')} servicing`, go: () => fp('servicing', t.id) })),
  }), [clients, queue, tasks])

  const appRef = useRef(null)
  useLayoutEffect(() => {
    const el = appRef.current
    if (!el) return undefined
    const raf = requestAnimationFrame(() => el.classList.add('is-anim'))
    const onVis = () => { if (document.hidden) el.classList.remove('is-anim') }
    document.addEventListener('visibilitychange', onVis)
    return () => { cancelAnimationFrame(raf); document.removeEventListener('visibilitychange', onVis) }
  }, [layout])

  useEffect(() => {
    const onKey = e => { if (isSearchKey(e)) { e.preventDefault(); setPanel(p => (p === 'search' ? null : 'search')) } }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const tops = (
    <>
      <Link to={fp('messages')} className="fx-ib tp-wig" aria-label="Messages" {...wig}><MessageSquare size={18} />{day.unread > 0 && <span className="fx-badge">{day.unread}</span>}</Link>
      <button type="button" className="fx-ib tp-wig is-bell" aria-label="Notifications" {...wig} onClick={open('bell')}><Bell size={18} /><span className="fx-badge">3</span></button>
    </>
  )

  return (
    <div className={`tp tp-app fx fs is-${layout}`} ref={appRef}>
      <div className="tp-sky" aria-hidden="true"><i /><i /><i /></div>

      <header className="tp-phone-top fx-ptop">
        <Link to={fp('overview')} className="fx-brand" aria-label="Ohvara home"><OhvaraMark height={28} back="var(--ov-mark-back)" front="var(--ov-mark-front)" className="fx-mark" /></Link>
        <span className="tp-grow" />
        {tops}
        <button type="button" className={`fx-me tp-wig av-${avatarHue(account.name)}`} aria-label="Menu" {...wig} onClick={open('menu')}>{initials(account.name).toUpperCase()}</button>
      </header>

      <Link to={fp('overview')} className="fx-brand fx-brand-page" aria-label="Ohvara home"><OhvaraMark height={30} back="var(--ov-mark-back)" front="var(--ov-mark-front)" className="fx-mark" /><b>ohvara</b></Link>
      <header className="tp-top fx-top">
        <span className="fx-top-gap" aria-hidden="true" />
        <PillTabs as="nav" label="Pages" className="tp-tabs fx-tabs" itemClass="tp-tab fx-tab" value={FUL_TABS.some(([k]) => k === active) ? active : null} persistKey="ful-tabs"
          items={FUL_TABS.map(([k, label]) => ({ key: k, to: fp(k), label, extra: tabCount[k] > 0 ? <span className="fx-tb">{tabCount[k]}</span> : null }))} />
        <div className="fx-tr">
          {tops}
          <button type="button" className={`tp-me fx-me tp-wig av-${avatarHue(account.name)}`} aria-label={`Your account, ${account.name}`} aria-expanded={panel === 'menu'} {...wig} onClick={open('menu')}>{initials(account.name).toUpperCase()}</button>
        </div>
      </header>

      <aside className="tp-rail fx-rail" aria-label="Actions">
        <button type="button" className="tp-ri fx-ri tp-wig" aria-label="Search (Ctrl K)" data-tip="Search  Ctrl K" {...wig} onClick={open('search')}><Search size={20} /></button>
        <i className="fx-hair" />
        <button type="button" className="fx-ri tp-wig" aria-label="Your next call" data-tip={day.next ? `Next call ${day.next.time}` : 'No more calls today'} {...wig} onClick={e => { wig.onClick(e); callNow() }}><PhoneCall size={18} /></button>
        <button type="button" className="fx-ri tp-wig" aria-label="Log a call" data-tip="Log a call" {...wig} onClick={open('log')}><PhoneOutgoing size={18} /></button>
        <button type="button" className="fx-ri tp-wig" aria-label="Book for an agent" data-tip="Book for an agent" {...wig} onClick={open('book')}><CalendarPlus size={18} /></button>
        <i className="fx-hair" />
        <NavLink to={fp('messages')} className="fx-ri tp-wig" aria-label="Messages" data-tip="Messages" {...wig}><MessageSquare size={18} />{day.unread > 0 && <span className="fx-badge">{day.unread}</span>}</NavLink>
        <NavLink to={fp('servicing')} className="fx-ri tp-wig" aria-label="Servicing" data-tip="Servicing" {...wig}><LifeBuoy size={18} /></NavLink>
        <i className="fx-hair" />
        <button type="button" role="switch" aria-checked={!away} className={`fx-ri fx-duty tp-wig${away ? '' : ' on'}`} aria-label="Active or away" data-tip={away ? 'Away: no new people' : 'Active: people come to you'} {...wig} onClick={flipAway}><Radio size={18} /><i aria-hidden="true" /></button>
        <i className="fx-hair" />
        <button type="button" className="fx-ri tp-wig" aria-label="Help and support" aria-expanded={panel === 'help'} data-tip="Help and support" {...wig} onClick={open('help')}><CircleHelp size={18} /></button>
        <NavLink to={fp('settings')} className="fx-ri tp-wig" aria-label="Settings" data-tip="Settings" {...wig}><Settings size={18} /></NavLink>
        <button type="button" className="fx-ri tp-wig" aria-label="Switch theme" data-tip={theme === 'dark' ? 'Light mode' : 'Dark mode'} {...wig} onClick={flipTheme}>{theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}</button>
      </aside>

      <div className="tp-col fx-col">
        <div className={`tp-head fx-head${page.leaving ? ' is-leaving' : ''}${layout === 'messages' ? ' is-quiet' : ''}`} key={`h-${page.key}`}>
          <RollTitle lines={title} />
          {stats.length > 0 && layout !== 'messages' && (
            <ul className="fx-kpis" aria-label={`${title[1]} at a glance`}>
              {stats.map(s => (
                <li key={s.label}>
                  <span className="fx-kpi-ic"><s.icon size={17} aria-hidden="true" /></span>
                  <span className="fx-kpi-t">
                    <b className={s.fmt ? 'tp-money' : 'tp-num'}><CountUp value={s.n} format={s.fmt} /></b>
                    <span>{s.label}{s.chip && <i className={`fx-delta is-${s.chip[1]}`}>{s.chip[0]}</i>}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <main className={`tp-main fx-main fs-main${page.leaving ? ' is-leaving' : ''}`} key={page.key}>
          {page.el}
          <p className="tp-foot">Sample info. Changes reset when you reload.</p>
        </main>
      </div>

      <nav className="tp-bar fx-bar" aria-label="Pages">
        {['overview', 'queue'].map(k => { const I = ICONS[k]; return <Link key={k} to={fp(k)} className={`fx-btab${active === k ? ' is-on' : ''}`}><I size={20} aria-hidden="true" />{k === 'overview' ? 'Overview' : 'Queue'}</Link> })}
        <button type="button" className="fx-btab is-plus" aria-label="Your next call" onClick={callNow}><span className="fx-bplus"><PhoneCall size={22} aria-hidden="true" /></span>Call</button>
        <Link to={fp('servicing')} className={`fx-btab${active === 'servicing' ? ' is-on' : ''}`}><LifeBuoy size={20} aria-hidden="true" />Servicing</Link>
        <button type="button" className="fx-btab" aria-label="More" onClick={open('menu')}><Ellipsis size={20} aria-hidden="true" />More</button>
      </nav>

      {panel === 'search' && <Palette onClose={close} pages={PAGES} rows={rows} placeholder="Search clients, the queue, servicing, pages" />}
      <BellDrawer open={panel === 'bell'} onClose={close} />
      <LogCall open={panel === 'log'} onClose={close} />
      <BookForAgent open={panel === 'book'} onClose={close} />
      <Help open={panel === 'help'} onClose={close} />
      <AccountMenu open={panel === 'menu'} onClose={close} theme={theme} setTheme={setTheme} away={away} flipAway={flipAway} />
    </div>
  )
}

