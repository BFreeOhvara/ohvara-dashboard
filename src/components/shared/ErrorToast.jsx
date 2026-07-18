import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AlertCircle } from 'lucide-react'

// ── ErrorToast — one-off inline validation message, top-right slide-in, same
// mechanics as NotificationToast.jsx's ToastCard (position, card style,
// exit-only slide animation, dismiss timing) but not routed through the
// notifications table/bell (Prompt 199). `onDone` is captured in a ref so the
// mount effect only runs once — the caller passes a fresh inline arrow every
// render, and depending on it directly would tear down/reschedule the
// dismiss timers on every re-render instead of once (Prompt 200 fix).
// Originally built for TrainingCenter.jsx, extracted to shared (Prompt 310)
// so CallModal can reuse the same component instead of a second toast.
export function ErrorToast({ message, onDone }) {
  const [exiting, setExiting] = useState(false)
  const onDoneRef = useRef(onDone)
  useEffect(() => { onDoneRef.current = onDone })

  useEffect(() => {
    const toExit = setTimeout(() => setExiting(true), 4500)
    const toDone = setTimeout(() => onDoneRef.current(), 4850)
    return () => { clearTimeout(toExit); clearTimeout(toDone) }
  }, [])

  return createPortal(
    <div style={{ position: 'fixed', top: 16, right: 16, zIndex: 10000, pointerEvents: 'none' }}>
      <div style={{
        display: 'flex', alignItems: 'flex-start', gap: 10,
        padding: '11px 14px',
        background: '#13131F',
        border: '0.5px solid var(--border)',
        borderRadius: 10,
        boxShadow: '0 8px 32px rgba(0,0,0,0.45)',
        width: 300,
        pointerEvents: 'auto',
        opacity: exiting ? 0 : 1,
        transform: exiting ? 'translateX(110%)' : 'translateX(0)',
        transition: 'opacity 0.3s ease, transform 0.3s ease',
      }}>
        <div style={{
          width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
          background: 'var(--danger-dim)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <AlertCircle size={13} style={{ color: 'var(--danger)' }} />
        </div>
        <p style={{
          flex: 1, fontSize: 12.5, color: 'var(--text-primary)',
          margin: 0, lineHeight: 1.45, paddingTop: 4,
        }}>
          {message}
        </p>
      </div>
    </div>,
    document.body
  )
}
