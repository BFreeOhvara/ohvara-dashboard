import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

// Prompt 772 — a bottom sheet for the phone layout (a client, mockup
// Client.dc.html). Closes on the X, a tap on the dim page, Esc, or a swipe
// down on its top strip (grabber + header). Portaled to <body> (a transformed
// ancestor would trap position:fixed — see Gotchas). `head` sits in the
// draggable strip next to the X; `foot` is pinned under the scrolling body.

const DRAG_CLOSE = 90

export function PhoneSheet({ label, head, foot, onClose, children }) {
  const [closing, setClosing] = useState(false)
  const [drag, setDrag] = useState(0)
  const [settled, setSettled] = useState(false)
  const start = useRef(null)
  const closeRef = useRef(null)
  const onCloseRef = useRef(onClose)
  useEffect(() => { onCloseRef.current = onClose })
  const timer = useRef(null)

  const close = useRef(() => {
    if (timer.current) return
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { onCloseRef.current(); return }
    setClosing(true)
    timer.current = setTimeout(() => onCloseRef.current(), 220)
  })

  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = e => { if (e.key === 'Escape') close.current() }
    window.addEventListener('keydown', onKey)
    closeRef.current?.focus({ preventScroll: true, focusVisible: false })
    return () => { document.body.style.overflow = prev; window.removeEventListener('keydown', onKey); clearTimeout(timer.current) }
  }, [])

  const grip = {
    onTouchStart: e => { start.current = e.touches[0].clientY },
    onTouchMove: e => { if (start.current != null) setDrag(Math.max(0, e.touches[0].clientY - start.current)) },
    onTouchEnd: () => {
      if (start.current == null) return
      start.current = null
      if (drag > DRAG_CLOSE) close.current()
      setDrag(0)
    },
  }

  return createPortal(
    <>
      <div className={`ph-scrim${closing ? ' is-closing' : ''}`} onClick={() => close.current()} aria-hidden="true" />
      <section
        className={`ph-sheet${closing ? ' is-closing' : ''}${settled ? ' is-settled' : ''}`} role="dialog" aria-modal="true" aria-label={label}
        style={drag ? { transform: `translateY(${drag}px)` } : undefined}
        onAnimationEnd={e => { if (e.target === e.currentTarget && !closing) setSettled(true) }}
      >
        <div className="ph-sheet-grip" {...grip}>
          <span className="ph-grab" aria-hidden="true" />
          <div style={{ marginTop: 14, marginBottom: 2, display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 12 }}>{head}</div>
            <button ref={closeRef} type="button" className="ph-close" onClick={() => close.current()} aria-label="Close">
              <X size={18} strokeWidth={2.4} />
            </button>
          </div>
        </div>
        <div className="ph-sheet-body">{children}</div>
        {foot && <div className="ph-sheet-foot">{foot}</div>}
      </section>
    </>,
    document.body,
  )
}
