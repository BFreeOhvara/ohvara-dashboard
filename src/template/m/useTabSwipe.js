import { useEffect, useLayoutEffect, useRef } from 'react'
import { swipeTarget, rubber, velocityOf } from './appModel'

// P971 — swiping between the phone app's tabs. The page track follows the finger (the next or previous page peeks
// in), the bar's highlight moves with it, and on release it snaps with the finger's speed: a quick flick switches
// even when short, a slow drag past 35 % switches, anything less springs back. The direction locks in the first
// few pixels: a gesture that starts up or down is a scroll and never a swipe. Past the first or last tab the page
// only gives a little. Works over cards and buttons (a tap still taps; the click that ends a drag is dropped).
// The transform is written straight to the track (no React render per frame). Touch uses touch events, so iOS can
// be told to stop scrolling the moment the swipe locks; a mouse uses pointer events.
const LOCK = 8
const SKIP = 'input, textarea, select, [contenteditable], [data-no-swipe]'

export function useTabSwipe({ viewRef, trackRef, barRef, idx, count, onSwitch, on = true }) {
  const live = useRef({})
  useLayoutEffect(() => { live.current = { idx, count, onSwitch } })
  const moved = useRef(false)

  useEffect(() => {
    const view = viewRef.current
    if (!view) return undefined
    let g = null // { x, y, mode: 'wait' | 'drag' | 'scroll', dx, samples }

    const place = (dx, drag) => {
      const { idx: i, count: n } = live.current
      const track = trackRef.current
      const w = view.clientWidth || 1
      const edge = (i === 0 && dx > 0) || (i === n - 1 && dx < 0)
      const d = edge ? rubber(dx, w) : dx
      if (track) {
        track.style.transition = drag ? 'none' : ''
        track.style.transform = `translate3d(calc(${-i * 100}% + ${d}px), 0, 0)`
      }
      const bar = barRef.current
      if (bar) {
        bar.classList.toggle('is-drag', drag)
        bar.style.setProperty('--p', String(Math.max(0, Math.min(n - 1, i - d / w))))
      }
    }

    const start = (x, y, target) => {
      if (target?.closest?.(SKIP)) { g = null; return }
      g = { x, y, mode: 'wait', dx: 0, samples: [{ t: performance.now(), x }] }
      moved.current = false
    }
    // Returns true while this gesture is a swipe (the caller then stops the page from scrolling).
    const move = (x, y) => {
      if (!g || g.mode === 'scroll') return false
      const dx = x - g.x
      const dy = y - g.y
      if (g.mode === 'wait') {
        if (Math.abs(dx) < LOCK && Math.abs(dy) < LOCK) return false
        if (Math.abs(dy) >= Math.abs(dx)) { g.mode = 'scroll'; return false }
        g.mode = 'drag'
        moved.current = true
        view.classList.add('is-dragging')
      }
      g.dx = dx
      const t = performance.now()
      g.samples.push({ t, x })
      if (g.samples.length > 12) g.samples.shift()
      place(dx, true)
      return true
    }
    const end = cancelled => {
      const s = g
      g = null
      if (!s || s.mode !== 'drag') return
      view.classList.remove('is-dragging')
      const { idx: i, count: n, onSwitch: go } = live.current
      const v = cancelled ? 0 : velocityOf(s.samples)
      const to = cancelled ? i : swipeTarget(i, s.dx, v, view.clientWidth || 1, n)
      // Snap: let the CSS transition run to the landing page; the frame then catches up to the same place.
      const track = trackRef.current
      if (track) { track.style.transition = ''; track.style.transform = `translate3d(calc(${-to * 100}% + 0px), 0, 0)` }
      const bar = barRef.current
      if (bar) { bar.classList.remove('is-drag'); bar.style.setProperty('--p', String(to)) }
      if (to !== i) go(to)
    }

    // Touch: passive start, active move (so a locked swipe can stop the page scrolling on iOS).
    const onTouchStart = e => { if (e.touches.length !== 1) { end(true); return } start(e.touches[0].clientX, e.touches[0].clientY, e.target) }
    const onTouchMove = e => { if (e.touches.length !== 1) return; if (move(e.touches[0].clientX, e.touches[0].clientY) && e.cancelable) e.preventDefault() }
    const onTouchEnd = () => end(false)
    const onTouchCancel = () => end(true)
    // Mouse (desktop, preview): pointer events, followed on the window so a drag that leaves the page still ends.
    const onPointerDown = e => {
      if (e.pointerType === 'touch' || e.button !== 0) return
      start(e.clientX, e.clientY, e.target)
      const pm = ev => { if (move(ev.clientX, ev.clientY)) ev.preventDefault() }
      const pu = () => { window.removeEventListener('pointermove', pm); window.removeEventListener('pointerup', pu); window.removeEventListener('pointercancel', pc); end(false) }
      const pc = () => { window.removeEventListener('pointermove', pm); window.removeEventListener('pointerup', pu); window.removeEventListener('pointercancel', pc); end(true) }
      window.addEventListener('pointermove', pm)
      window.addEventListener('pointerup', pu)
      window.addEventListener('pointercancel', pc)
    }

    view.addEventListener('touchstart', onTouchStart, { passive: true })
    view.addEventListener('touchmove', onTouchMove, { passive: false })
    view.addEventListener('touchend', onTouchEnd)
    view.addEventListener('touchcancel', onTouchCancel)
    view.addEventListener('pointerdown', onPointerDown)
    return () => {
      view.removeEventListener('touchstart', onTouchStart)
      view.removeEventListener('touchmove', onTouchMove)
      view.removeEventListener('touchend', onTouchEnd)
      view.removeEventListener('touchcancel', onTouchCancel)
      view.removeEventListener('pointerdown', onPointerDown)
    }
  }, [viewRef, trackRef, barRef, on])

  // The click that ends a drag is not a tap.
  const onClickCapture = e => { if (moved.current) { e.preventDefault(); e.stopPropagation(); moved.current = false } }
  return { onClickCapture }
}
