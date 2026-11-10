import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link, NavLink, useLocation, useNavigate, useOutlet } from 'react-router-dom'
import {
  Home, PhoneCall, Users, Wallet, Settings, Search, Bell, Sun, Moon, MessageSquare,
  ChevronRight, LogOut, Ellipsis, CalendarCheck, Clock3, CircleHelp, Mail, Keyboard, TriangleAlert,
  ShieldCheck, CheckCircle2, CalendarDays, CalendarOff, Plus, Phone, AlarmClock, Headset, NotebookPen, Smartphone,
  GraduationCap, Trophy, Bug, ShieldAlert,
} from 'lucide-react'
import { useTheme } from '../../hooks/useTheme'
import { useIsTestAccount } from '../../hooks/useIsTestAccount'
import { Drawer, Avatar, PillTabs, useAccount, useNote, initials } from '../kit'
import { avatarHue } from '../avatarHue'
import { wig, still, CountUp, RollTitle, usePageSwap, usd, useExit, useKeep } from '../motion'
import { armEntrance } from '../../adminshell/entrance'
import { visibilityGate } from '../../adminshell/entrance'
import Palette from '../Palette'
import { LiveClock } from '../Clock'
import { OhvaraMark } from '../../components/ui/OhvaraMark'
import { isSearchKey } from '../../lib/searchKey'
import { SUPPORT_EMAIL } from '../../components/auth/authUtils'
import { useFulDay, useFulClients, useFulFeed, useFulSettings, useFulPay, useFulTasks, useFulActions, useFulAgents, useFulShift, useFulSchedule, useAgentAppts, useVaBooking, useFulLive, useFulClock, useFulSource, useFulStatus } from './data'
import { DataLoading, DataError, FirstRun } from '../DataState'
import { SlotPick } from '../SlotPick'
import { useClientZone } from '../useClientZone'
import { agentSlots, clocksBetween, zoneAbbr, DEFAULT_APPT_MIN } from '../../lib/callSlots'
import FulPhone from './Phone'
import { dockReducer, dockBadge, railState, initialDock, RING_MS } from './phoneDock'
import { clock } from '../../lib/portalPhone'
import { HelpDot } from '../../fulshell/training/HelpDot'
import { useTraining } from '../../fulshell/training/store'
import { GetApp } from '../TemplateFrame'
import { ReportBug } from '../ReportBug'
import { DayOffDrawer } from './Shift'
import { CALL_WORD } from './words'
import { licensedIn, weekPay } from './p879'
import { useDayOffActions } from '../../hooks/useVaShiftsShell'
import { companyDay } from '../../lib/vaShifts'
import { fp, FUL_TABS, fulPageOf, fulTitleOf } from './paths'
import '../glass.css'
import '../p881.css'
import '../flow.css'
import '../palette.css'
import './ful.css'
import MoreBelow from '../MoreBelow'
import { useMessagesToggle } from '../msgToggle'
import '../p911.css'
import '../shell914.css'
import '@fontsource/urbanist/500.css'
import '@fontsource/urbanist/600.css'
import '@fontsource/urbanist/700.css'

// P845 — the Fulfillment (VA) frame, built from the agent shell (TemplateFrame): glass pill tabs up top, the floating
// rail of actions, the rolling title with three headline numbers, the photo backdrop, light and dark. Same pieces
// (kit, motion, Palette, flow.css); VA content. Sample info only (./data), at /template/fulfillment and the real VA URLs.
const ICONS = { overview: Home, calendar: CalendarDays, clients: Users, schedule: Clock3, pay: Wallet, training: GraduationCap }
const PAGES = [...FUL_TABS.map(([k, label]) => ({ to: () => fp(k), label })), { to: () => fp('training'), label: 'Training' }, { to: () => fp('messages'), label: 'Messages' }, { to: () => fp('settings'), label: 'Settings' }]
const money = usd()
// P907: a Calendar item still to call (sample rows carry done; a real call row is open while booked).
const openItem = k => (k.done != null ? !k.done : k.status === 'booked')

function BellDrawer({ open, onClose }) {
  const { data: items } = useFulFeed()
  return (
    <Drawer open={open} onClose={onClose} title="Notifications" sub="What happened lately">
      {!items.length && <FirstRun icon={Bell} title="Nothing yet" sub="Calls booked for you, agents' requests and payouts show here." />}
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
  const keep = useKeep(open)
  if (!keep) return null
  const pick = id => { onClose(); navigate(fp('calendar', id)) }
  return (
    <Drawer open={open} center onClose={onClose} title="Log a call" sub="Pick the call. Its result is saved on the call.">
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

// Book for an agent: the caller on the line (an incoming call whose live transfer didn't connect, P880), the agent, a
// day and a time. Lands on the agent's calendar (sample only). P907: VAs never see new leads, so this opens only from
// the phone's transfer card for the person on the call; there is no Queue to pick from.
// P854: the time is the person's (their zone from state + city, or picked), inside the agent's hours on the agent's
// clock, and never within the agent's appointment length + buffer of another appointment (lib/callSlots agentSlots).
const APPT_CLOCKS = clocksBetween(8 * 60, 20 * 60) // the person's 8 AM to 8 PM; the agent's hours filter it
export function BookForAgent({ open, onClose, person = null }) {
  const { data: agents } = useFulAgents()
  const book = useVaBooking()
  const note = useNote()
  const clock = useFulClock()
  const BOOK_DAYS = clock.bookDays.slice(0, 4)
  const [picked, setAgent] = useState(null)
  const [date, setDate] = useState(BOOK_DAYS[0][1])
  const [time, setTime] = useState('')
  const who = person ? { name: person.name, phone: person.number, city: person.city || '', state: person.state || '' } : null
  // P881 (N-C-22, N-A-12): only an agent licensed in the person's state can be booked; the database refuses the rest.
  const where = who?.checklist?.state || who?.state || null
  const agent = picked || (agents.find(a => licensedIn(a, where)) || agents[0])?.id
  const ag = agents.find(x => x.id === agent)
  const licensed = licensedIn(ag, where)
  const zone = useClientZone(who?.checklist?.state || who?.state, who?.city)
  const appts = useAgentAppts(agent)
  const slots = ag ? agentSlots({ date: clock.isoOf(date), clocks: APPT_CLOCKS, clientTz: zone.tz, appts, length: ag.appt?.length, buffer: ag.appt?.buffer, hours: { tz: ag.tz, open: ag.open, close: ag.close, days: ag.days } }) : []
  const pick = licensed ? slots.find(x => x.clock === time && x.open && x.iso >= clock.nowIso) : null
  const keep = useKeep(open)
  if (!keep) return null
  if (!who || !ag) {
    return <Drawer open={open} center onClose={onClose} title="Book for an agent" sub={who ? 'No agents yet.' : 'Nobody on the line.'}><p className="fx-calm">{who ? 'Agents you serve show here once they join.' : 'Book a caller with an agent from the call, when the transfer does not connect.'}</p></Drawer>
  }
  const gap = (ag.appt?.length || DEFAULT_APPT_MIN) + (ag.appt?.buffer || 0)
  const save = () => {
    const when = `${clock.dayName(date)}, ${clock.dateText(date)}, ${time} ${zoneAbbr(zone.tz, pick.iso)} (their time)`
    note(`${who.name} booked with ${ag.name}, ${when}`)
    onClose()
  }
  return (
    <Drawer open={open} center onClose={onClose} title="Book for an agent" sub={<>It goes on the agent's calendar inside their hours. <HelpDot lesson="booking" inline /></>}
      footer={<><button type="button" className="tp-primary fx-accent" disabled={!pick} onClick={save}><CalendarCheck size={16} />Book it</button><button type="button" className="tp-btn ov-ghost" onClick={onClose}>Cancel</button></>}>
      <p className="tp-mid">{who.name}{who.city ? ` · ${who.city}, ${who.state}` : ''}</p>
      <div className="tp-field"><span>Agent</span>
        <PillTabs role="radiogroup" label="Agent" className="fx-chips" itemClass="fx-chip fs-agent" value={agent} onChange={a => { setAgent(a); setTime('') }}
          items={agents.map(a => ({ key: a.id, label: <><Avatar name={a.name} /><b>{a.name.split(' ')[0]}</b>{!licensedIn(a, where) && <small className="fs-unlic">{where ? `not in ${where}` : 'state?'}</small>}</> }))} />
        <small className="tp-sub">{ag.hours}, {zoneAbbr(ag.tz)} · {ag.states ? `licensed in ${ag.states.join(', ')}` : 'licence states not connected yet'}</small>
        {!licensed && <p className="lic-va-warn" role="alert"><ShieldAlert size={13} aria-hidden="true" />{!ag.states ? `We can't see ${ag.name.split(' ')[0]}'s licence states yet, so booking stays off. Leave it for the team.` : where ? `${ag.name.split(' ')[0]} isn't licensed in ${where}. Pick an agent who is, or leave it for the team.` : "Confirm the person's state on the call first."}</p>}
      </div>
      <SlotPick days={BOOK_DAYS} day={date} onDay={setDate} slots={slots} value={time} onPick={setTime} zone={zone} place={`${who.city}, ${who.checklist?.state || who.state}`} viewerTz={book.viewerTz}
        notBefore={clock.nowIso} hint={`Inside ${ag.name.split(' ')[0]}’s hours. Greyed-out times are within ${gap} minutes of another appointment.`} />
    </Drawer>
  )
}

function Help({ open, onClose, onBug }) {
  const keep = useKeep(open)
  if (!keep) return null
  return (
    <Drawer open={open} center onClose={onClose} title="Help and support" sub="Ask an agent about a client, or the Ohvara team about anything else.">
      <ul className="tp-list">
        {/* P876: Report a bug, the same pop-up in all three portals (ReportBug) */}
        <li><button type="button" className="fx-mrow" onClick={() => { onClose(); onBug() }}><Bug size={17} aria-hidden="true" /><span className="tp-grow"><b>Report a bug</b><small>Something broken or not working right</small></span><ChevronRight size={15} aria-hidden="true" /></button></li>
        <li><Link to={fp('messages')} className="fx-mrow" onClick={onClose}><MessageSquare size={17} aria-hidden="true" /><span className="tp-grow"><b>Message an agent</b><small>About one of their clients</small></span><ChevronRight size={15} aria-hidden="true" /></Link></li>
        <li><a href={`mailto:${SUPPORT_EMAIL}`} className="fx-mrow"><Mail size={17} aria-hidden="true" /><span className="tp-grow"><b>Email support</b><small>{SUPPORT_EMAIL}</small></span><ChevronRight size={15} aria-hidden="true" /></a></li>
        <li className="fx-mrow"><ShieldCheck size={17} aria-hidden="true" /><span className="tp-grow"><b>Coverage or advice questions</b><small>Those go to the client's agent. Use Send to agent on the step.</small></span></li>
        <li className="fx-mrow"><Keyboard size={17} aria-hidden="true" /><span className="tp-grow"><b>Search anything</b><small>Press Ctrl K (Cmd K on a Mac)</small></span></li>
      </ul>
    </Drawer>
  )
}

// The avatar menu: this shift and a day off, theme, account pages, sign out. (P846: no Active or Away; VAs work set hours.)
function AccountMenu({ open, onClose, theme, setTheme, onAsk, onApp }) {
  const account = useAccount()
  const note = useNote()
  const { data: shift } = useFulShift()
  useEffect(() => {
    if (!open) return undefined
    const onKey = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
  const [shown, leaving] = useExit(open, 200)
  if (!shown) return null
  const links = [['calendar', 'Calendar', CalendarDays], ['training', 'Training', GraduationCap], ['pay', 'Pay', Wallet], ['settings', 'Settings', Settings], ['messages', 'Messages', MessageSquare]]
  return (
    <div className={`tp fx-layer fx-menu-layer${leaving ? ' is-leaving' : ''}`} role="presentation">
      <button type="button" className="fx-scrim is-clear tp-bare" aria-label="Close menu" tabIndex={-1} onClick={onClose} />
      <section className="fx-menu" role="dialog" aria-label="Your account">
        <header className="fx-menu-h"><span className={`fx-av av-${avatarHue(account.name)}`}>{initials(account.name).toUpperCase()}</span><span className="tp-grow"><b>{account.name}</b><small>Fulfillment</small></span></header>
        <Link to={fp('schedule')} className="fx-mrow" onClick={onClose}>
          <Clock3 size={17} aria-hidden="true" /><span className="tp-grow"><b>{shift.notSet ? 'Your rota isn’t set up yet' : shift.onToday ? `Your shift today ${shift.shift.text}` : 'You are off today'}</b><small>Your hours, time off and who is on</small></span><ChevronRight size={15} aria-hidden="true" />
        </Link>
        <button type="button" className="fx-mrow" onClick={() => { onClose(); onAsk() }}><CalendarOff size={17} aria-hidden="true" /><b className="tp-grow">Request a day off</b></button>
        <button type="button" className="fx-mrow" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? <Sun size={17} aria-hidden="true" /> : <Moon size={17} aria-hidden="true" />}<b className="tp-grow">{theme === 'dark' ? 'Light mode' : 'Dark mode'}</b></button>
        <button type="button" className="fx-mrow" onClick={() => { onClose(); onApp() }}><Smartphone size={17} aria-hidden="true" /><b className="tp-grow">Get the phone app</b></button>
        <i className="fx-mline" />
        {links.map(([k, label, Icon]) => <Link key={k} to={fp(k)} className="fx-mrow" onClick={onClose}><Icon size={17} aria-hidden="true" /><b className="tp-grow">{label}</b><ChevronRight size={15} aria-hidden="true" /></Link>)}
        <i className="fx-mline" />
        <button type="button" className="fx-mrow is-danger" onClick={() => (account.live ? account.signOut() : note('Sign out works once you sign in for real'))}><LogOut size={17} aria-hidden="true" /><b className="tp-grow">Sign out</b></button>
      </section>
    </div>
  )
}

// P857 — the + menu: the VA's call actions in one place, like the agent shell's Create menu (same look, same spot,
// fx-cmenu: beside the rail on a desktop, a bottom sheet on a phone). Arrow keys move, Home/End jump, Esc closes and
// puts focus back on the +. Each item does exactly what its old rail button did.
function ActionMenu({ open, onClose, at, items, back }) {
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return undefined
    const list = () => [...(ref.current?.querySelectorAll('[role="menuitem"]') || [])]
    const t = requestAnimationFrame(() => list()[0]?.focus())
    const onKey = e => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); back.current?.focus(); return }
      const l = list()
      if (!l.length) return
      const i = l.indexOf(document.activeElement)
      const go = n => { e.preventDefault(); l[(n + l.length) % l.length].focus() }
      if (e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey)) go(i + 1)
      else if (e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey)) go(i - 1)
      else if (e.key === 'Home') go(0)
      else if (e.key === 'End') go(l.length - 1)
    }
    window.addEventListener('keydown', onKey)
    return () => { cancelAnimationFrame(t); window.removeEventListener('keydown', onKey) }
  }, [open, onClose, back])
  // P914: plays its way out like the avatar menu (fx-menu-out)
  const [shown, leaving] = useExit(open, 200)
  if (!shown) return null
  return (
    <div className={`tp fx-layer fx-menu-layer${leaving ? ' is-leaving' : ''}`} role="presentation">
      <button type="button" className="fx-scrim is-clear tp-bare" aria-label="Close menu" tabIndex={-1} onClick={onClose} />
      <section ref={ref} className="fx-menu fx-cmenu fs-cmenu" role="menu" aria-label="Calls and more" style={at || undefined}>
        <p className="fx-cmenu-h">Calls and more</p>
        {items.map((it, i) => (it === 'line' ? <i key={`l${i}`} className="fx-mline" /> : (
          <button key={it.key} type="button" role="menuitem" className="fx-mrow" onClick={() => { onClose(); it.run() }}>
            <it.icon size={17} aria-hidden="true" /><span className="tp-grow"><b>{it.label}</b><small>{it.sub}</small></span>
            {it.count > 0 && <span className="fx-tb" aria-hidden="true">{it.count}</span>}
          </button>
        )))}
      </section>
    </div>
  )
}

// P876 — the live call's timer on the rail's phone icon (and the top bar's on a phone), so a call slid away is never lost.
function RailTimer({ since }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t) }, [])
  return <span className="fs-ri-time tp-num" aria-hidden="true">{since ? clock(Math.max(0, now - since) / 1000) : '0:00'}</span>
}

// Three headline numbers beside the title: what a VA checks first on that page.
function useHeadStats(page) {
  const { data: day } = useFulDay()
  const { data: pay } = useFulPay()
  const { data: clients } = useFulClients()
  const { data: agents } = useFulAgents()
  const { data: settings } = useFulSettings()
  const { data: shift } = useFulShift()
  const { data: sched } = useFulSchedule()
  const { weeks } = useFulClock()
  const account = useAccount()
  const { sum: tr } = useTraining(account.name)
  const real = useFulSource() === 'real'
  const { check } = useDayOffActions()
  const offRoom = check({ date: real ? companyDay() : (shift.days || []).flat().find(d => d.today)?.date || '' })
  const S = (icon, n, label, extra = {}) => ({ icon, n, label, ...extra })
  const todayLeft = day.today.filter(openItem).length
  const doneToday = day.today.length - todayLeft
  const kinds = new Set(day.today.filter(openItem).map(k => k.type || 'cancel_old')).size
  const weekCancelled = day.week.filter(k => k.status === 'cancelled').length
  const att = clients.filter(c => c.stage === 'needs_attention').length
  return {
    overview: [S(PhoneCall, day.today.length, 'booked calls today', { chip: [`${doneToday} done`, 'up'] }), S(Clock3, todayLeft, 'still to call', { chip: day.next ? [`next ${day.next.time}`, 'blue'] : null }), S(Wallet, real ? 0 : weekPay().pay, 'earned this week', { fmt: money })],
    calendar: [S(PhoneCall, todayLeft, 'calls left today', { chip: day.next ? [`next ${day.next.time}`, 'blue'] : null }), S(CalendarCheck, sched.filter(i => weeks[0].includes(i.day)).length, 'booked this week', { chip: kinds > 1 ? [`${kinds} kinds today`, 'up'] : null }), S(CheckCircle2, weekCancelled, 'old policies cancelled', { chip: ['Confirmed', 'up'] })],
    clients: [S(Users, clients.length, 'clients'), S(ShieldCheck, agents.length, 'agents you serve'), S(TriangleAlert, att, 'need attention', { chip: att ? ['See who', 'warn'] : null })],
    // P918: Schedule is the VA's own hours.
    schedule: [S(CalendarCheck, shift.thisWeek || 0, 'shifts this week', { chip: shift.onToday ? ['On today', 'up'] : null }), S(Clock3, real ? 0 : weekPay().hours, 'hours this week', { fmt: n => (real ? '0' : n.toFixed(1)) }), S(CalendarOff, Math.max(0, offRoom.allowance - offRoom.used), 'days off left this month')],
    // P946: pay is hourly (P879/P945): what's earned so far, the hours, and days off left. No per-cancellation pay.
    pay: [S(Wallet, real ? 0 : weekPay().pay, 'earned this week', { fmt: money, chip: [`${money(pay.lastWeek)} last week`, 'blue'] }), S(Clock3, real ? 0 : weekPay().hours, 'hours this week', { fmt: n => (real ? '0' : n.toFixed(1)) }), S(CalendarOff, Math.max(0, offRoom.allowance - offRoom.used), 'days off left this month')],
    training: [S(GraduationCap, tr.passed, `of ${tr.total} lessons passed`, { chip: tr.complete ? ['Complete', 'up'] : null }), S(Trophy, tr.avg == null ? 0 : Math.round(tr.avg * 100), 'average check score', { fmt: n => `${n}%` }), S(Clock3, tr.left, 'lessons to go', { chip: tr.left ? ['Next one open', 'blue'] : null })],
    settings: [S(CalendarCheck, shift.thisWeek, 'shifts this week'), S(Users, agents.length, 'agents you serve'), S(Bell, settings.notifications.filter(n => n.push).length, 'alerts switched on')],
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
  const { data: feed } = useFulFeed() // P934: the bell's count is what's really in it (no fixed 3)
  const active = fulPageOf(pathname)
  const page = usePageSwap(active || 'overview', outlet)
  const layout = page.key
  const title = fulTitleOf(layout)
  const stats = useHeadStats(layout)
  // P911: the top-right Messages icon shows selected while Messages is open; a second click closes it to Overview.
  const msg = useMessagesToggle(active === 'messages', fp('overview'))
  const { data: { timeZone: fulTz } } = useFulSettings()
  const { data: day } = useFulDay()
  const { data: clients } = useFulClients()
  const { data: tasks } = useFulTasks()
  const { bookCallback } = useFulActions()
  const live = useFulLive()
  const source = useFulSource()
  const isTest = useIsTestAccount() // P929: no sample line on test accounts
  const status = useFulStatus()
  const { sum: trainSum } = useTraining(account.name)
  const trainLeft = trainSum.left
  const close = useCallback(() => setPanel(null), [])
  const open = which => e => { wig.onClick(e); setPanel(which) }
  // P914: the avatar toggles its menu (a second click closes it, with the menu's close animation), as on the agent side
  const toggleMenu = e => { wig.onClick(e); setPanel(p => (p === 'menu' ? null : 'menu')) }
  const menuOn = panel === 'menu'
  const flipTheme = e => { wig.onClick(e); setTheme(theme === 'dark' ? 'light' : 'dark') }
  const left = day.today.filter(openItem).length
  const callNow = () => { if (day.next) navigate(fp('calendar', day.next.id)); else { navigate(fp('calendar')); note('No more calls today') } }

  // P876 — the phone is a call screen that slides in over the page from the right (./Phone), with its own open state
  // beside the frame's panels (./phoneDock). It stays mounted, so a call keeps going while it is slid away. It opens only
  // from the rail's phone icon (the top bar's on a phone), which rings for an incoming call and shows a green pulse and
  // the timer while a call is live. A ring slides it in by itself. Opening any other panel slides it away, so it never
  // sits over a menu or a drawer's buttons. It never changes the page's layout (no margins, ful.css).
  const [dock, dockDo] = useReducer(dockReducer, initialDock)
  const openPhone = useCallback(() => { setPanel(null); dockDo({ type: 'open' }) }, [])
  const togglePhone = useCallback(() => { setPanel(null); dockDo({ type: 'toggle' }) }, [])
  const closePhone = useCallback(() => dockDo({ type: 'close' }), [])
  const ring = useCallback(id => { setPanel(null); dockDo({ type: 'ring', id }) }, [])
  const onAnswer = useCallback(() => dockDo({ type: 'answer' }), [])
  const onDecline = useCallback(() => dockDo({ type: 'miss', declined: true }), [])
  const onLine = useCallback((l, since) => dockDo({ type: 'line', line: l, since }), [])
  const onLock = useCallback(locked => dockDo({ type: 'lock', locked }), [])
  const line = railState(dock) // the rail icon: 'ringing' | 'live' | 'after' | null
  const badge = dockBadge(dock)
  useEffect(() => { if (panel) dockDo({ type: 'close' }) }, [panel])
  // A ring nobody answers gives up after RING_MS and shows as a missed call on the rail icon.
  useEffect(() => {
    if (!dock.ringId) return undefined
    const t = setTimeout(() => dockDo({ type: 'miss' }), RING_MS)
    return () => clearTimeout(t)
  }, [dock.ringId])
  const liveNow = () => { if (day.next) ring(day.next.id); else note('No call coming in') }
  // A Call button (a call's drawer, a lead, a servicing step) sets the store's live request: the phone slides in and
  // the call starts on that person. A request is a call id, or { kind: 'lead' | 'task' | 'client', id }.
  const [startReq, setStartReq] = useState(null)
  const startFor = useCallback(req => { setStartReq(r => ({ req, n: (r?.n || 0) + 1 })); openPhone() }, [openPhone])
  const [bookFor, setBookFor] = useState(null)
  const onBook = useCallback(person => { setBookFor(person); setPanel('book') }, [])
  // P907: a missed incoming call becomes a booked callback on the Calendar (the system picks the time), never a queue.
  const missedN = dock.missed.length
  const seenMissed = useRef(missedN)
  useEffect(() => {
    const was = seenMissed.current
    seenMissed.current = missedN
    if (missedN <= was) return
    const m = dock.missed[0] // newest first (phoneDock)
    const k = day.today.find(x => (x.ref || x.id) === m?.id)
    const c = k?.row?.client || k?.client
    if (!c || !bookCallback) return
    bookCallback({ name: k.name, phone: c.client_phone, city: c.city, state: c.state, clientId: c.lead ? null : c.id, agentId: c.agent_id, why: 'missed_call', note: 'Called in and nobody picked up in time.' })
    note(`Missed ${k.name.split(' ')[0]}'s call. A callback is booked on your Calendar`)
  }, [missedN, dock.missed, day.today, bookCallback, note])
  const phoneLabel = line === 'live' ? `Phone, on a call, ${dock.open ? 'showing' : 'slid away'}` : line === 'ringing' ? 'Phone, a call is coming in' : line === 'after' ? 'Phone, save the result of the call' : badge ? `Phone, ${badge.label}` : 'Phone'
  const phoneIcon = cls => (
    <button type="button" className={`${cls} tp-wig${line ? ` is-${line}` : ''}`} aria-label={phoneLabel} aria-haspopup="dialog" aria-expanded={dock.open}
      data-tip={line === 'live' ? 'Phone: on a call' : line === 'ringing' ? 'Phone: a call is coming in' : 'Phone'} {...wig} onClick={e => { wig.onClick(e); togglePhone() }}>
      <Phone size={18} />
      {line === 'live' && <RailTimer since={dock.since} />}
      {line === 'ringing' && <i className="fs-ri-dot" aria-hidden="true" />}
      {line === 'after' && <i className="fs-ri-dot is-after" aria-hidden="true" />}
      {!line && badge && <span className="fx-badge is-missed" aria-hidden="true">{badge.n}</span>}
    </button>
  )

  // The + menu opens beside the rail button on a desktop (a bottom sheet on a phone), like the agent's.
  const [menuAt, setMenuAt] = useState(null)
  const plusFrom = useRef(null)
  const openCreate = e => {
    wig.onClick(e)
    plusFrom.current = e.currentTarget
    const r = e.currentTarget.getBoundingClientRect()
    const wide = window.innerWidth >= 1000
    setMenuAt(wide ? { left: `${Math.round(r.right + 14)}px`, top: `${Math.round(Math.max(12, Math.min(r.top - 8, window.innerHeight - 400)))}px` } : null)
    setPanel('create')
  }
  const actions = [
    { key: 'next', icon: AlarmClock, label: 'Next call', sub: day.next ? `${day.next.name} at ${day.next.time}` : 'No more calls today', count: left, run: callNow },
    { key: 'live', icon: Headset, label: 'Live call', sub: 'The call coming in now', run: liveNow },
    { key: 'log', icon: NotebookPen, label: 'Log a call', sub: 'Save the result on the call', run: () => setPanel('log') },
    'line',
    { key: 'dayoff', icon: CalendarOff, label: 'Request a day off', sub: 'Tell the team ahead of time', run: () => setPanel('dayoff') },
  ]

  // Search: clients across every agent, booked calls and client steps, and the pages.
  const rows = useMemo(() => ({
    clients: clients.map(c => ({ id: `c-${c.id}`, name: c.name, sub: `${c.agent}'s client · ${c.carrier_name}`, hay: `${c.name} ${c.client_phone} ${c.agent} ${c.policy_number}`, go: () => fp('clients', c.id) })),
    policies: tasks.filter(t => t.due !== 'done').map(t => ({ id: `t-${t.id}`, name: t.name, sub: `${t.iso ? 'Booked' : 'Client step'} · ${t.due_text}`, hay: `${t.name} ${t.kind.replace(/_/g, ' ')} ${t.client?.client_phone || ''}`, go: () => (t.iso && t.mine !== false ? fp('calendar', t.id) : t.client_id ? fp('clients', t.client_id) : fp('calendar', t.id)) })),
  }), [clients, tasks])

  const appRef = useRef(null)
  useLayoutEffect(() => {
    const el = appRef.current
    if (!el) return undefined
    let stop = () => {}
    // P859/P860: it then gets SETTLE_MS to really run; if it has not (a throttled or frozen browser), the page shows at rest
    // (.is-settled, flow.css). Reduced motion shows at once. The body never waits on an animation.
    const raf = requestAnimationFrame(() => { el.classList.add('is-anim'); stop = armEntrance(el, { still: still(), rootClass: 'fx-settled' }) })
    const onVis = visibilityGate(el) // P917: back from another tab, the motion comes back
    document.addEventListener('visibilitychange', onVis)
    return () => { cancelAnimationFrame(raf); stop(); document.removeEventListener('visibilitychange', onVis) }
  }, [layout])
  useEffect(() => () => document.documentElement.classList.remove('fx-settled'), [])

  useEffect(() => {
    const onKey = e => { if (isSearchKey(e)) { e.preventDefault(); setPanel(p => (p === 'search' ? null : 'search')) } }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Sample: a call "comes in" about 20 seconds after you land, once per visit, so the live-call screen can be seen.
  // Automated browsers skip it (they use the rail button), so a test click is never covered.
  const nextId = day.next?.id
  useEffect(() => {
    if (!nextId || navigator.webdriver || source === 'real') return undefined
    try { if (sessionStorage.getItem('ful-live-pop') === '1') return undefined } catch { /* no storage: it pops once per load */ }
    const t = setTimeout(() => {
      try { sessionStorage.setItem('ful-live-pop', '1') } catch { /* private window: it can pop again */ }
      if (!document.hidden) ring(nextId)
    }, 20000)
    return () => clearTimeout(t)
  }, [nextId, ring, source])

  const tops = (
    <>
      <NavLink to={fp('messages')} className={`fx-ib tp-wig${msg.closing ? ' is-closing' : ''}`} aria-label={active === 'messages' ? 'Close Messages' : 'Messages'} {...wig} onClick={e => { wig.onClick?.(e); msg.onClick(e) }}><MessageSquare size={18} />{day.unread > 0 && <span className="fx-badge">{day.unread}</span>}</NavLink>
      <button type="button" className="fx-ib tp-wig is-bell" aria-label="Notifications" {...wig} onClick={open('bell')}><Bell size={18} />{feed.length > 0 && <span className="fx-badge">{Math.min(9, feed.length)}</span>}</button>
    </>
  )

  return (
    <div className={`tp tp-app fx fs is-${layout}`} ref={appRef}>
      <div className="tp-sky" aria-hidden="true"><i /><i /><i /></div>

      <header className={`tp-phone-top fx-ptop${menuOn ? ' is-menu' : ''}`}>
        <Link to={fp('overview')} className="fx-brand" aria-label="Ohvara home"><OhvaraMark height={28} back="var(--ov-mark-back)" front="var(--ov-mark-front)" className="fx-mark" /></Link>
        <span className="tp-grow" />
        {phoneIcon('fx-ib fs-top-phone')}
        {tops}
        <button type="button" className={`fx-me tp-wig av-${avatarHue(account.name)}`} aria-label="Menu" aria-haspopup="dialog" aria-expanded={menuOn} {...wig} onClick={toggleMenu}>{initials(account.name).toUpperCase()}</button>
      </header>

      <Link to={fp('overview')} className="fx-brand fx-brand-page" aria-label="Ohvara home"><OhvaraMark height={30} back="var(--ov-mark-back)" front="var(--ov-mark-front)" className="fx-mark" /><b>ohvara</b></Link>
      <header className={`tp-top fx-top${menuOn ? ' is-menu' : ''}`}>
        <span className="fx-top-gap" aria-hidden="true" />
        <PillTabs as="nav" label="Pages" className="tp-tabs fx-tabs" itemClass="tp-tab fx-tab" value={FUL_TABS.some(([k]) => k === active) ? active : null} persistKey="ful-tabs"
          items={FUL_TABS.map(([k, label]) => ({ key: k, to: fp(k), label }))} />
        <div className="fx-tr">
          {tops}
          <button type="button" className={`tp-me fx-me tp-wig av-${avatarHue(account.name)}`} aria-label={`Your account, ${account.name}`} aria-haspopup="dialog" aria-expanded={menuOn} {...wig} onClick={toggleMenu}>{initials(account.name).toUpperCase()}</button>
        </div>
      </header>

      <aside className="tp-rail fx-rail" aria-label="Actions">
        <button type="button" className="tp-ri fx-ri tp-wig" aria-label="Search (Ctrl K)" data-tip="Search  Ctrl K" {...wig} onClick={open('search')}><Search size={20} /></button>
        <i className="fx-hair" />
        {/* P857: one + for the call actions (it was four phone-looking buttons in a row) */}
        <button type="button" className="fx-ri fx-rplus tp-wig" aria-label="Calls and more" aria-haspopup="menu" aria-expanded={panel === 'create'} data-tip={left ? `Calls and more · ${left} calls left today` : 'Calls and more'} {...wig} onClick={openCreate}><Plus size={20} />{left > 0 && <span className="fx-badge" aria-hidden="true">{left}</span>}</button>
        <i className="fx-hair" />
        <NavLink to={fp('messages')} className="fx-ri tp-wig" aria-label="Messages" data-tip="Messages" {...wig}><MessageSquare size={18} />{day.unread > 0 && <span className="fx-badge">{day.unread}</span>}</NavLink>
        <NavLink to={fp('calendar')} className="fx-ri tp-wig" aria-label="Calendar" data-tip="Calendar" {...wig}><CalendarDays size={18} /></NavLink>
        {/* P931: Training lives on the rail only (not a header tab), with lessons still to do as its badge */}
        <NavLink to={fp('training')} className="fx-ri tp-wig" aria-label={trainLeft ? `Training, ${trainLeft} lessons to go` : 'Training'} data-tip="Training" {...wig}><GraduationCap size={18} />{trainLeft > 0 && <span className="fx-badge">{trainLeft}</span>}</NavLink>
        <i className="fx-hair" />
        {phoneIcon('fx-ri fs-ri-phone')}
        <i className="fx-hair" />
        <button type="button" className="fx-ri tp-wig" aria-label="Get the phone app" aria-expanded={panel === 'app'} data-tip="Get the phone app" {...wig} onClick={open('app')}><Smartphone size={18} /></button>
        <button type="button" className="fx-ri tp-wig" aria-label="Help and support" aria-expanded={panel === 'help'} data-tip="Help and support" {...wig} onClick={open('help')}><CircleHelp size={18} /></button>
        <i className="fx-hair" />
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
          {/* P847 + P860 + P864: the live clock, one line on the title row, Overview only, in the zone from Settings */}
          {layout === 'overview' && <LiveClock tz={fulTz} />}
        </div>

        <main className={`tp-main fx-main fs-main${page.leaving ? ' is-leaving' : ''}`} key={page.key}>
          {status.error ? <DataError onRetry={status.retry} /> : status.loading ? <DataLoading /> : page.el}
          {!isTest && source !== 'real' && <p className="tp-foot">Sample info. Changes reset when you reload.</p>}
        </main>
      </div>

      <nav className="tp-bar fx-bar" aria-label="Pages">
        {['overview', 'clients'].map(k => { const I = ICONS[k]; return <Link key={k} to={fp(k)} className={`fx-btab${active === k ? ' is-on' : ''}`}><I size={20} aria-hidden="true" />{k === 'overview' ? 'Overview' : 'Clients'}</Link> })}
        <button type="button" className="fx-btab is-plus" aria-label="Calls and more" aria-haspopup="menu" aria-expanded={panel === 'create'} onClick={openCreate}><span className="fx-bplus"><Plus size={24} aria-hidden="true" />{left > 0 && <span className="fx-badge" aria-hidden="true">{left}</span>}</span>Calls</button>
        <Link to={fp('calendar')} className={`fx-btab${active === 'calendar' ? ' is-on' : ''}`}><CalendarDays size={20} aria-hidden="true" />Calendar</Link>
        <button type="button" className="fx-btab" aria-label="More" aria-expanded={menuOn} onClick={toggleMenu}><Ellipsis size={20} aria-hidden="true" />More</button>
      </nav>

      {panel === 'search' && <Palette onClose={close} pages={PAGES} rows={rows} placeholder="Search clients, booked calls, pages" />}
      <BellDrawer open={panel === 'bell'} onClose={close} />
      <LogCall open={panel === 'log'} onClose={close} />
      <BookForAgent open={panel === 'book'} onClose={() => { close(); setBookFor(null) }} person={bookFor} key={bookFor?.key || 'any'} />

      <Help open={panel === 'help'} onClose={close} onBug={() => setPanel('bug')} />
      <ReportBug open={panel === 'bug'} onClose={close} role="Fulfillment" />
      <DayOffDrawer open={panel === 'dayoff'} onClose={close} />
      <ActionMenu open={panel === 'create'} onClose={close} at={menuAt} items={actions} back={plusFrom} />
      <GetApp open={panel === 'app'} onClose={close} />
      <FulPhone open={dock.open} onClose={closePhone} ringId={dock.ringId} onAnswer={onAnswer} onDecline={onDecline} onLine={onLine} onLock={onLock} nudge={dock.nudge}
        missed={dock.missed} live={live} onLive={startFor} startReq={startReq} onBook={onBook} />
      {/* P918: the phone slid away during a live call leaves a tab on the right edge, above any open drawer. */}
      {line === 'live' && !dock.open && createPortal(
        <div className="tp fs-edge-layer">
          <button type="button" className="fs-edge" aria-label="Show the phone, on a call" onClick={openPhone}>
            <i className="fs-edge-pulse" aria-hidden="true" /><Phone size={16} aria-hidden="true" /><RailTimer since={dock.since} />
          </button>
        </div>, document.body)}
      <AccountMenu open={panel === 'menu'} onClose={close} theme={theme} setTheme={setTheme} onAsk={() => setPanel('dayoff')} onApp={() => setPanel('app')} />
      <MoreBelow page={layout} />
    </div>
  )
}

