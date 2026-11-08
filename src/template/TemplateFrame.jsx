import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link, NavLink, useLocation, useOutlet } from 'react-router-dom'
import {
  Home, PhoneIncoming, CalendarDays, Users, History, CreditCard, Settings, Search, Bell, Plus, Sun, Moon, MessageSquare,
  PhoneCall, LifeBuoy, Radio, ChevronRight, LogOut, ShieldCheck, Ellipsis, FileUp, TriangleAlert, Wallet, CalendarCheck, Clock3,
  Smartphone, CircleHelp, StickyNote, PhoneOutgoing, Mail, Keyboard, Bug,
} from 'lucide-react'
import { useTheme } from '../hooks/useTheme'
import {
  useSampleActivity, useSampleClients, useSampleLeads, useSampleThreads, useSampleBilling, useSampleAppointments, useSampleSettings, useSampleActions, useSampleNeeds, useDataStatus, useDataSource,
} from './data'
import { NeedRows, FyiList } from './NeedsNow'
import { useNeedAction } from './needAction'
import { Drawer, Avatar, Field, PillTabs, Seg, useAccount, useNote, initials } from './kit'
import { ReportBug } from './ReportBug'
import { avatarHue } from './avatarHue'
import ViewToggle from './ViewToggle'
import { DataLoading, DataError } from './DataState'
import { wig, still, CountUp, RollTitle, usePageSwap, usd, useExit } from './motion'
import { armEntrance } from '../adminshell/entrance'
import { paths, tabOf, titleOfLayout, layoutOf, isTemplateAddress } from './paths'
import Palette from './Palette'
import { Select } from './Select'
import { CallTime } from './CallTime'
import { EMPTY_CALL_TIME, callTimeReady, callTimeText } from './callTimeModel'
import { BOOK_DAYS, isoOf } from './carriers'
import { CarrierSelect } from './CarrierSelect'
import { agentBooksCall } from './ful/data'
import { SlotPick } from './SlotPick'
import { useClientZone } from './useClientZone'
import { AGENT_TZ } from './data'
import { inLiveHours } from '../lib/leadSplit'
import { agentSlots, clocksBetween, timeLines } from '../lib/callSlots'
import { LiveClock } from './Clock'
import { OhvaraMark } from '../components/ui/OhvaraMark'
import { isSearchKey } from '../lib/searchKey'
import { needsResult } from './agentView'
import { appLink, loadAppConfig } from '../lib/appConfig'
import { openExternal } from '../lib/native'
import { STORES, STORES_SOON, appQr } from '../lib/appStores'
import { dailyTotal, rangeWords, tierOf } from './spendPlan'
import { TalkDrawer, TalkStatus } from './Talk'
import { SUPPORT_EMAIL } from '../components/auth/authUtils'
import './glass.css'
import './flow.css'
import './palette.css'
import './fit867.css'
import './p893.css'
import MoreBelow from './MoreBelow'
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

// P873: the bell leads with Needs you now (each with its one action), then the quiet FYI list, then the latest activity.
function BellDrawer({ open, onClose }) {
  const { data: items } = useSampleActivity()
  const { data: needs } = useSampleNeeds()
  const act = useNeedAction(onClose)
  return (
    <Drawer open={open} onClose={onClose} title="Notifications" sub={needs.now.length ? `${needs.now.length} need you now` : 'Nothing needs you right now'} footer={<Link to={paths.activity()} className="tp-btn ov-ghost" onClick={onClose}>See all activity</Link>}>
      <section className="lc-bell" aria-label="Needs you now">
        <h3 className="lc-h">Needs you now</h3>
        {needs.now.length ? <NeedRows items={needs.now} onAct={act} /> : <p className="tp-sub">You are all caught up. New calls, replies and outcomes to mark show here first.</p>}
      </section>
      <FyiList items={needs.fyi} onPick={onClose} />
      <section className="lc-bell" aria-label="Lately">
        <h3 className="lc-h">Lately</h3>
        {items.length ? <ul className="tp-list">
          {items.slice(0, 4).map(a => <li key={a.id} className="tp-li"><Avatar name={a.who} /><span className="tp-grow"><b>{a.who}</b><small>{a.text}</small></span><small>{a.at}</small></li>)}
        </ul> : <p className="tp-sub">Nothing has happened yet.</p>}
      </section>
    </Drawer>
  )
}

// Book a call. P847: three kinds. An appointment or check-in goes on the agent's own calendar (as before). A
// cancellation call or a service call is fulfillment's: while the agent has the client on the phone they can book an
// exact time (it lands on the on-shift VA's Schedule), give the best time to reach them, or leave it to the team.
// P854: every time is picked on the client's clock (SlotPick). An appointment can't overlap another one on the
// agent's calendar (lib/callSlots agentSlots: the agent's length + buffer, 30 minutes when there's no setting).
const DAYS = [['Mon', 2], ['Tue', 3], ['Wed', 4], ['Thu', 5], ['Fri', 6]]
const APPT_CLOCKS = clocksBetween(8 * 60, 20 * 60) // the client's 8 AM to 8 PM; the agent's hours filter it
const AGENT_HOURS = { open: 9 * 60, close: 18 * 60, days: [1, 2, 3, 4, 5] } // "Working hours 9:00 AM to 6:00 PM"
const CALL_KINDS = [{ key: 'appt', label: 'Appointment' }, { key: 'cancellation', label: 'Cancellation call' }, { key: 'service', label: 'Service call' }]
const SERVICE_WHAT = ['Change address', 'Update phone', 'Change beneficiary', 'Change billing date', 'Payment change', 'Policy question', 'Other']
function BookCall({ open, onClose }) {
  const { data: clients } = useSampleClients()
  const { data: leads } = useSampleLeads()
  const { data: events } = useSampleAppointments()
  const { data: settings } = useSampleSettings()
  const { bookCall, bookFulfillmentCall } = useSampleActions()
  const note = useNote()
  const people = useMemo(() => [
    ...clients.map(c => ({ ref: c.id, kind: 'client', who: `${c.client_first_name} ${c.client_last_name}`, label: 'Check-in call', state: c.state, city: c.city, carrier: c.carrier_name })),
    ...leads.filter(l => !['sold', 'not_interested'].includes(l.stage)).map(l => ({ ref: l.id, kind: 'lead', who: `${l.first_name} ${l.last_name}`, label: 'Appointment', state: l.state, city: l.city })),
  ], [clients, leads])
  const [kind, setKind] = useState('appt')
  const [ref, setRef] = useState('')
  const [date, setDate] = useState(3)
  const [time, setTime] = useState('')
  const [oldCarrier, setOldCarrier] = useState('Globe Life')
  const [what, setWhat] = useState(SERVICE_WHAT[0])
  const [ct, setCt] = useState(EMPTY_CALL_TIME)
  const forFul = kind !== 'appt'
  const list = forFul ? people.filter(p => p.kind === 'client' || p.ref === ref) : people
  // A name typed in (not on the list) has no city or state yet: the booker picks the zone.
  const who = list.find(p => p.ref === ref) || (forFul && ref ? { ref, kind: 'client', who: ref, state: '', city: '' } : list[0])
  const myTz = settings.timeZone || AGENT_TZ
  const zone = useClientZone(who?.state, who?.city)
  const place = who?.city ? `${who.city}, ${who.state}` : who?.state || ''
  const slots = agentSlots({ date: isoOf(date), clocks: APPT_CLOCKS, clientTz: zone.tz, appts: events, hours: { tz: myTz, ...AGENT_HOURS } })
  const pick = slots.find(s => s.clock === time && s.open)
  if (!open) return null
  const ready = forFul ? callTimeReady(ct) && (kind !== 'cancellation' || oldCarrier.trim()) : !!pick
  const save = () => {
    if (!forFul) {
      const day = DAYS.find(d => d[1] === date)[0]
      const clientText = timeLines(pick.iso, zone.tz, null, place).client
      bookCall({ ...who, iso: pick.iso, tz: zone.tz, clientText })
      note(`${who.label} with ${who.who} booked for ${day} at ${time}, the client's time`)
    } else {
      const va = agentBooksCall({ who: who.who, state: who.state, city: who.city, oldCarrier, kind, mode: ct.mode, day: ct.day, time: ct.time, iso: ct.iso, tz: ct.tz, vaId: ct.vaId, window: ct.window })
      const day = BOOK_DAYS.find(d => d[1] === ct.day)?.[0]
      bookFulfillmentCall({ who: who.who, kind, mode: ct.mode, day, date: ct.day, time: ct.time, window: ct.window, va: va?.name })
      const label = kind === 'cancellation' ? 'Cancellation call' : 'Service call'
      note(ct.mode === 'exact' ? `${label} with ${who.who} booked for ${callTimeText(ct)}. ${va.name} has it` : ct.mode === 'window' ? `${label} with ${who.who} sent. Best time: ${ct.window.toLowerCase()}` : `${label} with ${who.who} sent. The team sets the time`)
    }
    setCt(EMPTY_CALL_TIME)
    setTime('')
    onClose()
  }
  const sub = forFul ? 'Fulfillment makes this call. Times are the client’s time.' : 'It goes on your calendar. Times are the client’s time.'
  return (
    <Drawer open center onClose={onClose} title="Book a call" sub={sub}
      footer={<><button type="button" className="tp-primary fx-accent" disabled={!ready} onClick={save}><CalendarCheck size={16} />{forFul && ct.mode !== 'exact' ? 'Send to fulfillment' : 'Book it'}</button><button type="button" className="tp-btn ov-ghost" onClick={onClose}>Cancel</button></>}>
      <div className="tp-field"><span>What call</span>
        <Seg label="What call" role="radiogroup" className="fx-callkinds" value={kind} onChange={k => { setKind(k); setRef('') }} options={CALL_KINDS} />
      </div>
      <Field label="Who"><Select label="Who" value={who.ref} onChange={setRef} search={forFul || undefined} allowCustom={forFul}
        options={list.map(p => ({ value: p.ref, label: p.who, sub: p.kind === 'lead' ? 'Lead' : 'Client' }))} /></Field>
      {!forFul && (
        <SlotPick days={DAYS} day={date} onDay={setDate} slots={slots} value={time} onPick={setTime} zone={zone} place={place} viewerTz={myTz}
          hint="Inside your hours, 9:00 AM to 6:00 PM. Greyed-out times are within 30 minutes of another appointment." />
      )}
      {kind === 'cancellation' && <Field label="Carrier they're leaving" hint="Its open hours set the times. Pick one or type it."><CarrierSelect label="Carrier they're leaving" value={oldCarrier} onChange={setOldCarrier} by="agent" /></Field>}
      {kind === 'service' && <Field label="What it's about"><Select label="What it's about" value={what} onChange={setWhat} options={SERVICE_WHAT} /></Field>}
      {forFul && <CallTime kind={kind} value={ct} onChange={setCt} state={who.state} city={who.city} oldCarrier={oldCarrier} viewerTz={myTz} />}
    </Drawer>
  )
}

// Everyone an agent can call or write about: clients and open leads.
function usePeople() {
  const { data: clients } = useSampleClients()
  const { data: leads } = useSampleLeads()
  return useMemo(() => [
    ...clients.map(c => ({ ref: c.id, kind: 'client', who: `${c.client_first_name} ${c.client_last_name}` })),
    ...leads.filter(l => !['sold', 'not_interested'].includes(l.stage)).map(l => ({ ref: l.id, kind: 'lead', who: `${l.first_name} ${l.last_name}` })),
  ], [clients, leads])
}

// Add a note to a client: it shows on the client's page (sample only).
function AddNote({ open, onClose }) {
  const { data: clients } = useSampleClients()
  const { clientAction } = useSampleActions()
  const note = useNote()
  const [ref, setRef] = useState('')
  const [text, setText] = useState('')
  if (!open) return null
  const c = clients.find(x => x.id === ref) || clients[0]
  const save = () => { clientAction(c.id, `Note: ${text.trim()}`); note(`Note added to ${c.client_first_name} ${c.client_last_name}`); setText(''); onClose() }
  return (
    <Drawer open center onClose={onClose} title="Add a note to a client" sub="Only you and the team see it."
      footer={<><button type="button" className="tp-primary fx-accent" disabled={!text.trim()} onClick={save}><StickyNote size={16} />Save note</button><button type="button" className="tp-btn ov-ghost" onClick={onClose}>Cancel</button></>}>
      <Field label="Client"><Select label="Client" value={c?.id} onChange={setRef} options={clients.map(x => ({ value: x.id, label: `${x.client_first_name} ${x.client_last_name}` }))} /></Field>
      <Field label="Note"><textarea className="tp-input fx-ta" rows={4} placeholder="What should the team know?" value={text} onChange={e => setText(e.target.value)} /></Field>
    </Drawer>
  )
}

// Log a call you made yourself, so the record stays whole (sample only).
const RESULTS = ['Reached them', 'Left a voicemail', 'No answer', 'Set a follow-up']
function LogCall({ open, onClose }) {
  const people = usePeople()
  const { clientAction, addLeadNote } = useSampleActions()
  const note = useNote()
  const [ref, setRef] = useState('')
  const [result, setResult] = useState(RESULTS[0])
  const [text, setText] = useState('')
  if (!open) return null
  const who = people.find(p => p.ref === ref) || people[0]
  const save = () => {
    const line = `Call logged: ${result}${text.trim() ? `. ${text.trim()}` : ''}`
    if (who.kind === 'client') clientAction(who.ref, line)
    else addLeadNote(who.ref, line)
    note(`Call with ${who.who} logged`)
    setText('')
    onClose()
  }
  return (
    <Drawer open center onClose={onClose} title="Log a call" sub="A call you made outside Ohvara."
      footer={<><button type="button" className="tp-primary fx-accent" onClick={save}><PhoneOutgoing size={16} />Log it</button><button type="button" className="tp-btn ov-ghost" onClick={onClose}>Cancel</button></>}>
      <Field label="Who"><Select label="Who" value={who.ref} onChange={setRef} options={people.map(p => ({ value: p.ref, label: p.who, sub: p.kind === 'lead' ? 'Lead' : 'Client' }))} /></Field>
      <div className="tp-field"><span>How it went</span>
        <PillTabs role="radiogroup" label="How it went" className="fx-chips" itemClass="fx-chip" value={result} onChange={setResult} items={RESULTS.map(r => ({ key: r, label: <b>{r}</b> }))} />
      </div>
      <Field label="Notes (optional)"><textarea className="tp-input fx-ta" rows={3} value={text} onChange={e => setText(e.target.value)} /></Field>
    </Drawer>
  )
}

// Get the phone app: the one /app link as a QR, plus the store buttons (live once the store links are set).
// P857: exported so the VA rail uses the same sheet.
export function GetApp({ open, onClose }) {
  const [cfg, setCfg] = useState(null)
  const [qr, setQr] = useState(null)
  const link = appLink()
  useEffect(() => {
    if (!open) return undefined
    let on = true
    loadAppConfig().then(c => { if (on) setCfg(c) })
    appQr(link).then(u => { if (on) setQr(u) }).catch(() => {})
    return () => { on = false }
  }, [open, link])
  if (!open) return null
  const live = !!(cfg?.ios || cfg?.android)
  const store = ({ key, label, sub }) => (
    <button key={key} type="button" className="fx-app-store" disabled={!cfg?.[key]} onClick={() => openExternal(cfg[key])}>
      <Smartphone size={16} aria-hidden="true" /><span>{label}<small>{cfg?.[key] ? sub : 'Coming soon'}</small></span>
    </button>
  )
  return (
    <Drawer open center onClose={onClose} title="Get the phone app" sub={live ? 'Your portal on your phone, with alerts.' : STORES_SOON}>
      <div className="fx-app">
        <span className="fx-app-qr">{qr ? <img src={qr} alt={`QR code for ${link}`} width={176} height={176} /> : null}</span>
        <p className="tp-sub">{live ? 'Point your phone camera at the code to get the app.' : 'Scan to open Ohvara on your phone.'}</p>
        <div className="fx-app-stores">{STORES.map(store)}</div>
      </div>
    </Drawer>
  )
}

// Help and support: where to ask, and the one shortcut worth knowing.
function Help({ open, onClose, onBug, onTalk }) {
  if (!open) return null
  return (
    <Drawer open center onClose={onClose} title="Help and support" sub="Ask the team anything about a client or your account.">
      <TalkStatus />
      <ul className="tp-list">
        {/* P878 (N-I-01): a real person calls back, from any screen */}
        <li><button type="button" className="fx-mrow" onClick={() => { onClose(); onTalk() }}><PhoneCall size={17} aria-hidden="true" /><span className="tp-grow"><b>Talk to someone</b><small>Pick a time and a person from Ohvara calls you</small></span><ChevronRight size={15} aria-hidden="true" /></button></li>
        {/* P876: Report a bug, the same pop-up in all three portals (ReportBug) */}
        <li><button type="button" className="fx-mrow" onClick={() => { onClose(); onBug() }}><Bug size={17} aria-hidden="true" /><span className="tp-grow"><b>Report a bug</b><small>Something broken or not working right</small></span><ChevronRight size={15} aria-hidden="true" /></button></li>
        <li><Link to={paths.messages()} className="fx-mrow" onClick={onClose}><MessageSquare size={17} aria-hidden="true" /><span className="tp-grow"><b>Message the team</b><small>Fastest for anything about a client</small></span><ChevronRight size={15} aria-hidden="true" /></Link></li>
        <li><Link to={paths.requestService()} className="fx-mrow" onClick={onClose}><LifeBuoy size={17} aria-hidden="true" /><span className="tp-grow"><b>Request a service</b><small>Changes, cancellations, documents</small></span><ChevronRight size={15} aria-hidden="true" /></Link></li>
        <li><a href={`mailto:${SUPPORT_EMAIL}`} className="fx-mrow"><Mail size={17} aria-hidden="true" /><span className="tp-grow"><b>Email support</b><small>{SUPPORT_EMAIL}</small></span><ChevronRight size={15} aria-hidden="true" /></a></li>
        <li className="fx-mrow"><Keyboard size={17} aria-hidden="true" /><span className="tp-grow"><b>Search anything</b><small>Press Ctrl K (Cmd K on a Mac)</small></span></li>
      </ul>
    </Drawer>
  )
}

// The + menu: everything an agent can start, in one place. On a desktop it opens beside the rail.
function CreateMenu({ open, onClose, at, pick }) {
  useEffect(() => {
    if (!open) return undefined
    const onKey = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open) return null
  const row = (Icon, label, sub) => <><Icon size={17} aria-hidden="true" /><span className="tp-grow"><b>{label}</b><small>{sub}</small></span></>
  return (
    <div className="tp fx-layer fx-menu-layer" role="presentation">
      <button type="button" className="fx-scrim is-clear tp-bare" aria-label="Close menu" tabIndex={-1} onClick={onClose} />
      <section className="fx-menu fx-cmenu" role="menu" aria-label="Create" style={at || undefined}>
        <p className="fx-cmenu-h">Create</p>
        <Link to={paths.submit()} role="menuitem" className="fx-mrow" onClick={onClose}>{row(FileUp, 'Submit a policy', 'A sale for servicing')}</Link>
        <button type="button" role="menuitem" className="fx-mrow" onClick={() => pick('book')}>{row(PhoneCall, 'Book a call', 'Puts it on your calendar')}</button>
        <Link to={paths.requestService()} role="menuitem" className="fx-mrow" onClick={onClose}>{row(LifeBuoy, 'Request a service', 'Changes, cancellations, documents')}</Link>
        <i className="fx-mline" />
        <button type="button" role="menuitem" className="fx-mrow" onClick={() => pick('note')}>{row(StickyNote, 'Add a note to a client', 'Shows on their page')}</button>
        <button type="button" role="menuitem" className="fx-mrow" onClick={() => pick('log')}>{row(PhoneOutgoing, 'Log a call', 'A call you made yourself')}</button>
      </section>
    </div>
  )
}

// The avatar menu: account pages, the Active switch, theme, sign out.
function AccountMenu({ open, onClose, theme, setTheme }) {
  const account = useAccount()
  const note = useNote()
  useEffect(() => {
    if (!open) return undefined
    const onKey = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
  // P843: the menu plays its way out (fx-menu-out) instead of vanishing
  const [shown, leaving] = useExit(open, 200)
  if (!shown) return null
  const links = [[paths.billing, 'Billing', CreditCard], [paths.settings, 'Settings', Settings], [paths.requestService, 'Request a service', LifeBuoy], [paths.more, 'More', Ellipsis]]
  if (isTemplateAddress()) links.push([paths.signup, 'Sign-up preview', ShieldCheck], [paths.welcome, 'Welcome preview', Home])
  return (
    <div className={`tp fx-layer fx-menu-layer${leaving ? ' is-leaving' : ''}`} role="presentation">
      <button type="button" className="fx-scrim is-clear tp-bare" aria-label="Close menu" tabIndex={-1} onClick={onClose} />
      <section className="fx-menu" role="dialog" aria-label="Your account">
        <header className="fx-menu-h"><span className="fx-av">{initials(account.name).toUpperCase()}</span><span className="tp-grow"><b>{account.name}</b><small>Agent</small></span></header>
        <button type="button" className="fx-mrow" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? <Sun size={17} aria-hidden="true" /> : <Moon size={17} aria-hidden="true" />}<b className="tp-grow">{theme === 'dark' ? 'Light mode' : 'Dark mode'}</b></button>
        <ViewToggle />
        <i className="fx-mline" />
        {links.map(([to, label, Icon]) => <Link key={label} to={to()} className="fx-mrow" onClick={onClose}><Icon size={17} aria-hidden="true" /><b className="tp-grow">{label}</b><ChevronRight size={15} aria-hidden="true" /></Link>)}
        <i className="fx-mline" />
        <button type="button" className="fx-mrow is-danger" onClick={() => (account.live ? account.signOut() : note('Sign out works once you sign in for real'))}><LogOut size={17} aria-hidden="true" /><b className="tp-grow">Sign out</b></button>
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
  const { data: settings } = useSampleSettings()
  const daily = dailyTotal(billing.spend)
  const wk = billing.expected.appts.booked
  const booked = S0 => S0(CalendarCheck, billing.booked, 'booked this week', { chip: [`about ${rangeWords(wk)}`, 'blue'] })
  // P898: on Leads, the booked calls (and live calls) whose time has passed and still need the agent's result.
  const waiting = leads.filter(l => needsResult(l)).length
  const by = st => clients.filter(c => c.stage === st).length
  const money = usd()
  const S = (icon, n, label, extra = {}) => ({ icon, n, label, ...extra })
  return {
    overview: [S(Users, clients.length, 'clients in your book', { chip: [`${by('protected')} protected`, 'up'] }), booked(S), S(Wallet, daily, 'lead spend a day', { fmt: money })],
    leads: [S(TriangleAlert, waiting, waiting === 1 ? 'call waiting for a result' : 'calls waiting for a result', { chip: waiting ? ['Mark result', 'warn'] : null }), S(CalendarCheck, leads.filter(l => l.stage === 'booked').length, 'booked'), S(Wallet, daily, 'lead spend a day', { fmt: money })],
    clients: [S(Users, clients.length, 'clients'), S(TriangleAlert, by('needs_attention'), 'need attention', { chip: by('needs_attention') ? ['See who', 'warn'] : null }), S(ShieldCheck, by('protected'), 'protected', { chip: ['On time', 'up'] })],
    calendar: [S(CalendarDays, events.length, 'this week'), S(Clock3, events.filter(e => e.date === 2).length, 'today'), S(PhoneCall, events.filter(e => /call/i.test(e.label)).length, 'client calls')],
    activity: [S(History, activity.filter(a => a.at.startsWith('Today')).length, 'today'), S(CalendarDays, activity.length, 'this week'), S(MessageSquare, activity.filter(a => a.kind === 'text').length, 'texts sent for you')],
    billing: billing.plan === 'pilot'
      ? [S(Wallet, billing.walletNow.left, 'left this week', { fmt: money, chip: ['Pilot', 'blue'] }), S(Wallet, daily, 'lead spend a day', { fmt: money }), booked(S)]
      : [S(Wallet, daily, 'lead spend a day', { fmt: money }), S(ShieldCheck, tierOf(daily).monthly || 0, `${tierOf(daily).label} a month`, { fmt: money }), booked(S)],
    // P843: no weekly submit count or 'no weekly limit' (old plan language): what is in servicing now
    submit: [S(ShieldCheck, clients.length, 'clients in servicing'), S(FileUp, by('setting_up'), 'setting up', { chip: by('setting_up') ? ['Team on it', 'blue'] : null }), S(Users, by('protected'), 'protected', { chip: ['On time', 'up'] })],
    settings: [S(Bell, settings.notifications.filter(n => n.push).length, 'alerts switched on'), S(CalendarDays, settings.hours.days.length, 'working days'), S(Users, clients.length, 'clients in your book')],
    messages: [S(MessageSquare, threads.reduce((n, t) => n + t.unread, 0), 'unread'), S(Users, threads.length, 'threads')],
  }[page] || []
}

export default function TemplateFrame() {
  const { pathname } = useLocation()
  const outlet = useOutlet()
  const [theme, setTheme] = useTheme()
  const [panel, setPanel] = useState(null)
  const account = useAccount()
  const active = tabOf(pathname)
  const page = usePageSwap(layoutOf(pathname), outlet)
  // The head and the page class follow the page on screen, so they change once the old page has left.
  const layout = page.key
  const title = titleOfLayout(layout)
  const { data: threads } = useSampleThreads()
  const { data: settings } = useSampleSettings()
  const { data: billing } = useSampleBilling()
  const stats = useHeadStats(layout)
  const status = useDataStatus()
  const source = useDataSource()
  const unread = threads.reduce((n, t) => n + t.unread, 0)
  const { data: needList } = useSampleNeeds()
  const needs = needList.now.filter(n => n.kind === 'lead').length
  const bell = needList.now.length
  const close = useCallback(() => setPanel(null), [])
  const open = which => e => { wig.onClick(e); setPanel(which) }
  // P893: the avatar toggles its menu (a second click closes it, with the menu's close animation)
  const toggleMenu = e => { wig.onClick(e); setPanel(p => (p === 'menu' ? null : 'menu')) }
  const menuOn = panel === 'menu'
  const flipTheme = e => { wig.onClick(e); setTheme(theme === 'dark' ? 'light' : 'dark') }
  // P890: no Active switch. Live transfers ring the agent inside their live-call hours (How you take leads, P889).
  const take = billing.take
  const duty = take?.mode === 'both' && inLiveHours(take.hours, take.tz)
  // The + menu opens beside the rail button on a desktop (a bottom sheet on a phone).
  const [menuAt, setMenuAt] = useState(null)
  const openCreate = e => {
    wig.onClick(e)
    const r = e.currentTarget.getBoundingClientRect()
    setMenuAt(window.innerWidth >= 1000 ? { left: `${Math.round(r.right + 14)}px`, top: `${Math.round(Math.max(12, Math.min(r.top - 8, window.innerHeight - 340)))}px` } : null)
    setPanel('create')
  }

  // Entrance motion only once the page is really painting: the first animation frame adds .is-anim (a background
  // tab never runs one, so its content sits at its final look), and hiding the tab drops it again.
  const appRef = useRef(null)
  useLayoutEffect(() => {
    const el = appRef.current
    if (!el) return undefined
    let stop = () => {}
    // P859: it then gets SETTLE_MS to really run; if it has not (a throttled or frozen browser), the page shows at rest
    // (.is-settled, flow.css). Reduced motion shows at once. The body never waits on an animation.
    const raf = requestAnimationFrame(() => { el.classList.add('is-anim'); stop = armEntrance(el, { still: still(), rootClass: 'fx-settled' }) })
    const onVis = () => { if (document.hidden) el.classList.remove('is-anim') }
    document.addEventListener('visibilitychange', onVis)
    return () => { cancelAnimationFrame(raf); stop(); document.removeEventListener('visibilitychange', onVis) }
  }, [layout])
  useEffect(() => () => document.documentElement.classList.remove('fx-settled'), [])

  // Ctrl/⌘K opens search from anywhere.
  useEffect(() => {
    const onKey = e => { if (isSearchKey(e)) { e.preventDefault(); setPanel(p => (p === 'search' ? null : 'search')) } }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className={`tp tp-app fx is-${layout}`} ref={appRef}>
      <div className="tp-sky" aria-hidden="true"><i /><i /><i /></div>

      <header className={`tp-phone-top fx-ptop${menuOn ? ' is-menu' : ''}`}>
        <Link to={paths.home()} className="fx-brand" aria-label="Ohvara home"><OhvaraMark height={28} back="var(--ov-mark-back)" front="var(--ov-mark-front)" className="fx-mark" /></Link>
        <span className="tp-grow" />
        <Link to={paths.messages()} className="fx-ib tp-wig" aria-label="Messages" {...wig}><MessageSquare size={18} />{unread > 0 && <span className="fx-badge">{unread}</span>}</Link>
        <button type="button" className="fx-ib tp-wig is-bell" aria-label="Notifications" {...wig} onClick={open('bell')}><Bell size={18} />{bell > 0 && <span className="fx-badge">{bell}</span>}</button>
        <button type="button" className={`fx-me tp-wig av-${avatarHue(account.name)}`} aria-label="Menu" aria-haspopup="dialog" aria-expanded={menuOn} {...wig} onClick={toggleMenu}>{initials(account.name).toUpperCase()}</button>
      </header>

      {/* P841: the desktop logo sits in the page, not in the sticky header, so it scrolls away with the page */}
      <Link to={paths.home()} className="fx-brand fx-brand-page" aria-label="Ohvara home"><OhvaraMark height={30} back="var(--ov-mark-back)" front="var(--ov-mark-front)" className="fx-mark" /><b>ohvara</b></Link>
      <header className={`tp-top fx-top${menuOn ? ' is-menu' : ''}`}>
        <span className="fx-top-gap" aria-hidden="true" />
        <PillTabs as="nav" label="Pages" className="tp-tabs fx-tabs" itemClass="tp-tab fx-tab" value={active} persistKey="tpl-tabs"
          items={TABS.map(t => ({ key: t.key, to: t.to(), label: t.label, extra: t.key === 'leads' && needs > 0 ? <span className="fx-tb">{needs}</span> : null }))} />
        <div className="fx-tr">
          <Link to={paths.messages()} className="fx-ib tp-wig" aria-label="Messages" {...wig}><MessageSquare size={18} />{unread > 0 && <span className="fx-badge">{unread}</span>}</Link>
          <button type="button" className="fx-ib tp-wig is-bell" aria-label="Notifications" {...wig} onClick={open('bell')}><Bell size={18} />{bell > 0 && <span className="fx-badge">{bell}</span>}</button>
          <button type="button" className={`tp-me fx-me tp-wig av-${avatarHue(account.name)}`} aria-label={`Your account, ${account.name}`} aria-haspopup="dialog" aria-expanded={menuOn} {...wig} onClick={toggleMenu}>{initials(account.name).toUpperCase()}</button>
        </div>
      </header>

      <aside className="tp-rail fx-rail" aria-label="Actions">
        <button type="button" className="tp-ri fx-ri tp-wig" aria-label="Search (Ctrl K)" data-tip="Search  Ctrl K" {...wig} onClick={open('search')}><Search size={20} /></button>
        <i className="fx-hair" />
        <button type="button" className="fx-ri fx-rplus tp-wig" aria-label="Create" aria-haspopup="menu" aria-expanded={panel === 'create'} data-tip="Create" {...wig} onClick={openCreate}><Plus size={20} /></button>
        <button type="button" className="tp-ri fx-ri tp-wig" aria-label="Book a call" data-tip="Book a call" {...wig} onClick={open('book')}><PhoneCall size={18} /></button>
        <NavLink to={paths.requestService()} className="fx-ri tp-wig" aria-label="Request a service" data-tip="Request a service" {...wig}><LifeBuoy size={18} /></NavLink>
        <i className="fx-hair" />
        <NavLink to={paths.messages()} className="fx-ri tp-wig" aria-label="Messages" data-tip="Messages" {...wig}><MessageSquare size={18} />{unread > 0 && <span className="fx-badge">{unread}</span>}</NavLink>
        <NavLink to={paths.calendar()} className="fx-ri tp-wig" aria-label="Calendar" data-tip="Calendar" {...wig}><CalendarDays size={18} /></NavLink>
        <i className="fx-hair" />
        <NavLink to={paths.billing()} className={`fx-ri fx-duty tp-wig${duty ? ' on' : ''}`} aria-label={duty ? 'Live transfers ring you now' : 'Live transfers off now: we book callers'} data-tip={duty ? 'Live transfers: on now' : 'Live transfers: off now'} {...wig}><Radio size={18} /><i aria-hidden="true" /></NavLink>
        <i className="fx-hair" />
        <button type="button" className="fx-ri tp-wig" aria-label="Get the phone app" aria-expanded={panel === 'app'} data-tip="Get the phone app" {...wig} onClick={open('app')}><Smartphone size={18} /></button>
        <button type="button" className="fx-ri tp-wig" aria-label="Help and support" aria-expanded={panel === 'help'} data-tip="Help and support" {...wig} onClick={open('help')}><CircleHelp size={18} /></button>
        <i className="fx-hair" />
        <NavLink to={paths.settings()} className="fx-ri tp-wig" aria-label="Settings" data-tip="Settings" {...wig}><Settings size={18} /></NavLink>
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
                    <b className={s.fmt ? 'tp-money' : 'tp-num'}><CountUp value={s.n} format={s.fmt} />{s.tail && <em>{s.tail}</em>}</b>
                    <span>{s.label}{s.chip && <i className={`fx-delta is-${s.chip[1]}`}>{s.chip[0]}</i>}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
          {/* P847 + P860 + P864: the live clock, one line on the title row, Overview only, in the zone from Settings */}
          {layout === 'overview' && <LiveClock tz={settings.timeZone} />}
        </div>

        <main className={`tp-main fx-main${page.leaving ? ' is-leaving' : ''}`} key={page.key}>
          {status.error ? <DataError onRetry={status.retry} /> : status.loading ? <DataLoading /> : page.el}
          {source === 'sample' && <p className="tp-foot">Sample info. Changes reset when you reload.</p>}
        </main>
      </div>

      <nav className="tp-bar fx-bar" aria-label="Actions">
        <button type="button" className="fx-btab" aria-label="Search" onClick={open('search')}><Search size={21} aria-hidden="true" />Search</button>
        <button type="button" className="fx-btab" onClick={open('book')}><PhoneCall size={20} aria-hidden="true" />Book</button>
        <button type="button" className="fx-btab is-plus" aria-label="Create" aria-haspopup="menu" aria-expanded={panel === 'create'} onClick={openCreate}><span className="fx-bplus"><Plus size={24} aria-hidden="true" /></span>Create</button>
        <Link to={paths.requestService()} className="fx-btab"><LifeBuoy size={20} aria-hidden="true" />Request</Link>
        <Link to={paths.settings()} className="fx-btab"><Settings size={20} aria-hidden="true" />Settings</Link>
      </nav>

      {panel === 'search' && <Palette onClose={close} pages={PAGES} />}
      <BellDrawer open={panel === 'bell'} onClose={close} />
      <BookCall open={panel === 'book'} onClose={close} />
      <CreateMenu open={panel === 'create'} onClose={close} at={menuAt} pick={setPanel} />
      <AddNote open={panel === 'note'} onClose={close} />
      <LogCall open={panel === 'log'} onClose={close} />
      <GetApp open={panel === 'app'} onClose={close} />
      <Help open={panel === 'help'} onClose={close} onBug={() => setPanel('bug')} onTalk={() => setPanel('talk')} />
      <TalkDrawer open={panel === 'talk'} onClose={close} />
      <ReportBug open={panel === 'bug'} onClose={close} role="Agent" />
      <AccountMenu open={panel === 'menu'} onClose={close} theme={theme} setTheme={setTheme} />
      <MoreBelow page={layout} />
    </div>
  )
}
