import { createElement, useEffect, useRef, useState } from 'react'

// Motion for the shell. Reduced motion drops movement and count-ups (the final value shows at once); fades stay.
// Easing everywhere: cubic-bezier(0.2, 0.8, 0.2, 1). CSS side lives in flow.css.
export const still = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

// Icon buttons: a small spring wiggle on click, and on a desktop mouse a slight pull toward the pointer.
function wiggle(e) {
  const el = e.currentTarget
  if (!el || still()) return
  el.classList.remove('is-wig')
  void el.offsetWidth // restart the animation on a quick second click
  el.classList.add('is-wig')
}

function pull(e) {
  const el = e.currentTarget
  if (!el || still() || e.pointerType !== 'mouse') return
  const r = el.getBoundingClientRect()
  el.style.setProperty('--tp-px', `${((e.clientX - r.left) / r.width - 0.5) * 6}px`)
  el.style.setProperty('--tp-py', `${((e.clientY - r.top) / r.height - 0.5) * 6}px`)
}

function release(e) {
  e.currentTarget?.style.removeProperty('--tp-px')
  e.currentTarget?.style.removeProperty('--tp-py')
}

export const wig = { onClick: wiggle, onPointerMove: pull, onPointerLeave: release, onAnimationEnd: e => e.currentTarget.classList.remove('is-wig') }

// A number that counts up from 0 when it first shows (and eases to a new value when it changes).
// format: n => string. Under reduced motion it renders the final value straight away.
const ease = t => 1 - (1 - t) ** 3
export function CountUp({ value, format = n => Math.round(n).toLocaleString('en-US'), ms = 800, className }) {
  const target = Number(value) || 0
  const reduce = still()
  const [n, setN] = useState(0)
  const from = useRef(0)
  useEffect(() => {
    if (reduce) return undefined
    const start = performance.now()
    const a = from.current
    let raf = 0
    const tick = now => {
      // P859: a frame stamped before the effect began (a stalled or throttled browser) must not count backwards: clamp to 0..1.
      const t = Math.max(0, Math.min(1, (now - start) / ms))
      const v = a + (target - a) * ease(t)
      setN(v)
      from.current = v
      if (t < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    // A background tab runs no animation frames: land on the real number anyway, so it never sits at 0.
    const land = setTimeout(() => { cancelAnimationFrame(raf); from.current = target; setN(target) }, ms + 100) // P859: and stop the frame loop, or its next tick overwrites the landing
    return () => { cancelAnimationFrame(raf); clearTimeout(land) }
  }, [target, ms, reduce])
  return createElement('span', { className, 'aria-label': format(target) }, createElement('span', { 'aria-hidden': 'true' }, format(reduce ? target : n)))
}

export const usd = (cents = false) => n => `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 })}`

// The page title rolls in letter by letter from below. Each line is its own row; words never break.
export function RollTitle({ lines, className = '' }) {
  let i = 0
  return createElement('h1', { className: `tp-cn fx-title ${className}`, 'aria-label': lines.join(' ') },
    lines.map((line, li) => createElement('span', { key: li, className: 'fx-line', 'aria-hidden': 'true' },
      line.split(' ').map((word, wi) => createElement('span', { key: wi, className: 'fx-word' },
        [...word].map((ch, ci) => createElement('span', { key: ci, className: 'fx-ch', style: { '--i': i++ } }, ch)))))))
}

// Keeps the old page on screen while it fades out and lifts (~200ms), then shows the new one.
// pageKey: what counts as "a different page" (a record drawer opening on the same page is not one).
export function usePageSwap(pageKey, element) {
  const [shownKey, setShownKey] = useState(pageKey)
  const last = useRef(element)
  const leaving = shownKey !== pageKey
  // The newest look of the page on screen, kept so its leave shows it as it was. Written and read during render
  // on purpose: the leaving page must be the exact element from the last render before the address changed.
  // eslint-disable-next-line react-hooks/refs
  if (!leaving) last.current = element
  useEffect(() => {
    if (!leaving) return undefined
    const t = setTimeout(() => setShownKey(pageKey), still() ? 0 : 200)
    return () => clearTimeout(t)
  }, [leaving, pageKey])
  // eslint-disable-next-line react-hooks/refs
  return { el: leaving ? last.current : element, leaving, key: shownKey }
}

// P843: a panel that plays its way out. [shown, leaving]: shown stays true while the exit animation runs after open
// went false; leaving drives the is-leaving class. Reduced motion: no exit, it goes at once.
export function useExit(open, ms = 220) {
  const [prev, setPrev] = useState(open)
  const [leaving, setLeaving] = useState(false)
  if (open !== prev) { setPrev(open); setLeaving(!open && !still()) }
  useEffect(() => {
    if (!leaving) return undefined
    const t = setTimeout(() => setLeaving(false), ms)
    return () => clearTimeout(t)
  }, [leaving, ms])
  return [open || leaving, leaving && !open]
}
