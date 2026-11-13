import { useEffect } from 'react'

// P972: the keyboard. Dragging down on the conversation or tapping anywhere off the field drops it (the web side of
// iOS's interactive dismiss; the native drag-along needs keyboardDismissMode in the next app build), and the typing
// bar rides on top of it (--ma-kb: how much of the screen the keyboard covers when the page isn't resized for it).
export function useKeyboard(rootRef, inputRef) {
  useEffect(() => {
    const root = rootRef.current
    const scroller = root?.querySelector('.ma-sub-scroll')
    if (!root || !scroller) return undefined
    let y0 = null
    const typing = () => document.activeElement === inputRef.current
    const onStart = e => { y0 = e.touches?.[0]?.clientY ?? null }
    const onMove = e => {
      if (y0 === null || !typing()) return
      if ((e.touches?.[0]?.clientY ?? y0) - y0 > 14) { inputRef.current.blur(); y0 = null }
    }
    const onDown = e => { if (typing() && !e.target.closest('.ma-compose')) inputRef.current.blur() }
    scroller.addEventListener('touchstart', onStart, { passive: true })
    scroller.addEventListener('touchmove', onMove, { passive: true })
    root.addEventListener('pointerdown', onDown)
    const vv = window.visualViewport
    const fit = () => {
      const kb = vv ? Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)) : 0
      root.style.setProperty('--ma-kb', `${kb}px`)
      root.classList.toggle('has-kb', kb > 40)
    }
    vv?.addEventListener('resize', fit)
    vv?.addEventListener('scroll', fit)
    fit()
    return () => {
      scroller.removeEventListener('touchstart', onStart)
      scroller.removeEventListener('touchmove', onMove)
      root.removeEventListener('pointerdown', onDown)
      vv?.removeEventListener('resize', fit)
      vv?.removeEventListener('scroll', fit)
    }
  }, [rootRef, inputRef])
}

// P982 — Search never brings the keyboard up by itself (iOS did, on open): if the field gets focus in the first moment
// without the person touching it, it's dropped. A tap on the field focuses it as normal.
export function useNoAutoKeyboard(ref) {
  useEffect(() => {
    const el = ref.current
    if (!el) return
    let touched = false
    const touch = () => { touched = true }
    const onFocus = () => { if (!touched) el.blur() }
    el.addEventListener('pointerdown', touch)
    el.addEventListener('touchstart', touch, { passive: true })
    el.addEventListener('focus', onFocus)
    if (document.activeElement === el) el.blur()
    const t = setTimeout(() => el.removeEventListener('focus', onFocus), 1200)
    return () => { clearTimeout(t); el.removeEventListener('pointerdown', touch); el.removeEventListener('touchstart', touch); el.removeEventListener('focus', onFocus) }
  }, [ref])
}