import { useLayoutEffect } from 'react'

// Agent pages ease in on a route change: each top block goes from half visible
// and 8px low to its resting place, 40ms apart. Nothing in the CSS hides anything;
// a page that never eases is simply complete. Web Animations with fill 'backwards'
// (never 'forwards' or 'both'): it holds a delayed block at 0.5 until its turn and
// leaves no transform behind, because a leftover transform traps position: fixed
// (Gotchas). That is also why any block holding a fixed node is left out, and why
// the whole ease stops on the first press or key, or when a dialog appears.

const DIALOG = '[role=dialog],[aria-modal=true]'
// Banners above every page: not page content, so they neither ease nor count as it.
const BANNERS = '.ov-confirm-banner,.ov-grace-banner'
// One of these is a block to itself, not a wrapper to walk past.
const SURFACES = '.ov-card,.ov-hero'
const MAX_TARGETS = 8
const LAZY_WAIT_MS = 1500
const STAGGER_MS = 40
const KEYFRAMES = [
  { opacity: 0.5, transform: 'translateY(8px)' },
  { opacity: 1, transform: 'translateY(0)' },
]
// GSAP's power3.out, the curve from the Solvik demo.
const TIMING = { id: 'page-ease', duration: 250, easing: 'cubic-bezier(0.165, 0.84, 0.44, 1)', fill: 'backwards' }

function blockChildren(node) {
  const blocks = []
  for (const el of node.children) {
    const cs = getComputedStyle(el)
    if (cs.display === 'contents') { blocks.push(...blockChildren(el)); continue }
    if (cs.display === 'none' || cs.display === 'inline') continue
    if (cs.position === 'fixed' || cs.position === 'absolute') continue
    // Already dimmed or moved at rest: an ease to 1 and 0 would jump when it ended.
    if (cs.opacity !== '1' || cs.transform !== 'none') continue
    if (el.matches(BANNERS)) continue
    const box = el.getBoundingClientRect()
    if (box.width && box.height) blocks.push(el)
  }
  return blocks
}

const movable = el => !el.matches(DIALOG) && !el.querySelector(DIALOG)
  && ![...el.querySelectorAll('*')].some(n => getComputedStyle(n).position === 'fixed')

function pickTargets(wrapper) {
  let node = wrapper
  for (;;) {
    const blocks = blockChildren(node)
    if (blocks.length > 1) return blocks.filter(movable).slice(0, MAX_TARGETS)
    if (blocks.length === 1 && !blocks[0].matches(SURFACES)) { node = blocks[0]; continue }
    const last = blocks[0] || (node === wrapper ? null : node)
    return last && movable(last) ? [last] : []
  }
}

const addsDialog = r => (r.type === 'attributes'
  ? r.target.matches(DIALOG)
  : [...r.addedNodes].some(n => n.nodeType === 1 && (n.matches(DIALOG) || n.querySelector(DIALOG))))

// Starts the ease and returns what stops it early.
function runEase(wrapper, targets) {
  const anims = targets.map((el, i) => el.animate(KEYFRAMES, { ...TIMING, delay: i * STAGGER_MS }))
  const dialogs = new MutationObserver(records => { if (records.some(addsDialog)) stop() })
  const release = () => {
    window.removeEventListener('pointerdown', stop, true)
    window.removeEventListener('keydown', stop, true)
    dialogs.disconnect()
  }
  function stop() {
    release()
    anims.forEach(a => a.cancel())
  }
  dialogs.observe(wrapper, { childList: true, subtree: true, attributes: true, attributeFilter: ['role', 'aria-modal'] })
  window.addEventListener('pointerdown', stop, true)
  window.addEventListener('keydown', stop, true)
  anims[anims.length - 1].onfinish = release
  return stop
}

// `wrapperRef` is the keyed div around the page, so `pathname` changing means a new one.
export function usePageEase(wrapperRef, pathname, enabled) {
  useLayoutEffect(() => {
    const wrapper = wrapperRef.current
    if (!enabled || !wrapper) return undefined
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined

    const targets = pickTargets(wrapper)
    if (targets.length) return runEase(wrapper, targets)

    // A lazy page (fallback={null}) or a loading gate has nothing here yet. Ease its
    // first content once, from the moment it lands; anything after that just appears.
    let stopEase = null
    const quit = () => { arrival.disconnect(); clearTimeout(timer) }
    const arrival = new MutationObserver(() => {
      const found = pickTargets(wrapper)
      if (!found.length) return
      quit()
      stopEase = runEase(wrapper, found)
    })
    const timer = setTimeout(quit, LAZY_WAIT_MS)
    arrival.observe(wrapper, { childList: true, subtree: true })
    return () => { quit(); stopEase?.() }
  }, [wrapperRef, pathname, enabled])
}
