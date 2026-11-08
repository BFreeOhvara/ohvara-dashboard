import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link, NavLink, useLocation, useNavigate, useOutlet } from 'react-router-dom'
import {
  Home, PhoneIncoming, PhoneCall, Users, LifeBuoy, Wallet, Settings, Search, Bell, Sun, Moon, MessageSquare, Radio,
  ChevronRight, LogOut, Ellipsis, CalendarCheck, Clock3, CircleHelp, PhoneOutgoing, Mail, Keyboard,
  TriangleAlert, ShieldCheck, Check, Hand, CalendarPlus,
} from 'lucide-react'
import { useTheme } from '../hooks/useTheme'
import { useStretchPill } from '../hooks/useStretchPill'
import { useNotificationFeed, useMarkRead } from '../hooks/useNotifications'
import { usePortalPhone } from '../contexts/portalPhone'
import { Drawer, Avatar, useAccount, useNote, initials } from '../template/kit'
import { wig, still, CountUp, RollTitle, usePageSwap, useExit } from '../template/motion'
import { armEntrance } from '../adminshell/entrance'
import Palette from '../template/Palette'
import { OhvaraMark } from '../components/ui/OhvaraMark'
import { isSearchKey } from '../lib/searchKey'
import { safeLink } from '../lib/notifications'
import { SUPPORT_EMAIL } from '../components/auth/authUtils'
import { timeText } from '../lib/fulfillmentDay'
import { displayName } from '../lib/vaQueue'
import { FUL, FUL_TABS, fulPageOf, fulTitleOf } from './paths'
import { LiveClock } from '../template/Clock'
import { useFulData } from './useFulData'
import '../template/glass.css'
import '../template/flow.css'
import '../template/palette.css'
import './fulshell.css'
import '@fontsource/urbanist/500.css'
import '@fontsource/urbanist/600.css'
import '@fontsource/urbanist/700.css'

// P837 — the Fulfillment (VA) shell: the agent shell's frame (glass pill tabs, the floating action rail, the rolling
// title with three headline numbers, the photo backdrop, light and dark) around the VA's real pages. Every number
// here is read from the existing hooks (useFulData); nothing on the frame writes, except opening a notification
// (marks it read, as the old bell did) and the theme. Calls and texts stay behind voice_live / sms_live.
const ICONS = { today: Home, queue: PhoneIncoming, calls: PhoneCall, clients: Users, servicing: LifeBuoy, pay: Wallet }
const PAGES = [...FUL_TABS.map(([k, label]) => ({ to: () => FUL[k], label })), { to: () => FUL.messages, label: 'Messages' }, { to: () => FUL.settings, label: 'Settings' }]

function BellDrawer({ open, onClose, profileId }) {
  const { data: rows = [], isLoading, isError } = useNotificationFeed(profileId, 8)
  const markRead = useMarkRead(profileId)
  const navigate = useNavigate()
  const go = n => {
    if (!n.read) markRead.mutate([n.id])
    const to = safeLink(n.link)
    onClose()
    if (to) navigate(to)
  }
  return (
    <Drawer open={open} onClose={onClose} title="Notifications" sub="What happened lately">
      {isLoading ? <p className="tp-sub">Loading…</p>
        : isError ? <p className="tp-sub">Couldn’t load your notifications.</p>
          : rows.length === 0 ? <p className="fx-calm"><Check size={16} aria-hidden="true" />You’re all caught up.</p>
            : (
              <ul className="tp-list">
                {rows.map(n => (
                  <li key={n.id}>
                    <button type="button" className={`fx-mrow fs-note${n.read ? '' : ' is-new'}`} onClick={() => go(n)}>
                      <Bell size={16} aria-hidden="true" /><span className="tp-grow"><b>{n.title}</b>{n.detail && <small>{n.detail}</small>}</span>
                      <small>{new Date(n.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</small>
                    </button>
                  </li>
                ))}
              </ul>
            )}
    </Drawer>
  )
}

// Log a call: a call's result is recorded on the call itself, so this picks one of today's calls and opens it on Calls.
function LogCall({ open, onClose, d }) {
  const navigate = useNavigate()
  if (!open) return null
  const rows = [...(d.day.next ? [d.day.next] : []), ...d.day.rest, ...d.day.done]
  const pick = id => { onClose(); navigate(`${FUL.calls}?open=${id}`) }
  return (
    <Drawer open center onClose={onClose} title="Log a call" sub="Pick the call. Its result is saved on the call.">
      {rows.length === 0 ? <p className="fx-calm">No calls on your calendar today. Older calls are on Calls and Clients.</p> : (
        <ul className="tp-list">
          {rows.map(r => (
            <li key={r.id}><button type="button" className="fx-mrow" onClick={() => pick(r.id)}>
              <PhoneOutgoing size={16} aria-hidden="true" /><span className="tp-grow"><b>{r.name}</b><small>{r.result || r.sub}</small></span>
              <small>{timeText(r.at, d.tz)}</small><ChevronRight size={15} aria-hidden="true" />
            </button></li>
          ))}
        </ul>
      )}
      <Link to={FUL.clients} className="tp-btn ov-ghost" onClick={onClose}>Find someone else on Clients</Link>
    </Drawer>
  )
}

// Book for an agent: a booking starts from a lead you take on the Queue (it holds the lead so no other VA calls them).
function BookForAgent({ open, onClose, d }) {
  const navigate = useNavigate()
  if (!open) return null
  const rows = [...d.missed, ...(d.vaQ.data || [])].slice(0, 5)
  const go = () => { onClose(); navigate(FUL.queue) }
  return (
    <Drawer open center onClose={onClose} title="Book a call for an agent" sub="Take a lead on the Queue, then book it with its agent."
      footer={<><button type="button" className="tp-primary fx-accent" onClick={go}><CalendarPlus size={16} />Open the Queue</button><button type="button" className="tp-btn ov-ghost" onClick={onClose}>Cancel</button></>}>
      {rows.length === 0 ? <p className="fx-calm">Nobody is waiting in the queue right now.</p> : (
        <ul className="tp-list">
          {rows.map(r => <li key={r.lead_id} className="tp-li"><Avatar name={displayName(r) || '?'} /><span className="tp-grow"><b>{displayName(r)}</b><small>{r.agent_name ? `Missed by ${r.agent_name}` : [r.city, r.state].filter(Boolean).join(', ') || 'Waiting'}</small></span></li>)}
        </ul>
      )}
    </Drawer>
  )
}

// Active / Away: there is no VA availability switch in the database yet (agent_duty is agents only). Calls are booked
// into your shift, so this shows the shift; the switch is a door item (brain/ohvara/fulfillment-map.md).
function Shift({ open, onClose, d }) {
  if (!open) return null
  return (
    <Drawer open center onClose={onClose} title="Active or away" sub="Calls are booked inside your shift.">
      <div className="fs-shift">
        <span className="fx-kpi-ic"><Clock3 size={17} aria-hidden="true" /></span>
        <span className="tp-grow"><b>{d.shiftText || 'No shift saved yet'}</b><small>{d.shiftText ? 'Your shift, set by Brayden' : 'Ask Brayden to set your shift'}</small></span>
      </div>
      <p className="tp-sub">A switch to go away mid-shift is coming soon. Until then, message the team if you need to step away.</p>
      <Link to={FUL.messages} className="tp-btn ov-ghost" onClick={onClose}>Message the team</Link>
    </Drawer>
  )
}

function Help({ open, onClose }) {
  if (!open) return null
  return (
    <Drawer open center onClose={onClose} title="Help and support" sub="Ask the team anything about a client, a call or your pay.">
      <ul className="tp-list">
        <li><Link to={FUL.messages} className="fx-mrow" onClick={onClose}><MessageSquare size={17} aria-hidden="true" /><span className="tp-grow"><b>Message the team</b><small>Fastest for anything about a client</small></span><ChevronRight size={15} aria-hidden="true" /></Link></li>
        <li><Link to={FUL.more} className="fx-mrow fs-phone-only" onClick={onClose}><PhoneCall size={17} aria-hidden="true" /><span className="tp-grow"><b>Carrier phone numbers</b><small>On More</small></span><ChevronRight size={15} aria-hidden="true" /></Link></li>
        <li><a href={`mailto:${SUPPORT_EMAIL}`} className="fx-mrow"><Mail size={17} aria-hidden="true" /><span className="tp-grow"><b>Email support</b><small>{SUPPORT_EMAIL}</small></span><ChevronRight size={15} aria-hidden="true" /></a></li>
        <li className="fx-mrow"><Keyboard size={17} aria-hidden="true" /><span className="tp-grow"><b>Search anything</b><small>Press Ctrl K (Cmd K on a Mac)</small></span></li>
      </ul>
    </Drawer>
  )
}

function AccountMenu({ open, onClose, theme, setTheme, onShift }) {
  const account = useAccount()
  useEffect(() => {
    if (!open) return undefined
    const onKey = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
  const [shown, leaving] = useExit(open, 200) // P843: plays its way out
  if (!shown) return null
  // On a phone the bottom bar holds Today, Queue, Call and Servicing; Calls, Clients and More are here (fs-phone-only).
  const links = [[FUL.calls, 'Calls', PhoneCall, true], [FUL.clients, 'Clients', Users, true], [FUL.pay, 'Pay', Wallet], [FUL.messages, 'Messages', MessageSquare], [FUL.settings, 'Settings', Settings], [FUL.more, 'More', Ellipsis, true]]
  return (
    <div className={`tp fx-layer fx-menu-layer${leaving ? ' is-leaving' : ''}`} role="presentation">
      <button type="button" className="fx-scrim is-clear tp-bare" aria-label="Close menu" tabIndex={-1} onClick={onClose} />
      <section className="fx-menu" role="dialog" aria-label="Your account">
        <header className="fx-menu-h"><span className="fx-av">{initials(account.name).toUpperCase()}</span><span className="tp-grow"><b>{account.name}</b><small>Fulfillment</small></span></header>
        <button type="button" className="fx-mrow" onClick={onShift}><Radio size={17} aria-hidden="true" /><span className="tp-grow"><b>Active or away</b><small>Your shift</small></span><ChevronRight size={15} aria-hidden="true" /></button>
        <button type="button" className="fx-mrow" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? <Sun size={17} aria-hidden="true" /> : <Moon size={17} aria-hidden="true" />}<b className="tp-grow">{theme === 'dark' ? 'Light mode' : 'Dark mode'}</b></button>
        <i className="fx-mline" />
        {links.map(([to, label, Icon, phoneOnly]) => <Link key={label} to={to} className={`fx-mrow${phoneOnly ? ' fs-phone-only' : ''}`} onClick={onClose}><Icon size={17} aria-hidden="true" /><b className="tp-grow">{label}</b><ChevronRight size={15} aria-hidden="true" /></Link>)}
        <i className="fx-mline" />
        <button type="button" className="fx-mrow is-danger" onClick={() => account.signOut?.()}><LogOut size={17} aria-hidden="true" /><b className="tp-grow">Sign out</b></button>
      </section>
    </div>
  )
}

// Three headline numbers per page: what a VA checks first there.
function headStats(page, d) {
  const S = (icon, n, label, extra = {}) => ({ icon, n, label, ...extra })
  const b = d.buckets
  const waiting = b.new + b.not_reached + b.callback_due + d.missed.length
  const open = d.servicing.length
  return {
    today: [S(PhoneCall, d.day.left, 'calls left today', { chip: d.live.length ? ['On a call', 'warn'] : null }), S(PhoneIncoming, waiting, 'waiting in the queue', { chip: b.callback_due ? [`${b.callback_due} callback due`, 'warn'] : null })],
    queue: [S(TriangleAlert, b.callback_due, 'callbacks due', { chip: b.callback_due ? ['Call first', 'warn'] : null }), S(PhoneIncoming, b.new, 'new'), S(PhoneOutgoing, b.not_reached + d.missed.length, 'to try again')],
    calls: [S(PhoneCall, d.day.total, 'calls today'), S(Check, d.day.done.length, 'done'), S(Clock3, d.day.left, 'to go', { chip: d.day.next ? [`next ${d.day.next.time} ${d.day.next.period}`, 'blue'] : null })],
    clients: [S(Users, d.mine.length, 'clients on your book'), S(CalendarCheck, d.mine.filter(p => p.scheduled_call_at && p.fulfillment_stage !== 'Complete').length, 'with a call booked'), S(ShieldCheck, d.mine.filter(p => p.fulfillment_stage === 'Complete').length, 'cancelled')],
    servicing: [S(LifeBuoy, open, 'open steps'), S(TriangleAlert, d.tasks.overdue.length, 'overdue', { chip: d.tasks.overdue.length ? ['Do first', 'warn'] : null }), S(Hand, d.tasks.mine.length, 'you are working')],
    // P890: pay is hourly from clock in and out (the Pay screen shows hours); no per-cancel counts here.
    pay: [],
    messages: [S(MessageSquare, d.unread, 'unread')],
  }[page] || []
}

export default function FulfillFrame() {
  const { pathname } = useLocation()
  const outlet = useOutlet()
  const navigate = useNavigate()
  const [theme, setTheme] = useTheme()
  const [panel, setPanel] = useState(null)
  const tabsRef = useRef(null)
  const account = useAccount()
  const note = useNote()
  const phone = usePortalPhone()
  const d = useFulData()
  const active = fulPageOf(pathname)
  const page = usePageSwap(active || 'today', outlet)
  const layout = page.key
  const title = fulTitleOf(layout)
  const stats = headStats(layout, d)
  const close = useCallback(() => setPanel(null), [])
  const { data: bell = [] } = useNotificationFeed(d.profile?.id, 8)
  const unreadBell = bell.filter(n => !n.read).length
  const tabCount = { queue: d.buckets.callback_due + d.missed.length, servicing: d.tasks.overdue.length }
  useStretchPill(tabsRef, { activeKey: FUL_TABS.some(([k]) => k === active) ? active : null, selector: 'a.is-on', persistKey: 'ful-tabs' })
  const open = which => e => { wig.onClick(e); setPanel(which) }
  const flipTheme = e => { wig.onClick(e); setTheme(theme === 'dark' ? 'light' : 'dark') }
  const liveCall = !!phone.activeId
  const callNow = () => {
    if (liveCall) { phone.show(); return }
    const first = d.day.next || d.day.rest[0]
    if (first) navigate(`${FUL.calls}?open=${first.id}`)
    else { navigate(FUL.calls); note('No more calls on your calendar today') }
  }

  // Search: your clients (cancellation calls) and the leads in your queue, plus the pages.
  const searchRows = useMemo(() => ({
    clients: d.mine.map(p => {
      const name = [p.client_first_name, p.client_last_name].filter(Boolean).join(' ') || 'Client'
      return { id: `c-${p.id}`, name, sub: `${p.current_carrier || p.carrier_name || 'Carrier not noted'}${p.client_phone ? ` · ${p.client_phone}` : ''}`, hay: `${name} ${p.client_phone || ''} ${p.current_carrier || ''} ${p.carrier_name || ''}`, go: () => `${FUL.calls}?open=${p.id}` }
    }),
    leads: [...d.missed, ...(d.vaQ.data || [])].map(r => ({ id: `l-${r.lead_id}`, name: displayName(r) || 'Lead', sub: [r.city, r.state].filter(Boolean).join(', ') || 'In the queue', hay: `${displayName(r)} ${r.phone || ''} ${r.city || ''}`, go: () => FUL.queue })),
  }), [d.mine, d.missed, d.vaQ.data])

  const appRef = useRef(null)
  useLayoutEffect(() => {
    const el = appRef.current
    if (!el) return undefined
    let stop = () => {}
    // P859/P860: it then gets SETTLE_MS to really run; if it has not (a throttled or frozen browser), the page shows at rest
    // (.is-settled, flow.css). Reduced motion shows at once. The body never waits on an animation.
    const raf = requestAnimationFrame(() => { el.classList.add('is-anim'); stop = armEntrance(el, { still: still(), rootClass: 'fx-settled' }) })
    const onVis = () => { if (document.hidden) el.classList.remove('is-anim') }
    document.addEventListener('visibilitychange', onVis)
    return () => { cancelAnimationFrame(raf); stop(); document.removeEventListener('visibilitychange', onVis) }
  }, [layout])
  useEffect(() => () => document.documentElement.classList.remove('fx-settled'), [])

  useEffect(() => {
    const onKey = e => { if (isSearchKey(e)) { e.preventDefault(); setPanel(p => (p === 'search' ? null : 'search')) } }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className={`tp tp-app fx fs is-${layout}`} ref={appRef}>
      <div className="tp-sky" aria-hidden="true"><i /><i /><i /></div>

      <header className="tp-phone-top fx-ptop">
        <Link to={FUL.today} className="fx-brand" aria-label="Ohvara home"><OhvaraMark height={28} back="var(--ov-mark-back)" front="var(--ov-mark-front)" className="fx-mark" /></Link>
        <span className="tp-grow" />
        <Link to={FUL.messages} className="fx-ib tp-wig" aria-label="Messages" {...wig}><MessageSquare size={18} />{d.unread > 0 && <span className="fx-badge">{d.unread}</span>}</Link>
        <button type="button" className="fx-ib tp-wig is-bell" aria-label="Notifications" {...wig} onClick={open('bell')}><Bell size={18} />{unreadBell > 0 && <span className="fx-badge">{unreadBell}</span>}</button>
        <button type="button" className="fx-me tp-wig" aria-label="Menu" {...wig} onClick={open('menu')}>{initials(account.name).toUpperCase()}</button>
      </header>

      <Link to={FUL.today} className="fx-brand fx-brand-page" aria-label="Ohvara home"><OhvaraMark height={30} back="var(--ov-mark-back)" front="var(--ov-mark-front)" className="fx-mark" /><b>ohvara</b></Link>
      <header className="tp-top fx-top">
        <span className="fx-top-gap" aria-hidden="true" />
        <nav className="tp-tabs fx-tabs" ref={tabsRef} aria-label="Pages">
          {FUL_TABS.map(([k, label]) => (
            <Link key={k} to={FUL[k]} className={`tp-tab fx-tab${active === k ? ' is-on' : ''}`} aria-current={active === k ? 'page' : undefined}>
              {label}{tabCount[k] > 0 && <span className="fx-tb">{tabCount[k]}</span>}
            </Link>
          ))}
        </nav>
        <div className="fx-tr">
          <Link to={FUL.messages} className="fx-ib tp-wig" aria-label="Messages" {...wig}><MessageSquare size={18} />{d.unread > 0 && <span className="fx-badge">{d.unread}</span>}</Link>
          <button type="button" className="fx-ib tp-wig is-bell" aria-label="Notifications" {...wig} onClick={open('bell')}><Bell size={18} />{unreadBell > 0 && <span className="fx-badge">{unreadBell}</span>}</button>
          <button type="button" className="tp-me fx-me tp-wig" aria-label={`Your account, ${account.name}`} aria-expanded={panel === 'menu'} {...wig} onClick={open('menu')}>{initials(account.name).toUpperCase()}</button>
        </div>
      </header>

      <aside className="tp-rail fx-rail" aria-label="Actions">
        <button type="button" className="tp-ri fx-ri tp-wig" aria-label="Search (Ctrl K)" data-tip="Search  Ctrl K" {...wig} onClick={open('search')}><Search size={20} /></button>
        <i className="fx-hair" />
        <button type="button" className={`fx-ri fx-duty tp-wig${d.shiftText ? ' on' : ''}`} aria-label="Active or away" data-tip={d.shiftText ? `Shift: ${d.shiftText}` : 'No shift saved'} {...wig} onClick={open('shift')}><Radio size={18} /><i aria-hidden="true" /></button>
        <i className="fx-hair" />
        <button type="button" className="fx-ri tp-wig" aria-label="Log a call" data-tip="Log a call" {...wig} onClick={open('log')}><PhoneOutgoing size={18} /></button>
        <button type="button" className="fx-ri tp-wig" aria-label="Book for an agent" data-tip="Book for an agent" {...wig} onClick={open('book')}><CalendarPlus size={18} /></button>
        <i className="fx-hair" />
        <NavLink to={FUL.messages} className="fx-ri tp-wig" aria-label="Messages" data-tip="Messages" {...wig}><MessageSquare size={18} />{d.unread > 0 && <span className="fx-badge">{d.unread}</span>}</NavLink>
        <button type="button" className="fx-ri tp-wig" aria-label="Help and support" data-tip="Help and support" {...wig} onClick={open('help')}><CircleHelp size={18} /></button>
        <i className="fx-hair" />
        <NavLink to={FUL.settings} className="fx-ri tp-wig" aria-label="Settings" data-tip="Settings" {...wig}><Settings size={18} /></NavLink>
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
                    <b className={s.fmt ? 'tp-money' : 'tp-num'}><CountUp value={s.n} format={s.fmt} /></b>
                    <span>{s.label}{s.chip && <i className={`fx-delta is-${s.chip[1]}`}>{s.chip[0]}</i>}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
          {/* P860: the live clock, one line, right side of every page's title row, in the zone from the VA's profile */}
          {layout === 'today' && <LiveClock tz={d.tz} />}
        </div>

        <main className={`tp-main fx-main fs-main${page.leaving ? ' is-leaving' : ''}`} key={page.key}>
          {page.el}
        </main>
      </div>

      <nav className="tp-bar fx-bar" aria-label="Pages">
        {[['today', 'Today'], ['queue', 'Queue']].map(([k, label]) => { const I = ICONS[k]; return <Link key={k} to={FUL[k]} className={`fx-btab${active === k ? ' is-on' : ''}`}><I size={20} aria-hidden="true" />{label}</Link> })}
        <button type="button" className="fx-btab is-plus" aria-label={liveCall ? 'Back to the call' : 'Your next call'} onClick={callNow}><span className={`fx-bplus${liveCall ? ' is-live' : ''}`}><PhoneCall size={22} aria-hidden="true" /></span>{liveCall ? 'On call' : 'Call'}</button>
        <Link to={FUL.servicing} className={`fx-btab${active === 'servicing' ? ' is-on' : ''}`}><LifeBuoy size={20} aria-hidden="true" />Servicing</Link>
        <button type="button" className="fx-btab" onClick={open('menu')}><Ellipsis size={20} aria-hidden="true" />More</button>
      </nav>

      {panel === 'search' && <Palette onClose={close} pages={PAGES} rows={searchRows} placeholder="Search your clients, the queue, pages" />}
      <BellDrawer open={panel === 'bell'} onClose={close} profileId={d.profile?.id} />
      <LogCall open={panel === 'log'} onClose={close} d={d} />
      <BookForAgent open={panel === 'book'} onClose={close} d={d} />
      <Shift open={panel === 'shift'} onClose={close} d={d} />
      <Help open={panel === 'help'} onClose={close} />
      <AccountMenu open={panel === 'menu'} onClose={close} theme={theme} setTheme={setTheme} onShift={() => setPanel('shift')} />
    </div>
  )
}
