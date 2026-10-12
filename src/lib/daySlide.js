// Activity's day change (Prompt 718), shared with My calls (Prompt 748).

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

// The old day's half of the slide: a static copy of each day-dependent block
// ([data-day-slide]) goes out towards the side you came from while React
// mounts the new day, which comes in from the other side (.ov-slide-from-*).
// The copy sits in the block's .ov-slide-frame, which clips while it runs.
export function slideOut(root, dir) {
  if (!root) return
  const reduce = reducedMotion()
  const dx = dir === 'prev' ? 32 : -32
  root.querySelectorAll('[data-day-slide]').forEach(node => {
    const frame = node.parentElement
    if (!frame || !node.offsetWidth || typeof node.animate !== 'function') return
    const ghost = node.cloneNode(true)
    ghost.removeAttribute('data-day-slide')
    ghost.removeAttribute('class')
    ghost.setAttribute('aria-hidden', 'true')
    ghost.inert = true
    ghost.dataset.slideGhost = ''
    Object.assign(ghost.style, { position: 'absolute', left: '0', top: '0', width: `${node.offsetWidth}px`, pointerEvents: 'none' })
    frame.classList.add('is-sliding')
    frame.appendChild(ghost)
    const duration = reduce ? 120 : 240
    const anim = ghost.animate(
      reduce ? [{ opacity: 1 }, { opacity: 0 }] : [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: `translateX(${dx}px)` }],
      { duration, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)', fill: 'forwards' },
    )
    const done = () => {
      if (!ghost.isConnected) return
      ghost.remove()
      if (!frame.querySelector('[data-slide-ghost]')) frame.classList.remove('is-sliding')
    }
    anim.onfinish = done
    anim.oncancel = done
    // A hidden tab can pause the animation; never leave the copy behind.
    setTimeout(done, duration + 200)
  })
}
