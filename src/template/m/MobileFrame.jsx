import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Home, Inbox, CalendarDays, MessageCircle } from 'lucide-react'
import { useTheme } from '../../hooks/useTheme'
import { useIsTestAccount } from '../../hooks/useIsTestAccount'
import { useStretchPill } from '../../hooks/useStretchPill'
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
import AAccount, { AClients, AActivity } from './AAccount'
import ABilling from './ABilling'
import ASettings from './ASettings'
import ASubmit from './ASubmit'
import { ASearch, ANeeds, AToday, AImport, ANotif, useUnseen } from './ASubs'
import { TABS, OWN_BAR, routeOf, baseTab, nextTab, isSwipe, stageOf } from './appModel'
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
// Messages · Account), each its own scroller; sub-screens slide in from the right (Back, or swipe from the left
// edge); Notifications slide in from the left. A floating glass tab bar, icons only, hides on a lead, a chat,
// Submit and Import. Every screen reads the same data hooks as the portal; the addresses are the portal's own.
const TAB_PATH = { home: () => paths.home(), leads: () => paths.leads(), calendar: () => paths.calendar(), messages: () => paths.messages(), account: () => paths.more() }
const TAB_PAGE = { home: AHome, leads: ALeads, calendar: ACalendar, messages: AMessages, account: AAccount }
const TAB_ICON = { home: Home, leads: Inbox, calendar: CalendarDays, messages: MessageCircle }
const TAB_LABEL = { home: 'Home', leads: 'Leads', calendar: 'Calendar', messages: 'Messages', account: 'Account' }
const LEAVE_MS = 260

function SubScreen({ route }) {
  switch (route.sub) {
    case 'lead': return <ALead id={route.id} />
    case 'clients': return <AClients id={route.id} />
    case 'billing': return <ABilling />
    case 'activity': return <AActivity />
    case 'settings': return <ASettings />
    case 'submit': return <ASubmit />
    case 'search': return <ASearch />
    case 'needs': return <ANeeds />
    case 'today': return <AToday />
    case 'import': return <AImport />
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
  const subKey = route.sub && !notif ? `${route.sub}:${route.id || ''}:${route.sub === 'settings' || route.sub === 'billing' || route.sub === 'submit' ? loc.search : ''}` : null
  const under = route.over ? { sub: route.over, id: route.sub === 'thread' ? null : route.id } : null

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

  // Leaving a sub-screen: slide it out, then go back (one step when there is history, else to its tab).
  const [leaving, setLeaving] = useState(false)
  const [edge, setEdge] = useState(0)
  const leaveT = useRef(null)
  const doBack = useCallback(() => {
    if (window.history.state?.idx > 0) navigate(-1)
    else navigate(TAB_PATH[tab](), { replace: true, state: { tab } })
  }, [navigate, tab])
  const back = useCallback(() => {
    if (still || !route.sub) { doBack(); return }
    setLeaving(true)
    clearTimeout(leaveT.current)
    leaveT.current = setTimeout(() => { setLeaving(false); setEdge(0); doBack() }, LEAVE_MS)
  }, [still, route.sub, doBack])
  useEffect(() => () => clearTimeout(leaveT.current), [])
  // A new address: the layer that was leaving is gone, so reset (during render, not in an effect).
  const [atKey, setAtKey] = useState(loc.key)
  if (atKey !== loc.key) { setAtKey(loc.key); setLeaving(false); setEdge(0) }

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

  // Swipe between tabs: the track follows the finger; far enough sideways moves one tab over.
  const [dx, setDx] = useState(0)
  const swipe = useRef(null)
  const moved = useRef(false)
  const onDown = e => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    if (e.target.closest('input, textarea, select, [data-no-swipe], .ma-layer')) return
    swipe.current = { x: e.clientX, y: e.clientY, on: false }
    moved.current = false
  }
  const onMove = e => {
    const s = swipe.current
    if (!s) return
    const ddx = e.clientX - s.x
    const ddy = e.clientY - s.y
    if (!s.on) {
      if (Math.abs(ddy) > 12 && Math.abs(ddy) > Math.abs(ddx)) { swipe.current = null; return }
      if (Math.abs(ddx) > 12 && Math.abs(ddx) > Math.abs(ddy) * 1.2) { s.on = true; moved.current = true; e.currentTarget.setPointerCapture?.(e.pointerId) }
      else return
    }
    const atEnd = (idx === 0 && ddx > 0) || (idx === tabs.length - 1 && ddx < 0)
    setDx(atEnd ? ddx / 4 : ddx)
  }
  const onUp = e => {
    const s = swipe.current
    swipe.current = null
    if (!s || !s.on) return
    const ddx = e.clientX - s.x
    const ddy = e.clientY - s.y
    setDx(0)
    if (isSwipe(ddx, ddy)) { const n = nextTab(idx, ddx, tabs.length); if (n !== idx) goTab(tabs[n]) }
  }
  const onClickCapture = e => { if (moved.current) { e.preventDefault(); e.stopPropagation(); moved.current = false } }

  // Edge swipe back on a sub-screen (from the left edge), and swipe Notifications away to the left.
  const edgeRef = useRef(null)
  const onEdgeDown = e => {
    const fromEdge = notif ? true : e.clientX <= 28
    if (!fromEdge || e.target.closest('input[type="range"], [data-no-swipe]')) return
    edgeRef.current = { x: e.clientX, y: e.clientY, on: false }
  }
  const onEdgeMove = e => {
    const s = edgeRef.current
    if (!s) return
    const ddx = e.clientX - s.x
    const ddy = e.clientY - s.y
    if (!s.on) {
      if (Math.abs(ddy) > 12 && Math.abs(ddy) > Math.abs(ddx)) { edgeRef.current = null; return }
      if (Math.abs(ddx) > 10 && (notif ? ddx < 0 : ddx > 0)) { s.on = true; e.currentTarget.setPointerCapture?.(e.pointerId) } else return
    }
    setEdge(notif ? Math.min(0, ddx) : Math.max(0, ddx))
  }
  const onEdgeUp = e => {
    const s = edgeRef.current
    edgeRef.current = null
    if (!s || !s.on) return
    const ddx = e.clientX - s.x
    if (Math.abs(ddx) > Math.min(110, window.innerWidth * 0.3)) back()
    else setEdge(0)
  }
  const edgeHandlers = { onPointerDown: onEdgeDown, onPointerMove: onEdgeMove, onPointerUp: onEdgeUp, onPointerCancel: () => { edgeRef.current = null; setEdge(0) } }

  const hideBar = OWN_BAR.includes(route.sub) || notif
  const barRef = useRef(null)
  useStretchPill(barRef, { activeKey: tab, selector: 'button.is-on' })
  const trackStyle = { transform: `translate3d(calc(${-idx * 100}% + ${dx}px), 0, 0)`, transition: dx || still ? 'none' : undefined }
  const layerStyle = edge ? { transform: `translate3d(${edge}px, 0, 0)`, transition: 'none' } : undefined

  const body = status.error ? <DataError onRetry={status.retry} /> : status.loading ? <DataLoading /> : null

  return (
    <AppCtx.Provider value={app}>
      <div className={`tp fx ma${still ? ' is-still' : ''}${route.sub ? ' has-sub' : ''}`}>
        <div className="tp-sky" aria-hidden="true" />
        {body
          ? <main className="ma-solo">{body}</main>
          : (
            <div className="ma-viewport" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={() => { swipe.current = null; setDx(0) }} onClickCapture={onClickCapture} onDragStart={e => e.preventDefault()}>
              <div className="ma-track" style={trackStyle}>
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

        {!body && under && (
          <div className="ma-layer-r is-under" aria-hidden="true">
            <SubScreen route={under} />
          </div>
        )}
        {!body && subKey && (
          <div key={subKey} className={`ma-layer-r${leaving ? ' is-leaving' : ''}`} style={layerStyle} {...edgeHandlers}>
            <SubScreen route={route} />
          </div>
        )}
        {!body && notif && (
          <>
            <button type="button" className={`ma-notif-scrim${leaving ? ' is-leaving' : ''}`} aria-label="Close notifications" onClick={back} />
            <div className={`ma-layer-l${leaving ? ' is-leaving' : ''}`} style={layerStyle} {...edgeHandlers} role="dialog" aria-label="Notifications">
              <ANotif />
            </div>
          </>
        )}

        <nav className={`ma-tabbar${hideBar ? ' is-hidden' : ''}`} aria-label="Pages" ref={barRef} aria-hidden={hideBar} inert={hideBar ? '' : undefined}>
          {tabs.map(k => {
            const Icon = TAB_ICON[k]
            const on = k === tab
            const badge = k === 'leads' ? toMark : k === 'messages' ? unread : 0
            const label = `${TAB_LABEL[k]}${badge ? `, ${badge} ${k === 'leads' ? 'to mark' : 'unread'}` : ''}`
            return (
              <button key={on ? `${k}-on` : k} type="button" className={`ma-tab${on ? ' is-on' : ''}`} aria-label={label} aria-current={on ? 'page' : undefined} onClick={() => goTab(k)}>
                {k === 'account'
                  ? <Ini name={account.name} size={32} className="ma-tab-me" />
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
