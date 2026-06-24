import { useState, useEffect, useRef } from 'react'
import { Bell, MessageSquare, Award, Clock, DollarSign, PhoneCall, X } from 'lucide-react'
import { useRepNotifications } from '../../hooks/useNotifications'
import { useActiveCall } from '../../contexts/ActiveCallContext'

const TYPE_STYLES = {
  message:     { Icon: MessageSquare, color: 'var(--accent)',  bg: 'var(--accent-dim)'  },
  badge:       { Icon: Award,         color: 'var(--success)', bg: 'var(--success-dim)' },
  follow_up:   { Icon: Clock,         color: 'var(--warning)', bg: 'var(--warning-dim)' },
  deal_closed: { Icon: DollarSign,    color: 'var(--success)', bg: 'var(--success-dim)' },
  call_graded: { Icon: PhoneCall,     color: 'var(--info)',    bg: 'var(--info-dim)'    },
  default:     { Icon: Bell,          color: 'var(--info)',    bg: 'var(--info-dim)'    },
}

let uid = 0

function ToastCard({ toast, onDismiss }) {
  const s = TYPE_STYLES[toast.notification.type] || TYPE_STYLES.default
  const { Icon } = s
  return (
    <div
      style={{
        display: 'flex', alignItems: 'flex-start', gap: 10,
        padding: '11px 14px',
        background: '#13131F',
        border: '0.5px solid var(--border)',
        borderRadius: 10,
        boxShadow: '0 8px 32px rgba(0,0,0,0.45)',
        width: 300,
        pointerEvents: 'auto',
        opacity: toast.exiting ? 0 : 1,
        transform: toast.exiting ? 'translateX(110%)' : 'translateX(0)',
        transition: 'opacity 0.3s ease, transform 0.3s ease',
      }}
    >
      <div style={{
        width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
        background: s.bg,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <Icon size={13} style={{ color: s.color }} />
      </div>
      <p style={{
        flex: 1, fontSize: 12.5, color: 'var(--text-primary)',
        margin: 0, lineHeight: 1.45, paddingTop: 4,
      }}>
        {toast.notification.message}
      </p>
      <button
        onClick={onDismiss}
        style={{
          background: 'none', border: 'none', cursor: 'pointer',
          color: 'var(--text-muted)', padding: 2, flexShrink: 0,
          display: 'flex', alignItems: 'center',
        }}
      >
        <X size={12} />
      </button>
    </div>
  )
}

export function NotificationToast({ profileId }) {
  const { data: notifications = [] } = useRepNotifications(profileId, 30)
  const [toasts, setToasts] = useState([])

  // Track whether the rep is in an active call via a ref so the notifications
  // effect doesn't need it as a dependency (avoiding stale closure issues).
  const { isInCall } = useActiveCall()
  const isInCallRef = useRef(false)
  useEffect(() => { isInCallRef.current = isInCall }, [isInCall])

  // Track which notification IDs have already been shown. null = not yet
  // initialized — first load seeds without firing any toasts.
  const seenRef = useRef(null)

  useEffect(() => {
    if (seenRef.current === null) {
      // First load — seed as seen so existing notifications don't all pop.
      seenRef.current = new Set(notifications.map(n => n.id))
      return
    }
    const newOnes = notifications.filter(n => !seenRef.current.has(n.id))
    newOnes.forEach(n => seenRef.current.add(n.id))
    if (!newOnes.length || isInCallRef.current) return

    const incoming = newOnes.map(n => ({ id: ++uid, notification: n, exiting: false }))
    setToasts(prev => [...prev, ...incoming])
    incoming.forEach(t => {
      const tid = t.id
      // Auto-dismiss: start exit animation after 4.5s, remove after 300ms more.
      setTimeout(() => {
        setToasts(prev => prev.map(x => x.id === tid ? { ...x, exiting: true } : x))
        setTimeout(() => setToasts(prev => prev.filter(x => x.id !== tid)), 350)
      }, 4500)
    })
  }, [notifications]) // eslint-disable-line react-hooks/exhaustive-deps

  function handleDismiss(id) {
    setToasts(prev => prev.map(t => t.id === id ? { ...t, exiting: true } : t))
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 350)
  }

  if (!toasts.length) return null

  return (
    <div style={{
      position: 'fixed', top: 16, right: 16,
      zIndex: 10000,
      display: 'flex', flexDirection: 'column', gap: 8,
      pointerEvents: 'none',
    }}>
      {toasts.map(t => (
        <ToastCard key={t.id} toast={t} onDismiss={() => handleDismiss(t.id)} />
      ))}
    </div>
  )
}
