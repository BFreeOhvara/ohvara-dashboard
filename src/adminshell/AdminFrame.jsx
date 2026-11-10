import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link, NavLink, useLocation, useNavigate, useOutlet } from 'react-router-dom'
import {
  Home, Users, Headset, PhoneIncoming, BookUser, Landmark, Plug, Settings, Search, Bell, Sun, Moon, MessageSquare, ChevronRight, LogOut,
  Ellipsis, CircleHelp, Mail, Keyboard, UserPlus, Shuffle, Hand, Bug, History, TriangleAlert, Wallet, CalendarDays, CalendarOff,
  ShieldCheck, PhoneForwarded, CircleDollarSign, CheckCircle2, Radio, Link2, Copy, Plus, Rocket, BadgeCheck, Hourglass,
  PhoneCall, Scale,
} from 'lucide-react'
import { useTheme } from '../hooks/useTheme'
import { useIsTestAccount } from '../hooks/useIsTestAccount'
import { Drawer, Avatar, Field, Seg, PillTabs, useAccount, useNote, initials } from '../template/kit'
import ViewToggle from '../template/ViewToggle'
import { ReportBug } from '../template/ReportBug'
import { avatarHue } from '../template/avatarHue'
import { wig, still, CountUp, RollTitle, usePageSwap, usd, useExit, useKeep } from '../template/motion'
import { armEntrance } from './entrance'
import { visibilityGate } from './entrance'
import Palette from '../template/Palette'
import { OhvaraMark } from '../components/ui/OhvaraMark'
import { isSearchKey } from '../lib/searchKey'
import { SUPPORT_EMAIL } from '../components/auth/authUtils'
import {
  useAdmDay, useAdmAgents, useAdmVas, useAdmLeads, useAdmClients, useAdmFeed, useAdmSettings, useAdmMoney, useAdmActions,
  useAdmInvites, useAdmConnect, useAdmPeriod, useAdmSetup, useAdmSource, plugged,
} from './data'
import { useGhlRow } from './useGhlRow'
import { syncFailed } from './engine'
import { LiveClock } from '../template/Clock'
import MoreBelow from '../template/MoreBelow'
import { ap, ADM_TABS, ADM_LABELS, admPageOf, admTitleOf } from './paths'
import { STAGE_WORD } from './words'
import '../template/glass.css'
import '../template/flow.css'
import '../template/palette.css'
import './admin.css'
import './p906.css'
import './p913.css'
import '../template/shell914.css'
import './p914.css'
import './p934.css'
import { useMessagesToggle } from '../template/msgToggle'
import { UnmatchedAlert, RouteLeadDrawer } from './screens/Unmatched913'
import '@fontsource/urbanist/500.css'
import '@fontsource/urbanist/600.css'
import '@fontsource/urbanist/700.css'

// P849 — the Admin frame, built from the agent and VA shells (TemplateFrame, FulFrame): glass pill tabs up top, the
// floating rail of actions, the rolling title with three headline numbers, a live clock with its time zone, the photo
// backdrop, light and dark. Same pieces (template kit, motion, Palette, flow.css), imported and never edited; admin
// content. Sample info only (./data), at /preview/admin and the real admin URLs. P867: there is no partner view; Jordan
// is a full admin, identical to Brayden (decision Q12).
const ICONS = { overview: Home, agents: Users, setup: Rocket, team: Headset, leads: PhoneIncoming, clients: BookUser, billing: Landmark, connect: Plug }
const money = usd()

function BellDrawer({ open, onClose, onRoute }) {
  const { data: items } = useAdmFeed()
  return (
    <Drawer open={open} onClose={onClose} title="Notifications" sub="What happened lately">
      {/* P913: a lead that matched no agent is an alert at the top. P934: clicking it slides in Pick the agent. */}
      <UnmatchedAlert onOpen={onRoute} />
      <ul className="tp-list">
        {items.slice(0, 8).map(a => <li key={a.id} className="tp-li"><Avatar name={a.who} /><span className="tp-grow"><b>{a.who}</b><small>{a.text}</small></span><small>{a.at}</small></li>)}
      </ul>
    </Drawer>
  )
}

// Add someone: an agent or a Fulfillment person, by email, by text, or a link to copy. No admin from here (as today).
export function AddSomeone({ open, onClose }) {
  const { invite } = useAdmActions()
  const { data: settings } = useAdmSettings()
  const note = useNote()
  const role = 'fulfillment' // P906: agents sign up and pay themselves; only the Fulfillment team is invited here
  const [via, setVia] = useState('email')
  const [name, setName] = useState('')
  const [to, setTo] = useState('')
  const keep = useKeep(open)
  if (!keep) return null
  const textOff = !settings.switches.invite_sms_live
  const ready = name.trim().length > 1 && (via === 'link' || to.trim().length > 4)
  const send = () => {
    invite({ name: name.trim(), role, via, to: via === 'link' ? 'Link copied' : to.trim() })
    note(via === 'link' ? `Invite link for ${name.trim()} copied (sample)` : `Invite sent to ${name.trim()} (sample: nothing was sent)`)
    setName(''); setTo(''); onClose()
  }
  return (
    <Drawer open={open} center onClose={onClose} title="Add a VA" sub="They get a link to set a password and land on the Fulfillment side."
      footer={<><button type="button" className="tp-primary fx-accent" disabled={!ready} onClick={send}>{via === 'link' ? <Copy size={16} /> : <UserPlus size={16} />}{via === 'link' ? 'Copy the link' : 'Send invite'}</button><button type="button" className="tp-btn ov-ghost" onClick={onClose}>Cancel</button></>}>
      <Field label="Full name"><input value={name} onChange={e => setName(e.target.value)} placeholder="First and last name" /></Field>
      <div className="tp-field"><span>Send it by</span>
        <Seg label="Send by" role="radiogroup" value={via} onChange={setVia} options={[{ key: 'email', label: 'Email' }, { key: 'text', label: 'Text', title: textOff ? 'Invite by text is off in Settings' : undefined }, { key: 'link', label: 'Copy a link' }]} />
        {via === 'text' && textOff && <small>Invite by text is off in Settings, so this would go as a link to copy.</small>}
      </div>
      {via !== 'link' && <Field label={via === 'email' ? 'Email' : 'Mobile number'}><input type={via === 'email' ? 'email' : 'tel'} value={to} onChange={e => setTo(e.target.value)} placeholder={via === 'email' ? 'name@example.com' : '(555) 555-0100'} /></Field>}
      <p className="tp-sub">Agents sign up and pay on their own; they show on Setup once they've paid. Admins are added by another admin outside the portal.</p>
    </Drawer>
  )
}

// Give a call: the desk's calls past their time. Picking one opens the Fulfillment page's desk on it.
function GiveCall({ open, onClose }) {
  const { data: day } = useAdmDay()
  const navigate = useNavigate()
  const keep = useKeep(open)
  if (!keep) return null
  return (
    <Drawer open={open} center onClose={onClose} title="Give a call" sub={day.late.length ? 'Calls past their time. Pick one to give it to someone free.' : 'No call is past its time.'}>
      <ul className="tp-list">
        {day.late.map(c => (
          <li key={c.id}><button type="button" className="fx-mrow" onClick={() => { onClose(); navigate(`${ap('team')}?call=${c.id}`) }}>
            <Avatar name={c.client} tone="warn" /><span className="tp-grow"><b>{c.client}</b><small>{c.time} · {c.old_carrier}</small></span><Hand size={15} aria-hidden="true" />
          </button></li>
        ))}
      </ul>
    </Drawer>
  )
}

function Help({ open, onClose, onBug }) {
  const keep = useKeep(open)
  if (!keep) return null
  return (
    <Drawer open={open} center onClose={onClose} title="Help and support" sub="Where things live on the admin side.">
      <ul className="tp-list">
        {/* P876: Report a bug, the same pop-up in all three portals (ReportBug) */}
        <li><button type="button" className="fx-mrow" onClick={() => { onClose(); onBug() }}><Bug size={17} aria-hidden="true" /><span className="tp-grow"><b>Report a bug</b><small>Something broken in the admin side</small></span><ChevronRight size={15} aria-hidden="true" /></button></li>
        <li><Link to={ap('bugs')} className="fx-mrow" onClick={onClose}><Bug size={17} aria-hidden="true" /><span className="tp-grow"><b>Bug reports</b><small>What agents, VAs and admins sent from Help and support</small></span><ChevronRight size={15} aria-hidden="true" /></Link></li>
        <li><Link to={`${ap('settings')}?tab=audit`} className="fx-mrow" onClick={onClose}><History size={17} aria-hidden="true" /><span className="tp-grow"><b>Audit log</b><small>Every admin action, newest first</small></span><ChevronRight size={15} aria-hidden="true" /></Link></li>
        <li><a href={`mailto:${SUPPORT_EMAIL}`} className="fx-mrow"><Mail size={17} aria-hidden="true" /><span className="tp-grow"><b>Support mailbox</b><small>{SUPPORT_EMAIL}</small></span><ChevronRight size={15} aria-hidden="true" /></a></li>
        <li className="fx-mrow"><Keyboard size={17} aria-hidden="true" /><span className="tp-grow"><b>Search anything</b><small>Press Ctrl K (Cmd K on a Mac)</small></span></li>
      </ul>
    </Drawer>
  )
}

// The avatar menu: theme, account pages, sign out (P919: no way back to the old admin pages).
function AccountMenu({ open, onClose, theme, setTheme }) {
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
  const name = account.name
  const links = [['settings', 'Settings', Settings], ['messages', 'Messages', MessageSquare], ['billing', 'Revenue', Landmark]]
  return (
    <div className={`tp fx-layer fx-menu-layer${leaving ? ' is-leaving' : ''}`} role="presentation">
      <button type="button" className="fx-scrim is-clear tp-bare" aria-label="Close menu" tabIndex={-1} onClick={onClose} />
      <section className="fx-menu" role="dialog" aria-label="Your account">
        <header className="fx-menu-h"><span className={`fx-av av-${avatarHue(name)}`}>{initials(name).toUpperCase()}</span><span className="tp-grow"><b>{name}</b><small>Admin · owner</small></span></header>
        <button type="button" className="fx-mrow" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? <Sun size={17} aria-hidden="true" /> : <Moon size={17} aria-hidden="true" />}<b className="tp-grow">{theme === 'dark' ? 'Light mode' : 'Dark mode'}</b></button>
        <ViewToggle />
        <i className="fx-mline" />
        {links.map(([k, label, Icon]) => <Link key={k} to={ap(k)} className="fx-mrow" onClick={onClose}><Icon size={17} aria-hidden="true" /><b className="tp-grow">{label}</b><ChevronRight size={15} aria-hidden="true" /></Link>)}
        <i className="fx-mline" />
        <button type="button" className="fx-mrow is-danger" onClick={() => (account.live ? account.signOut() : note('Sign out works once you sign in for real'))}><LogOut size={17} aria-hidden="true" /><b className="tp-grow">Sign out</b></button>
      </section>
    </div>
  )
}

// Three headline numbers beside the title: what an admin checks first on that page.
function useHeadStats(page) {
  const { data: day } = useAdmDay()
  const { data: agents } = useAdmAgents()
  const { data: vas } = useAdmVas()
  const { data: clients } = useAdmClients()
  const { data: m } = useAdmMoney()
  const { data: invites } = useAdmInvites()
  const { data: connect } = useAdmConnect()
  const { data: wk } = useAdmPeriod('week')
  const { data: pipe } = useAdmSetup()
  const { data: settings } = useAdmSettings()
  const S = (icon, n, label, extra = {}) => ({ icon, n, label, ...extra })
  const route = day.unassigned.length
  const att = clients.filter(c => c.stage === 'needs_attention').length
  const linked = plugged(connect).filter(Boolean).length
  return {
    overview: [S(ShieldCheck, day.payingAgents, 'paying agents', { chip: [`${day.onDuty.length} on duty`, 'up'] }), S(Headset, day.onShift.length, 'VAs on shift today'), S(CircleDollarSign, m.total, 'revenue this week', { fmt: money, chip: [`${money(m.lastWeek)} last week`, 'blue'] })],
    agents: [S(Users, agents.length, 'agents', { chip: invites.some(i => i.role === 'agent') ? [`${invites.filter(i => i.role === 'agent').length} invites out`.replace(/^1 invites/, '1 invite'), 'blue'] : null }), S(Radio, agents.filter(a => a.active).length, 'taking transfers'), S(TriangleAlert, agents.filter(a => a.billing.status === 'past_due').length, 'past due', { chip: agents.some(a => a.billing.status === 'past_due') ? ['See who', 'warn'] : null })],
    setup: [S(Rocket, pipe.filter(c => c.stage !== 'live').length, 'getting set up'), S(Hourglass, pipe.filter(c => c.stage === 'checks').length, 'on launch checks', { chip: pipe.some(c => c.paused) ? [`${pipe.filter(c => c.paused).length} paused`, 'warn'] : null }), S(BadgeCheck, pipe.filter(c => c.stage === 'live').length, 'live this week')],
    team: [S(Headset, day.onShift.length, 'on shift today'), S(CalendarOff, settings.daysOffPerMonth ?? 2, 'days off a month each'), S(Wallet, vas.reduce((t, v) => t + v.week.verified + v.week.checking, 0), 'VA pay this week', { fmt: money })],
    leads: [S(PhoneIncoming, day.week.in, 'leads this week'), S(Shuffle, route, 'not matched', { chip: route ? ['Pick an agent', 'warn'] : null }), S(CheckCircle2, day.week.sold, 'sold this week')],
    clients: [S(BookUser, clients.length, 'clients'), S(TriangleAlert, att, 'need attention', { chip: att ? ['See who', 'warn'] : null }), S(CalendarDays, clients.reduce((n, c) => n + c.steps.length, 0), 'servicing steps open')],
    billing: [S(CircleDollarSign, wk.inTotal, 'brought in this week', { fmt: money }), S(Wallet, wk.profit, 'profit this week', { fmt: money, chip: [`${wk.split[0].pct}/${wk.split[1].pct} split`, 'blue'] }), S(TriangleAlert, m.failed.length, 'failed payments', { chip: m.failed.length ? ['Follow up', 'warn'] : null })],
    connect: [S(Link2, linked, 'of 5 plugged in'), S(PhoneForwarded, connect.ads.length, 'ad accounts'), S(Plug, connect.sources.forms.filter(f => f.on).length, 'forms on')],
    settings: [S(Users, agents.length + vas.length, 'people with a login'), S(Radio, ['sms_live', 'voice_live', 'ai_caller_live'].filter(k => settings.switches?.[k]).length, 'of 3 go-live switches on', { chip: ['Sample', 'blue'] }), S(Bug, day.openBugs, 'open bug reports')],
  }[page] || []
}

export default function AdminFrame() {
  const { pathname } = useLocation()
  const outlet = useOutlet()
  const source = useAdmSource()
  const isTest = useIsTestAccount() // P929: no sample line on test accounts
  const [theme, setTheme] = useTheme()
  const [panel, setPanel] = useState(null)
  const account = useAccount()
  const active = admPageOf(pathname)
  const page = usePageSwap(active || 'overview', outlet)
  const layout = page.key
  const title = admTitleOf(layout)
  const stats = useHeadStats(layout)
  const { data: day } = useAdmDay()
  const { data: agents } = useAdmAgents()
  const { data: vas } = useAdmVas()
  const { data: leads } = useAdmLeads()
  const { data: clients } = useAdmClients()
  const { data: settings } = useAdmSettings()
  const ghlRow = useGhlRow()
  const close = useCallback(() => setPanel(null), [])
  const open = which => e => { wig.onClick(e); setPanel(which) }
  // P914: the avatar toggles its menu (a second click closes it, with the menu's close animation), as on the agent side
  const toggleMenu = e => { wig.onClick(e); setPanel(p => (p === 'menu' ? null : 'menu')) }
  const menuOn = panel === 'menu'
  // P914: the top-right Messages icon shows selected while Messages is open; a second click goes back to Overview
  // with the same page swap as a nav tab.
  const msg = useMessagesToggle(active === 'messages', ap('overview'))
  const flipTheme = e => { wig.onClick(e); setTheme(theme === 'dark' ? 'light' : 'dark') }
  const tabs = ADM_TABS
  const tabCount = { leads: day.unassigned.length, billing: day.failed.length }

  const rows = useMemo(() => ({
    clients: [
      ...clients.map(c => ({ id: `c-${c.id}`, name: c.name, sub: `${c.agent}'s client · ${c.carrier}`, hay: `${c.name} ${c.phone} ${c.agent} ${c.policy} ${c.carrier}`, go: () => ap('clients', c.id) })),
      ...agents.map(a => ({ id: `a-${a.id}`, name: a.name, sub: `Agent · ${a.city}, ${a.state}`, hay: `${a.name} ${a.email} ${a.phone} agent`, go: () => ap('agents', a.id) })),
      ...vas.map(v => ({ id: `v-${v.id}`, name: v.name, sub: 'Fulfillment', hay: `${v.name} ${v.email} ${v.phone} fulfillment va`, go: () => ap('team', v.id) })),
    ],
    leads: leads.map(l => ({ id: `l-${l.id}`, name: l.name, sub: `${l.agent_id ? STAGE_WORD[l.stage] : 'Not matched'} · ${l.agent || 'no agent'}`, hay: `${l.name} ${l.phone} ${l.city} ${l.agent || ''}`, go: () => ap('leads', l.id) })),
  }), [clients, agents, vas, leads])
  const pages = [...tabs.map(([k, label]) => ({ to: () => ap(k), label })), { to: () => ap('messages'), label: 'Messages' }, { to: () => ap('connect'), label: 'Connect' }, { to: () => ap('settings'), label: 'Settings' }]

  const appRef = useRef(null)
  useLayoutEffect(() => {
    const el = appRef.current
    if (!el) return undefined
    let stop = () => {}
    // P859: motion starts on the first painted frame, then gets SETTLE_MS to really run; if it has not, the page
    // shows at rest (.is-settled). Under reduced motion it shows at once. The body never waits on an animation.
    const raf = requestAnimationFrame(() => { el.classList.add('is-anim'); stop = armEntrance(el, { still: still() }) })
    const onVis = visibilityGate(el) // P917: back from another tab, the motion comes back
    document.addEventListener('visibilitychange', onVis)
    return () => { cancelAnimationFrame(raf); stop(); document.removeEventListener('visibilitychange', onVis) }
  }, [layout])

  useEffect(() => () => document.documentElement.classList.remove('adm-settled'), [])

  useEffect(() => {
    const onKey = e => { if (isSearchKey(e)) { e.preventDefault(); setPanel(p => (p === 'search' ? null : 'search')) } }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const tops = (
    <>
      <NavLink to={ap('messages')} className={`fx-ib tp-wig${msg.closing ? ' is-closing' : ''}`} aria-label={active === 'messages' ? 'Close Messages' : 'Messages'} {...wig} onClick={e => { wig.onClick?.(e); msg.onClick(e) }}><MessageSquare size={18} />{day.unread > 0 && <span className="fx-badge">{day.unread}</span>}</NavLink>
      <button type="button" className="fx-ib tp-wig is-bell" aria-label="Notifications" {...wig} onClick={open('bell')}><Bell size={18} /><span className="fx-badge">{Math.min(9, day.needs)}</span></button>
    </>
  )
  const me = account.name

  return (
    <div className={`tp tp-app fx adm is-${layout}`} ref={appRef}>
      <div className="tp-sky" aria-hidden="true"><i /><i /><i /></div>

      <header className={`tp-phone-top fx-ptop${menuOn ? ' is-menu' : ''}`}>
        <Link to={ap('overview')} className="fx-brand" aria-label="Ohvara home"><OhvaraMark height={28} back="var(--ov-mark-back)" front="var(--ov-mark-front)" className="fx-mark" /></Link>
        <span className="tp-grow" />
        {tops}
        <button type="button" className={`fx-me tp-wig av-${avatarHue(me)}`} aria-label="Menu" aria-haspopup="dialog" aria-expanded={menuOn} {...wig} onClick={toggleMenu}>{initials(me).toUpperCase()}</button>
      </header>

      <Link to={ap('overview')} className="fx-brand fx-brand-page" aria-label="Ohvara home"><OhvaraMark height={30} back="var(--ov-mark-back)" front="var(--ov-mark-front)" className="fx-mark" /><b>ohvara</b></Link>
      <header className={`tp-top fx-top${menuOn ? ' is-menu' : ''}`}>
        <span className="fx-top-gap" aria-hidden="true" />
        <PillTabs as="nav" label="Pages" className="tp-tabs fx-tabs adm-tabs" itemClass="tp-tab fx-tab" value={tabs.some(([k]) => k === active) ? active : null} persistKey="adm-tabs"
          items={tabs.map(([k, label]) => ({ key: k, to: ap(k), label, extra: tabCount[k] > 0 ? <span className="fx-tb is-circle" aria-label={`${tabCount[k]} waiting`}>{tabCount[k]}</span> : null }))} />
        <div className="fx-tr">
          {tops}
          <button type="button" className={`tp-me fx-me tp-wig av-${avatarHue(me)}`} aria-label={`Your account, ${me}`} aria-haspopup="dialog" aria-expanded={menuOn} {...wig} onClick={toggleMenu}>{initials(me).toUpperCase()}</button>
        </div>
      </header>

      <aside className="tp-rail fx-rail" aria-label="Actions">
        <button type="button" className="tp-ri fx-ri tp-wig" aria-label="Search (Ctrl K)" data-tip="Search  Ctrl K" {...wig} onClick={open('search')}><Search size={20} /></button>
        <i className="fx-hair" />
        <button type="button" className="fx-ri tp-wig" aria-label="Add a VA" data-tip="Add a VA" {...wig} onClick={open('add')}><UserPlus size={18} /></button>
        {/* P934: no Route a lead here; a real unmatched lead is routed from its notification (RouteLeadDrawer). */}
        <button type="button" className="fx-ri tp-wig" aria-label="Give a call" data-tip={day.late.length ? `${day.late.length} calls past their time` : 'Give a call'} {...wig} onClick={open('give')}><Hand size={18} /></button>
        <i className="fx-hair" />
        <NavLink to={ap('messages')} className="fx-ri tp-wig" aria-label="Messages" data-tip="Messages" {...wig}><MessageSquare size={18} />{day.unread > 0 && <span className="fx-badge">{day.unread}</span>}</NavLink>
        <NavLink to={ap('connect')} className="fx-ri tp-wig" aria-label="Connect" data-tip={syncFailed(ghlRow) ? 'Connect · the last sync failed' : 'Connect'} {...wig}><Plug size={18} />{syncFailed(ghlRow) && <span className="adm-warndot" aria-label="The last sync failed" />}</NavLink>
        <i className="fx-hair" />
        {/* P934: the working pages that left Settings, each its own page (screens/Work934.jsx). */}
        <NavLink to={ap('bugs')} className="fx-ri tp-wig" aria-label="Bug reports" data-tip="Bug reports" {...wig}><Bug size={18} /></NavLink>
        <NavLink to={ap('numbers')} className="fx-ri tp-wig" aria-label="Deedstone numbers" data-tip="Deedstone numbers and VA pods" {...wig}><PhoneCall size={18} /></NavLink>
        <NavLink to={ap('compliance')} className="fx-ri tp-wig" aria-label="Compliance" data-tip="Compliance" {...wig}><Scale size={18} /></NavLink>
        <i className="fx-hair" />
        <button type="button" className="fx-ri tp-wig" aria-label="Help and support" aria-expanded={panel === 'help'} data-tip="Help and support" {...wig} onClick={open('help')}><CircleHelp size={18} /></button>
        <NavLink to={ap('settings')} className="fx-ri tp-wig" aria-label="Settings" data-tip="Settings" {...wig}><Settings size={18} /></NavLink>
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
          {/* P860 + P864: the live clock, one line on the title row, on Overview only */}
          {layout === 'overview' && <LiveClock tz={settings.tz} />}
        </div>

        <main className={`tp-main fx-main adm-main${page.leaving ? ' is-leaving' : ''}`} key={page.key}>
          {page.el}
          {!isTest && source === 'sample' && <p className="tp-foot">Sample info. Changes reset when you reload.</p>}
        </main>
      </div>

      <nav className="tp-bar fx-bar" aria-label="Pages">
        {['overview', 'leads'].map(k => { const I = ICONS[k]; return <Link key={k} to={ap(k)} className={`fx-btab${active === k ? ' is-on' : ''}`}><I size={20} aria-hidden="true" />{ADM_LABELS[k]}</Link> })}
        <button type="button" className="fx-btab is-plus" aria-label="Add a VA" onClick={() => setPanel('add')}><span className="fx-bplus"><Plus size={22} aria-hidden="true" /></span>Add</button>
        <Link to={ap('team')} className={`fx-btab${active === 'team' ? ' is-on' : ''}`}><Headset size={20} aria-hidden="true" />Team</Link>
        <button type="button" className="fx-btab" aria-label="More" aria-expanded={menuOn} onClick={toggleMenu}><Ellipsis size={20} aria-hidden="true" />More</button>
      </nav>

      {panel === 'search' && <Palette onClose={close} pages={pages} rows={rows} placeholder="Search clients, agents, VAs, leads, pages" />}
      <BellDrawer open={panel === 'bell'} onClose={close} onRoute={() => setPanel('route')} />
      <AddSomeone open={panel === 'add'} onClose={close} />
      <RouteLeadDrawer open={panel === 'route'} onClose={close} />
      <GiveCall open={panel === 'give'} onClose={close} />
      <Help open={panel === 'help'} onClose={close} onBug={() => setPanel('bug')} />
      <ReportBug open={panel === 'bug'} onClose={close} role="Admin" />
      <AccountMenu open={panel === 'menu'} onClose={close} theme={theme} setTheme={setTheme} />
      <MoreBelow page={layout} />
    </div>
  )
}
