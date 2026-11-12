import { useEffect, useLayoutEffect, useRef } from 'react'
import { backCloses, sheetCloses, velocityOf } from './appModel'

// P972 — swipe a slide-in screen away the way it came: from the right, swipe right; Notifications (from the left),
// swipe left. Works from anywhere on the screen, not just the edge. The screen follows the finger and the one under
// it slides home from a little way over (the peek); on release a flick or a drag past 35 % closes it, anything less
// springs back. The direction locks in the first few pixels: up or down is a scroll, the other way is ignored.
// Transforms are written straight to the DOM (no React render per frame). Touch uses touch events (iOS can be told
// to stop scrolling once the swipe locks); a mouse uses pointer events. Swiping away also drops the keyboard.
const LOCK = 8
const PEEK = 0.28
const SKIP = 'input, textarea, select, [contenteditable], [data-no-swipe]'
const EASE = 'cubic-bezier(.22, 1, .36, 1)'

export function useBackSwipe({ layerRef, underOf, scrimRef, dir = 1, on = true, onClose, key = '' }) {
  const live = useRef({})
  useLayoutEffect(() => { live.current = { dir, onClose, underOf } })
  const moved = useRef(false)

  useEffect(() => {
    const el = layerRef.current
    if (!el || !on) return undefined
    let g = null // { x, y, mode: 'wait' | 'drag' | 'scroll' | 'off', d, samples }
    let timer = 0
    const width = () => el.clientWidth || window.innerWidth || 1

    const paint = (d, drag) => {
      const { dir: s, underOf: u } = live.current
      const p = Math.min(1, Math.abs(d) / width())
      el.style.transition = drag ? 'none' : `transform .32s ${EASE}`
      el.style.transform = `translate3d(${d}px, 0, 0)`
      const under = u?.()
      if (under) {
        under.style.transition = drag ? 'none' : `transform .32s ${EASE}`
        under.style.transform = `translate3d(${-s * PEEK * (1 - p) * 100}%, 0, 0)`
      }
      const scrim = scrimRef?.current
      if (scrim) { scrim.style.transition = drag ? 'none' : 'opacity .32s'; scrim.style.opacity = String(1 - p) }
    }
    const settle = () => {
      const under = live.current.underOf?.()
      if (under) { under.style.transition = ''; under.style.transform = '' }
    }

    const start = (x, y, target) => {
      if (target?.closest?.(SKIP)) { g = null; return }
      g = { x, y, mode: 'wait', d: 0, samples: [{ t: performance.now(), x }] }
      moved.current = false
    }
    const move = (x, y) => {
      if (!g || g.mode === 'scroll' || g.mode === 'off') return false
      const dx = x - g.x
      const dy = y - g.y
      const s = live.current.dir
      if (g.mode === 'wait') {
        if (Math.abs(dx) < LOCK && Math.abs(dy) < LOCK) return false
        if (Math.abs(dy) >= Math.abs(dx)) { g.mode = 'scroll'; return false }
        if (Math.sign(dx) !== s) { g.mode = 'off'; return false }
        g.mode = 'drag'
        moved.current = true
        clearTimeout(timer)
        el.classList.add('is-dragging')
        const a = document.activeElement
        if (a && el.contains(a) && a.blur) a.blur()
      }
      g.d = s > 0 ? Math.max(0, dx) : Math.min(0, dx)
      g.samples.push({ t: performance.now(), x })
      if (g.samples.length > 12) g.samples.shift()
      paint(g.d, true)
      return true
    }
    const end = cancelled => {
      const st = g
      g = null
      if (!st || st.mode !== 'drag') return
      el.classList.remove('is-dragging')
      const s = live.current.dir
      const v = cancelled ? 0 : velocityOf(st.samples) * s
      if (!cancelled && backCloses(st.d * s, v, width())) {
        el.style.transition = `transform .26s ${EASE}`
        el.style.transform = `translate3d(${s * 100}%, 0, 0)`
        const under = live.current.underOf?.()
        if (under) { under.style.transition = `transform .26s ${EASE}`; under.style.transform = 'translate3d(0, 0, 0)' }
        const scrim = scrimRef?.current
        if (scrim) { scrim.style.transition = 'opacity .26s'; scrim.style.opacity = '0' }
        timer = setTimeout(() => { settle(); live.current.onClose?.() }, 250)
      } else {
        paint(0, false)
        timer = setTimeout(() => { settle(); el.style.transition = ''; el.style.transform = '' }, 330)
      }
    }

    const onTouchStart = e => { if (e.touches.length !== 1) { end(true); return } start(e.touches[0].clientX, e.touches[0].clientY, e.target) }
    const onTouchMove = e => { if (e.touches.length !== 1) return; if (move(e.touches[0].clientX, e.touches[0].clientY) && e.cancelable) e.preventDefault() }
    const onTouchEnd = () => end(false)
    const onTouchCancel = () => end(true)
    const onPointerDown = e => {
      if (e.pointerType === 'touch' || e.button !== 0) return
      start(e.clientX, e.clientY, e.target)
      const off = () => { window.removeEventListener('pointermove', pm); window.removeEventListener('pointerup', pu); window.removeEventListener('pointercancel', pc) }
      const pm = ev => { if (move(ev.clientX, ev.clientY)) ev.preventDefault() }
      const pu = () => { off(); end(false) }
      const pc = () => { off(); end(true) }
      window.addEventListener('pointermove', pm)
      window.addEventListener('pointerup', pu)
      window.addEventListener('pointercancel', pc)
    }

    el.addEventListener('touchstart', onTouchStart, { passive: true })
    el.addEventListener('touchmove', onTouchMove, { passive: false })
    el.addEventListener('touchend', onTouchEnd)
    el.addEventListener('touchcancel', onTouchCancel)
    el.addEventListener('pointerdown', onPointerDown)
    return () => {
      clearTimeout(timer)
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchmove', onTouchMove)
      el.removeEventListener('touchend', onTouchEnd)
      el.removeEventListener('touchcancel', onTouchCancel)
      el.removeEventListener('pointerdown', onPointerDown)
    }
  }, [layerRef, scrimRef, on, key])

  // The click that ends a swipe is not a tap.
  const onClickCapture = e => { if (moved.current) { e.preventDefault(); e.stopPropagation(); moved.current = false } }
  return { onClickCapture }
}

// P972 — pull a bottom sheet down to close it. The sheet follows the finger (only while whatever is under the finger
// is scrolled to its top; otherwise the finger scrolls the sheet), the dim behind it fades, and on release a flick
// down or a pull past a quarter of its height closes it; anything less springs back.
export function useSheetDrag({ sheetRef, scrimRef, onClose, on = true, closes = sheetCloses }) {
  const live = useRef({})
  useLayoutEffect(() => { live.current = { onClose, closes } })
  useEffect(() => {
    const el = sheetRef.current
    if (!el || !on) return undefined
    let g = null
    let timer = 0
    const atTop = t => {
      for (let n = t; n && n !== el.parentNode; n = n.parentNode) {
        if (n.nodeType === 1 && n.scrollTop > 0) return false
        if (n === el) break
      }
      return true
    }
    const paint = (dy, drag) => {
      el.style.transition = drag ? 'none' : `transform .32s ${EASE}`
      el.style.transform = dy ? `translate3d(0, ${dy}px, 0)` : ''
      const scrim = scrimRef?.current
      if (scrim) { scrim.style.transition = drag ? 'none' : 'opacity .32s'; scrim.style.opacity = String(Math.max(0, 1 - dy / Math.max(1, el.offsetHeight))) }
    }
    const start = (x, y, target) => {
      if (target?.closest?.('input[type="range"], [data-no-swipe]')) { g = null; return }
      g = { x, y, mode: 'wait', dy: 0, top: atTop(target), samples: [{ t: performance.now(), x: y }] }
    }
    const move = (x, y) => {
      if (!g || g.mode !== 'wait' && g.mode !== 'drag') return false
      const dx = x - g.x
      const dy = y - g.y
      if (g.mode === 'wait') {
        if (Math.abs(dx) < LOCK && Math.abs(dy) < LOCK) return false
        if (Math.abs(dx) > Math.abs(dy) || dy < 0 || !g.top) { g.mode = 'off'; return false }
        g.mode = 'drag'
        clearTimeout(timer)
        const a = document.activeElement
        if (a && el.contains(a) && a.blur) a.blur()
      }
      g.dy = Math.max(0, dy)
      g.samples.push({ t: performance.now(), x: y })
      if (g.samples.length > 12) g.samples.shift()
      paint(g.dy, true)
      return true
    }
    const end = cancelled => {
      const st = g
      g = null
      if (!st || st.mode !== 'drag') return
      const v = cancelled ? 0 : velocityOf(st.samples)
      const test = live.current.closes
      if (!cancelled && test(st.dy, v, el.offsetHeight || 1)) {
        el.style.transition = `transform .22s ${EASE}`
        el.style.transform = 'translate3d(0, 100%, 0)'
        const scrim = scrimRef?.current
        if (scrim) { scrim.style.transition = 'opacity .22s'; scrim.style.opacity = '0' }
        timer = setTimeout(() => { el.classList.add('is-out'); live.current.onClose?.() }, 200)
      } else {
        paint(0, false)
        timer = setTimeout(() => { el.style.transition = '' }, 330)
      }
    }
    const onTouchStart = e => { if (e.touches.length !== 1) { end(true); return } start(e.touches[0].clientX, e.touches[0].clientY, e.target) }
    const onTouchMove = e => { if (e.touches.length !== 1) return; if (move(e.touches[0].clientX, e.touches[0].clientY) && e.cancelable) e.preventDefault() }
    const onTouchEnd = () => end(false)
    const onTouchCancel = () => end(true)
    const onPointerDown = e => {
      if (e.pointerType === 'touch' || e.button !== 0) return
      start(e.clientX, e.clientY, e.target)
      const off = () => { window.removeEventListener('pointermove', pm); window.removeEventListener('pointerup', pu); window.removeEventListener('pointercancel', pc) }
      const pm = ev => { if (move(ev.clientX, ev.clientY)) ev.preventDefault() }
      const pu = () => { off(); end(false) }
      const pc = () => { off(); end(true) }
      window.addEventListener('pointermove', pm)
      window.addEventListener('pointerup', pu)
      window.addEventListener('pointercancel', pc)
    }
    el.addEventListener('touchstart', onTouchStart, { passive: true })
    el.addEventListener('touchmove', onTouchMove, { passive: false })
    el.addEventListener('touchend', onTouchEnd)
    el.addEventListener('touchcancel', onTouchCancel)
    el.addEventListener('pointerdown', onPointerDown)
    return () => {
      clearTimeout(timer)
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchmove', onTouchMove)
      el.removeEventListener('touchend', onTouchEnd)
      el.removeEventListener('touchcancel', onTouchCancel)
      el.removeEventListener('pointerdown', onPointerDown)
    }
  }, [sheetRef, scrimRef, on])
}
