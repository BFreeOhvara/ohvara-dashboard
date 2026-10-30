import { useCallback, useEffect, useRef, useState } from 'react'

// Prompt 750 — the quick fix right after a call is marked Cancelled or No
// answer: "Marked cancelled · Change to No answer" for 10 seconds (held while
// hovered), then it fades. The page owns the state so the bar outlives the
// focus card, which moves on to the next call the moment a result lands.
const SHOW_MS = 10e3
const FADE_MS = 250

export function useResultFix() {
  const [fix, setFix] = useState(null)
  const timer = useRef(null)
  const stop = () => { clearTimeout(timer.current); timer.current = null }
  const close = useCallback(() => {
    stop()
    setFix(f => (f ? { ...f, leaving: true } : f))
    timer.current = setTimeout(() => setFix(null), FADE_MS)
  }, [])
  const arm = useCallback(ms => { stop(); timer.current = setTimeout(close, ms) }, [close])
  const show = useCallback((p, result) => {
    setFix({ id: p.id, result, key: `${p.id}:${Date.now()}` })
    arm(SHOW_MS)
  }, [arm])
  const hold = useCallback(on => { if (on) stop(); else arm(SHOW_MS / 2) }, [arm])
  useEffect(() => stop, [])
  return { fix, show, hold, close, arm }
}
