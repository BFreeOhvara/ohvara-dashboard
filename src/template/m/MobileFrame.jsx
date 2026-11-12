import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, useNavigationType } from 'react-router-dom'
import { Home, Inbox, CalendarDays, MessageCircle } from 'lucide-react'
import { useTheme } from '../../hooks/useTheme'
import { useIsTestAccount } from '../../hooks/useIsTestAccount'
import { useSampleLeads, useSampleThreads, useDataSource, useDataStatus } from '../data'
import { useAccount } from '../kit'
import { useNavKeys } from '../useProducts'
import { clockNow } from '../leadLifecycle'
import { paths } from '../paths'
import { DataLoading, DataError } from '../DataState'
import { NoShowUndo } from '../LeadOutcome'
import { AppCtx, ResultSheet, SoldSheet, FollowPicker, Ini, useStill } from './AppKit'
import { SupportProvider, AThread } from './AMessages'
import AHome from './AHome'
import ALeads, { ALead } from './ALeads'
import ACalendar from './ACalendar'
import AMessages from './AMessages'
import AAccount, { AClients } from './AAccount'
import { AClient } from './AClient'
import { AHelp } from './AHelp'
import { ANotif, AActivity } from './ANotes'
import { useUnseen } from './useNotes'
import ABilling from './ABilling'
import ASettings from './ASettings'
import ASubmit from './ASubmit'
import { ASearch, ANeeds, AToday, AImport } from './ASubs'
import { TABS, OWN_BAR, routeOf, baseTab, stageOf, parentOf, nestedOf, screenKey } from './appModel'
import { useTabSwipe } from './useTabSwipe'
import { useBackSwipe } from './useBackSwipe'
import '../glass.css'
import '../flow.css'
import '../palette.css'
import '../leads873.css'
import '../fit867.css'
import './m.css'
import './app.css'
import '@fontsource/urbanist/500.css'
import '@fontsource/urbanist/600.css'
import '@fontsource/urbanist/700.css'
import '@fontsource/urbanist/800.css'

// P967 — the agent app on a phone (below 768 px, and the native app), rebuilt from Brayden's approved mockup
// (media/app-mockup/agent-app-mockup.dc.html). Five tabs side by side you swipe between (Home · Leads · Calendar ·
// Messages · Account), each its own scroller; sub-screens slide in from the right and Notifications from the left;
// P972: each swipes away the way it came (from anywhere on it), with the screen under it peeking in. A floating glass tab bar, icons only, hides on a lead, a chat,
// Submit and Import. Every screen reads the same data hooks as the portal; the addresses are the portal's own.
const TAB_PATH = { home: () => paths.home(), leads: () => paths.leads(), calendar: () => paths.calendar(), messages: () => paths.messages(), account: () => paths.more() }
const TAB_PAGE = { home: AHome, leads: ALeads, calendar: ACalendar, messages: AMessages, account: AAccount }
const TAB_ICON = { home: Home, leads: Inbox, calendar: CalendarDays, messages: MessageCircle }
const TAB_LABEL = { home: 'Home', leads: 'Leads', calendar: 'Calendar', messages: 'Messages', account: 'Account' }
const LEAVE_MS = 260

function SubScreen({ route, root = false }) {
  switch (route.sub) {
    case 'lead': return <ALead id={route.id} />
    case 'clients': return route.id ? <AClient id={route.id} /> : <AClients />
    case 'billing': return <ABilling root={root} />
    case 'activity': return <AActivity />
    case 'settings': return <ASettings root={root} />
    case 'submit': return <ASubmit root={root} />
    case 'search': return <ASearch />
    case 'needs': return <ANeeds />
    case 'today': return <AToday />
    case 'import': return <AImport />
    case 'help': return <AHelp />
    case 'thread': return <AThread id={route.id} />
    default: return null
  }
}

export default function MobileFrame() {
  return <SupportProvider><Frame /></SupportProvider>
}

function Frame() {
  const loc = useLocation()
  const navigate = useNavigate()
  const navType = useNavigationType()
  useTheme() // applies the saved theme
  const still = useStill()
  const account = useAccount()
  const source = useDataSource()
  const isTest = useIsTestAccount() // P929: no sample line on test accounts
  const status = useDataStatus()
  const navKeys = useNavKeys() // P955: tabs for what they bought
  const tabs = TABS.filter(t => t !== 'leads' || navKeys.has('leads'))
  const route = routeOf(loc.pathname, loc.search)
  const fromTab = loc.state?.tab
  const tab = tabs.includes(baseTab(route, fromTab)) ? baseTab(route, fromTab) : 'home'
  const idx = Math.max(0, tabs.indexOf(tab))
  const notif = route.sub === 'notif'

  // P972 — the layer stack. The screen on top, and under it the screen Back lands on (a setting's Settings, a
  // client's Clients, the client under its chat): it shows while the top one is swiped away, and keeps its place
  // (same key) when it comes back up. A screen that came back with Back doesn't slide in again.
  const parent = route.sub ? parentOf(route, loc.search) : null
  const layers = []
  if (parent) layers.push({ key: screenKey(parent.sub, parent.id), route: { sub: parent.sub, id: parent.id }, top: notif })
  if (route.sub && !notif) layers.push({ key: screenKey(route.sub, route.id, nestedOf(route, loc.search)), route, top: true })
  const enter = navType !== 'POP'

  // Badges: leads to mark (Leads), unread messages (Messages), new notifications (the bell, on Home).
  const { data: leads } = useSampleLeads()
  const { data: threads } = useSampleThreads()
  const unseen = useUnseen()
  const now = clockNow()
  const toMark = leads.filter(l => stageOf(l, now) === 'mark').length
  const unread = threads.reduce((n, t) => n + (t.unread || 0), 0)

  // Sheets the screens ask the frame for: the result sheet, after Sold, follow up on a picked day, No show's Undo.
  const [marking, setMarking] = useState(null)
  const [sold, setSold] = useState(null)
  const [follow, setFollow] = useState(null)
  const [undoId, setUndoId] = useState(null)
  const undoLead = undoId ? leads.find(l => l.id === undoId) : null

  // Leaving a screen: slide it out, then go back one step (with no history: to its parent, else its tab).
  const [leaving, setLeaving] = useState(false)
  const leaveT = useRef(null)
  const doBack = useCallback(() => {
    if (window.history.state?.idx > 0) { navigate(-1); return }
    const up = !parent ? TAB_PATH[tab]() : route.over || nestedOf(route, loc.search) ? loc.pathname : paths.clients()
    navigate(up, { replace: true, state: { tab } })
  }, [navigate, tab, parent, route, loc.pathname, loc.search])
  const back = useCallback(() => {
    if (still || !route.sub) { doBack(); return }
    setLeaving(true)
    clearTimeout(leaveT.current)
    leaveT.current = setTimeout(() => { setLeaving(false); doBack() }, LEAVE_MS)
  }, [still, route.sub, doBack])
  useEffect(() => () => clearTimeout(leaveT.current), [])
  // A new address: the layer that was leaving is gone, so reset (during render, not in an effect).
  const [atKey, setAtKey] = useState(loc.key)
  if (atKey !== loc.key) { setAtKey(loc.key); setLeaving(false) }

  const goTab = useCallback(key => {
    if (!tabs.includes(key)) return
    if (key === tab && !route.sub) { document.querySelector(`[data-ma-tab="${key}"]`)?.scrollTo({ top: 0, behavior: still ? 'auto' : 'smooth' }); return }
    navigate(TAB_PATH[key](), { replace: !route.sub, state: { tab: key } })
  }, [tabs, tab, route.sub, navigate, still])
  const open = useCallback((to, extra = {}) => navigate(to, { state: { tab, ...extra } }), [navigate, tab])
  const openSub = useCallback((key, params = {}) => {
    const q = new URLSearchParams({ s: key, ...params })
    navigate(`${loc.pathname}?${q}`, { state: { tab } })
  }, [navigate, loc.pathname, tab])

  const app = useMemo(() => ({
    tab, back, open, openSub, goTab, unseen,
    markLead: l => setMarking(l), soldFor: l => setSold(l), pickFollow: l => setFollow(l), undoFor: id => setUndoId(id),
  }), [tab, back, open, openSub, goTab, unseen])

  // Swipe between tabs (P971, useTabSwipe): the track follows the finger and snaps with its speed.
  const frameRef = useRef(null)
  const viewRef = useRef(null)
  const trackRef = useRef(null)
  const barRef = useRef(null)
  const onSwitch = useCallback(n => goTab(tabs[n]), [goTab, tabs])

  // Swipe back (P972, useBackSwipe): the top screen follows the finger the way it came, the one under it peeks in.
  const topRef = useRef(null)
  const notifRef = useRef(null)
  const scrimRef = useRef(null)
  const underR = useCallback(() => frameRef.current?.querySelector('.ma-layer-r.is-under') || viewRef.current, [])
  const underL = useCallback(() => frameRef.current?.querySelector('.ma-layer-r') || viewRef.current, [])
  const topId = layers.length ? layers[layers.length - 1].key : ''
  const swipeR = useBackSwipe({ layerRef: topRef, underOf: underR, dir: 1, on: !!topId && !notif, onClose: doBack, key: topId })
  const swipeL = useBackSwipe({ layerRef: notifRef, underOf: underL, scrimRef, dir: -1, on: notif, onClose: doBack })

  // The status bar: clear over a tab page at rest; a soft blur once the page scrolls under it (P972).
  const onPageScroll = e => {
    const el = e.target
    if (!el.classList?.contains('ma-page') || !el.classList.contains('is-on')) return
    frameRef.current?.classList.toggle('is-scrolled', el.scrollTop > 4)
  }
  useEffect(() => {
    const page = frameRef.current?.querySelector(`[data-ma-tab="${tab}"]`)
    frameRef.current?.classList.toggle('is-scrolled', (page?.scrollTop || 0) > 4)
  }, [tab])

  const hideBar = OWN_BAR.includes(route.sub) || notif || (route.sub === 'clients' && !!route.id) // P972: a client has its own button at the bottom
  const body = status.error ? <DataError onRetry={status.retry} /> : status.loading ? <DataLoading /> : null
  const { onClickCapture } = useTabSwipe({ viewRef, trackRef, barRef, idx, count: tabs.length, onSwitch, on: !body })
  const trackStyle = { transform: `translate3d(calc(${-idx * 100}% + 0px), 0, 0)`, transition: still ? 'none' : undefined }

  return (
    <AppCtx.Provider value={app}>
      <div className={`tp fx ma${still ? ' is-still' : ''}${route.sub ? ' has-sub' : ''}`} ref={frameRef}>
        <div className="tp-sky" aria-hidden="true" />
        <div className="ma-statusbar" aria-hidden="true" />
        {body
          ? <main className="ma-solo">{body}</main>
          : (
            <div className="ma-viewport" ref={viewRef} onClickCapture={onClickCapture} onDragStart={e => e.preventDefault()} onScrollCapture={onPageScroll}>
              <div className="ma-track" ref={trackRef} style={trackStyle}>
                {tabs.map((k, i) => {
                  const Page = TAB_PAGE[k]
                  const near = Math.abs(i - idx) <= 1 || k === 'home'
                  return (
                    <section key={k} className={`ma-page${i === idx ? ' is-on' : ''}`} data-ma-tab={k} data-ma-scroll aria-hidden={i !== idx} inert={i !== idx ? '' : undefined} aria-label={TAB_LABEL[k]}>
                      {near || i === idx ? <Page /> : null}
                      {k === tab && !isTest && source === 'sample' && <p className="ma-sample">Sample info. Changes reset when you reload.</p>}
                    </section>
                  )
                })}
              </div>
            </div>
          )}

        {!body && layers.map((L, i) => {
          const top = L.top && !notif && i === layers.length - 1
          return (
            <div key={L.key} ref={top ? topRef : undefined}
              className={`ma-layer-r${top ? '' : ' is-under'}${top && enter ? ' is-enter' : ''}${top && leaving ? ' is-leaving' : ''}`}
              aria-hidden={!top && !notif ? true : undefined} inert={!top && !notif ? '' : undefined}
              onClickCapture={top ? swipeR.onClickCapture : undefined}>
              <SubScreen route={L.route} root={!top} />
            </div>
          )
        })}
        {!body && notif && (
          <>
            <button type="button" ref={scrimRef} className={`ma-notif-scrim${leaving ? ' is-leaving' : ''}`} aria-label="Close notifications" onClick={back} />
            <div ref={notifRef} className={`ma-layer-l${enter ? ' is-enter' : ''}${leaving ? ' is-leaving' : ''}`} role="dialog" aria-label="Notifications" onClickCapture={swipeL.onClickCapture}>
              <ANotif />
            </div>
          </>
        )}

        <nav className={`ma-tabbar${hideBar ? ' is-hidden' : ''}`} aria-label="Pages" ref={barRef} aria-hidden={hideBar} inert={hideBar ? '' : undefined} style={{ '--n': tabs.length, '--p': idx }}>
          <i className="ma-tab-hl" aria-hidden="true" />
          {tabs.map(k => {
            const Icon = TAB_ICON[k]
            const on = k === tab
            const badge = k === 'leads' ? toMark : k === 'messages' ? unread : 0
            const label = `${TAB_LABEL[k]}${badge ? `, ${badge} ${k === 'leads' ? 'to mark' : 'unread'}` : ''}`
            return (
              <button key={k} type="button" className={`ma-tab${on ? ' is-on' : ''}`} aria-label={label} aria-current={on ? 'page' : undefined} onClick={() => goTab(k)}>
                {k === 'account'
                  ? <Ini name={account.name} tone="sky" size={32} className="ma-tab-me" />
                  : <Icon size={25} strokeWidth={on ? 2.2 : 1.9} aria-hidden="true" />}
                {badge > 0 && <span className="ma-badge is-tab">{badge}</span>}
              </button>
            )
          })}
        </nav>

        <ResultSheet lead={marking} onClose={() => setMarking(null)} />
        <SoldSheet lead={sold} onClose={() => setSold(null)} />
        <FollowPicker lead={follow} onClose={() => setFollow(null)} />
        {undoLead?.undo && <div className="ma-undo-host"><NoShowUndo lead={undoLead} /></div>}
      </div>
    </AppCtx.Provider>
  )
}
