// Icon buttons: a small spring wiggle on click, and on a desktop mouse a slight pull toward the pointer.
// Both are skipped under reduced motion (glass.css also turns the keyframes off there). Spread `wig` on the button.
const still = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

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
