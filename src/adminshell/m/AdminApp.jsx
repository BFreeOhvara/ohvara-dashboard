import { useCallback, useMemo, useRef, useState, useEffect } from 'react'
import { useLocation, useNavigate, useNavigationType } from 'react-router-dom'
import { Home, Briefcase, Users, MessageCircle } from 'lucide-react'
import { useTheme } from '../../hooks/useTheme'
import { useAdmFeed, useAdmSource, useAdmMeta } from '../data'
import { ap } from '../paths'
import { DataLoading, DataError } from '../../template/DataState'
import { AppCtx, Ini, useStill } from '../../template/m/AppKit'
import { useTabSwipe } from '../../template/m/useTabSwipe'
import { useBackSwipe } from '../../template/m/useBackSwipe'
import { screenKey, stackOf } from '../../template/m/appModel'
import { ADM_TABS, ADM_LABEL, ADM_OWN_BAR, admRouteOf } from './admModel'
import { useFeedSeen } from './admStore'
import { useNeeds, useUnread, useAdmName } from './useAdm'
import AHomeAdm, { AMoney } from './AHomeAdm'
import AAgents, { AAgent } from './AAgents'
import ATeam, { AVa } from './ATeam'
import AMsgs, { AThreadAdm } from './AMsgs'
import AYou, { AUnassigned, AAi, ALeadsAll, ALeadAdm, AClientsAll, AClientAdm, AReports, ABugs, ABug, ASetupView, APayouts, APlans, ASettingsAdm } from './AYou'
import { ANotif, ASearch } from './ASubsAdm'
import '../../template/glass.css'
import '../../template/flow.css'
import '../../template/palette.css'
import '../../template/m/m.css'
import '../../template/m/app.css'
import '../../template/m/va/va.css'
import './adm.css'
import '@fontsource/urbanist/500.css'
import '@fontsource/urbanist/600.css'
import '@fontsource/urbanist/700.css'
import '@fontsource/urbanist/800.css'

// P986 — the admin app on a phone (below 768 px, and inside the native app), for Brayden and Jordan (both full
// admins). The agent and VA apps' frame and rules: five tabs side by side you swipe between (Home · Agents · Team ·
// Messages · You), the floating glass pill bar, sub-screens from the right and Notifications from the left that swipe
// away the way they came (one screen at a time), bottom sheets that swipe down, nothing pinned at the top. Same admin
// data hooks and addresses as the desktop admin (sample data stays on until launch), which stays exactly as it was at
// 768 px and up (AdminShell picks). Plan and price changes, live switches and connections stay on the desktop.
const TAB_PATH = { home: () => ap('overview'), agents: () => ap('agents'), team: () => ap('team'), messages: () => ap('messages'), you: () => ap('settings') }
const TAB_PAGE = { home: AHomeAdm, agents: AAgents, team: ATeam, messages: AMsgs, you: AYou }
const TAB_ICON = { home: Home, agents: Briefcase, team: Users, messages: MessageCircle }
const LEAVE_MS = 260

function SubScreen({ route }) {
  switch (route.sub) {
    case 'search': return <ASearch />
    case 'money': return <AMoney />
    case 'agent': return <AAgent id={route.id} />
    case 'va': return <AVa id={route.id} />
    case 'thread': return <AThreadAdm id={route.id} />
    case 'unassigned': return <AUnassigned />
    case 'ai': return <AAi />
    case 'leads': return <ALeadsAll />
    case 'lead': return <ALeadAdm id={route.id} />
    case 'clients': return <AClientsAll />
    case 'client': return <AClientAdm id={route.id} />
    case 'reports': return <AReports />
    case 'bugs': return <ABugs />
    case 'bug': return <ABug id={route.id} />
    case 'setup': return <ASetupView />
    case 'payouts': return <APayouts />
    case 'plans': return <APlans />
    case 'settings': return <ASettingsAdm />
    default: return null
  }
}

export default function AdminApp() {
  const loc = useLocation()
  const navigate = useNavigate()
  const navType = useNavigationType()
  useTheme() // applies the saved theme
  const still = useStill()
  const source = useAdmSource()
  const meta = useAdmMeta()
  const route = admRouteOf(loc.pathname, loc.search)
  const tab = route.tab
  const idx = Math.max(0, ADM_TABS.indexOf(tab))
  const meName = useAdmName()
  const notif = route.sub === 'notif'

  // The screen stack (P982, same as the agent and VA apps): each screen opened over another carries the screens under
  // it in the address state, so Back / swipe-back goes one screen at a time with the one underneath already there.
  const topKey = route.sub && !notif ? screenKey(route.sub, route.id) : null
  const stackJson = typeof loc.state?.stack === 'string' ? loc.state.stack : ''
  const { under, stack } = stackOf(stackJson, topKey)
  const layers = []
  if (under) layers.push({ key: under.key, route: under.route, top: false })
  if (topKey) layers.push({ key: topKey, route, top: true })
  const pushKey = JSON.stringify(topKey ? [...stack, { key: topKey, route: { ...route }, href: loc.pathname + loc.search, tab }].slice(-8) : [])
  const enter = navType !== 'POP'

  // Badges: the Needs you count (Home), unread messages (Messages), new notifications (the bell).
  const needs = useNeeds().length
  const unread = useUnread()
  const { data: feed } = useAdmFeed()
  const seen = useFeedSeen()
  const unseen = feed.filter(f => !seen.includes(f.id)).length

  const [leaving, setLeaving] = useState(false)
  const leaveT = useRef(null)
  const doBack = useCallback(() => {
    if (window.history.state?.idx > 0) { navigate(-1); return }
    const st = stackOf(stackJson, topKey)
    if (st.under?.href) { navigate(st.under.href, { replace: true, state: { tab: st.under.tab || tab, stack: JSON.stringify(st.stack.slice(0, -1)) } }); return }
    navigate(TAB_PATH[tab](), { replace: true, state: { tab } })
  }, [navigate, tab, stackJson, topKey])
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
    if (!ADM_TABS.includes(key)) return
    if (key === tab && !route.sub && !Object.keys(state).length) { document.querySelector(`[data-ma-tab="${key}"]`)?.scrollTo({ top: 0, behavior: still ? 'auto' : 'smooth' }); return }
    navigate(TAB_PATH[key](), { replace: !route.sub, state: { tab: key, ...state } })
  }, [tab, route.sub, navigate, still])
  const open = useCallback((to, extra = {}) => navigate(to, { state: { tab, ...extra, stack: pushKey } }), [navigate, tab, pushKey])
  // A sub-screen over the current tab: ?s=<key>&t=<id>. Chats always open over Messages' address.
  const openSub = useCallback((key, params = {}) => {
    const q = new URLSearchParams({ s: key, ...params })
    const base = key === 'thread' && tab === 'messages' ? TAB_PATH.messages() : loc.pathname
    navigate(`${base}?${q}`, { state: { tab, stack: pushKey } })
  }, [navigate, loc.pathname, tab, pushKey])

  const app = useMemo(() => ({ tab, back, open, openSub, goTab, unseen, adm: true }), [tab, back, open, openSub, goTab, unseen])

  const frameRef = useRef(null)
  const viewRef = useRef(null)
  const trackRef = useRef(null)
  const barRef = useRef(null)
  const onSwitch = useCallback(n => goTab(ADM_TABS[n]), [goTab])
  const topRef = useRef(null)
  const notifRef = useRef(null)
  const scrimRef = useRef(null)
  const underR = useCallback(() => frameRef.current?.querySelector('.ma-layer-r.is-under') || viewRef.current, [])
  const underL = useCallback(() => frameRef.current?.querySelector('.ma-layer-r') || viewRef.current, [])
  const topId = layers.length ? layers[layers.length - 1].key : ''
  const swipeR = useBackSwipe({ layerRef: topRef, underOf: underR, dir: 1, on: !!topId && !notif, onClose: doBack, key: topId })
  const swipeL = useBackSwipe({ layerRef: notifRef, underOf: underL, scrimRef, dir: -1, on: notif, onClose: doBack })

  const hideBar = ADM_OWN_BAR.includes(route.sub) || notif
  const body = meta?.error ? <DataError onRetry={meta.retry} /> : meta?.isLoading ? <DataLoading /> : null
  const { onClickCapture } = useTabSwipe({ viewRef, trackRef, barRef, idx, count: ADM_TABS.length, onSwitch, on: !body })
  const trackStyle = { transform: `translate3d(calc(${-idx * 100}% + 0px), 0, 0)`, transition: still ? 'none' : undefined }

  return (
    <AppCtx.Provider value={app}>
      <div className={`tp fx ma va am${still ? ' is-still' : ''}${route.sub ? ' has-sub' : ''}`} ref={frameRef}>
        <div className="tp-sky" aria-hidden="true" />
        {body
          ? <main className="ma-solo">{body}</main>
          : (
            <div className="ma-viewport" ref={viewRef} onClickCapture={onClickCapture} onDragStart={e => e.preventDefault()}>
              <div className="ma-track" ref={trackRef} style={trackStyle}>
                {ADM_TABS.map((k, i) => {
                  const Page = TAB_PAGE[k]
                  const near = Math.abs(i - idx) <= 1 || k === 'home'
                  return (
                    <section key={k} className={`ma-page${i === idx ? ' is-on' : ''}`} data-ma-tab={k} data-ma-scroll aria-hidden={i !== idx} inert={i !== idx || undefined} aria-label={ADM_LABEL[k]}>
                      {near ? <Page route={route} /> : null}
                      {k === tab && source === 'sample' && <p className="ma-sample">Sample info, same as the desktop admin. Changes reset when you reload.</p>}
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
              <ANotif />
            </div>
          </>
        )}

        <nav className={`ma-tabbar${hideBar ? ' is-hidden' : ''}`} aria-label="Pages" ref={barRef} aria-hidden={hideBar} inert={hideBar || undefined} style={{ '--n': ADM_TABS.length, '--p': idx }}>
          <i className="ma-tab-hl" aria-hidden="true" />
          {ADM_TABS.map(k => {
            const Icon = TAB_ICON[k]
            const on = k === tab
            const badge = k === 'messages' ? unread : k === 'home' ? needs : 0
            const words = k === 'home' ? 'need you' : 'unread'
            return (
              <button key={k} type="button" className={`ma-tab${on ? ' is-on' : ''}`} aria-label={`${ADM_LABEL[k]}${badge ? `, ${badge} ${words}` : ''}`} aria-current={on ? 'page' : undefined} onClick={() => goTab(k)}>
                {k === 'you'
                  ? <Ini name={meName} tone="sky" size={32} className="ma-tab-me" />
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
