import { useCallback, useMemo, useRef, useState, useEffect, useSyncExternalStore } from 'react'
import { useLocation, useNavigate, useNavigationType } from 'react-router-dom'
import { Home, CalendarDays, Users, MessageCircle } from 'lucide-react'
import { useTheme } from '../../../hooks/useTheme'
import { useIsTestAccount } from '../../../hooks/useIsTestAccount'
import { useAccount } from '../../kit'
import { useFulSchedule, useFulStatus, useFulSource, useFulFeed } from '../../ful/data'
import { fp } from '../../ful/paths'
import { DataLoading, DataError } from '../../DataState'
import { AppCtx, Ini, useStill } from '../AppKit'
import { useTabSwipe } from '../useTabSwipe'
import { useBackSwipe } from '../useBackSwipe'
import { screenKey } from '../appModel'
import { VA_TABS, VA_LABEL, VA_OWN_BAR, vaRouteOf } from './vaModel'
import { VaCallProvider } from './VCall'
import VToday from './VToday'
import VCalendar from './VCalendar'
import VRota from './VRota'
import VMessages, { VThread } from './VMessages'
import { useVaThreads, FEED_SEEN } from './vaStore'
import VMe, { VPay, VSettings, VTraining, VLesson, VHelp } from './VMe'
import { VNotif, VSearch, VClient } from './VSubs'
import '../../glass.css'
import '../../flow.css'
import '../../palette.css'
import '../m.css'
import '../app.css'
import './va.css'
import '@fontsource/urbanist/500.css'
import '@fontsource/urbanist/600.css'
import '@fontsource/urbanist/700.css'
import '@fontsource/urbanist/800.css'

// P975 — the fulfillment (VA) app on a phone (below 768 px, and inside the native app), from Brayden's approved
// mockup (media/app-mockup/va-app-mockup.dc.html). The agent app's frame and rules (P967–P974): five tabs side by side
// you swipe between (Today · Calendar · Rota · Messages · Me), a floating glass pill bar with icons only and the grey
// stretchy highlight, sub-screens from the right and Notifications from the left that swipe away the way they came,
// bottom sheets that swipe down, nothing pinned at the top. Same VA data hooks and addresses as the desktop VA desk,
// which stays the main tool at 768 px and up (FulFrame picks).
const TAB_PATH = { today: () => fp('overview'), calendar: () => fp('calendar'), rota: () => fp('schedule'), messages: () => fp('messages'), me: () => fp('more') }
const TAB_PAGE = { today: VToday, calendar: VCalendar, rota: VRota, messages: VMessages, me: VMe }
const TAB_ICON = { today: Home, calendar: CalendarDays, rota: Users, messages: MessageCircle }
const LEAVE_MS = 260

function SubScreen({ route }) {
  switch (route.sub) {
    case 'search': return <VSearch />
    case 'client': return <VClient id={route.id} />
    case 'settings': return <VSettings />
    case 'pay': return <VPay />
    case 'training': return route.id ? <VLesson id={route.id} /> : <VTraining />
    case 'help': return <VHelp />
    case 'thread': return <VThread id={route.id} />
    default: return null
  }
}

export default function VaApp() {
  const { data: schedule } = useFulSchedule()
  return <VaCallProvider schedule={schedule}><Frame /></VaCallProvider>
}

function Frame() {
  const loc = useLocation()
  const navigate = useNavigate()
  const navType = useNavigationType()
  useTheme() // applies the saved theme
  const still = useStill()
  const account = useAccount()
  const source = useFulSource()
  const isTest = useIsTestAccount()
  const status = useFulStatus()
  const route = vaRouteOf(loc.pathname, loc.search)
  const tab = route.tab
  const idx = Math.max(0, VA_TABS.indexOf(tab))
  const notif = route.sub === 'notif'

  // The layer stack: the screen on top and, under it, the one Back lands on (a lesson's Training list).
  const parent = useMemo(() => (route.sub === 'training' && route.id ? { sub: 'training', id: null } : null), [route.sub, route.id])
  const layers = []
  if (parent) layers.push({ key: screenKey(parent.sub, parent.id), route: parent, top: false })
  if (route.sub && !notif) layers.push({ key: screenKey(route.sub, route.id), route, top: true })
  const enter = navType !== 'POP'

  // Badges: unread messages (Messages), new notifications (the bell on Today).
  const threads = useVaThreads()
  const unread = threads.reduce((n, t) => n + (t.unread || 0), 0)
  const { data: feed } = useFulFeed()
  const seen = useSyncExternalStore(FEED_SEEN.sub, FEED_SEEN.get)
  const unseen = feed.filter(f => !seen.includes(f.id)).length

  const [leaving, setLeaving] = useState(false)
  const leaveT = useRef(null)
  const doBack = useCallback(() => {
    if (window.history.state?.idx > 0) { navigate(-1); return }
    const up = parent ? `${loc.pathname}?s=training` : TAB_PATH[tab]()
    navigate(up, { replace: true, state: { tab } })
  }, [navigate, tab, parent, loc.pathname])
  const back = useCallback(() => {
    if (still || !route.sub) { doBack(); return }
    setLeaving(true)
    clearTimeout(leaveT.current)
    leaveT.current = setTimeout(() => { setLeaving(false); doBack() }, LEAVE_MS)
  }, [still, route.sub, doBack])
  useEffect(() => () => clearTimeout(leaveT.current), [])
  const [atKey, setAtKey] = useState(loc.key)
  if (atKey !== loc.key) { setAtKey(loc.key); setLeaving(false) }

  const goTab = useCallback((key, state = {}) => {
    if (!VA_TABS.includes(key)) return
    if (key === tab && !route.sub && !Object.keys(state).length) { document.querySelector(`[data-ma-tab="${key}"]`)?.scrollTo({ top: 0, behavior: still ? 'auto' : 'smooth' }); return }
    navigate(TAB_PATH[key](), { replace: !route.sub, state: { tab: key, ...state } })
  }, [tab, route.sub, navigate, still])
  const open = useCallback((to, extra = {}) => navigate(to, { state: { tab, ...extra } }), [navigate, tab])
  const openSub = useCallback((key, params = {}) => {
    const q = new URLSearchParams({ s: key, ...params })
    const base = key === 'thread' ? TAB_PATH.messages() : loc.pathname
    navigate(`${base}?${q}`, { state: { tab } })
  }, [navigate, loc.pathname, tab])

  const app = useMemo(() => ({ tab, back, open, openSub, goTab, unseen, va: true }), [tab, back, open, openSub, goTab, unseen])

  const frameRef = useRef(null)
  const viewRef = useRef(null)
  const trackRef = useRef(null)
  const barRef = useRef(null)
  const onSwitch = useCallback(n => goTab(VA_TABS[n]), [goTab])
  const topRef = useRef(null)
  const notifRef = useRef(null)
  const scrimRef = useRef(null)
  const underR = useCallback(() => frameRef.current?.querySelector('.ma-layer-r.is-under') || viewRef.current, [])
  const underL = useCallback(() => frameRef.current?.querySelector('.ma-layer-r') || viewRef.current, [])
  const topId = layers.length ? layers[layers.length - 1].key : ''
  const swipeR = useBackSwipe({ layerRef: topRef, underOf: underR, dir: 1, on: !!topId && !notif, onClose: doBack, key: topId })
  const swipeL = useBackSwipe({ layerRef: notifRef, underOf: underL, scrimRef, dir: -1, on: notif, onClose: doBack })

  const hideBar = VA_OWN_BAR.includes(route.sub) || notif
  const body = status.error ? <DataError onRetry={status.retry} /> : status.loading ? <DataLoading /> : null
  const { onClickCapture } = useTabSwipe({ viewRef, trackRef, barRef, idx, count: VA_TABS.length, onSwitch, on: !body })
  const trackStyle = { transform: `translate3d(calc(${-idx * 100}% + 0px), 0, 0)`, transition: still ? 'none' : undefined }

  return (
    <AppCtx.Provider value={app}>
      <div className={`tp fx ma va${still ? ' is-still' : ''}${route.sub ? ' has-sub' : ''}`} ref={frameRef}>
        <div className="tp-sky" aria-hidden="true" />
        {body
          ? <main className="ma-solo">{body}</main>
          : (
            <div className="ma-viewport" ref={viewRef} onClickCapture={onClickCapture} onDragStart={e => e.preventDefault()}>
              <div className="ma-track" ref={trackRef} style={trackStyle}>
                {VA_TABS.map((k, i) => {
                  const Page = TAB_PAGE[k]
                  const near = Math.abs(i - idx) <= 1 || k === 'today'
                  return (
                    <section key={k} className={`ma-page${i === idx ? ' is-on' : ''}`} data-ma-tab={k} data-ma-scroll aria-hidden={i !== idx} inert={i !== idx || undefined} aria-label={VA_LABEL[k]}>
                      {near ? <Page route={route} /> : null}
                      {k === tab && !isTest && source === 'sample' && <p className="ma-sample">Sample info. Changes reset when you reload.</p>}
                    </section>
                  )
                })}
              </div>
            </div>
          )}

        {!body && layers.map((L, i) => {
          const top = L.top && i === layers.length - 1
          return (
            <div key={L.key} ref={top ? topRef : undefined}
              className={`ma-layer-r${top ? '' : ' is-under'}${top && enter ? ' is-enter' : ''}${top && leaving ? ' is-leaving' : ''}`}
              aria-hidden={!top ? true : undefined} inert={!top || undefined}
              onClickCapture={top ? swipeR.onClickCapture : undefined}>
              <SubScreen route={L.route} />
            </div>
          )
        })}
        {!body && notif && (
          <>
            <button type="button" ref={scrimRef} className={`ma-notif-scrim${leaving ? ' is-leaving' : ''}`} aria-label="Close notifications" onClick={back} />
            <div ref={notifRef} className={`ma-layer-l${enter ? ' is-enter' : ''}${leaving ? ' is-leaving' : ''}`} role="dialog" aria-label="Notifications" onClickCapture={swipeL.onClickCapture}>
              <VNotif />
            </div>
          </>
        )}

        <nav className={`ma-tabbar${hideBar ? ' is-hidden' : ''}`} aria-label="Pages" ref={barRef} aria-hidden={hideBar} inert={hideBar || undefined} style={{ '--n': VA_TABS.length, '--p': idx }}>
          <i className="ma-tab-hl" aria-hidden="true" />
          {VA_TABS.map(k => {
            const Icon = TAB_ICON[k]
            const on = k === tab
            const badge = k === 'messages' ? unread : 0
            return (
              <button key={k} type="button" className={`ma-tab${on ? ' is-on' : ''}`} aria-label={`${VA_LABEL[k]}${badge ? `, ${badge} unread` : ''}`} aria-current={on ? 'page' : undefined} onClick={() => goTab(k)}>
                {k === 'me'
                  ? <Ini name={account?.name} tone="sage" size={32} className="ma-tab-me" />
                  : <Icon size={25} strokeWidth={on ? 2.2 : 1.9} aria-hidden="true" />}
                {badge > 0 && <span className="ma-badge is-tab">{badge}</span>}
              </button>
            )
          })}
        </nav>
      </div>
    </AppCtx.Provider>
  )
}
