import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Bell, CheckCheck, MessageSquare, Award, Clock, DollarSign, PhoneCall } from 'lucide-react'
import { useRepNotifications, useRepUnreadCount, useRepMarkNotificationRead, useRepMarkAllRead } from '../../hooks/useNotifications'
import { useFollowUpNotifier, useMessageReplyNotifier, useFollowUp5MinNotifier, useDealClosedNotifier, useCallGradedNotifier } from '../../hooks/useRepNotificationTriggers'
import { useMyLeads } from '../../hooks/useLeads'

const TYPE_STYLES = {
  message:      { Icon: MessageSquare, color: 'var(--accent)',  bg: 'var(--accent-dim)'  },
  badge:        { Icon: Award,         color: 'var(--success)', bg: 'var(--success-dim)' },
  follow_up:    { Icon: Clock,         color: 'var(--warning)', bg: 'var(--warning-dim)' },
  deal_closed:  { Icon: DollarSign,    color: 'var(--success)', bg: 'var(--success-dim)' },
  call_graded:  { Icon: PhoneCall,     color: 'var(--info)',    bg: 'var(--info-dim)'    },
  default:      { Icon: Bell,          color: 'var(--info)',    bg: 'var(--info-dim)'    },
}

function fmtTime(iso) {
  const d = new Date(iso)
  const diffMs = Date.now() - d.getTime()
  const diffMin = Math.floor(diffMs / 60000)
  if (diffMin < 1) return 'just now'
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function RepNotificationBell({ profileId }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const panelRef = useRef(null)
  const [coords, setCoords] = useState(null)

  const { data: notifications = [] } = useRepNotifications(profileId, 30)
  const { data: unreadCount = 0 }    = useRepUnreadCount(profileId)
  const markOne  = useRepMarkNotificationRead(profileId)
  const markAll  = useRepMarkAllRead(profileId)

  // Follow-up trigger — runs silently in the background
  const { data: leads = [] } = useMyLeads()
  useFollowUpNotifier(profileId, leads, notifications)
  useMessageReplyNotifier(profileId)
  useFollowUp5MinNotifier(profileId)
  useDealClosedNotifier(profileId)
  useCallGradedNotifier(profileId)

  // The sidebar (`<aside>`) is `position: fixed` with `overflow: hidden` for
  // its own scroll containment — any dropdown rendered as its DOM descendant
  // gets clipped to the sidebar's 240px width no matter the z-index, even
  // positioned outside that box. Render the panel into a portal instead,
  // positioned via the bell's own bounding rect, so it isn't a descendant of
  // the clipped container at all.
  useEffect(() => {
    if (open && ref.current) {
      const rect = ref.current.getBoundingClientRect()
      setCoords({ top: rect.top - 4, left: rect.right + 8 })
    }
  }, [open])

  // Close on outside click — checks both the bell wrapper and the portal panel,
  // since the panel is no longer a DOM descendant of the wrapper.
  useEffect(() => {
    function handleClick(e) {
      if (
        ref.current && !ref.current.contains(e.target) &&
        panelRef.current && !panelRef.current.contains(e.target)
      ) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      {/* Bell button */}
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          position: 'relative',
          width: 34, height: 34,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: open ? 'var(--bg-elevated)' : 'transparent',
          border: '0.5px solid ' + (open ? 'var(--border-hover)' : 'transparent'),
          borderRadius: 8, cursor: 'pointer',
          color: 'var(--text-secondary)',
          transition: 'all 0.15s',
        }}
        onMouseEnter={e => { if (!open) e.currentTarget.style.background = 'var(--bg-elevated)' }}
        onMouseLeave={e => { if (!open) e.currentTarget.style.background = 'transparent' }}
      >
        <Bell size={16} />
        {unreadCount > 0 && (
          <span style={{
            position: 'absolute', top: 5, right: 5,
            width: 8, height: 8, borderRadius: '50%',
            background: 'var(--danger)',
            boxShadow: '0 0 6px var(--danger)',
            animation: 'navPulse 2s ease-in-out infinite',
          }} />
        )}
      </button>

      {/* Dropdown — portaled to document.body, positioned via the bell's
          bounding rect (see the coords effect above) so it escapes the
          sidebar's overflow:hidden clipping entirely. */}
      {open && coords && createPortal(
        <div
          ref={panelRef}
          style={{
            position: 'fixed', top: coords.top, left: coords.left,
            width: 340, maxHeight: 420,
            // Solid, not the translucent/backdrop-blur `glass` token — this
            // panel needs to fully cover whatever's behind it.
            background: '#13131F', border: '0.5px solid var(--border)',
            borderRadius: 10, overflow: 'hidden',
            zIndex: 9999,
            boxShadow: '0 16px 48px rgba(0,0,0,0.4)',
          }}
        >
          {/* Header */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '10px 14px',
            borderBottom: '0.5px solid var(--border)',
            background: 'var(--bg-elevated)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>Notifications</span>
              {unreadCount > 0 && (
                <span style={{
                  fontSize: 10, padding: '1px 6px', borderRadius: 3,
                  background: 'var(--danger-dim)', color: 'var(--danger)',
                  border: '0.5px solid rgba(239,68,68,0.20)',
                  fontFamily: 'var(--font-mono)', fontWeight: 500,
                }}>
                  {unreadCount}
                </span>
              )}
            </div>
            {unreadCount > 0 && (
              <button
                onClick={() => markAll.mutate()}
                style={{
                  fontSize: 11, color: 'var(--accent)', background: 'none',
                  border: 'none', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: 4,
                }}
              >
                <CheckCheck size={11} /> Mark all read
              </button>
            )}
          </div>

          {/* List */}
          <div style={{ overflowY: 'auto', maxHeight: 360 }} className="scrollbar-thin">
            {notifications.length === 0 ? (
              <div style={{ padding: '32px 16px', textAlign: 'center' }}>
                <Bell size={20} style={{ color: 'var(--text-muted)', margin: '0 auto 8px' }} />
                <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>No notifications yet</p>
              </div>
            ) : (
              notifications.map((n, i) => {
                const style = TYPE_STYLES[n.type] || TYPE_STYLES.default
                const { Icon } = style
                return (
                  <div
                    key={n.id}
                    className="table-row-animated"
                    style={{
                      display: 'flex', gap: 10, padding: '10px 14px',
                      borderBottom: i < notifications.length - 1 ? '0.5px solid var(--border)' : 'none',
                      background: n.read ? 'transparent' : 'rgba(108,99,255,0.04)',
                      cursor: n.read ? 'default' : 'pointer',
                      transition: 'background 100ms',
                      animationDelay: `${i * 0.03}s`,
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-elevated)' }}
                    onMouseLeave={e => { e.currentTarget.style.background = n.read ? 'transparent' : 'rgba(108,99,255,0.04)' }}
                    onClick={() => { if (!n.read) markOne.mutate(n.id) }}
                  >
                    {/* Icon */}
                    <div style={{
                      width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
                      background: style.bg,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      <Icon size={13} style={{ color: style.color }} />
                    </div>

                    {/* Content */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{
                        fontSize: 13, color: 'var(--text-primary)', margin: 0,
                        lineHeight: 1.4, overflow: 'hidden',
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                      }}>
                        {n.message}
                      </p>
                      {n.type === 'message' && n.data?.reply_preview && (
                        <p style={{
                          fontSize: 11, color: 'var(--text-secondary)', marginTop: 2,
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>
                          "{n.data.reply_preview}"
                        </p>
                      )}
                      <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                        {fmtTime(n.created_at)}
                      </p>
                    </div>

                    {/* Unread dot */}
                    {!n.read && (
                      <div style={{
                        width: 6, height: 6, borderRadius: '50%',
                        background: 'var(--accent)', flexShrink: 0, marginTop: 5,
                        boxShadow: '0 0 4px var(--accent)',
                      }} />
                    )}
                  </div>
                )
              })
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}
