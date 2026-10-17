import { useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { RefreshCw } from 'lucide-react'
import { isNativeApp } from '../../lib/native'

// Prompt 775 — pull down at the top of Home / Today in the phone app to
// refresh everything on the page (every query refetches). The website keeps
// the browser's own pull-to-refresh, so this only wraps in the app.

const PULL = 70
const MAX = 110

export function PullToRefresh({ children }) {
  if (!isNativeApp()) return children
  return <Puller>{children}</Puller>
}

function Puller({ children }) {
  const qc = useQueryClient()
  const start = useRef(null)
  const pulled = useRef(0)
  const [pull, setPullState] = useState(0)
  const setPull = v => { pulled.current = v; setPullState(v) }
  const [busy, setBusy] = useState(false)

  const atTop = () => (document.scrollingElement?.scrollTop ?? window.scrollY) <= 0

  function onTouchStart(e) {
    if (busy || !atTop() || e.target.closest?.('[role="dialog"], .ph-sheet')) return
    start.current = e.touches[0].clientY
  }
  function onTouchMove(e) {
    if (start.current == null) return
    const d = e.touches[0].clientY - start.current
    if (d <= 0 || !atTop()) { setPull(0); return }
    setPull(Math.min(MAX, d * 0.5))
  }
  async function onTouchEnd() {
    if (start.current == null) return
    start.current = null
    if (pulled.current < PULL) { setPull(0); return }
    setBusy(true)
    setPull(PULL * 0.6)
    try { await qc.refetchQueries({ type: 'active' }) } finally { setBusy(false); setPull(0) }
  }

  return (
    <div onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd} onTouchCancel={onTouchEnd}>
      <div className="nv-ptr" style={{ height: pull }} aria-hidden={!busy}>
        <RefreshCw size={18} strokeWidth={2.2} className={busy ? 'animate-spin' : undefined}
          style={{ transform: busy ? undefined : `rotate(${pull * 3}deg)`, opacity: Math.min(1, pull / PULL) }} />
        {busy && <span className="sr-only" role="status">Refreshing</span>}
      </div>
      {children}
    </div>
  )
}
