import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Check } from 'lucide-react'

// Prompt 774 — a short "done" line above the tab bar (Invite sent, Paid,
// Given to…). Portaled to <body>; goes away by itself.

export function PhoneToast({ text, onDone, ms = 2800 }) {
  const done = useRef(onDone)
  useEffect(() => { done.current = onDone })
  useEffect(() => {
    if (!text) return undefined
    const t = setTimeout(() => done.current?.(), ms)
    return () => clearTimeout(t)
  }, [text, ms])
  if (!text) return null
  return createPortal(
    <div className="aph-toast" role="status" aria-live="polite">
      <span className="aph-toast-ic" aria-hidden="true"><Check size={14} strokeWidth={3} /></span>{text}
    </div>,
    document.body,
  )
}
