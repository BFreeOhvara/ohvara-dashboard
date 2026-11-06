// P859 — content never waits on motion. The shell's entrance animations start from opacity 0 (fill-mode both), so a
// browser that does not actually tick them (a throttled or GPU-starved tab, a paused timeline) left the page body
// invisible while the frame (no entrance animation) showed. The watchdog below drops every entrance animation back to the
// visible resting look (.is-settled, admin.css) when they have not really started. Plain JS, no JSX, so a node test runs it.
export const SETTLE_MS = 600 // how long motion gets to get going before the page shows at rest
export const RECHECK_MS = 2000 // a second look, for a slow first paint
const STALLED_BELOW = 100 // ms: an animation older than SETTLE_MS that is still inside its first 100 ms has not run

// CSS animations only (they have an animationName): a hover transition that began a moment ago is not a stall.
const live = a => !!a.animationName && (a.playState === 'running' || a.playState === 'pending' || a.playState === 'paused')

// True when some entrance animation under `el` has not moved: it is still at its very first moment.
export function entranceStalled(anims) {
  return anims.some(a => live(a) && !(Number(a.currentTime) >= STALLED_BELOW))
}

// Starts the watchdog on the app element. Returns a stop function. `settle` runs at most once.
export function armEntrance(el, { still = false, timers = { set: (f, ms) => setTimeout(f, ms), clear: id => clearTimeout(id) } } = {}) {
  // On the app (the page) and on <html> (the drawers and panels, which render outside it).
  const settle = () => { el.classList.add('is-settled'); el.ownerDocument?.documentElement?.classList.add('ad-settled') }
  if (still) { settle(); return () => {} } // reduced motion: everything shows at once
  const check = () => {
    if (typeof el.getAnimations !== 'function') { settle(); return } // cannot tell, so show it
    if (entranceStalled(el.getAnimations({ subtree: true }))) settle()
  }
  const ids = [timers.set(check, SETTLE_MS), timers.set(check, RECHECK_MS)]
  return () => ids.forEach(id => timers.clear(id))
}
