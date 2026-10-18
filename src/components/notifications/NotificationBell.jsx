import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import {
  Bell, CheckCheck, X, ChevronRight, SlidersHorizontal, Headphones, PhoneMissed, Phone, Wallet,
  MessageSquare, UserPlus, CircleCheck, Calendar, Clock, Users, Flag, Zap, Gauge, Video, PartyPopper,
} from 'lucide-react'
import { useNotificationFeed, useMoneyBanner, useMarkRead } from '../../hooks/useNotifications'
import { usePushSettings } from '../../hooks/useAccount'
import { isNativeApp } from '../../lib/native'
import { GetAppModal } from '../layout/GetAppModal'
import { lookOf, groupByDay, shownFor, needsYou, timeLabel, safeLink } from '../../lib/notifications'

// Prompt 767 — the notifications bell and panel, the same for every role
// (contents differ). Mockups: media/notifications/panel.dc.html, on-page and
// all-roles in the vault. Opens under the bell with a pointer; the page below
// the header dims; click outside or Esc closes. Rows are all 64px with no
// buttons: a click marks the row read and goes straight to the thing. The red
// banner is money problems only and stays until the problem is fixed.

const ICONS = {
  listen: Headphones, missed: PhoneMissed, phone: Phone, wallet: Wallet, msg: MessageSquare, join: UserPlus,
  win: CircleCheck, cal: Calendar, clock: Clock, team: Users, flag: Flag, bolt: Zap, gauge: Gauge, video: Video, bell: Bell,
}

// Panel placement from the bell (mockup: 14px below it, right edge 7px past
// it, pointer centred on it) and the dim area (below the header, right of
// the sidebar).
function useAnchor(open, btnRef) {
  const [pos, setPos] = useState(null)
  useLayoutEffect(() => {
    if (!open) return undefined
    const place = () => {
      const b = btnRef.current?.getBoundingClientRect()
      if (!b) return
      const header = btnRef.current.closest('.ov-header')?.getBoundingClientRect()
      // Placed by left edges (a page scrollbar shifts `right:` but not `left:`).
      const vw = window.innerWidth
      const width = Math.min(420, vw - 16)
      const left = Math.max(8, Math.min(b.right + 7, vw - 8) - width)
      setPos({
        top: b.bottom + 14, left, width,
        maxH: Math.min(720, window.innerHeight - b.bottom - 28),
        arrowLeft: b.left + b.width / 2 - 7,
        dimTop: header ? header.bottom : b.bottom + 8,
        dimLeft: header ? header.left : 0,
      })
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [open, btnRef])
  return pos
}

// Prompt 772 — `full`: the agent's phone layout opens the panel full screen
// (no pointer, no dim), with a close button in its title bar.
export function NotificationBell({ profileId, full = false }) {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const btnRef = useRef(null)
  const panelRef = useRef(null)
  const pos = useAnchor(open, btnRef)
  const { data: rows = [], isError: feedFailed, refetch: refetchFeed } = useNotificationFeed(profileId)
  const { data: banner } = useMoneyBanner(profileId)
  const markRead = useMarkRead(profileId)
  const unread = rows.filter(n => !n.read).length
  // Prompt 775 — the footer tells the truth about phone alerts.
  const { data: push } = usePushSettings(profileId)
  const phoneOn = !!push?.push_on && (isNativeApp() || (push?.devices ?? 0) > 0)
  const [getApp, setGetApp] = useState(false)

  useEffect(() => {
    if (!open) return undefined
    const onKey = e => { if (e.key === 'Escape') { setOpen(false); btnRef.current?.focus() } }
    const onDown = e => {
      if (panelRef.current?.contains(e.target) || btnRef.current?.contains(e.target)) return
      setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown)
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onDown) }
  }, [open])

  const go = link => {
    setOpen(false)
    const to = safeLink(link)
    if (to) navigate(to)
  }

  return (
    <>
      <button ref={btnRef} type="button" className={`ov-hbtn nt-bell${open ? ' is-open' : ''}`}
        aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'} aria-expanded={open} aria-haspopup="dialog"
        onClick={() => setOpen(o => !o)}>
        <Bell size={18} strokeWidth={2} />
        {unread > 0 && <span className="ov-hcount">{unread > 99 ? '99+' : unread}</span>}
      </button>
      {open && pos && createPortal(
        <>
          {!full && <div className="nt-dim" style={{ top: pos.dimTop, left: pos.dimLeft }} aria-hidden="true" />}
          {!full && <div className="nt-arrow" style={{ top: pos.top - 6, left: pos.arrowLeft }} aria-hidden="true" />}
          <div ref={panelRef} role="dialog" aria-label="Notifications" className={`nt-wrap${full ? ' is-full' : ''}`}
            style={full ? { top: 0, left: 0, width: '100vw', height: '100dvh' } : { top: pos.top, left: pos.left, width: pos.width, height: pos.maxH }}>
            <NotificationPanel rows={rows} failed={feedFailed} onRetry={() => refetchFeed()} banner={banner} unread={unread}
              onClose={full ? () => { setOpen(false); btnRef.current?.focus() } : undefined}
              onOpen={n => { if (!n.read) markRead.mutate([n.id]); go(n.link) }}
              onMarkAll={() => markRead.mutate(null)}
              onBanner={() => go(banner?.link)}
              onSettings={() => go('/settings#notifications')}
              phoneOn={phoneOn}
              onPhone={() => { if (isNativeApp() || phoneOn) go('/settings#notifications'); else { setOpen(false); setGetApp(true) } }} />
          </div>
        </>,
        document.body,
      )}
      {getApp && <GetAppModal onClose={() => setGetApp(false)} />}
    </>
  )
}

// The panel itself, without placement (the harness renders it on its own).
export function NotificationPanel({ rows, failed = false, onRetry, banner, unread, onOpen, onMarkAll, onBanner, onSettings, onClose, initialTab = 'all', now, phoneOn = false, onPhone }) {
  const [tab, setTab] = useState(initialTab)
  const needs = rows.filter(needsYou).length
  const groups = groupByDay(shownFor(rows, tab), now)
  const tabs = [['needs', 'Needs you', needs], ['all', 'Everything', 0]]

  return (
    <div className="nt-panel">
      <div className="nt-head">
        <div className="nt-titlebar">
          <span className="nt-title">Notifications</span>
          {unread > 0 && <span className="nt-unread">{unread}</span>}
          <span style={{ flex: 1 }} />
          <button type="button" className="nt-markall" onClick={onMarkAll} disabled={!unread}>
            <CheckCheck size={14} strokeWidth={2.2} aria-hidden="true" />Mark all read
          </button>
          {onClose && (
            <button type="button" className="nt-close" onClick={onClose} aria-label="Close notifications">
              <X size={20} strokeWidth={2.2} />
            </button>
          )}
        </div>
        <div className="nt-tabs" role="tablist" aria-label="Show">
          {tabs.map(([key, label, n]) => (
            <button key={key} type="button" role="tab" aria-selected={tab === key}
              className={`nt-tab${tab === key ? ' is-on' : ''}`} onClick={() => setTab(key)}>
              {label}{n > 0 && <span className="nt-tab-n">{n}</span>}
            </button>
          ))}
        </div>
      </div>

      {banner && (
        <div className="nt-banner" role="alert">
          <span className="nt-banner-tile"><Wallet size={18} strokeWidth={2} aria-hidden="true" /></span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span className="nt-banner-title">{banner.title}</span>
            <span className="nt-banner-sub">{banner.sub}</span>
            {/* Prompt 775 — no payment buttons inside the phone app. */}
            {!(isNativeApp() && String(banner.link || '').startsWith('/agent/billing')) && (
              <button type="button" className="nt-banner-btn" onClick={onBanner}>{banner.btn}</button>
            )}
          </span>
        </div>
      )}

      <div className="nt-list scrollbar-thin">
        {failed && groups.length === 0 ? (
          // P778 — a failed load isn't "all caught up".
          <div className="nt-empty" role="alert">
            <span className="nt-empty-title">Couldn’t load your notifications</span>
            <button type="button" className="nt-banner-btn" onClick={onRetry}>Try again</button>
          </div>
        ) : groups.length === 0 ? (
          <div className="nt-empty">
            <span className="nt-empty-tile"><PartyPopper size={22} strokeWidth={2} aria-hidden="true" /></span>
            <span className="nt-empty-title">You’re all caught up</span>
            <span className="nt-empty-sub">{tab === 'needs' ? 'Nothing needs you right now.' : 'New notifications show up here.'}</span>
          </div>
        ) : groups.map(g => (
          <div key={g.label}>
            <div className="nt-group">{g.label}</div>
            {g.items.map(n => {
              const look = lookOf(n.type)
              const Icon = ICONS[look.icon] || Bell
              return (
                <button key={n.id} type="button" className={`nt-row nt-tone-${look.tone}${n.read ? '' : ' is-unread'}`}
                  onClick={() => onOpen(n)}>
                  {!n.read && <span className="nt-edge" aria-hidden="true" />}
                  <span className="nt-tile"><Icon size={17} strokeWidth={2} aria-hidden="true" /></span>
                  <span className="nt-body">
                    <span className="nt-line">
                      <span className="nt-row-title">{n.title}</span>
                      <span className="nt-time">{timeLabel(n.created_at, now)}</span>
                      {!n.read && <span className="nt-dot" aria-label="Unread" />}
                    </span>
                    <span className="nt-row-sub">{n.detail}</span>
                  </span>
                  <ChevronRight size={14} strokeWidth={2.2} className="nt-chev" aria-hidden="true" />
                </button>
              )
            })}
          </div>
        ))}
      </div>

      <div className="nt-foot">
        <button type="button" className="nt-settings" onClick={onSettings}>
          <SlidersHorizontal size={15} strokeWidth={2} aria-hidden="true" />Notification settings
        </button>
        <span style={{ flex: 1 }} />
        <button type="button" className="nt-phone" onClick={onPhone}>
          <span className={`nt-phone-dot${phoneOn ? ' is-on' : ''}`} aria-hidden="true" />
          {phoneOn ? 'Phone alerts on' : isNativeApp() ? 'Phone alerts off' : 'Phone alerts off · Get the app'}
        </button>
      </div>
    </div>
  )
}
